"""Film mode phase 2: the film probe test build (core/src/fw/gr3x/film-probe.ts), executed in the built image.

 - The settings load (its entry, through the scaffold, every hook of the build: guard, probe) with
   the firmware's own load substituted: the record in use gets starts (0x9b1) + 1, every record
   is guarded as before, nothing else changes; with no record in use nothing is written.
 - The settings save (the same way): the record in use gets power-offs (0x9b3) + 1 before the
   firmware's save sees it, every record guarded.
 - The clock stub: pictures (0x9b2) + 1, then { 2000 + starts % 100, mode + 1 (at most 12), 1,
   power-offs % 24, pictures % 60 } for every value of the three bytes and of the mode; with the
   record pointer at 0 it is the camera's clock (0x536b6510), untouched.
 - The date imprint's context reads the clock stub.
Second form ('exposures', T10-FILMPROBE2): the clock stub only reads the pictures byte, and the date
imprint's exposure hook (SetShootingInfoResultBeforeExpose's entry) adds 1 to it first: run from
the hook to the function's second instruction, every argument register, lr and sp as they were, ip
= sp, the orientation and frame-look words written as without the probe, nothing written with no
record in use.
Third form ('sequence', T10-FILMPROBE3): no settings hooks; the entries of the multi-exposure end
(0x5346a910) and retake (0x5346a8d8) add 1 to 0x9b1 / 0x9b3, then the function's own first
instruction, every register kept; the exposure hook also leaves the state (byte 0x6c0 of the live
shooting record, 0 when a pointer is missing) at 0x55804388; the clock shows { 2000 + ends % 100,
state + 1 (at most 12), 1, retakes % 24, exposures % 60 }, nothing written.
Fourth form ('emitters', T10-FILMPROBE4): as the third, but each of the nine posters of UI event
0xb8 leaves its number at 0x55804388 (registers kept, then its own first instruction), the model's
end (0x5323a080) copies it to 0x55804389 (10 when none) and clears it, each exposure clears both,
and the clock's month is that byte + 1.
This does not establish the camera's start, power off, menus or pictures.
"""
import argparse,hashlib,json,random,struct
from pathlib import Path
from unicorn import arm_const as reg
from guard_probe import GuardProbe,guarded,SIZE,UD,RECS,LOAD_DATA,SAVE_DATA
from native_probe import STOP

if not __debug__:raise RuntimeError('Validation requires Python assertions')

STARTS,PICTURES,OFFS=0x9b1,0x9b2,0x9b3;END,RETAKE,STATE=0x5346a910,0x5346a8d8,0x55804388;SHOWN=0x55804389;MODEL_END=0x5323a080;
EMITTERS=(0x531a4d80,0x531a6ef4,0x531b3838,0x531cb5f4,0x532a7c84,0x532a7cb0,0x532a7cdc,0x532a7d08,0x532a7f6c);OBJ,HOLDER,LIVE=0x63034000,0x63035000,0x63036000;BEFORE_EXPOSE=0x534322d8
FRAME_LOOK,ORIENT,STASH,SINGLETON=0x55804384,0x55804380,0x55804378,0x553458b0
MODEL=0x55063f30;POINTER=MODEL+4;GET_TIME=0x536b6510
TIME=0x63030000;MODE=0x63031000

class Probe(GuardProbe):
    def __init__(self,data,manifest):
        super().__init__(data,manifest);self.clock=0
        for at in (0x55060000,0x55340000):
            try:self.uc.mem_map(at,0x10000)
            except Exception:pass
    def _hook(self,cpu,at,size,user):
        if at==GET_TIME:
            self.clock+=1;cpu.reg_write(reg.UC_ARM_REG_PC,cpu.reg_read(reg.UC_ARM_REG_LR))
        else:super()._hook(cpu,at,size,user)

