"""WB button (core/src/fw/gr3x/wb-button.ts): its hooks run in the emulator, against the camera's code.

  python3 wb_button_probe.py --rtos GR3.rtos --manifest patch-manifest.json --report out.json

The manifest is a film mode build with `wbButton`. Checked:
 1. White Balance's opening (wbOpen): event 0x93 into the events list, only when none of the WB
    button's checks says busy and the live values' kind is not 2; registers and stack kept.
 2. GetEventCustomize's entry (Fn, ISO, Drive) and GetEventSwitchWlan's switch (Movie/Wireless, Hold)
    with function 44: White Balance opened (pressed only, for GetEventCustomize), then as Off.
 3. The WB button's handler, run natively from its entry with every call it makes stubbed: the
    stored function 0 (or above 44) keeps the camera's 0x93; another goes to GetEventCustomize
    (the handler's object, a copy of the events holding a reference, the function, press 0, key 0xa)
    and the handler goes on as after 0x93 (0x102 and the rest); 44 is Off; moving the AF point and
    the busy camera never reach it; held or released (press 1..3), our functions get it as the
    ISO button's do.
 4. The Fn Button Setting screen, natively: nine rows of type 0x22, the ninth opening our list, its
    text and value (the function's icon), its help as the plain lines', the key repeat stopping on it.
 5. The list's set and is-current (0 ⇄ 44), its record, list controller, key map and record number.
 6. The line's name in every text row: that row's ISO Button with WB.
"""
import argparse,hashlib,json,struct
from pathlib import Path
from unicorn import arm_const as reg
from film_roll_check import RollProbe
from native_probe import STOP,STACK

WB,TEXT,ICON,SETTING,LINE_ID,FN_LINE,THIS_WORD=44,0x94,213,0xabb,0x020001c0,0x020000d2,0x55804390
RECORD_POINTER=0x55063f34;REC=0x63041000
APP,SHOOTING,STATE,LIVE_VALUES,LIVE_KIND=0x5320ad88,0x5320b19c,0x5320b61c,0x53525d5c,0x535493ac
BUSY=(0x53237328,0x53236f38,0x53236f30,0x532a88a0,0x532374e0,0x532380ac)
MAKE,ADD,FREE=0x53207c8c,0x53200594,0x53207c98
CUSTOM,WLAN=0x5329bcc8,0x5329a0a0
HANDLER,EVENT_SITE,DONE=0x53296694,0x532969e8,0x53296730
SCREEN_ID=0x020000d1
LIVE_PTR=0x63057f00;LIVE_OBJ=0x0c0c0
EVENTS=0x63057e00;OBJ=0x0e0e0;CTRL=0x63057e80
ICON_OFF,ICON_ISO=0x113,365

class WbProbe(RollProbe):
    def __init__(self,data,manifest):
        super().__init__(data,manifest);self.stub={};self.log=[]
    def _hook(self,cpu,at,size,user):
        if at in self.stub:
            f=self.stub[at];v=f(cpu) if callable(f) else f
            if v is not None:
                cpu.reg_write(reg.UC_ARM_REG_R0,v&0xffffffff);cpu.reg_write(reg.UC_ARM_REG_PC,cpu.reg_read(reg.UC_ARM_REG_LR))
            return
        super()._hook(cpu,at,size,user)

def r(cpu,n):return cpu.reg_read(getattr(reg,'UC_ARM_REG_R%d'%n))
def u32(cpu,a):return struct.unpack('<I',bytes(cpu.mem_read(a,4)))[0]
def put(cpu,a,v):cpu.mem_write(a,struct.pack('<I',v&0xffffffff))

