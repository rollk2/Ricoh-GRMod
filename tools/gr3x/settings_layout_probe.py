"""Film mode, phase 2: the layout of the user-settings record and its free bytes.

The record (0xb28 bytes, *0x55063f34 and the seven stored ones at UserDataModel + 8 .. + 0x20) is
a row of fields { value; u8 flag; }. The default merge (0x53246df8, which ends in 0x5324075c)
copies a field's factory value (from the default builder 0x532406fc) into the record when that
field's flag is set. Run natively here with one byte at 1 at a time, it gives every field: its
flag byte and the value bytes it copies. Bytes neither a value nor a flag are padding.

The padding is then checked against the whole program (0x53000000 .. 0x53b00000, linear sweep):
every load, store and address computation with an immediate offset (`ldr/str` of every size,
`ldrd/strd`, `vldr/vstr`, `add rd,rn,#k`, a constant offset in a register, plus the offset of an
earlier `add` on the base register). An access goes "through a record pointer" when its base was
loaded from [object, #4 .. #0x20] (the record in use, the stored ones) or from *0x55063f34. It is
"exact" when it starts at the byte or is a byte / halfword covering it; a wider one starting
elsewhere is another object's word or a copy of several fields. A free byte has no exact access
through a record pointer. Known limit: a record pointer received as a parameter is not followed,
so the accesses of any base are listed too, for review (docs/film-mode-notes.md). The bulk
operations (default builder, load, save, mode recall) are not covered here.

Usage: python3 settings_layout_probe.py --rtos GR3.rtos --report out.json
"""
import argparse,hashlib,json,struct
from pathlib import Path
from capstone import Cs,CS_ARCH_ARM,CS_MODE_ARM
from capstone import arm_const as A
from unicorn import arm_const as reg
from native_probe import NativeProbe,STACK,STOP

if not __debug__:raise RuntimeError('Validation requires Python assertions')

SIZE=0xb28;MERGE=0x53246df8;MERGE_TAIL=0x5324075c;DEFAULTS=0x532406fc
REC=0x62040000;DEF=0x62042000;MODEL=0x62044000;CUR=0x62046000
CODE_END=0x53b00000
# Bytes GR Mod already uses in the padding (soft focus, date imprint, End Screen picture).
GRMOD={0x9a1:'soft focus',0x9a2:'date imprint',0x9a3:'End Screen picture',0x9a9:'End Screen picture',
       0x9aa:'End Screen picture',0x9ab:'End Screen picture'}
RECALL_COPY=0xb26  # the mode recall and the load copy 0xb26 bytes

class Merge(NativeProbe):
    def __init__(self,data):
        super().__init__(data);self.defaults=0;self.outside=set();self.tail=False
    def _hook(self,cpu,at,size,user):
        if at==MERGE_TAIL and not self.tail:
            cpu.reg_write(reg.UC_ARM_REG_PC,cpu.reg_read(reg.UC_ARM_REG_LR))
        elif at==DEFAULTS:
            self.defaults+=1;cpu.reg_write(reg.UC_ARM_REG_R0,DEF);cpu.reg_write(reg.UC_ARM_REG_PC,cpu.reg_read(reg.UC_ARM_REG_LR))
        else:
            if not (MERGE<=at<0x5324b284 or MERGE_TAIL<=at<MERGE_TAIL+0x1000 or 0x53141e04<=at<0x53141f00):self.outside.add(at)
            super()._hook(cpu,at,size,user)
    def run(self,rec,dflt,index=0):
        self.tail=False
        self.uc.mem_write(REC,bytes(rec));self.uc.mem_write(DEF,bytes(dflt));self.uc.mem_write(MODEL,bytes(0x100))
        self.call(MERGE,MODEL,REC,index)
        return bytes(self.uc.mem_read(REC,SIZE))
    def run_tail(self,current,dflt):
        """The merge's tail: copies a factory value into the record (r1) when the record in use
        (model + 4) has that field's flag at 0."""
        self.tail=True
        self.uc.mem_write(REC,bytes(SIZE));self.uc.mem_write(DEF,bytes(dflt));self.uc.mem_write(CUR,bytes(current))
        self.uc.mem_write(MODEL,bytes(0x100));self.uc.mem_write(MODEL+4,struct.pack('<I',CUR))
        self.call(MERGE_TAIL,MODEL,REC)
        return bytes(self.uc.mem_read(REC,SIZE))

