"""Film mode phase 3.1: the roll's state and frame counter (core/src/fw/gr3x/film-roll.ts), executed in the built image.

 - The first exposure (the date imprint's exposure hook, SetShootingInfoResultBeforeExpose's entry):
   in a mode 1..6 with no roll started, the record in use and the BOX's stored record get bit 1 of
   0x9b1 and frame 1 (0x9b2); nothing else changes, nothing in mode 0, with a roll started, or with a
   missing pointer; every argument register, lr and sp as they were, ip = sp at the function's second
   instruction.
 - The model's end (0x5323a080): with a roll started and the multi-exposure state 2, the frame
   advances in both records; past the roll's length (from the ratio at +0x4c2: 36 for 3:2, 12 for
   1:1, 21 for XPan, 36 otherwise) the roll ends (bit 1 and the frame cleared); then the record in use
   and the BOX's record are written (0x53826c54(store, 1, 0xb26, record in use) then (store, mode + 2,
   0xb26, BOX record), store = [0x53828014() + 8], both substituted); nothing at all otherwise;
   every register kept, then the function's second instruction.
 - The screen counter (0x532aa1f4): r2 = the frame in a mode 1..6 with a roll started, 1 without,
   the count (r0) in mode 0 or with a missing pointer; r0, r1, r3 kept.
 - Save Settings into BOX n (0x5324b760, the native body substituted from its second instruction):
   the native result returned; BOX n's bit 1 and frame cleared (1 <= n <= 6), the record in use's too
   when n is the active mode; nothing else.
 - The mode recall, run natively from the copy of the stored record to just before the live values
   (as guard_probe): the record in use's Save Interim Images (+0x482) is 0 after recalling 1..6, and
   as copied after recalling 0.
This does not establish the camera's storage, menus or pictures.
"""
import argparse,hashlib,json,random,struct
from pathlib import Path
from unicorn import arm_const as reg
from film_probe_check import Probe
from guard_probe import RECALL_FROM,RECALL_TO,UD,RECS,SIZE
from native_probe import STOP

if not __debug__:raise RuntimeError('Validation requires Python assertions')

FLAGS,FRAME,FOLDER,INTERIM,RATIO=0x9b1,0x9b2,0x9b3,0x482,0x4c2
SET_FILE_PATH,NEXT_FOLDER,FOLDER_MARK=0x535b2e8c,0x535b742c,0x535a6dac;SVC,WRAP,DIRS,TABLE,PATH=0x63050000,0x63051000,0x63052000,0x63053000,0x63054000
MODEL=0x55063f30;POINTER=MODEL+4;STORED=MODEL+8;SINGLETON=0x553458b0
BEFORE_EXPOSE,MODEL_END,COUNTER,BOX_SAVE=0x534322d8,0x5323a080,0x532aa1f4,0x5324b760
APP_DATA,APP_WRITE=0x53828014,0x53826c54
CUR,BOXES,OBJ,STORE,LIVE1,LIVE2,LIVE3=0x63040000,0x63042000,0x6304a000,0x6304b000,0x6304c000,0x6304d000,0x6304e000
LENGTHS={0:36,3:12,4:21}

class RollProbe(Probe):
    def __init__(self,data,manifest):
        super().__init__(data,manifest);self.writes=[];self.box_native=0;self.next=0;self.next_calls=0
        for at in range(0x63040000,0x63058000,0x1000):
            try:self.uc.mem_map(at,0x1000)
            except Exception:pass
    def _hook(self,cpu,at,size,user):
        r=lambda n:cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%n))
        ret=lambda v:(cpu.reg_write(reg.UC_ARM_REG_R0,v),cpu.reg_write(reg.UC_ARM_REG_PC,cpu.reg_read(reg.UC_ARM_REG_LR)))
        if at==APP_DATA:ret(OBJ)
        elif at==APP_WRITE:self.writes.append((r(0),r(1),r(2),r(3)));ret(1)
        elif at==NEXT_FOLDER:
            assert r(0)==WRAP;self.next_calls+=1;ret(self.next)
        elif at==BOX_SAVE+4:
            assert r(1)==self.box_n;self.box_native+=1;ret(0x66)
        else:super()._hook(cpu,at,size,user)

