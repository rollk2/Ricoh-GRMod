"""The camera's own grain on the films (core/src/fw/gr3x/grain-native.ts, T-GRAIN1), in the emulator.

  python3 grain_native_probe.py --rtos GR3.rtos --manifest patch-manifest.json --report out.json

The development step's look parameters run natively from their Standard case (0x536dbaa4, where a
film goes) and a monochrome case (Soft Monotone, 0x536db9d8) to the end of the function, through
the patched end (0x536db9c0): +0x1f8 must be the film's value for a film of the build, 0 for
Standard itself and for a look beyond the films, the live particle byte for the monochrome look;
the four live bytes written back and every other halfword of the block as without the patch.
"""
import argparse,hashlib,json,struct
from pathlib import Path
from unicorn import arm_const as reg
from film_roll_check import RollProbe
from native_probe import STOP

STANDARD,SOFT_MONO,END=0x536dbaa4,0x536db9d8,0x536db9c0
BLOCK,LIVE,FRAME=0x63050000,0x63051000,0x63052f00

def verify(data,manifest,base=None):
    levels=manifest['grainTest'];p=RollProbe(data,manifest);cpu=p.uc;cases={}
    sites={s['address']:s for s in manifest['sites']}
    assert 'native grain' in sites[END]['reason']
    def run(case,look,particle):
        cpu.mem_write(BLOCK,bytes(0x200)+b'\xee'*0x20)
        live=bytearray(range(256))*16;live=live[:0x800]
        live[0x77c]=look;live[0x795]=particle;cpu.mem_write(LIVE,bytes(live))
        # The function's frame: 0x10 bytes, then r4..r10 and the return address.
        cpu.mem_write(FRAME,bytes(0x10)+struct.pack('<8I',4,5,6,7,8,9,10,STOP))
        for i in range(13):cpu.reg_write(getattr(reg,'UC_ARM_REG_R%d'%i),0x1230+i)
        cpu.reg_write(reg.UC_ARM_REG_R0,BLOCK);cpu.reg_write(reg.UC_ARM_REG_R3,LIVE)
        cpu.reg_write(reg.UC_ARM_REG_SP,FRAME);cpu.reg_write(reg.UC_ARM_REG_CPSR,0x13)
        cpu.emu_start(case,STOP,count=20000)
        assert cpu.reg_read(reg.UC_ARM_REG_PC)==STOP and cpu.reg_read(reg.UC_ARM_REG_SP)==FRAME+0x30
        assert [cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%i)) for i in range(4,11)]==[4,5,6,7,8,9,10]
        return bytes(cpu.mem_read(BLOCK,0x220)),bytes(cpu.mem_read(LIVE+0x793,4))
    for look in [11,12,63]+[64+k for k in range(len(levels)+1)]:
        for particle in (0,1,3):
            block,back=run(STANDARD,look,particle)
            k=look-64;want=levels[k] if 0<=k<len(levels) else 0
            assert struct.unpack_from('<H',block,0x1f8)[0]==want,(look,particle,block[0x1f8:0x1fa].hex())
            ref,refback=run(STANDARD,11,particle)
            assert block[:0x1f8]==ref[:0x1f8] and block[0x1fa:]==ref[0x1fa:] and back==refback,(look,particle)
            assert back[2]==0,'Standard writes the live particle byte back as 0'
            cases['standard case']=cases.get('standard case',0)+1
    for particle in (0,1,2,3):
        block,back=run(SOFT_MONO,14,particle)
        assert struct.unpack_from('<H',block,0x1f8)[0]==particle and back[2]==particle
        cases['monochrome case']=cases.get('monochrome case',0)+1
    return dict(cases=cases,levels=levels,rtos_sha256=hashlib.sha256(data).hexdigest(),hardware_tested=False)

if __name__=='__main__':
    a=argparse.ArgumentParser(description=__doc__)
    for s in ('rtos','manifest','report'):a.add_argument('--'+s,type=Path,required=True)
    a=a.parse_args();result=verify(a.rtos.read_bytes(),json.loads(a.manifest.read_text()))
    with a.report.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
    print(json.dumps(result))