def verify(data,manifest,seed=2610,rounds=64):
    e=manifest['entries'];assert manifest.get('filmProbe') and manifest.get('round10')
    form=manifest['filmProbe'];exposures=form in ('exposures','sequence','emitters');sequence=form in ('sequence','emitters');emitters=form=='emitters'
    sites={s['address']:s for s in manifest['sites']}
    max_ratio=max(r['id'] for r in manifest['menu'])
    want=lambda rec:guarded(rec,0,max_ratio)
    p=Probe(data,manifest);cpu=p.uc;rng=random.Random(seed);calls=0
    # The guard is outermost at both entries; the probe is in the chain (the guard's prior).
    for at in (LOAD_DATA,SAVE_DATA):assert 'guard' in sites[at]['reason']
    # 1. Load (the third form has no settings hooks: as the guard alone).
    for i in range(rounds):
        recs,ud=p.records(rng,pointers=i%8!=7);p.loads=0
        p.run(LOAD_DATA,STOP,{0:UD});calls+=1
        assert p.loads==1 and cpu.reg_read(reg.UC_ARM_REG_R0)==0x77
        for k,rec in enumerate(recs):
            w=bytearray(want(rec));ptr=struct.unpack_from('<I',ud,4+4*k)[0]
            if not ptr:w=bytearray(rec)
            if k==0 and ptr and not sequence:w[STARTS]=(rec[STARTS]+1)&255
            assert bytes(cpu.mem_read(RECS+k*0x1000,SIZE))==bytes(w),(i,k)
    # 2. Save: the firmware's save sees the record in use with power-offs + 1.
    for i in range(rounds):
        recs,ud=p.records(rng);p.saves=[]
        p.run(SAVE_DATA,STOP,{0:UD});calls+=1
        assert cpu.reg_read(reg.UC_ARM_REG_R0)==0x5a and len(p.saves)==1
        for k,rec in enumerate(recs):
            w=bytearray(want(rec))
            if k==0 and not sequence:w[OFFS]=(rec[OFFS]+1)&255
            assert p.saves[0][k]==bytes(w),(i,k)
    # 3. The clock stub.
    t=e['filmProbeTime']
    def clock(rec_ptr,mode_ptr):
        cpu.mem_write(POINTER,struct.pack('<I',rec_ptr));cpu.mem_write(MODEL,struct.pack('<I',mode_ptr))
        cpu.mem_write(TIME,bytes(16));p.clock=0
        p.call(t,0x1234,TIME)
        return bytes(cpu.mem_read(TIME,16))
    cases=0
    for v in range(256):
        for mode in (0,1,2,3,6,11,12,200,None):
            rec=bytearray(rng.randrange(256) for _ in range(SIZE));rec[STARTS]=v;rec[PICTURES]=(v*7+mode if mode else v*3)&255;rec[OFFS]=(255-v)
            cpu.mem_write(RECS,bytes(rec))
            if mode is not None:cpu.mem_write(MODE,bytes([mode]))
            if sequence:cpu.mem_write(SHOWN if emitters else STATE,bytes([mode or 0]))
            got=clock(RECS,MODE if mode is not None else 0);calls+=1;cases+=1
            pics=rec[PICTURES] if exposures else (rec[PICTURES]+1)&255
            after=bytearray(rec);after[PICTURES]=pics
            assert bytes(cpu.mem_read(RECS,SIZE))==bytes(after)
            month=min((mode or 0)+1,12) if sequence else 1 if mode is None else min(mode+1,12)
            assert got==struct.pack('<H',2000+v%100)+bytes([month,1,(255-v)%24,pics%60])+bytes(10),(v,mode,got.hex())
            assert p.clock==0
    got=clock(0,MODE);calls+=1
    assert p.clock==1 and got==bytes(16)
    # 4. The date imprint's context: cache, flush, clean, platform, then the clock.
    ctx=e['dateContext']
    assert struct.unpack('<I',cpu.mem_read(ctx+16,4))[0]==t
    # 5. The exposure hook.
    sites={s['address']:s for s in manifest['sites']}
    hook=e['exposureOrientation']
    assert int.from_bytes(bytes.fromhex(sites[BEFORE_EXPOSE]['replacement']),'little')==(0xea000000|(((hook-BEFORE_EXPOSE-8)>>2)&0xffffff))
    exposure_cases=0
    for v in (0,1,0x7f,0xfe,0xff):
        for with_rec in (True,False):
          for chain in ((None,0),(0,0),(2,1),(1,3),(0,7)) if sequence else ((None,0),):
           for pre in ((0xee,0xee),(3,7)) if emitters else ((0xee,0xee),):
            for stash in (0,0x1000b,0x10040|0x200):
                rec=bytearray(rng.randrange(256) for _ in range(SIZE));rec[PICTURES]=v;cpu.mem_write(RECS,bytes(rec))
                cpu.mem_write(POINTER,struct.pack('<I',RECS if with_rec else 0))
                cpu.mem_write(STASH,struct.pack('<I',stash));cpu.mem_write(FRAME_LOOK,bytes(4));cpu.mem_write(ORIENT,bytes(4))
                cpu.mem_write(SINGLETON,bytes(4));cpu.mem_write(STATE,bytes(pre))
                state,direction=chain
                if state is not None:
                    cpu.mem_write(SINGLETON,struct.pack('<I',OBJ));cpu.mem_write(OBJ+0x518,struct.pack('<I',HOLDER))
                    cpu.mem_write(HOLDER,struct.pack('<I',LIVE));cpu.mem_write(LIVE+0x6c0,bytes([state]));cpu.mem_write(LIVE+0xc8,bytes([direction]))
                regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444}
                p.run(hook,BEFORE_EXPOSE+4,regs);calls+=1;exposure_cases+=1
                for k,val in regs.items():assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%k))==val
                assert cpu.reg_read(reg.UC_ARM_REG_LR)==STOP and cpu.reg_read(reg.UC_ARM_REG_IP)==cpu.reg_read(reg.UC_ARM_REG_SP)
                after=bytearray(rec)
                if exposures and with_rec:after[PICTURES]=(v+1)&255
                assert bytes(cpu.mem_read(RECS,SIZE))==bytes(after),(v,with_rec)
                assert struct.unpack('<I',cpu.mem_read(FRAME_LOOK,4))[0]==stash
                if state is None:assert cpu.mem_read(ORIENT,4)==bytes(4)
                else:assert struct.unpack('<I',cpu.mem_read(ORIENT,4))[0]==((direction if direction<=3 else 0)|0x100)
                if emitters:assert cpu.mem_read(STATE,2)==bytes(2)
                elif sequence:assert cpu.mem_read(STATE,1)[0]==(state or 0)
                else:assert cpu.mem_read(STATE,1)[0]==0xee
    # 6. Third form: the multi-exposure end and retake, from the patched entries.
    seq_cases=0
    if sequence:
        for at,off in ((END,STARTS),(RETAKE,OFFS)):
            assert 'film probe' in sites[at]['reason']
            for v in (0,5,0xff):
                for with_rec in (True,False):
                    rec=bytearray(rng.randrange(256) for _ in range(SIZE));rec[off]=v;cpu.mem_write(RECS,bytes(rec))
                    cpu.mem_write(POINTER,struct.pack('<I',RECS if with_rec else 0))
                    regs={0:0xaaaa,1:0xbbbb,2:0xcccc,3:0xdddd}
                    p.run(at,at+4,regs);calls+=1;seq_cases+=1
                    for k,val in regs.items():assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%k))==val
                    assert cpu.reg_read(reg.UC_ARM_REG_LR)==STOP and cpu.reg_read(reg.UC_ARM_REG_IP)==cpu.reg_read(reg.UC_ARM_REG_SP)
                    after=bytearray(rec)
                    if with_rec:after[off]=(v+1)&255
                    assert bytes(cpu.mem_read(RECS,SIZE))==bytes(after),(hex(at),v,with_rec)
    else:
        for at in (END,RETAKE):assert at not in sites
    # 7. Fourth form: the posters and the model's end.
    if emitters:
        for k,at in enumerate(EMITTERS,1):
            assert 'film probe' in sites[at]['reason']
            cpu.mem_write(STATE,b'\x00\x55')
            regs={0:0x1010,1:0x2020,2:0x3030,3:0x4040}
            p.run(at,at+4,regs);calls+=1;seq_cases+=1
            for r,val in regs.items():assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%r))==val
            assert cpu.reg_read(reg.UC_ARM_REG_LR)==STOP and cpu.reg_read(reg.UC_ARM_REG_IP)==cpu.reg_read(reg.UC_ARM_REG_SP)
            assert cpu.mem_read(STATE,2)==bytes([k,0x55]),k
        assert 'film probe' in sites[MODEL_END]['reason']
        for e in (0,1,5,9):
            cpu.mem_write(STATE,bytes([e,0x77]))
            regs={0:0x5050,1:0x6060,2:0x7070,3:0x8080}
            p.run(MODEL_END,MODEL_END+4,regs);calls+=1;seq_cases+=1
            for r,val in regs.items():assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%r))==val
            assert cpu.mem_read(STATE,2)==bytes([0,e or 10]),e
    else:
        for at in EMITTERS+(MODEL_END,):assert at not in sites
    return dict(schema=1,sequence_cases=seq_cases,rtos_sha256=hashlib.sha256(data).hexdigest(),form='encodes' if form is True else form,calls=calls,clock_cases=cases,exposure_cases=exposure_cases,seed=seed,hardware_tested=False,
        scope='Load and save entries run natively (firmware load/save substituted); clock stub called directly.')

if __name__=='__main__':
    a=argparse.ArgumentParser(description=__doc__)
    for s in ('rtos','manifest','report'):a.add_argument('--'+s,type=Path,required=True)
    a=a.parse_args();result=verify(a.rtos.read_bytes(),json.loads(a.manifest.read_text()))
    with a.report.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
    print(json.dumps(result))