def layout(data):
    m=Merge(data);fields={}
    for flag in range(SIZE):
        rec=bytearray(SIZE);rec[flag]=1
        out=m.run(rec,b'\xff'*SIZE)
        changed=[i for i in range(SIZE) if out[i]!=rec[i]]
        if changed:fields[flag]=changed
    # The same with factory values 0x5a: a copy must not depend on the value.
    for flag,vals in fields.items():
        rec=bytearray(SIZE);rec[flag]=1
        out=m.run(rec,b'\x5a'*SIZE)
        assert [i for i in range(SIZE) if out[i]!=rec[i]]==vals,hex(flag)
    # No flag: nothing changes.
    assert m.run(bytes(SIZE),b'\xff'*SIZE)==bytes(SIZE)
    # The tail: with every byte of the record in use at 1, it copies nothing; one byte at 0 at a
    # time gives the fields it governs.
    assert m.run_tail(b'\x01'*SIZE,b'\xff'*SIZE)==bytes(SIZE)
    tail={}
    for flag in range(SIZE):
        cur=bytearray(b'\x01'*SIZE);cur[flag]=0
        out=m.run_tail(cur,b'\xff'*SIZE)
        changed=[i for i in range(SIZE) if out[i]]
        if changed:tail[flag]=changed
    return fields,tail,sorted(m.outside)

POINTER=0x55063f34
def scan(data):
    """Immediate offsets of the program in 0..SIZE-1, linear sweep of 0x53000000 .. CODE_END.
    Returns three maps {byte: [(instruction address, offset, size)]}: `hits`, every access whatever the base;
    `record`, accesses through a register holding a record pointer (loaded from [object, #4 ..
    #0x20] or from *0x55063f34, moved or offset by `add`); `loose`, `mov/movw` of the value."""
    cs=Cs(CS_ARCH_ARM,CS_MODE_ARM);cs.detail=True
    hits={};record={};loose={}
    sizes={'ldrb':1,'strb':1,'ldrsb':1,'ldrh':2,'strh':2,'ldrsh':2,'ldr':4,'str':4,'ldrd':8,'strd':8,'ldrex':4,'strex':4}
    FRAME=(A.ARM_REG_SP,A.ARM_REG_FP,A.ARM_REG_PC)
    CALLER=(A.ARM_REG_R0,A.ARM_REG_R1,A.ARM_REG_R2,A.ARM_REG_R3,A.ARM_REG_R12,A.ARM_REG_LR)
    def mark(lo,n,at,rec):
        for b in range(max(lo,0),min(lo+n,SIZE)):
            hits.setdefault(b,[]).append((at,lo,n))
            if rec:record.setdefault(b,[]).append((at,lo,n))
    off_={};const={};rec={}
    def kill(r):off_.pop(r,None);const.pop(r,None);rec.pop(r,None)
    for off in range(0,CODE_END-0x53000000,4):
        at=0x53000000+off;rows=list(cs.disasm(data[off:off+4],at))
        if not rows:off_.clear();const.clear();rec.clear();continue
        i=rows[0];mn=i.mnemonic;cond=len(mn)>2 and mn[-2:] in ('eq','ne','cs','hs','cc','lo','mi','pl','vs','vc','hi','ls','ge','lt','gt','le')
        mnb=mn[:-2] if cond else mn;ops=i.operands
        # A function's start: nothing is known.
        if i.bytes==b'\x0d\xc0\xa0\xe1' or (mnb=='push' and any(o.reg==A.ARM_REG_LR for o in ops)):
            off_.clear();const.clear();rec.clear();continue
        if mnb in ('bl','blx'):
            for r in CALLER:kill(r)
            continue
        if mnb in ('b','bx','pop','push') or mnb.startswith('ldm') and any(o.type==A.ARM_OP_REG and o.reg==A.ARM_REG_PC for o in ops):continue
        if mnb in ('mov','movw') and len(ops)==2 and ops[1].type==A.ARM_OP_IMM:
            kill(ops[0].reg);const[ops[0].reg]=ops[1].imm
            if 0x100<=ops[1].imm<SIZE:loose.setdefault(ops[1].imm,[]).append(at)
            continue
        if mnb=='movt' and len(ops)==2:
            v=(const.get(ops[0].reg,0)&0xffff)|(ops[1].imm<<16);kill(ops[0].reg);const[ops[0].reg]=v;continue
        if mnb=='mov' and len(ops)==2 and ops[1].type==A.ARM_OP_REG:
            src=ops[1].reg;d=ops[0].reg;o,c,r=off_.get(src),const.get(src),rec.get(src)
            if not cond:kill(d)
            if o is not None:off_[d]=o
            if c is not None:const[d]=c
            if r:rec[d]=True
            continue
        if mnb in ('add','sub') and len(ops)==3 and ops[0].type==A.ARM_OP_REG and ops[1].type==A.ARM_OP_REG and ops[2].type==A.ARM_OP_IMM:
            src=ops[1].reg;d=ops[0].reg;r=rec.get(src)
            k=ops[2].imm*(1 if mnb=='add' else -1)+off_.get(src,0)
            if src not in FRAME and 0<k<SIZE:mark(k,1,at,r)
            kill(d)
            if src not in FRAME:off_[d]=k
            if r:rec[d]=True
            continue
        n=sizes.get(mnb)
        if mnb in ('vldr','vstr'):n=8 if any(o.type==A.ARM_OP_REG and A.ARM_REG_D0<=o.reg<=A.ARM_REG_D31 for o in ops) else 4
        if n:
            for o in ops:
                if o.type==A.ARM_OP_MEM and o.mem.base not in FRAME:
                    b=o.mem.base;r=rec.get(b)
                    if o.mem.index==0:mark(o.mem.disp+off_.get(b,0),n,at,r)
                    elif o.mem.index in const and not o.mem.lshift:mark(const[o.mem.index]+off_.get(b,0),n,at,r)
                    elif r:
                        # A record pointer indexed by an unknown register: report it, whatever the byte.
                        record.setdefault('indexed',[]).append(at)
            if mnb=='ldr' and ops[0].type==A.ARM_OP_REG:
                m=ops[1].mem;d=ops[0].reg
                isrec=m.index==0 and m.base not in FRAME and (4<=m.disp<=0x20 and m.disp%4==0 and not off_.get(m.base) or const.get(m.base)==POINTER and m.disp==0)
                kill(d)
                if isrec:rec[d]=True
                continue
        if ops and ops[0].type==A.ARM_OP_REG and not mnb.startswith('str') and not mnb.startswith('cmp') and not mnb.startswith('tst'):kill(ops[0].reg)
    return hits,record,loose

