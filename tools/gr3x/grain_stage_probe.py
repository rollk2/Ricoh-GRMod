"""The JPEG grain in a film mode build with `grain` (core/src/fw/gr3x/jpeg-stage.ts), in the emulator.

  python3 grain_stage_probe.py --rtos GR3.rtos --manifest patch-manifest.json --report out.json

  - the chain: JpegEncodeMacroProcess::Execute's entry branches to the halation's stub, which
    ends by entering the grain's, which ends by entering the date imprint's;
  - the grain's stub, run from its first word with the module replaced by a recorder: the module
    gets the context and the configuration ([r1 + 8]), r0..r3, ip, lr and the stack come back as
    they were, and it goes on into the date imprint's stub;
  - the context (jpeg_grain.c, struct gctx): the camera's cache functions and heap, the stash word,
    the recipes and profiles as grain-module.ts has them, the look map (the films the build marks
    black and white at 32 + k), the magic; the module's bytes are grain-module.ts's.
The module itself is checked against the PC by tools/develop/jpeg_grain_probe.py.
"""
import argparse,base64,hashlib,json,re,struct
from pathlib import Path
from unicorn import arm_const as reg
from film_roll_check import RollProbe
from native_probe import STOP,STACK

EXECUTE=0x535047d4
CACHE,FLUSH,CLEAN,ALLOC,FREE,STASH=0x536bbc30,0x536bbcc0,0x536bbcac,0x536af2a8,0x536af2e4,0x55804378
TS=(Path(__file__).resolve().parents[2]/'core/src/fw/gr3x/grain-module.ts').read_text()
get=lambda n:base64.b64decode(re.search(n+r" = '([^']*)'",TS).group(1))

def branch_target(word,at):
    assert word>>24==0xea,hex(word)
    off=word&0xffffff
    if off&0x800000:off-=1<<24
    return at+8+off*4

def verify(data,manifest):
    assert manifest.get('grain')==True
    j=manifest['lookEntries']['jpeg'];e=manifest['entries'];p=RollProbe(data,manifest);c=p.uc
    u32=lambda a:struct.unpack('<I',bytes(c.mem_read(a,4)))[0]
    # 1. The chain.
    assert branch_target(u32(EXECUTE),EXECUTE)==j['halation']
    def last_branch(stub):
        for a in range(stub,stub+0x200,4):
            w=u32(a)
            if w>>24==0xea:return branch_target(w,a)
    assert last_branch(j['halation'])==j['grain'],'halation then grain'
    assert last_branch(j['grain'])==e['dateStage'],'grain then the date'
    # 2. The stub, the module replaced by a recorder.
    module=j['grainModule'];seen=[]
    def rec(cpu):
        seen.append((cpu.reg_read(reg.UC_ARM_REG_R0),cpu.reg_read(reg.UC_ARM_REG_R1)))
        cpu.reg_write(reg.UC_ARM_REG_R0,0xdead);cpu.reg_write(reg.UC_ARM_REG_R1,0xbeef);cpu.reg_write(reg.UC_ARM_REG_R2,0x1);cpu.reg_write(reg.UC_ARM_REG_R3,0x2)
        cpu.reg_write(reg.UC_ARM_REG_IP,0x3);cpu.reg_write(reg.UC_ARM_REG_PC,cpu.reg_read(reg.UC_ARM_REG_LR))
    orig=p._hook
    def hook(cpu,at,size,user):
        if at==module:rec(cpu);return
        orig(cpu,at,size,user)
    p._hook=hook
    from unicorn import UC_HOOK_CODE
    c.hook_add(UC_HOOK_CODE,lambda cpu,at,size,user:hook(cpu,at,size,user) if at==module else None,begin=module,end=module)
    PROC=0x63050000;CONF=0x63051000
    c.mem_write(PROC,struct.pack('<3I',0,0,CONF))
    regs={0:0x1111,1:PROC,2:0x2222,3:0x3333,12:0x4444}
    for i in range(13):c.reg_write(getattr(reg,'UC_ARM_REG_R'+str(i)),regs.get(i,0x1230+i))
    c.reg_write(reg.UC_ARM_REG_SP,STACK);c.reg_write(reg.UC_ARM_REG_LR,0x5a5a5a5a)
    c.emu_start(j['grain'],e['dateStage'],count=200)
    assert c.reg_read(reg.UC_ARM_REG_PC)==e['dateStage'] and c.reg_read(reg.UC_ARM_REG_SP)==STACK and c.reg_read(reg.UC_ARM_REG_LR)==0x5a5a5a5a
    for k,v in regs.items():assert c.reg_read(getattr(reg,'UC_ARM_REG_R'+str(k)))==v,k
    assert seen==[(j['grainContext'],CONF)],seen
    # 3. The context and the module's bytes.
    ctx=struct.unpack('<10I',bytes(c.mem_read(j['grainContext'],40)))
    assert ctx[:6]==(CACHE,FLUSH,CLEAN,ALLOC,FREE,STASH) and ctx[9]==0x314e5247
    recipes,profiles=get('GR3X_GRAIN_RECIPES'),get('GR3X_GRAIN_PROFILES')
    assert bytes(c.mem_read(ctx[6],len(recipes)))==recipes and bytes(c.mem_read(ctx[7],len(profiles)))==profiles
    mono=bytes(c.mem_read(ctx[8],64));films=manifest['filmCount'];monofilms=manifest.get('monoFilms',[False]*films)
    for k in range(films):assert mono[32+k]==int(bool(monofilms[k])),(k,mono[32+k])
    code=get('GR3X_GRAIN_CODE');assert bytes(c.mem_read(module,len(code)))==code
    return dict(chain=['execute','halation','grain','date'],films=films,mono=[int(bool(m)) for m in monofilms],
        rtos_sha256=hashlib.sha256(data).hexdigest(),hardware_tested=False)

if __name__=='__main__':
    a=argparse.ArgumentParser(description=__doc__)
    for s in ('rtos','manifest','report'):a.add_argument('--'+s,type=Path,required=True)
    a=a.parse_args();result=verify(a.rtos.read_bytes(),json.loads(a.manifest.read_text()))
    with a.report.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
    print(json.dumps(result))