def verify(data,manifest,seed=3101):
    assert manifest.get('filmRoll') and manifest.get('round10')
    e=manifest['entries'];sites={s['address']:s for s in manifest['sites']}
    for at in (MODEL_END,COUNTER,BOX_SAVE):assert 'film roll' in sites[at]['reason'],hex(at)
    max_id=max(r['id'] for r in manifest['menu'])
    p=RollProbe(data,manifest);cpu=p.uc;rng=random.Random(seed);cases={}
    count=lambda k:cases.__setitem__(k,cases.get(k,0)+1)
    cpu.mem_write(OBJ+8,struct.pack('<I',STORE))
    def setup(mode,cur=None,box=None,model=True,pointer=True,state=2):
        cur=bytearray(rng.randrange(256) for _ in range(SIZE)) if cur is None else bytearray(cur)
        boxes=[bytearray(rng.randrange(256) for _ in range(SIZE)) for _ in range(8)]
        if box is not None:boxes[mode]=bytearray(box)
        cpu.mem_write(CUR,bytes(cur))
        for i,b in enumerate(boxes):cpu.mem_write(BOXES+i*0x1000,bytes(b))
        cpu.mem_write(OBJ+0x100,bytes([mode]))
        cpu.mem_write(MODEL,struct.pack('<II',OBJ+0x100 if model else 0,CUR if pointer else 0))
        cpu.mem_write(STORED,b''.join(struct.pack('<I',BOXES+i*0x1000) for i in range(8)))
        cpu.mem_write(SINGLETON,struct.pack('<I',LIVE1));cpu.mem_write(LIVE1+0x518,struct.pack('<I',LIVE2));cpu.mem_write(LIVE2,struct.pack('<I',LIVE3))
        cpu.mem_write(LIVE3+0x6c0,bytes([state]))
        return cur,boxes
    def state():
        return bytes(cpu.mem_read(CUR,SIZE)),[bytes(cpu.mem_read(BOXES+i*0x1000,SIZE)) for i in range(8)]
    def kept(regs,second=None):
        for k,v in regs.items():assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%k))==v,k
        assert cpu.reg_read(reg.UC_ARM_REG_LR)==STOP
        if second:assert cpu.reg_read(reg.UC_ARM_REG_IP)==cpu.reg_read(reg.UC_ARM_REG_SP)
    # 1. The first exposure (the date imprint's hook, which runs the roll's code first).
    hook=e['exposureOrientation']
    for mode in range(8):
        for started in (False,True):
            for model,pointer in ((True,True),(False,True),(True,False)):
                cur,boxes=setup(mode,model=model,pointer=pointer)
                for b in [cur]+boxes:b[FLAGS]=(b[FLAGS]&~2)|(2 if started else 0)
                cpu.mem_write(CUR,bytes(cur))
                for i,b in enumerate(boxes):cpu.mem_write(BOXES+i*0x1000,bytes(b))
                cpu.mem_write(SINGLETON,bytes(4))
                regs={0:5,1:6,2:7,3:8};p.run(hook,BEFORE_EXPOSE+4,regs);count('exposure');kept(regs,True)
                c2,b2=state()
                want_c,want_b=bytearray(cur),[bytearray(b) for b in boxes]
                if 1<=mode<=6 and not started and model and pointer:
                    for b in (want_c,want_b[mode]):b[FLAGS]=(b[FLAGS]|2)&~0xc;b[FRAME]=1;b[FOLDER]=0
                assert c2==bytes(want_c) and b2==[bytes(b) for b in want_b],(mode,started,model,pointer)
    # 2. The model's end.
    for mode in range(8):
        for ratio in sorted(set([0,3,4,max_id,1,2]+[rng.randrange(256)])):
            L=LENGTHS.get(ratio,36) if ratio<=max_id else 36
            for frame in (1,2,L-1,L,L+5):
                for started,st in ((True,2),(True,0),(True,1),(False,2)):
                    cur,boxes=setup(mode,state=st)
                    for b in (cur,boxes[mode]):
                        b[FLAGS]=(b[FLAGS]&~2)|(2 if started else 0);b[FRAME]=frame&255;b[RATIO]=ratio
                    cpu.mem_write(CUR,bytes(cur));cpu.mem_write(BOXES+mode*0x1000,bytes(boxes[mode]))
                    p.writes=[];regs={0:0xa1,1:0xb2,2:0xc3,3:0xd4,4:0x44,5:0x55,6:0x66}
                    p.run(MODEL_END,MODEL_END+4,regs);count('end');kept(regs,True)
                    c2,b2=state();want_c,want_b=bytearray(cur),[bytearray(b) for b in boxes]
                    advance=1<=mode<=6 and started and st==2
                    if advance:
                        nf=frame+1
                        for b in (want_c,want_b[mode]):
                            if nf>L:b[FLAGS]&=~0xe;b[FRAME]=0;b[FOLDER]=0
                            else:b[FRAME]=nf&255
                        assert p.writes==[(STORE,1,0xb26,CUR),(STORE,mode+2,0xb26,BOXES+mode*0x1000)],p.writes
                        count('advance' if nf<=L else 'roll end')
                    else:assert p.writes==[]
                    assert c2==bytes(want_c) and b2==[bytes(b) for b in want_b],(mode,ratio,frame,started,st)
    cur,boxes=setup(2,model=False);p.writes=[];p.run(MODEL_END,MODEL_END+4,{});assert p.writes==[] and state()==(bytes(cur),[bytes(b) for b in boxes])
    cur,boxes=setup(2,pointer=False);p.writes=[];p.run(MODEL_END,MODEL_END+4,{});assert p.writes==[]
    cur,boxes=setup(2);cur[FLAGS]|=2;cpu.mem_write(CUR,bytes(cur));cpu.mem_write(SINGLETON,bytes(4));p.writes=[];p.run(MODEL_END,MODEL_END+4,{});assert p.writes==[]
    # 3. The screen counter.
    for mode in range(8):
        for started in (False,True):
            for frame in (0,1,17,72):
                for count_v in (0,93,123456):
                    cur,boxes=setup(mode);cur[FLAGS]=(cur[FLAGS]&~2)|(2 if started else 0);cur[FRAME]=frame;cpu.mem_write(CUR,bytes(cur))
                    p.run(COUNTER,COUNTER+4,{0:count_v,1:0x11,3:0x33,4:0x44});count('counter')
                    want=(frame if started else 1) if 1<=mode<=6 else count_v
                    assert cpu.reg_read(reg.UC_ARM_REG_R2)==want,(mode,started,frame,count_v)
                    kept({0:count_v,1:0x11,3:0x33,4:0x44})
    cur,boxes=setup(3,pointer=False);p.run(COUNTER,COUNTER+4,{0:55});assert cpu.reg_read(reg.UC_ARM_REG_R2)==55
    # 4. Save Settings into BOX n.
    for active in range(8):
        for n in range(9):
            cur,boxes=setup(active)
            for b in [cur]+boxes:b[FLAGS]|=2;b[FRAME]=9
            cpu.mem_write(CUR,bytes(cur))
            for i,b in enumerate(boxes):cpu.mem_write(BOXES+i*0x1000,bytes(b))
            # The object's first eight words as UserDataModel's: r0 is the object (0x55063f30).
            p.box_n=n;p.box_native=0
            p.run(BOX_SAVE,STOP,{0:MODEL,1:n});count('box save')
            assert p.box_native==1 and cpu.reg_read(reg.UC_ARM_REG_R0)==0x66
            c2,b2=state();want_c,want_b=bytearray(cur),[bytearray(b) for b in boxes]
            if 1<=n<=6:
                want_b[n][FLAGS]&=~0xe;want_b[n][FRAME]=0;want_b[n][FOLDER]=0
                if active==n:want_c[FLAGS]&=~0xe;want_c[FRAME]=0;want_c[FOLDER]=0
            assert c2==bytes(want_c) and b2==[bytes(b) for b in want_b],(active,n)
    # 5. The mode recall (guard_probe's layout: object UD, records at RECS + i * 0x1000).
    for mode in range(7):
        for _ in range(4):
            recs,ud=p.records(rng)
            p.run(RECALL_FROM,RECALL_TO,{5:UD,6:mode});count('recall')
            got=bytes(cpu.mem_read(RECS,0xb26));src=recs[1+mode]
            assert got[INTERIM]==(0 if mode else src[INTERIM]),(mode,got[INTERIM],src[INTERIM])
            assert bytes(cpu.mem_read(RECS+(1+mode)*0x1000,SIZE))==src
    # 6. Form 'folders': the roll's folder at SetFilePath's entry.
    folders=manifest['filmRoll']=='folders'
    assert (SET_FILE_PATH in sites)==folders and (FOLDER_MARK in sites)==folders
    if folders:
        enc=lambda b,f:(b.__setitem__(FLAGS,(b[FLAGS]&~0xc)|((f>>8)&3)<<2),b.__setitem__(FOLDER,f&255))
        dec=lambda b:b[FOLDER]|((b[FLAGS]>>2)&3)<<8
        def dirs(existing,highest):
            cpu.mem_write(SVC+8,struct.pack('<I',WRAP));cpu.mem_write(WRAP+8,struct.pack('<I',DIRS))
            cpu.mem_write(DIRS+0x10,struct.pack('<I',TABLE));cpu.mem_write(DIRS+0x2a,struct.pack('<H',highest-100))
            t=bytearray(0x1000)
            for f in existing:struct.pack_into('<I',t,(f-100)*4,0x7000+f)
            cpu.mem_write(TABLE,bytes(t))
        def run(given):
            path=bytearray(rng.randrange(256) for _ in range(16));path[4:6]=struct.pack('<H',given);cpu.mem_write(PATH,bytes(path))
            regs={0:SVC,1:0x1111,2:PATH,3:0x3333,4:0x44,5:0x55,6:0x66};p.next_calls=0
            p.run(SET_FILE_PATH,SET_FILE_PATH+4,regs);count('folder');kept(regs,True)
            return path,struct.unpack_from('<H',bytes(cpu.mem_read(PATH,16)),4)[0],bytes(cpu.mem_read(PATH,16))
        for mode in range(8):
            for started in (False,True):
                for folder in (0,99,100,105,512,999,1000,1023):
                    for nxt in (0,113):
                        for given in (0,107):
                            dirs([100,105,107,512,999],112);p.next=nxt
                            cur,boxes=setup(mode)
                            for b in [cur]+boxes:b[FLAGS]=(b[FLAGS]&~2)|(2 if started else 0);enc(b,folder)
                            # Free modes: no other BOX's roll in folder 112 (the highest).
                            for i in range(1,7):
                                if i!=mode and dec(boxes[i])==112:enc(boxes[i],0)
                            cpu.mem_write(CUR,bytes(cur))
                            for i,b in enumerate(boxes):cpu.mem_write(BOXES+i*0x1000,bytes(b))
                            path,got,raw=run(given)
                            want_c,want_b=bytearray(cur),[bytearray(b) for b in boxes]
                            roll=1<=mode<=6 and started
                            if given:want=given
                            elif roll and folder in (100,105,512,999):want=folder
                            elif roll:
                                want=nxt or 0
                                if nxt:
                                    for b in (want_c,want_b[mode]):enc(b,nxt)
                            else:want=0
                            assert got==want and raw[:4]==bytes(path[:4]) and raw[6:]==bytes(path[6:]),(mode,started,folder,nxt,given,got,want)
                            assert state()==(bytes(want_c),[bytes(b) for b in want_b]),(mode,started,folder,nxt,given)
        # Free modes: the highest folder is a started roll's folder of a BOX.
        for mode in (0,2,7):
            for owner in range(1,7):
                for owner_started in (True,False):
                    for nxt in (0,113):
                        dirs([100,112],112);p.next=nxt
                        cur,boxes=setup(mode)
                        cur[FLAGS]&=~2
                        for i in range(1,7):
                            boxes[i][FLAGS]&=~2;enc(boxes[i],0)
                        boxes[owner][FLAGS]|=2 if owner_started else 0;enc(boxes[owner],112)
                        if mode==owner:cur=bytearray(boxes[owner]);cur[FLAGS]&=~2
                        cpu.mem_write(CUR,bytes(cur))
                        for i,b in enumerate(boxes):cpu.mem_write(BOXES+i*0x1000,bytes(b))
                        path,got,raw=run(0)
                        want=nxt if owner_started else 0
                        assert got==want,(mode,owner,owner_started,nxt,got)
                        assert state()==(bytes(cur),[bytes(b) for b in boxes])
                        count('free mode, roll folder highest' if owner_started else 'free mode')
    return dict(schema=1,revision='T11-ROLL2' if folders else 'T11-ROLL1',rtos_sha256=hashlib.sha256(data).hexdigest(),cases=cases,seed=seed,hardware_tested=False,
        scope='Hooks run from their patched sites (firmware storage and the native BOX save body substituted); the recall runs natively.')

if __name__=='__main__':
    a=argparse.ArgumentParser(description=__doc__)
    for s in ('rtos','manifest','report'):a.add_argument('--'+s,type=Path,required=True)
    a=a.parse_args();result=verify(a.rtos.read_bytes(),json.loads(a.manifest.read_text()))
    with a.report.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
    print(json.dumps(result))