def verify(data):
    fields,tail,outside=layout(data)
    owner={}
    for flag,vals in fields.items():
        owner[flag]=('flag',flag)
        for v in vals:
            if v!=flag:
                assert v not in owner or owner[v]==('value',flag),hex(v);owner[v]=('value',flag)
    padding=[b for b in range(SIZE) if b not in owner]
    # The tail's flags are in the record in use, its values in the record merged.
    tail_bytes={v for vals in tail.values() for v in vals}|set(tail)
    hits,record,loose=scan(data)
    rows=[]
    for b in padding:
        # Exact: an access starting at the byte, or a byte / halfword one covering it. Wide: a
        # word or more starting elsewhere (another object's word, or a copy of several fields).
        exact=lambda acc:[a for a in acc if a[1]==b or a[2]<=2]
        rec=record.get(b,[]);every=hits.get(b,[])
        rows.append({'byte':hex(b),'grmod':GRMOD.get(b),'accesses':len(every),'exact':len(exact(every)),
                     'record_exact':[f'{a:x} [+{o:#x}, {n}]' for a,o,n in exact(rec)],
                     'record_wide':[f'{a:x} [+{o:#x}, {n}]' for a,o,n in rec if (a,o,n) not in exact(rec)],
                     'constants':[hex(a) for a in loose.get(b,[])[:6]],
                     'tail':b in tail_bytes,'recall_copies':b<RECALL_COPY})
    return {'rtos_sha256':hashlib.sha256(data).hexdigest(),'fields':len(fields),
            'field_list':[{'flag':hex(f),'value':[hex(v) for v in vals if v!=f]} for f,vals in sorted(fields.items())],
            'tail':[{'flag':hex(f),'value':[hex(v) for v in vals]} for f,vals in sorted(tail.items())],
            'outside':[hex(a) for a in outside],'padding':rows}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--rtos',type=Path,required=True);p.add_argument('--report',type=Path,required=True)
    a=p.parse_args();r=verify(a.rtos.read_bytes());a.report.write_text(json.dumps(r,indent=1)+'\n')
    free=[x for x in r['padding'] if not x['record_exact'] and not x['tail'] and not x['grmod'] and x['recall_copies']]
    print(f"{r['fields']} fields, {len(r['padding'])} padding bytes, {len(free)} with no exact access through a record pointer:")
    for x in free:print(f"  {x['byte']:>6}  exact accesses, any base: {x['exact']:4}  wide through a record pointer: {len(x['record_wide'])}")