def verify(data,manifest):
    assert manifest.get('wbButton')==True and manifest.get('filmRoll') in ('film','name2')
    e=manifest['entries'];p=WbProbe(data,manifest);cpu=p.uc;cases={}
    count=lambda k:cases.__setitem__(k,cases.get(k,0)+1)
    sites={s['address']:s for s in manifest['sites']}
    for at in (HANDLER,EVENT_SITE,0x531c97c4,0x531c9254,0x531c9a20,0x531c9a58,0x531c9af4,0x531c91c4):assert 'WB button' in sites[at]['reason'],hex(at)
    put(cpu,RECORD_POINTER,REC);cpu.mem_write(REC,bytes(0xb28))
    put(cpu,LIVE_PTR,LIVE_OBJ)
    def events_stubs(busy=(),kind=0,af=0):
        """The calls of wbOpen and of the WB button's handler: busy predicates, the live kind, events."""
        st={}
        st[APP]=0xa0a0;st[SHOOTING]=lambda c:(r(c,0)==0xa0a0 or 0) and 0xb19c;st[STATE]=lambda c:(r(c,0)==0xa0a0 or 0) and 0xb61c
        for k,f in enumerate(BUSY):
            want=0xb61c if f==0x532a88a0 else 0xb19c
            st[f]=(lambda k,want:lambda c:(p.log.append(('bad arg',hex(r(c,0)))) if r(c,0)!=want else None) or (1 if k in busy else 0))(k,want)
        st[LIVE_VALUES]=LIVE_PTR;st[LIVE_KIND]=lambda c:(p.log.append(('bad live',)) if r(c,0)!=LIVE_OBJ else None) or kind
        def make(c):cpu.mem_write(r(c,0),struct.pack('<III',0xe7e7,r(c,1),r(c,2)|r(c,3)<<16));p.log.append(('make',r(c,1),r(c,2),r(c,3)));return r(c,0)
        def add(c):p.log.append(('add',r(c,0),u32(cpu,r(c,1)+4)));return 1
        def free(c):p.log.append(('free',u32(cpu,r(c,0)+4)));return 0
        st[MAKE]=make;st[ADD]=add;st[FREE]=free
        return st
    def kept_regs(regs):
        for k,v in regs.items():assert r(cpu,k)==v&0xffffffff,(k,hex(r(cpu,k)),hex(v))
    def posted():return [x[1] for x in p.log if x[0]=='make']
    # --- 1. wbOpen.
    cpu.mem_write(EVENTS,struct.pack('<II',OBJ,0))
    for busy in [()]+[(k,) for k in range(len(BUSY))]:
        for kind in (0,1,2,3):
            p.stub=events_stubs(busy,kind);p.log=[]
            regs={0:EVENTS,4:0x44,5:0x55,6:0x66,7:0x77,8:0x88,9:0x99,10:0xaa,11:0xbb}
            p.run(e['wbOpen'],STOP,regs);del regs[0];kept_regs(regs)
            want=[0x93] if not busy and kind!=2 else []
            assert posted()==want,(busy,kind,p.log)
            if want:assert ('add',OBJ,0x93) in p.log and ('free',0x93) in p.log and ('make',0x93,0,0) in p.log
            assert not any(x[0].startswith('bad') for x in p.log),p.log
            count('wb open')
    # --- 2. GetEventCustomize's entry and GetEventSwitchWlan's switch with 44.
    for fn in (0,19,43,44,45,200):
        for press in (0,1):
            p.stub=events_stubs();p.log=[]
            regs={0:0x1111,1:EVENTS,2:fn,3:press,4:0x44,5:0x55,6:0x66,7:0x77,8:0x88}
            p.run(CUSTOM,CUSTOM+4,regs)
            want=dict(regs);want[2]=fn if fn in (19,) else 0
            kept_regs(want);assert posted()==([0x93] if fn==WB and press==0 else []),(fn,press,p.log);count('customize')
    for fn in (0,19,43,44,45):
        p.stub=events_stubs();p.log=[]
        regs={0:0x1111,1:0x2222,2:0x3333,3:0x4444,4:2,5:0x55,6:fn,7:0x77,8:EVENTS}
        p.run(WLAN,WLAN+4,regs)
        want=dict(regs);want[6]=fn if fn==19 else 0
        kept_regs(want);assert posted()==([0x93] if fn==WB else []),(fn,p.log);count('wlan')
    # --- 3. The WB button's handler, natively.
    THIS=0x63057d00
    def handler(stored,busy=(),kind=0,af=0,record=True,press=0):
        p.stub=events_stubs(busy,kind);p.log=[]
        st=p.stub
        for f in (0x5320b31c,0x532372f8,0x53243df8,0x5320b73c,0x532aea64,0x5320b25c,0x5323d0ec,0x5320b1fc,0x5323be20):st[f]=0
        st[0x532a441c]=af;st[0x532a4480]=af
        calls=[]
        def custom(c):
            sp=c.reg_read(reg.UC_ARM_REG_SP);copy=r(c,1)
            calls.append((r(c,0),u32(cpu,copy),u32(cpu,copy+4),r(c,2),r(c,3),u32(cpu,sp),u32(cpu,CTRL+4)))
            return 0
        st[CUSTOM]=custom
        cpu.mem_write(REC+SETTING,bytes([stored]));put(cpu,RECORD_POINTER,REC if record else 0)
        put(cpu,THIS_WORD,0);cpu.mem_write(EVENTS,struct.pack('<II',OBJ,CTRL));put(cpu,CTRL+4,5)
        regs={0:THIS,1:EVENTS,2:press,4:0x44,5:0x55,6:0x66,7:0x77,8:0x88,9:0x99,10:0xaa,11:0xbb}
        p.run(HANDLER,STOP,regs);del regs[0],regs[1],regs[2];kept_regs(regs)
        assert u32(cpu,CTRL+4)==5,'reference count'
        assert u32(cpu,THIS_WORD)==THIS
        assert not any(x[0].startswith('bad') for x in p.log),p.log
        return posted(),calls
    for stored,want_fn in ((0,None),(45,None),(200,None),(19,19),(23,23),(42,42),(44,0),(1,1)):
        for rec in (True,False):
            ev,calls=handler(stored,record=rec)
            if want_fn is None or not rec:assert ev==[0x93,0x102] and calls==[],(stored,rec,ev,calls)
            else:
                assert ev==[0x102] and calls==[(THIS,OBJ,CTRL,want_fn,0,0xa,6)],(stored,ev,calls)
            count('wb button')
    for stored in (0,19):
        ev,calls=handler(stored,af=1);assert 0x93 not in ev and calls==[] and 0xac in ev,(stored,ev);count('wb button, AF point move')
        for k in range(len(BUSY)):
            ev,calls=handler(stored,busy=(k,));assert 0x93 not in ev and calls==[],(stored,k,ev);count('wb button, busy')
        ev,calls=handler(stored,kind=2);assert 0x93 not in ev and calls==[],(stored,ev);count('wb button, live kind 2')
    # Held or released (press 1, 2, 3): our functions get it as the ISO button's do; White Balance and
    # the AF point move stay the camera's.
    for press in (1,2,3):
        for stored,want_fn in ((0,None),(45,None),(19,19),(44,0),(6,6)):
            for af in (0,1):
                ev,calls=handler(stored,press=press,af=af)
                if want_fn is None or af:
                    assert calls==[] and ev==([0xac] if af and press==1 else []),(press,stored,af,ev,calls)
                else:assert ev==[] and calls==[(THIS,OBJ,CTRL,want_fn,press,0xa,6)],(press,stored,ev,calls)
                count('wb button, held or released')
        ev,calls=handler(19,press=press,record=False);assert calls==[] and ev==[],(press,ev,calls)
    # --- 4. The Fn Button Setting screen.
    SCR=0x63057000;LIST=0x63057c00;VIEW=0x63056000
    cpu.mem_write(SCR,bytes(0x200));put(cpu,SCR+0x16c,LIST)
    st={}
    st[0x53394610]=lambda c:p.log.append(('types',r(c,0),bytes(cpu.mem_read(r(c,1),r(c,2))),r(c,3))) or 0
    # From the constructor's call (0x531c97c4, this in r0 and r4) to its next instruction.
    p.stub=st;p.log=[];p.run(0x531c97c4,0x531c97c8,{0:SCR,4:SCR,5:0x55});kept_regs({4:SCR,5:0x55})
    assert p.log==[('types',LIST,bytes([0x22]*9),0x3a)],p.log;count('screen rows')
    TEXTS=[0x1b7,0x1bd,0x1bf,0x1c1,0x1c3,0x28,0x1c5,0x1cb]
    lines=bytes(cpu.mem_read(e['wbScreenLines'],36))
    wb_text=struct.unpack_from('<H',lines,34)[0]
    assert [struct.unpack_from('<HH',lines,4*k) for k in range(9)]==[(k,t) for k,t in enumerate(TEXTS+[wb_text])]
    row=[0]
    for k in range(9):
        p.stub={0x53394820:lambda c:row[0],0x5316c9d8:lambda c:p.log.append(('open',r(c,0),r(c,1),r(c,2))) or 1,0x536b93d0:lambda c:p.log.append(('assert',)) or 0}
        row[0]=k;p.log=[];p.run(0x531c9220,STOP,{0:SCR})
        assert p.log==[('open',SCR,LINE_ID if k==8 else FN_LINE+k,SCREEN_ID)],(k,p.log);count('screen open')
    # The values: every row's text, our row's icon (the kinds' own draws stubbed).
    for stored,icon in ((0,ICON),(19,ICON_ISO),(44,ICON_OFF),(42,None)):
        cpu.mem_write(REC+SETTING,bytes([stored]));put(cpu,RECORD_POINTER,REC)
        st={0x53394758:lambda c:VIEW+r(c,1),0x533a68a4:0,0x533a6904:lambda c:p.log.append(('text',r(c,0)-VIEW,r(c,1))) or 0,
            0x533a6a70:lambda c:p.log.append(('icon',r(c,0)-VIEW,r(c,1))) or 0,0x536b93d0:lambda c:p.log.append(('assert',)) or 0,
            0x5320b67c:0x62049000,APP:0xa0a0}
        for f,kinds in ((0x531c97f0,'0-4'),(0x531c98c8,'5'),(0x531c9918,'6'),(0x531c9968,'7')):st[f]=(lambda kinds:lambda c:p.log.append(('kind',kinds,r(c,1))) or 0)(kinds)
        p.stub=st;p.log=[];p.run(0x531c99b8,STOP,{0:SCR,4:0x44,5:0x55,6:0x66,7:0x77,8:0x88,9:0x99,10:0xaa,11:0xbb});kept_regs({4:0x44,5:0x55,6:0x66,7:0x77,8:0x88,9:0x99,10:0xaa,11:0xbb})
        texts=[x for x in p.log if x[0]=='text'];icons=[x for x in p.log if x[0]=='icon'];kinds=[x for x in p.log if x[0]=='kind']
        assert texts==[('text',k,t) for k,t in enumerate(TEXTS+[wb_text])],texts
        assert [k[2] for k in kinds]==list(range(8)) and ('assert',) not in p.log,p.log
        assert len(icons)==1 and icons[0][1]==8,icons
        if icon is not None:assert icons[0][2]==icon,(stored,icons)
        else:assert icons[0][2] not in (ICON,ICON_OFF),icons
        count('screen values')
    # The help line: row 8 as the plain lines (no assertion).
    for k in range(9):
        p.stub={0x53394820:lambda c:row[0],0x5339a9a0:lambda c:p.log.append(('help',r(c,1))) or 0,0x536b93d0:lambda c:p.log.append(('assert',)) or 0}
        row[0]=k;p.log=[];p.run(0x531c9ac0,STOP,{0:SCR})
        assert ('assert',) not in p.log and len(p.log)==2,(k,p.log)
        if k>=5:assert p.log==[('help',0x3e),('help',0x43)],(k,p.log)
        count('screen help')
    # Key with repeat: moves on except on the last row (8).
    EV=0x63057b00;cpu.mem_write(EV,struct.pack('<II',0,EV+0x10));put(cpu,EV+0x14,1)
    for k in (6,7,8):
        p.stub={0x53394820:lambda c:row[0],0x53395260:lambda c:p.log.append(('move',r(c,1),r(c,2))) or 0}
        row[0]=k;p.log=[];p.run(0x531c9188,STOP,{0:SCR,1:EV})
        assert p.log==([] if k==8 else [('move',1,1)]),(k,p.log);count('screen last row')
    # --- 5. The list: set, is current, record, controller, key map, record number.
    LOBJ=0x63056800;VEC=0x63056900;FNS=[0,19,23,42,44]
    cpu.mem_write(VEC,bytes(FNS));put(cpu,LOBJ+0x1a4,VEC)
    for i,f in enumerate(FNS):
        cpu.mem_write(REC+SETTING,b'\x77');p.stub={};p.run(e['wbListSet'],STOP,{0:LOBJ,1:i});assert r(cpu,0)==1
        assert cpu.mem_read(REC+SETTING,1)[0]=={44:0,0:44}.get(f,f),(f,cpu.mem_read(REC+SETTING,1)[0]);count('list set')
        for s in (0,19,23,42,44,45,0xff):
            cpu.mem_write(REC+SETTING,bytes([s]));p.run(e['wbListIsCurrent'],STOP,{0:LOBJ,1:i})
            d=WB if s==0 or s>44 else 0 if s==44 else s
            assert r(cpu,0)==int(f==d),(f,s);count('list is current')
    put(cpu,RECORD_POINTER,0);p.run(e['wbListSet'],STOP,{0:LOBJ,1:0});assert r(cpu,0)==1
    p.run(e['wbListIsCurrent'],STOP,{0:LOBJ,1:4});assert r(cpu,0)==1;put(cpu,RECORD_POINTER,REC)
    table=e['dateListTable'];n=None
    for k in range(118,140):
        rec=struct.unpack('<16I',bytes(cpu.mem_read(table+k*0x40,0x40)))
        if rec[1]==wb_text:n=k;break
    assert n is not None
    assert rec[0]==0x10000 and rec[2]==0x531b3be8 and rec[4]==0x531b57b0 and rec[6]==e['wbListSet'] and rec[8]==e['wbListIsCurrent'] and not any(rec[9:]) and rec[3]==rec[5]==rec[7]==0
    O=0x63056c00;cpu.mem_write(O,bytes(0x200));p.stub={};p.run(e['dateSetCurrent'],STOP,{0:O,1:LINE_ID});assert cpu.mem_read(O+0x198,1)[0]==n;count('list record')
    p.run(e['dateFactory'],0x5316f3bc,{1:LINE_ID});assert r(cpu,1)==FN_LINE;count('list controller')
    p.run(e['dateFactory'],0x5316f3bc,{1:FN_LINE});assert r(cpu,1)==FN_LINE
    put(cpu,O,LINE_ID);p.run(e['dateKeys'],STOP,{0:O});assert r(cpu,0)==FN_LINE;count('key map')
    # --- 6. The line's name in every row: ISO Button with WB.
    def text(roots,row,i):
        rec=u32(cpu,u32(cpu,roots+row*4)+i*4);n=cpu.mem_read(rec,1)[0]-1
        return bytes(cpu.mem_read(u32(cpu,rec+4),2*n)).decode('utf-16-le')
    IMG=0x5407b540;ROOTS=0x55002bac
    roots_new=manifest['catalogs']['textRoots']
    names=[]
    for row in range(21):
        iso=text(ROOTS,row,0x1bd);name=text(roots_new,row,wb_text)
        want=iso.replace('ISO','WB') if 'ISO' in iso else iso.replace('感光度','白平衡')
        assert name==want and 'ISO' not in name,(row,iso,name);names.append(name);count('line name')
    return dict(cases=cases,names=names,rtos_sha256=hashlib.sha256(data).hexdigest(),hardware_tested=False,
                scope='Hooks and the touched camera functions run in the emulator, every call they make stubbed.')

if __name__=='__main__':
    a=argparse.ArgumentParser(description=__doc__)
    for s in ('rtos','manifest','report'):a.add_argument('--'+s,type=Path,required=True)
    a=a.parse_args();result=verify(a.rtos.read_bytes(),json.loads(a.manifest.read_text()))
    with a.report.open('x') as f:json.dump(result,f,indent=2,ensure_ascii=False);f.write('\n')
    print(json.dumps(result,ensure_ascii=False))
