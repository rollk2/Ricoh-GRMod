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
 - The screen counter (0x532aa1f4): in a mode 1..6, snprintf(buffer, 6, "%d/%d", frame or 1 before
   the roll starts, length) (substituted), then the text function's return (r4, r5, fp, sp, pc from
   its frame); else r2 = the count (r0), r0, r1, r3 kept.
 - Save Settings into BOX n (0x5324b760, the native body substituted from its second instruction):
   the native result returned; BOX n's bit 1 and frame cleared (1 <= n <= 6), the record in use's too
   when n is the active mode; nothing else.
 - The mode recall, run natively from the copy of the stored record to just before the live values
   (as guard_probe): the record in use's Save Interim Images (+0x482) is 0 after recalling 1..6, and
   as copied after recalling 0; the drive mode (+0x472) likewise 3 (multi-exposure).
 - Forms with folders: SetFilePath's entry gives the roll's folder (see film-roll.ts), the function
   then runs as a call (substituted: entry stack, ip = sp) and its result comes back to the caller.
This does not establish the camera's storage, menus or pictures.
"""
import argparse,hashlib,json,random,struct
from pathlib import Path
from unicorn import arm_const as reg
from film_probe_check import Probe,TIME,UDM
from guard_probe import RECALL_FROM,RECALL_TO,UD,RECS,SIZE
from native_probe import STOP,STACK

if not __debug__:raise RuntimeError('Validation requires Python assertions')

FLAGS,FRAME,FOLDER,INTERIM,RATIO=0x9b1,0x9b2,0x9b3,0x482,0x4c2
INTERIM_SET,DRIVE_SET=0x53262990,0x5327b744
LINE_VALUE_ICON,TOP_SET_TITLE,LIST_SET_ITEM,ROW=0x5339de20,0x5339dc70,0x5339e8b0,0x6304a800
SNPRINTF,FORMAT,BUF,DRIVE=0x53141100,0x53c0ca59,0x63049000,0x472
SET_FILE_PATH,NEXT_FOLDER,FOLDER_MARK=0x535b2e8c,0x535b742c,0x535a6dac;SVC,WRAP,DIRS,TABLE,PATH=0x63050000,0x63051000,0x63052000,0x63053000,0x63054000
MODEL=0x55063f30;POINTER=MODEL+4;STORED=MODEL+8;SINGLETON=0x553458b0
BEFORE_EXPOSE,MODEL_END,COUNTER,BOX_SAVE=0x534322d8,0x5323a080,0x532aa1f4,0x5324b760
APP_DATA,APP_WRITE=0x53828014,0x53826c54
CUR,BOXES,OBJ,STORE,LIVE1,LIVE2,LIVE3=0x63040000,0x63042000,0x6304a000,0x6304b000,0x6304c000,0x6304d000,0x6304e000
LENGTHS={0:36,3:12,4:21}
LIVE_CELL,LIVE_OBJ=0x63058000,0x63058100
LOOK_CODES={11:'STD',12:'VIV',13:'MON',14:'SMO',15:'HMO',16:'HCB',17:'POS',18:'BLB',19:'RET',20:'HDR',21:'CRP',22:'NEG'}

class RollProbe(Probe):
    def __init__(self,data,manifest):
        super().__init__(data,manifest);self.writes=[];self.box_native=0;self.next=0;self.next_calls=0;self.sfp_ret=None;self.sfp_calls=0;self.entry_sp=None;self.prints=[];self.setters=[];self.ui=[];self.real_post=False;self.fn_stubs=False;self.posters=0;self.model_no=0;self.events=[];self.qv_stubs=False;self.qv=[];self.dir_stubs=False;self.live=[];self.timer_stubs=False;self.timers=[]
        for at in range(0x63040000,0x63059000,0x1000):
            try:self.uc.mem_map(at,0x1000)
            except Exception:pass
    def _hook(self,cpu,at,size,user):
        r=lambda n:cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%n))
        ret=lambda v:(cpu.reg_write(reg.UC_ARM_REG_R0,v),cpu.reg_write(reg.UC_ARM_REG_PC,cpu.reg_read(reg.UC_ARM_REG_LR)))
        # rear_dial_probe stubs the UI event poster (0x532288b0); the key probe's hook there must run.
        if at==0x532288b0 and self.real_post:return
        if at==APP_DATA:ret(OBJ)
        elif at==APP_WRITE:self.writes.append((r(0),r(1),r(2),r(3)));ret(1)
        elif at==SET_FILE_PATH+4 and self.sfp_ret is not None:
            # The diagnostic's call of the function: entry stack, ip = sp, return address its own.
            assert cpu.reg_read(reg.UC_ARM_REG_SP)==self.entry_sp and cpu.reg_read(reg.UC_ARM_REG_IP)==self.entry_sp
            self.sfp_calls+=1;ret(self.sfp_ret)
        elif self.fn_stubs and at==0x532270d4:
            self.events.append(('retake action',));ret(1)
        elif self.dir_stubs and at==0x53525d5c:
            ret(LIVE_CELL)
        elif self.dir_stubs and at==0x5354d138:
            assert r(0)==LIVE_OBJ;self.live.append(('name',bytes(cpu.mem_read(r(1),6))));ret(1)
        elif self.dir_stubs and at==0x5354d104:
            assert r(0)==LIVE_OBJ;self.live.append(('type',r(1)&0xff));ret(1)
        elif self.fn_stubs and at==0x5320aefc:
            self.queue_arg=r(0);ret(0xe0e0)
        elif self.fn_stubs and at==0x532288b0:
            assert r(0)==0xe0e0;self.events.append((r(1),r(2),r(3)));ret(1)
        elif self.qv_stubs and at==0x531cbde4+4:
            assert cpu.reg_read(reg.UC_ARM_REG_SP)==cpu.reg_read(reg.UC_ARM_REG_IP)
            self.qv.append(('start',r(0),r(1),r(2),r(3),cpu.reg_read(reg.UC_ARM_REG_SP)));ret(0x77)
        elif self.timer_stubs and at==0x5320b01c:
            self.timers.append(('queue',));ret(0xb0b0)
        elif self.timer_stubs and at==0x5322b468:
            assert r(0)==0xb0b0;self.timers.append(('start',r(1),r(2)));ret(0x7777)
        elif self.qv_stubs and at==0x531cbfc4+4:
            assert cpu.reg_read(reg.UC_ARM_REG_SP)==cpu.reg_read(reg.UC_ARM_REG_IP)
            self.qv.append(('event',r(0),r(1),cpu.reg_read(reg.UC_ARM_REG_SP)));ret(0x55)
        elif self.qv_stubs and at==0x531ca804:
            assert cpu.reg_read(reg.UC_ARM_REG_LR)==STOP
            self.qv.append(('next',r(0),cpu.reg_read(reg.UC_ARM_REG_SP)));ret(1)
        elif self.fn_stubs and at==0x531a4d80:
            self.posters+=1;ret(0x5a)
        elif self.fn_stubs and at==0x5320c09c:
            assert r(0)==0xa0a0;ret(0xc0c0)
        elif self.fn_stubs and at==0x532dbee8:
            assert r(0)==0xc0c0;ret(self.model_no)
        elif at==LINE_VALUE_ICON:self.ui.append(('icon',r(0),r(1)));ret(0)
        elif at==TOP_SET_TITLE:self.ui.append(('title',r(0),r(1),r(2)));ret(0)
        elif at==LIST_SET_ITEM:self.ui.append(('item',r(0),r(1),r(2)));ret(0)
        elif at in (INTERIM_SET,DRIVE_SET) and self.stubs_on:
            self.setters.append(('interim' if at==INTERIM_SET else 'drive',r(0),r(1)));ret(1)
        elif at==SNPRINTF:
            self.prints.append((r(0),r(1),r(2),r(3),struct.unpack('<I',bytes(cpu.mem_read(cpu.reg_read(reg.UC_ARM_REG_SP),4)))[0]));ret(5)
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
    cpu.mem_write(LIVE_CELL,struct.pack('<I',LIVE_OBJ))
    if manifest['filmRoll'] in ('dir1','dir2','dir3','dg1','dg2','dg3','dir4','dir5','dir6','dir7','dir8'):p.dir_stubs=True
    def roll_name(rec):
        L=LENGTHS.get(rec[RATIO],36) if rec[RATIO]<=max_id else 36
        return (LOOK_CODES.get(rec[0x1c2],'FLM')+'%02d'%L).encode()+b'\0'
    menu_form=manifest['filmRoll'] in ('menu','keys','fn','fn2','fn3','fn4','fn5','rt1','fn6','fn7','dir1','dir2','dir3','dg1','dg2','dg3','dir4','dir5','dir6','dir7','dir8');keys_form=manifest['filmRoll']=='keys';fn_form=manifest['filmRoll'] in ('fn','fn2','fn3','fn4','fn5','rt1','fn6','fn7','dir1','dir2','dir3','dg1','dg2','dg3','dir4','dir5','dir6','dir7','dir8');fn2=manifest['filmRoll']=='fn2';fn3=manifest['filmRoll']=='fn3';fn4=manifest['filmRoll'] in ('fn4','fn5','rt1','fn6','fn7','dir1');fn7=manifest['filmRoll'] in ('fn7','dir1','dir2','dir3','dg1','dg2','dg3','dir4','dir5','dir6','dir7','dir8');dir1=manifest['filmRoll'] in ('dir1','dir2','dir3','dg1','dg2','dg3','dir4','dir5','dir6','dir7','dir8');dir4=manifest['filmRoll'] in ('dir4','dir5');dir6=manifest['filmRoll']=='dir6';dir7=manifest['filmRoll']=='dir7';dir8=manifest['filmRoll']=='dir8';dir5=manifest['filmRoll']=='dir5';dir2=manifest['filmRoll'] in ('dir2','dir3','dg1');dir3=manifest['filmRoll'] in ('dir3','dg1','dg2','dg3','dir4','dir5','dir6','dir7','dir8');dg2=manifest['filmRoll'] in ('dg2','dg3');dg3=manifest['filmRoll']=='dg3';dg1=manifest['filmRoll'] in ('dg1','dg2','dg3');fn5=manifest['filmRoll'] in ('fn5','rt1','fn6');rt1=manifest['filmRoll']=='rt1';fn6=manifest['filmRoll']=='fn6'
    def setup(mode,cur=None,box=None,model=True,pointer=True,state=2,film=True):
        cur=bytearray(rng.randrange(256) for _ in range(SIZE)) if cur is None else bytearray(cur)
        # Form 'menu': the record in use's Film Roll Mode (bit 0 of 0x9b1) on unless asked off.
        if menu_form:cur[FLAGS]=(cur[FLAGS]|1) if film else (cur[FLAGS]&~1)
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
                assert c2==bytes(want_c) and b2==[bytes(b) for b in want_b],(mode,started,model,pointer,[hex(i) for i in range(SIZE) if c2[i]!=want_c[i]],[(j,[hex(i) for i in range(SIZE) if b2[j][i]!=want_b[j][i]]) for j in range(8)])
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
                    p.writes=[];p.live=[];regs={0:0xa1,1:0xb2,2:0xc3,3:0xd4,4:0x44,5:0x55,6:0x66}
                    if dir1 and rng.random()<0.5:cur[0x1c2]=rng.choice([11,12,13,14,15,16,17,18,19,20,21,22,0,23,40]);cpu.mem_write(CUR,bytes(cur))
                    p.run(MODEL_END,MODEL_END+4,regs);count('end');kept(regs,True)
                    if dir1:
                        assert p.live==([('name',roll_name(cur)),('type',1)] if 1<=mode<=6 and started and st==2 else []),(p.live,mode,ratio,cur[0x1c2])
                        if p.live:count('folder name given')
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
    # 3. The screen counter, run from inside 0x532aa1d4 with a frame of {r4, r5, fp, sp, pc}.
    FRAME_AT=0x63048000
    for mode in range(8):
        for started in (False,True):
            for frame in (0,1,17,72):
                for ratio in (0,3,4,2):
                    for count_v in (0,93,123456):
                        cur,boxes=setup(mode);cur[FLAGS]=(cur[FLAGS]&~2)|(2 if started else 0);cur[FRAME]=frame;cur[RATIO]=ratio;cpu.mem_write(CUR,bytes(cur))
                        cpu.mem_write(FRAME_AT,struct.pack('<5I',0x4444,0x5555,0x6666,STACK,STOP));p.prints=[]
                        regs={0:count_v,1:0x11,3:0x33,4:BUF,5:0x55,11:FRAME_AT+0x14}
                        film=1<=mode<=6
                        p.run(COUNTER,STOP if film else COUNTER+4,regs);count('counter')
                        if film:
                            L=LENGTHS.get(ratio,36) if ratio<=max_id else 36
                            assert p.prints==[(BUF,6,FORMAT,frame if started else 1,L)],(p.prints,mode,started,frame,ratio)
                            assert cpu.reg_read(reg.UC_ARM_REG_R0)==5 and cpu.reg_read(reg.UC_ARM_REG_R4)==0x4444 and cpu.reg_read(reg.UC_ARM_REG_R5)==0x5555 and cpu.reg_read(reg.UC_ARM_REG_R11)==0x6666
                        else:
                            assert p.prints==[] and cpu.reg_read(reg.UC_ARM_REG_R2)==count_v,(mode,count_v)
                            kept({0:count_v,1:0x11,3:0x33,4:BUF})
    cur,boxes=setup(3,pointer=False);p.prints=[];p.run(COUNTER,COUNTER+4,{0:55,4:BUF});assert cpu.reg_read(reg.UC_ARM_REG_R2)==55 and p.prints==[]
    assert bytes(data[FORMAT-0x53000000:FORMAT-0x53000000+6])==b'%d/%d\0'
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
            p.live=[];p.run(RECALL_FROM,RECALL_TO,{5:UD,6:mode});count('recall')
            got=bytes(cpu.mem_read(RECS,0xb26));src=recs[1+mode]
            forced=mode and (not menu_form or src[FLAGS]&1)
            if dir1:
                assert p.live==([] if forced else [('name',bytes(src[0x936:0x93b])+b'\0'),('type',src[0x934])]),(mode,p.live)
                count('folder name restored' if p.live else 'folder name kept')
            assert got[INTERIM]==(0 if forced else src[INTERIM]),(mode,got[INTERIM],src[INTERIM])
            assert got[DRIVE]==(3 if forced else src[DRIVE]),(mode,got[DRIVE])
            assert bytes(cpu.mem_read(RECS+(1+mode)*0x1000,SIZE))==src
    # 6. Form 'folders': the roll's folder at SetFilePath's entry.
    folders=manifest['filmRoll'] in ('folders','folders-diag','menu','keys','fn','fn2','fn3','fn4','fn5','rt1','fn6','fn7','dir1','dir2','dir3','dg1','dg2','dg3','dir4','dir5','dir6','dir7','dir8');diag=manifest['filmRoll']=='folders-diag'
    D=0x55804390
    def diag_check(given,code_want,next_want,ret,calls_before):
        d=bytes(cpu.mem_read(D,8))
        assert struct.unpack_from('<H',d,0)[0]==given and d[2]==code_want and d[3]==(1 if ret else 0) and d[4]==(calls_before+1)&255 and struct.unpack_from('<H',d,6)[0]==next_want,(d.hex(),given,code_want,next_want,ret)
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
            if folders:
                p.sfp_ret=rng.choice((0,1,0x5a));p.entry_sp=STACK;p.sfp_calls=0;run.calls=cpu.mem_read(D+4,1)[0]
                p.run(SET_FILE_PATH,STOP,regs);count('folder');assert p.sfp_calls==1
                assert cpu.reg_read(reg.UC_ARM_REG_R0)==p.sfp_ret and cpu.reg_read(reg.UC_ARM_REG_LR)==STOP
                for k in (4,5,6):assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%k))==regs[k]
            else:p.run(SET_FILE_PATH,SET_FILE_PATH+4,regs);count('folder');kept(regs,True)
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
                            if diag:
                                if given:cw,nw=5,0
                                elif roll and folder in (100,105,512,999):cw,nw=2,0
                                elif roll:cw,nw=(3 if nxt else 4),nxt
                                else:cw,nw=1,0
                                diag_check(given,cw,nw,p.sfp_ret,run.calls);count('diagnostic')
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
                        if diag:diag_check(0,6 if owner_started else 1,nxt if owner_started else 0,p.sfp_ret,run.calls)
        if diag:
            # The clock: { 2000 + entry % 100, path + 6 when it succeeded (1..12), 1 + calls % 28, roll folder % 24, next % 60 }.
            for entry_f in (0,107,999):
                for code_v in (0,1,3,6):
                    for ok in (0,1):
                        for calls in (0,27,28,255):
                            for folder in (0,110,999):
                                for nxt in (0,110,999):
                                    cur,boxes=setup(3);enc(cur,folder);cpu.mem_write(CUR,bytes(cur))
                                    cpu.mem_write(D,struct.pack('<HBBBBH',entry_f,code_v,ok,calls,0,nxt))
                                    cpu.mem_write(TIME,bytes(16));p.call(e['filmProbeTime'],0x1234,TIME);count('clock')
                                    mm=code_v+(6 if ok else 0) or 1
                                    want=struct.pack('<H',2000+entry_f%100)+bytes([min(mm,12),1+calls%28,folder%24,nxt%60])+bytes(10)
                                    assert bytes(cpu.mem_read(TIME,16))==want,(entry_f,code_v,ok,calls,folder,nxt)
            cpu.mem_write(POINTER,b'\0\0\0\0');p.clock=0;p.call(e['filmProbeTime'],0x1234,TIME);assert p.clock==1
    # 7. Form 'menu': Film Roll Mode off, and the menu line's handlers.
    if menu_form:
        dirs([100,105,112],112)
        for mode in range(1,7):
            for started in (False,True):
                cur,boxes=setup(mode,film=False)
                for b in [cur]+boxes:b[FLAGS]=(b[FLAGS]&~2)|(2 if started else 0);enc(b,105)
                for i in range(1,7):
                    if dec(boxes[i])==112:enc(boxes[i],0)
                cpu.mem_write(CUR,bytes(cur))
                for i,b in enumerate(boxes):cpu.mem_write(BOXES+i*0x1000,bytes(b))
                before=state()
                cpu.mem_write(SINGLETON,bytes(4));p.run(e['exposureOrientation'],BEFORE_EXPOSE+4,{0:5,1:6,2:7,3:8});assert state()==before
                cpu.mem_write(SINGLETON,struct.pack('<I',LIVE1));p.writes=[];p.run(MODEL_END,MODEL_END+4,{});assert p.writes==[] and state()==before
                p.prints=[];p.run(COUNTER,COUNTER+4,{0:77,4:BUF});assert p.prints==[] and cpu.reg_read(reg.UC_ARM_REG_R2)==77
                path,got,raw=run(0);assert got==0 and state()==before,(mode,started,got)
                count('film off')
        V,IC,SET=e['filmMenuVisible'],e['filmMenuIsCurrent'],e['filmMenuSet']
        for mode in range(8):
            for model in (True,False):
                cur,boxes=setup(mode,model=model);p.call(V,0x1234);count('menu visible')
                assert cpu.reg_read(reg.UC_ARM_REG_R0)==(1 if model and 1<=mode<=6 else 0),(mode,model)
        for mode in range(8):
            for film in (False,True):
                for v in (0,1):
                    cur,boxes=setup(mode,film=film);p.call(IC,0x1234,v);count('menu current')
                    want=(1 if (film and menu_form)==bool(v) else 0) if 1<=mode<=6 else 0
                    assert cpu.reg_read(reg.UC_ARM_REG_R0)==want,(mode,film,v)
        p.stubs_on=True
        for mode in range(8):
            for film in (False,True):
                for started in (False,True):
                    for v in (0,1,2):
                        cur,boxes=setup(mode,film=film)
                        for b in [cur]+boxes:b[FLAGS]=(b[FLAGS]&~2)|(2 if started else 0);enc(b,333);b[FRAME]=9
                        cpu.mem_write(CUR,bytes(cur))
                        for i,b in enumerate(boxes):cpu.mem_write(BOXES+i*0x1000,bytes(b))
                        p.setters=[];p.log=[]
                        p.live=[];regs={0:0x1234,1:v,4:0x44,5:0x55,6:0x66};p.run(SET,STOP,regs);count('menu set')
                        if dir1:assert p.live==([('name',bytes(cur[0x936:0x93b])+b'\0'),('type',cur[0x934])] if 1<=mode<=6 and v==0 else []),(mode,v,p.live)
                        for k in (4,5,6):assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%k))==regs[k]
                        want_c,want_b=bytearray(cur),[bytearray(b) for b in boxes]
                        u=1<=mode<=6
                        if u and v==1:
                            want_c[FLAGS]|=1
                            assert p.setters==[('interim',UDM,0),('drive',UDM,3)],p.setters
                        else:assert p.setters==[],p.setters
                        # Off suspends: only the record in use's bit 0, the roll is kept.
                        if u and v==0:want_c[FLAGS]&=~1
                        assert state()==(bytes(want_c),[bytes(b) for b in want_b]),(mode,film,started,v)
        p.stubs_on=False
        # The line (this, row): value icon (boxed OFF 296 / ON 297), then the title (r1 = r2).
        for mode in (0,3,7):
            for film in (False,True):
                cur,boxes=setup(mode,film=film);p.ui=[]
                p.run(e['filmLine'],STOP,{0:0x1234,1:ROW});count('menu line')
                on=film and 1<=mode<=6
                assert p.ui[0]==('icon',ROW,297 if on else 296) and p.ui[1][0]=='title' and p.ui[1][1]==ROW and p.ui[1][2]==p.ui[1][3] and len(p.ui)==2,p.ui
        # The list's values: Off (296, text 2), On (297, text 1).
        for v in (0,1):
            p.ui=[];p.run(e['filmDraw'],STOP,{0:0x1234,1:ROW,2:v});count('menu list')
            assert p.ui==[('item',ROW,296 if v==0 else 297,2 if v==0 else 1)],p.ui
    # 8. Form 'keys': the key probe (a table of four { key, count, event }, pending entry at + 16).
    if keys_form:
        K=0x55804390;KEY_EVENT,POST_EVENT=0x53221a1c,0x532288b0
        def table():
            d=bytes(cpu.mem_read(K,17));return [(d[4*i],d[4*i+1],struct.unpack_from('<H',d,4*i+2)[0]) for i in range(4)],d[16]
        def key(k):
            regs={0:0x1111,1:k,2:0x22,3:0x33};p.run(KEY_EVENT,KEY_EVENT+4,regs);count('key');kept(regs,True)
        def post(ev):
            p.real_post=True;regs={0:0x1111,1:ev,2:0x22,3:0x33};p.run(POST_EVENT,POST_EVENT+4,regs);count('event');kept(regs,True);p.real_post=False
        def clock():
            cpu.mem_write(TIME,bytes(16));p.call(e['filmProbeTime'],0x1234,TIME);count('key clock');return bytes(cpu.mem_read(TIME,16))
        def date(k,c,n,ev):return struct.pack('<H',2000+k%100)+bytes([1+min(c,11),1+ev//60,n,ev%60])+bytes(10)
        cur,boxes=setup(3)
        # Model's end clears the table (whatever the roll does).
        cpu.mem_write(K,bytes(range(1,18)));p.writes=[];p.run(MODEL_END,MODEL_END+4,{0:1,1:2,2:3,3:4});assert table()==([(0,0,0)]*4,0)
        assert clock()==date(0,0,0,0)
        # A sequence: key 6, then the gesture 33 five times (each followed by an event), key 6 again.
        key(6);post(0x31)
        for i in range(5):key(33);post(0xd4+i)
        key(6);post(0x31)
        t,pend=table();assert t==[(6,2,0x31),(33,5,0xd8),(0,0,0),(0,0,0)] and pend==0,(t,pend)
        assert clock()==date(33,5,2,0xd8)
        assert clock()==date(33,5,2,0xd8)   # the clock does not clear (two encodes per frame)
        # No event after a key: the event stays; an event with nothing pending changes nothing.
        key(1);post(0x99);t,_=table();assert t[2]==(1,1,0x99)
        post(0x77);assert table()[0][2]==(1,1,0x99)
        # A fifth different key is not counted; counts stop at 255; equal counts: the first entry.
        key(2);key(3);t,pend=table();assert t[3]==(2,1,0) and pend==4 and all(x[0]!=3 for x in t)
        cpu.mem_write(K,bytes([7,255,1,0, 8,255,2,0])+bytes(9));key(7);assert table()[0][0][1]==255
        assert clock()==date(7,255,2,1)
        cpu.mem_write(K,bytes([9,3,5,0, 10,3,6,0, 11,2,7,0])+bytes(5));assert clock()==date(9,3,3,5)
        cpu.mem_write(K,bytes([60,1,0x1a4&255,0x1a4>>8])+bytes(13));assert clock()==date(60,1,1,0x1a4)
    # 10. Form 'fn': Film Advance (function 42) in Fn Button Settings.
    if fn_form:
        TABLE_OFF=bytes(cpu.mem_read(0x53b4eb7c,36));tbl=e['filmFnTable'];ADDED=bytes([42,43] if fn4 and not fn7 else [42])
        assert bytes(cpu.mem_read(tbl,36+len(ADDED)))==TABLE_OFF+ADDED
        p.stubs_on=True;p.fn_stubs=True
        # The lists' constructor (native loop, table and count patched): the vector it fills.
        VEC=0x63055000;OBJF=0x63056000
        for model,dropped in ((0,0x28),(1,0x16),(2,None)):
            cpu.mem_write(OBJF+0x1a4,struct.pack('<III',VEC,VEC,VEC+0x100));p.model_no=model
            p.run(0x531be67c,STOP,{0:OBJF});count('fn list')
            end=struct.unpack('<I',bytes(cpu.mem_read(OBJF+0x1a8,4)))[0]
            got=bytes(cpu.mem_read(VEC,end-VEC))
            want=bytes(f for f in TABLE_OFF+ADDED if not (model!=0 and f==0x16) and not (model!=1 and f==0x28))
            assert got==want,(model,got.hex(),want.hex())
        # Text and icon: 42 ours, the others the camera's.
        for fn,text0 in ((0,2),(42,None))+(((43,2),(200,2)) if fn7 else ((43,0x2b5),) if fn4 else ()):
            p.call(0x53292ed0,0x1234,fn);t=cpu.reg_read(reg.UC_ARM_REG_R0)
            if fn==42:assert 786<=t<1000,t
            else:assert t==text0
            count('fn text')
        for fn,icon in ((0,0x113),(23,0x121),(24,0x120),(42,0x121))+(((43,0x113),(200,0x113)) if fn7 else ((43,0x121),) if fn4 else ()):
            p.call(0x53293e6c,0x1234,fn);assert cpu.reg_read(reg.UC_ARM_REG_R0)==icon,(fn,hex(cpu.reg_read(reg.UC_ARM_REG_R0)));count('fn icon')
        # Pressed (Fn, ISO, Drive): GetEventCustomize's entry.
        FNS=(0,23,41,42,43) if fn4 else (0,23,41,42)
        for mode in (0,3,7):
            for film in (False,True):
                for fn in FNS:
                  for st in ((2,0) if fn==43 else (2,)):
                    cur,boxes=setup(mode,film=film,state=st);p.posters=0;p.events=[];fn6 and cpu.mem_write(0x55804398,b'\0');dir3 and cpu.mem_write(0x5580439a,b'\0');before=state()
                    regs={0:0x1111,1:0x2222,2:fn,3:0x3333,4:0x44,5:0x55}
                    p.run(0x5329bcc8,0x5329bccc,regs);count('fn pressed')
                    adv=fn==42 and film and 1<=mode<=6
                    assert p.posters==(1 if adv else 0),(mode,film,fn)
                    assert p.events==(([('retake action',)] if fn5 else [(0xb7,0,0)]) if fn==43 and not fn7 and film and 1<=mode<=6 and st==2 else []),(mode,film,fn,st,p.events)
                    want=dict(regs);want[2]=0 if fn in (42,43) else fn
                    kept(want,True);assert state()==before
        # Pressed (Movie/Wireless, Hold): the function in r6 at the switch.
        for mode in (0,3):
            for film in (False,True):
                for fn in FNS:
                  for st in ((2,0) if fn==43 else (2,)):
                    cur,boxes=setup(mode,film=film,state=st);p.posters=0;p.events=[];fn6 and cpu.mem_write(0x55804398,b'\0');dir3 and cpu.mem_write(0x5580439a,b'\0')
                    regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444,4:0x44,5:0x55,6:fn}
                    p.run(0x5329a0a0,0x5329a0a4,regs);count('fn wlan')
                    adv=fn==42 and film and 1<=mode<=6
                    assert p.posters==(1 if adv else 0),(mode,film,fn)
                    assert p.events==(([('retake action',)] if fn5 else [(0xb7,0,0)]) if fn==43 and not fn7 and film and 1<=mode<=6 and st==2 else []),(mode,film,fn,st,p.events)
                    want=dict(regs);want[6]=0 if fn in (42,43) else fn
                    for k,v in want.items():assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%k))==v,k
                    cpsr=cpu.reg_read(reg.UC_ARM_REG_CPSR);C=(cpsr>>29)&1;Z=(cpsr>>30)&1
                    assert (C==0 or Z==1)==(want[6]<=0x29)
        p.stubs_on=False;p.fn_stubs=False
    # 13. Form 'fn4': the screen's start, then Next shot, in film mode.
    if fn4:
        # The cases that stop at the start's second instruction first: Unicorn chains the blocks it has
        # run, so a jump into a block already reached is not stopped at `until` afterwards.
        START,NEXT=0x531cbde4,0x531ca804;p.qv_stubs=True
        ARM=0x55804399
        cases_qv=[(m,f,st,mo,po,a) for m in (0,1,3,6,7) for f in (False,True) for st in (0,1,2,3) for mo,po in ((True,True),(False,True),(True,False)) for a in ((False,True) if fn7 else (True,))]
        cases_qv.sort(key=lambda c:c[1] and 1<=c[0]<=6 and c[2]==2 and c[3] and c[4] and c[5])
        for mode,film,st,model,pointer,armed in cases_qv:
                        setup(mode,film=film,state=st,model=model,pointer=pointer);before=state();p.qv=[]
                        if fn7:cpu.mem_write(ARM,bytes([1 if armed else 0]))
                        auto=film and 1<=mode<=6 and st==2 and model and pointer and armed
                        regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444,4:0x44,5:0x55}
                        if auto:
                            p.run(START,STOP,regs);count('review closes')
                            assert p.qv[0][:5]==('start',0x1111,0x2222,0x3333,0x4444) and p.qv[0][5]==STACK-8
                            assert p.qv[1]==('next',0x1111,STACK) and len(p.qv)==2,p.qv
                            assert cpu.reg_read(reg.UC_ARM_REG_R0)==1 and cpu.reg_read(reg.UC_ARM_REG_SP)==STACK
                            for k in (4,5):assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%k))==regs[k]
                        else:
                            p.qv_stubs=False;p.run(START,START+4,regs);p.qv_stubs=True;count('review stays');kept(regs,True)
                        if fn7:assert cpu.mem_read(ARM,1)[0]==0
                        assert state()==before
        p.qv_stubs=False
        if fn7:
            # The opening action raises the flag; each exposure lowers it.
            for mode in (0,3):
                setup(mode);cpu.mem_write(ARM,b'\0');regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444}
                p.run(0x53226738,0x5322673c,regs);kept(regs,True);assert cpu.mem_read(ARM,1)[0]==1;count('review armed')
            for model in (True,False):
                setup(3,model=model);cpu.mem_write(ARM,b'\1');regs={0:5,1:6,2:7,3:8}
                p.run(e['exposureOrientation'],BEFORE_EXPOSE+4,regs);kept(regs,True);assert cpu.mem_read(ARM,1)[0]==0;count('arm cleared at exposure')
    # 16. Form 'dir2': the start notes the screen; Next shot at its first event.
    if dir2:
        START,EVENT,ARM,PEND=0x531cbde4,0x531cbfc4,0x55804399,0x5580439c;THIS=0x6304a400
        pend=lambda:struct.unpack('<I',bytes(cpu.mem_read(PEND,4)))[0]
        for mode in (0,3):
            setup(mode);cpu.mem_write(ARM,b'\0');regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444}
            p.run(0x53226738,0x5322673c,regs);kept(regs,True);assert cpu.mem_read(ARM,1)[0]==1;count('review armed')
        for mode in (0,1,3,6,7):
            for film in (False,True):
                for st in (0,2):
                    for model,pointer in ((True,True),(False,True),(True,False)):
                        for armed in (False,True):
                            setup(mode,film=film,state=st,model=model,pointer=pointer);before=state()
                            cpu.mem_write(ARM,bytes([armed]));cpu.mem_write(PEND,struct.pack('<I',0xdead))
                            regs={0:THIS,1:0x2222,2:0x3333,3:0x4444,4:0x44,5:0x55}
                            p.run(START,START+4,regs);kept(regs,True);count('review start')
                            noted=film and 1<=mode<=6 and st==2 and model and pointer and armed
                            assert pend()==(THIS if noted else 0) and cpu.mem_read(ARM,1)[0]==0 and state()==before,(mode,film,st,armed,hex(pend()))
        # Another screen or none waiting: the handler as it is (these first: Unicorn chains blocks).
        for waiting in (0,THIS+0x100):
            cpu.mem_write(PEND,struct.pack('<I',waiting));regs={0:THIS,1:0x6304a500,2:0x3333,3:0x4444}
            p.run(EVENT,EVENT+4,regs);kept(regs,True);assert pend()==waiting;count('review event, native')
        p.qv_stubs=True;p.qv=[]
        cpu.mem_write(PEND,struct.pack('<I',THIS));regs={0:THIS,1:0x6304a500,2:0x3333,3:0x4444,4:0x44}
        p.run(EVENT,STOP,regs);count('review event, Next shot')
        assert p.qv==[('event',THIS,0x6304a500,STACK-8),('next',THIS,STACK)],p.qv
        assert cpu.reg_read(reg.UC_ARM_REG_R0)==1 and cpu.reg_read(reg.UC_ARM_REG_SP)==STACK and pend()==0 and cpu.reg_read(reg.UC_ARM_REG_R4)==0x44
        p.qv_stubs=False
    # 17. Form 'dir3': one Complete per frame (flag at 0x5580439a, lowered by each exposure).
    if dir3:
        ONCE=0x5580439a;p.stubs_on=True;p.fn_stubs=True
        for path in ('custom','wlan'):
            setup(3,film=True,state=2);cpu.mem_write(ONCE,b'\0');p.posters=0
            for i in range(4):
                if path=='custom':p.run(0x5329bcc8,0x5329bccc,{0:0x1111,1:0x2222,2:42,3:0x3333})
                else:p.run(0x5329a0a0,0x5329a0a4,{0:0x1111,1:0x2222,2:0x3333,3:0x4444,6:42})
                count('advance presses')
            assert p.posters==1 and cpu.mem_read(ONCE,1)[0]==1,(path,p.posters)
            # Not in film mode: the flag is not raised.
            setup(0,film=True,state=2);cpu.mem_write(ONCE,b'\0');p.posters=0
            p.run(0x5329bcc8,0x5329bccc,{0:0x1111,1:0x2222,2:42,3:0x3333});assert p.posters==0 and cpu.mem_read(ONCE,1)[0]==0
        p.stubs_on=False;p.fn_stubs=False
        for model in (True,False):
            setup(3,model=model);cpu.mem_write(ONCE,b'\1');regs={0:5,1:6,2:7,3:8}
            p.run(e['exposureOrientation'],BEFORE_EXPOSE+4,regs);kept(regs,True);assert cpu.mem_read(ONCE,1)[0]==0;count('advance flag cleared at exposure')
    # 18. Form 'dg1': the screen's event log (0x558043a0: codes, count, frozen) and its clock.
    if dg1:
        LOG,START,EVENT,STOPF=0x558043a0,0x531cbde4,0x531cbfc4,0x531cab24;THIS=0x6304a400;EV=0x6304a600
        cpu.ctl_flush_tb()   # earlier sections ran into these blocks: Unicorn would chain past `until`
        log=lambda:bytes(cpu.mem_read(LOG,8))
        setup(0);cpu.mem_write(LOG,bytes(range(1,9)));regs={0:THIS,1:0x2222,2:0x3333,3:0x4444}
        p.run(START,START+4,regs);kept(regs,True);assert log()==bytes(8),log().hex();count('log cleared at start')
        cpu.mem_write(0x5580439c,bytes(4))
        for i,code in enumerate((0xf1,0x193,0xd5,0x8b)):
            cpu.mem_write(EV,struct.pack('<H',code));regs={0:THIS,1:EV,2:0x3333,3:0x4444}
            p.run(EVENT,EVENT+4,regs);kept(regs,True);count('log event')
        assert log()[:6]==struct.pack('<HHBB',0xf1,0x193,4,0),log().hex()
        regs={0:THIS,1:0x2222,2:0x3333,3:0x4444};p.run(STOPF,STOPF+4,regs);kept(regs,True);assert log()[5]==1;count('log frozen at stop')
        cpu.mem_write(EV,struct.pack('<H',0x66));p.run(EVENT,EVENT+4,{0:THIS,1:EV});assert log()[4]==4
        def clock():
            cpu.mem_write(TIME,bytes(16));p.call(e['filmProbeTime'],0x1234,TIME);count('log clock');return bytes(cpu.mem_read(TIME,16))
        setup(3)
        assert clock()==struct.pack('<H',2000+0x193%100)+bytes([5,1+0x193//100,0xf1//60,0xf1%60])+bytes(10)
        cpu.mem_write(LOG,struct.pack('<HHBB',1439+60,3500,40,1));assert clock()==struct.pack('<H',2000)+bytes([12,31,23,59])+bytes(10)
    # 19. Form 'dg2': a half press (UI event 0xe7) posted after the screen's start, in film mode.
    if dg2:
        START,ARM=0x531cbde4,0x55804399;THIS=0x6304a400
        cpu.ctl_flush_tb()
        for mode in (0,3):
            setup(mode);cpu.mem_write(ARM,b'\0');regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444}
            p.run(0x53226738,0x5322673c,regs);kept(regs,True);assert cpu.mem_read(ARM,1)[0]==1;count('review armed')
        cases_hp=[(m,f,st,mo,po,a) for m in (0,1,3,6,7) for f in (False,True) for st in (0,2) for mo,po in ((True,True),(False,True),(True,False)) for a in (False,True)]
        cases_hp.sort(key=lambda c:c[1] and 1<=c[0]<=6 and c[2]==2 and c[3] and c[4] and c[5])
        for mode,film,st,model,pointer,armed in cases_hp:
            setup(mode,film=film,state=st,model=model,pointer=pointer);before=state();cpu.mem_write(ARM,bytes([armed]))
            auto=film and 1<=mode<=6 and st==2 and model and pointer and armed
            regs={0:THIS,1:0x2222,2:0x3333,3:0x4444,4:0x44,5:0x55}
            if auto:
                p.qv_stubs=True;p.fn_stubs=True;p.qv=[];p.events=[]
                p.run(START,STOP,regs);count('half press posted')
                assert p.qv[0][:5]==('start',THIS,0x2222,0x3333,0x4444) and p.qv[0][5]==STACK-8 and len(p.qv)==1,p.qv
                assert p.events==[(0xb6 if dg3 else 0xe7,0,0)],p.events
                assert cpu.reg_read(reg.UC_ARM_REG_SP)==STACK and cpu.reg_read(reg.UC_ARM_REG_R4)==0x44
                p.qv_stubs=False;p.fn_stubs=False
            else:
                p.run(START,START+4,regs);kept(regs,True);count('review alone')
            assert cpu.mem_read(ARM,1)[0]==0 and state()==before
    # 20. Form 'dir4': the screen's own review timer (500 ms) after its start, in film mode.
    if dir4:
        START,ARM=0x531cbde4,0x55804399;THIS=0x6304a400
        cpu.ctl_flush_tb()
        for mode in (0,3):
            setup(mode);cpu.mem_write(ARM,b'\0');regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444}
            p.run(0x53226738,0x5322673c,regs);kept(regs,True);assert cpu.mem_read(ARM,1)[0]==1;count('review armed')
        cases_t=[(m,f,st,mo,po,a,run) for m in (0,1,3,6,7) for f in (False,True) for st in (0,2) for mo,po in ((True,True),(False,True),(True,False)) for a in (False,True) for run in (0,5)]
        cases_t.sort(key=lambda c:c[1] and 1<=c[0]<=6 and c[2]==2 and c[3] and c[4] and c[5])
        for mode,film,st,model,pointer,armed,running in cases_t:
            setup(mode,film=film,state=st,model=model,pointer=pointer);before=state();cpu.mem_write(ARM,bytes([armed]))
            cpu.mem_write(THIS+0x178,struct.pack('<I',running))
            auto=film and 1<=mode<=6 and st==2 and model and pointer and armed
            regs={0:THIS,1:0x2222,2:0x3333,3:0x4444,4:0x44,5:0x55}
            if auto:
                p.qv_stubs=True;p.timer_stubs=True;p.qv=[];p.timers=[]
                p.run(START,STOP,regs);count('review timer' if not running else 'review timer already running')
                assert p.qv[0][:5]==('start',THIS,0x2222,0x3333,0x4444) and len(p.qv)==1,p.qv
                assert p.timers==([] if running else [('queue',),('start',500,THIS+0x158)]),p.timers
                assert struct.unpack('<I',bytes(cpu.mem_read(THIS+0x178,4)))[0]==(running or 0x7777)
                if dir5:assert struct.unpack('<I',bytes(cpu.mem_read(0x5580439c,4)))[0]==(0 if running else THIS)
                assert cpu.reg_read(reg.UC_ARM_REG_SP)==STACK and cpu.reg_read(reg.UC_ARM_REG_R4)==0x44 and cpu.reg_read(reg.UC_ARM_REG_R5)==0x55
                p.qv_stubs=False;p.timer_stubs=False
            else:
                p.run(START,START+4,regs);kept(regs,True);count('review alone')
            assert cpu.mem_read(ARM,1)[0]==0 and state()==before
            if dir5 and not auto:assert struct.unpack('<I',bytes(cpu.mem_read(0x5580439c,4)))[0]==0
        if dir5:
            # The timer's handler: our timer on the noted screen presses Next shot; else as it is.
            TIMER=0x531ca86c;PEND=0x5580439c
            for noted,tid,mine in ((0,0x7777,0x7777),(THIS+0x100,0x7777,0x7777),(THIS,0x7777,0x1234)):
                cpu.mem_write(PEND,struct.pack('<I',noted));cpu.mem_write(THIS+0x178,struct.pack('<I',mine))
                regs={0:THIS,1:tid,3:0x4444};p.run(TIMER,TIMER+4,regs);count('review timer, native')
                for k,v in regs.items():assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%k))==v
                assert cpu.reg_read(reg.UC_ARM_REG_R2)==mine
            p.qv_stubs=True;p.qv=[]
            cpu.mem_write(PEND,struct.pack('<I',THIS));cpu.mem_write(THIS+0x178,struct.pack('<I',0x7777))
            p.run(TIMER,STOP,{0:THIS,1:0x7777,2:0x2222});count('review timer, Next shot')
            assert p.qv==[('next',THIS,STACK)],p.qv
            assert struct.unpack('<I',bytes(cpu.mem_read(PEND,4)))[0]==0 and struct.unpack('<I',bytes(cpu.mem_read(THIS+0x178,4)))[0]==0
            assert cpu.reg_read(reg.UC_ARM_REG_SP)==STACK
            p.qv_stubs=False
    # 21. Form 'dir6': a single picture's review layout (0) in film mode, after a shot.
    if dir6:
        LAYOUT,ARM=0x531cbe4c,0x55804399
        cpu.ctl_flush_tb()
        for mode in (0,3):
            setup(mode);cpu.mem_write(ARM,b'\0');regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444}
            p.run(0x53226738,0x5322673c,regs);kept(regs,True);assert cpu.mem_read(ARM,1)[0]==1;count('review armed')
        for mode in (0,1,3,6,7):
            for film in (False,True):
                for st in (0,2):
                    for model,pointer in ((True,True),(False,True),(True,False)):
                        for armed in (False,True):
                            setup(mode,film=film,state=st,model=model,pointer=pointer);before=state();cpu.mem_write(ARM,bytes([armed]))
                            plain=film and 1<=mode<=6 and st==2 and model and pointer and armed
                            regs={0:5,1:0x2222,2:0x3333,3:0x4444,4:0x44,5:0x55,6:0x66}
                            p.run(LAYOUT,LAYOUT+4,regs);count('layout plain' if plain else 'layout kept')
                            want=dict(regs);want[1]=0 if plain else 5
                            for k,v in want.items():assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%k))==v,(k,mode,film,st,armed)
                            assert cpu.reg_read(reg.UC_ARM_REG_SP)==STACK and cpu.reg_read(reg.UC_ARM_REG_LR)==STOP
                            assert cpu.mem_read(ARM,1)[0]==0 and state()==before
    # 22. Form 'dir7': no buttons (set 0) on the screen in film mode, after a shot.
    if dir7:
        BUT,ARM=0x531cbe2c,0x55804399
        cpu.ctl_flush_tb()
        for mode in (0,3):
            setup(mode);cpu.mem_write(ARM,b'\0');regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444}
            p.run(0x53226738,0x5322673c,regs);kept(regs,True);assert cpu.mem_read(ARM,1)[0]==1;count('review armed')
        for mode in (0,1,3,6,7):
            for film in (False,True):
                for st in (0,2):
                    for model,pointer in ((True,True),(False,True),(True,False)):
                        for armed in (False,True):
                            for multi in (False,True):
                                setup(mode,film=film,state=st,model=model,pointer=pointer);before=state();cpu.mem_write(ARM,bytes([armed]))
                                none=film and 1<=mode<=6 and st==2 and model and pointer and armed
                                regs={0:0x6304a400,1:0x2222,2:0x3333,3:0x4444,4:0x44,5:0x55,6:0x66}
                                # GuardProbe.run clears the flags: here Z comes from `cmp r0,r5` (Z = no multi-exposure).
                                for i in range(13):cpu.reg_write(getattr(reg,'UC_ARM_REG_R'+str(i)),regs.get(i,0x1230+i))
                                cpu.reg_write(reg.UC_ARM_REG_SP,STACK);cpu.reg_write(reg.UC_ARM_REG_LR,STOP);cpu.reg_write(reg.UC_ARM_REG_CPSR,0x13 | (0 if multi else 1<<30))
                                cpu.emu_start(BUT,BUT+8,count=200000);assert cpu.reg_read(reg.UC_ARM_REG_PC)==BUT+8
                                count('buttons none' if none else 'buttons native')
                                want=dict(regs);want[1]=0 if none else (3 if multi else 0)
                                for k,v in want.items():assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%k))==v,(k,mode,film,st,armed,multi)
                                assert cpu.reg_read(reg.UC_ARM_REG_SP)==STACK
                                assert cpu.mem_read(ARM,1)[0]==0 and state()==before
    # 23. Form 'dir8': the screen's id kind (+0x799 of the model) read as 0 instead of 3 in film mode.
    if dir8:
        KIND=0x531ca6e8;M=0x6304a700
        cpu.ctl_flush_tb()
        for mode in (0,1,3,6,7):
            for film in (False,True):
                for st in (0,2):
                    for model,pointer in ((True,True),(False,True),(True,False)):
                        for kind in (0,3,4,5):
                            setup(mode,film=film,state=st,model=model,pointer=pointer);before=state()
                            cpu.mem_write(M+0x799,bytes([kind]))
                            plain=kind==3 and film and 1<=mode<=6 and st==2 and model and pointer
                            regs={0:M,1:0x2222,2:0x3333,4:0x44,5:0x55,6:0x66}
                            p.run(KIND,KIND+4,regs);count('review id plain' if plain else 'review id native')
                            want=dict(regs);want[3]=0 if plain else kind
                            for k,v in want.items():assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%k))==v,(k,mode,film,st,kind)
                            assert cpu.reg_read(reg.UC_ARM_REG_SP)==STACK and cpu.reg_read(reg.UC_ARM_REG_LR)==STOP and state()==before
    # 15. Form 'fn6': Retake cancels the whole frame (flag at 0x55804398).
    if fn6:
        FLAG=0x55804398;OBJR=0x63057000
        try:cpu.mem_map(OBJR,0x1000)
        except Exception:pass
        flag=lambda:cpu.mem_read(FLAG,1)[0]
        for up,phase,want in ((1,2,1),(1,1,1),(0,2,2),(0,1,1)):
            cpu.mem_write(FLAG,bytes([up]));cpu.mem_write(OBJR+4,struct.pack('<I',phase))
            regs={0:OBJR,1:0x2222,2:0x3333,3:0x4444};p.run(0x5346a8d8,0x5346a8dc,regs);kept(regs,True);count('cancel machine')
            assert struct.unpack('<I',bytes(cpu.mem_read(OBJR+4,4)))[0]==want and flag()==0
        p.stubs_on=True;p.fn_stubs=True
        setup(3,film=True,state=2);cpu.mem_write(FLAG,b'\0')
        for i in range(4):
            p.events=[];p.run(0x5329bcc8,0x5329bccc,{0:0x1111,1:0x2222,2:43,3:0x3333});count('cancel presses')
            assert p.events==([('retake action',)] if i==0 else []) and flag()==1,(i,p.events)
        p.stubs_on=False;p.fn_stubs=False
        for model in (True,False):
            setup(3,model=model);cpu.mem_write(FLAG,b'\1');regs={0:5,1:6,2:7,3:8}
            p.run(e['exposureOrientation'],BEFORE_EXPOSE+4,regs);kept(regs,True);assert flag()==0;count('cancel cleared at exposure')
    # 14. Form 'rt1': the Retake probe (bytes at 0x55804390) and its clock.
    if rt1:
        K=0x55804390;OBJR=0x63057000
        try:cpu.mem_map(OBJR,0x1000)
        except Exception:pass
        k=lambda:bytes(cpu.mem_read(K,7))
        cpu.mem_write(K,bytes(17))
        regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444}
        p.run(0x5323a1a4,0x5323a1a8,regs);kept(regs,True);assert k()==bytes([1,0,0,0,0,0,0]);count('probe model retake')
        for v,z in ((2,1),(5,0),(0,0)):
            regs={0:v,1:0x2222,2:0x3333,3:0x4444};p.run(0x5323a1d0,0x5323a1d4,regs);count('probe state test')
            for r_,x in regs.items():assert cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%r_))==x
            assert (cpu.reg_read(reg.UC_ARM_REG_CPSR)>>30)&1==z and k()[1]==v+1
        for phase in (1,2,0):
            cpu.mem_write(OBJR+4,struct.pack('<I',phase));regs={0:OBJR,1:0x2222,2:0x3333,3:0x4444}
            p.run(0x5346a8d8,0x5346a8dc,regs);kept(regs,True);count('probe machine retake');assert k()[3]==phase+1
        assert k()[2]==3
        regs={0:OBJR,1:0x2222,2:0x3333,3:0x4444};p.run(0x5346a910,0x5346a914,regs);kept(regs,True);assert k()[4]==1;count('probe machine end')
        p.stubs_on=True;p.fn_stubs=True
        for mode,film,st,called in ((3,True,2,1),(3,True,0,0),(3,False,2,0),(0,True,2,0)):
            setup(mode,film=film,state=st);before=bytes(cpu.mem_read(K,7))
            p.run(0x5329bcc8,0x5329bccc,{0:0x1111,1:0x2222,2:43,3:0x3333});count('probe presses')
            after=k();assert after[5]==before[5]+1 and after[6]==before[6]+called,(mode,film,st,before.hex(),after.hex())
        p.stubs_on=False;p.fn_stubs=False
        def clock():
            cpu.mem_write(TIME,bytes(16));p.call(e['filmProbeTime'],0x1234,TIME);count('probe clock');return bytes(cpu.mem_read(TIME,16))
        setup(3)
        cpu.mem_write(K,bytes([1,3,1,2,0,1,1]));assert clock()==struct.pack('<H',2001)+bytes([4,2,2,11])+bytes(10)
        cpu.mem_write(K,bytes([0,0,0,0,0,0,0]));assert clock()==struct.pack('<H',2000)+bytes([1,1,0,0])+bytes(10)
        cpu.mem_write(K,bytes([123,200,40,30,0,12,7]));assert clock()==struct.pack('<H',2023)+bytes([12,31,23,59])+bytes(10)
        cpu.mem_write(MODEL+4,bytes(4));t=clock();assert t!=struct.pack('<H',2023)+bytes([12,31,23,59])+bytes(10)
    # 11. Form 'fn2': no Next / Retake / Complete screen in film mode, and the two-key clock.
    # 12. Form 'fn3': the live view's id (0x08000000) instead of the screen's (0x0800000c) in film mode,
    # the key probe cleared at each exposure and deaf to keys 6 and 57.
    if fn2 or fn3:
        OPEN=0x53226738;REVIEW_ID=0x53226760;K=0x55804390;KEY_EVENT,POST_EVENT=0x53221a1c,0x532288b0
        for mode in (0,1,3,6,7) if fn3 else ():
            for film in (False,True):
                for st in (0,1,2,3):
                    for model,pointer in ((True,True),(False,True),(True,False)):
                        setup(mode,film=film,state=st,model=model,pointer=pointer);before=state()
                        live=film and 1<=mode<=6 and st==2 and model and pointer
                        regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444,4:0x44,5:0x55}
                        p.run(REVIEW_ID,REVIEW_ID+4,regs);count('review to live' if live else 'review screen')
                        want=dict(regs);want[1]=0 if live else 0xc;kept(want)
                        assert cpu.reg_read(reg.UC_ARM_REG_SP)==STACK and state()==before
        for mode in (0,1,3,6,7) if fn2 else ():
            for film in (False,True):
                for st in (0,1,2,3):
                    for model,pointer in ((True,True),(False,True),(True,False)):
                        setup(mode,film=film,state=st,model=model,pointer=pointer);before=state()
                        skip=film and 1<=mode<=6 and st==2 and model and pointer
                        regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444,4:0x44,5:0x55}
                        if skip:
                            p.run(OPEN,STOP,regs);count('review skipped')
                            want=dict(regs);want[0]=1;kept(want)
                            assert cpu.reg_read(reg.UC_ARM_REG_SP)==STACK
                        else:
                            p.run(OPEN,OPEN+4,regs);count('review opens');kept(regs,True)
                        assert state()==before
        # The model's end keeps the key table (cleared only at start-up).
        cur,boxes=setup(3)
        cpu.mem_write(K,bytes([35,4,0,0, 57,9,0,0])+bytes(9));p.writes=[];p.run(MODEL_END,MODEL_END+4,{0:1,1:2,2:3,3:4})
        assert bytes(cpu.mem_read(K,8))==bytes([35,4,0,0, 57,9,0,0])
        def key(k):
            regs={0:0x1111,1:k,2:0x22,3:0x33};p.run(KEY_EVENT,KEY_EVENT+4,regs);count('key');kept(regs,True)
        def clock():
            cpu.mem_write(TIME,bytes(16));p.call(e['filmProbeTime'],0x1234,TIME);count('key clock');return bytes(cpu.mem_read(TIME,16))
        def date(k1,c1,k2,c2):return struct.pack('<H',2000+k1%100)+bytes([1+min(c1,11),1+min(c2,30),k2//60,k2%60])+bytes(10)
        if fn3:
            # Each exposure clears the table (the exposure hook runs first); keys 6 and 57 are not counted.
            for started in (False,True):
                cur,boxes=setup(3)
                for b in [cur]:b[FLAGS]=(b[FLAGS]&~2)|(2 if started else 0)
                cpu.mem_write(CUR,bytes(cur));cpu.mem_write(K,bytes(range(1,18)))
                regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444}
                p.run(e['exposureOrientation'],BEFORE_EXPOSE+4,regs);count('key clear at exposure');kept(regs,True)
                assert bytes(cpu.mem_read(K,17))==bytes(17)
            cpu.mem_write(K,bytes(17))
            for k in (6,57,6):key(k)
            assert bytes(cpu.mem_read(K,17))==bytes(17)
        cpu.mem_write(K,bytes(17));assert clock()==date(0,0,0,0)
        N=58 if fn3 else 57
        key(N);key(N);key(N);key(35);t=clock();assert t==date(N,3,35,1),t.hex()
        for _ in range(4):key(35)
        assert clock()==date(35,5,N,3)
        key(50);assert clock()==date(35,5,N,3)
        cpu.mem_write(K,bytes([9,3,0,0, 10,3,0,0, 11,2,0,0, 130,40,0,0])+bytes(1));assert clock()==date(130,40,9,3)
        cpu.mem_write(K,bytes([9,3,0,0, 10,7,0,0, 11,2,0,0])+bytes(5));assert clock()==date(10,7,9,3)
        cpu.mem_write(K,bytes([200,1,0,0])+bytes(13));assert clock()==date(200,1,0,0)
    return dict(schema=1,revision='T14-DIR8' if dir8 else 'T14-DIR7' if dir7 else 'T14-DIR6' if dir6 else 'T14-DIR5' if dir5 else 'T14-DIR4' if dir4 else 'T14-DG3' if dg3 else 'T14-DG2' if dg2 else 'T14-DG1' if dg1 else 'T14-DIR3' if dir3 else 'T14-DIR2' if dir2 else 'T14-DIR1' if dir1 else 'T13-FN7' if fn7 else 'T13-FN6' if fn6 else 'T13-RT1' if rt1 else 'T13-FN5' if fn5 else 'T13-FN4' if fn4 else 'T13-FN3' if fn3 else 'T13-FN2' if fn2 else 'T13-FN1' if fn_form else 'T12-KEYS2' if keys_form else 'T12-MENU2' if menu_form else 'T11-ROLL2D' if diag else 'T11-ROLL3' if folders else 'T11-ROLL1',rtos_sha256=hashlib.sha256(data).hexdigest(),cases=cases,seed=seed,hardware_tested=False,
        scope='Hooks run from their patched sites (firmware storage and the native BOX save body substituted); the recall runs natively.')

if __name__=='__main__':
    a=argparse.ArgumentParser(description=__doc__)
    for s in ('rtos','manifest','report'):a.add_argument('--'+s,type=Path,required=True)
    a=a.parse_args();result=verify(a.rtos.read_bytes(),json.loads(a.manifest.read_text()))
    with a.report.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
    print(json.dumps(result))
