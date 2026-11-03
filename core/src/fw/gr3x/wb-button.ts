/**
 * GR III / IIIx: the WB button in Fn Button Settings (docs/film-mode-notes.md, "Touche WB").
 *
 * The camera's WB button (the 4-way controller's down key) always opens White Balance: its handler
 * in CaptureReadySwitchFunctionModel (vtable 0x53b5bfd0 + 0x5c, 0x53296694) posts UI event 0x93
 * (action 0x53226804, WhiteBalanceController 0x0200004e) and has no setting. The other keys (Fn,
 * ISO, Drive) read their function in the settings record and run it through GetEventCustomize
 * (0x5329bcc8(this, &events, f, press, key)); Movie/Wireless and Hold through GetEventSwitchWlan.
 * This adds:
 *  - a function "White Balance" (44) to the functions' list of every button (film-roll.ts's table,
 *    text 0x94 and the WB line's icon 213), which opens White Balance as the WB button does, after
 *    the same checks (the camera busy, the live values' kind 2: nothing);
 *  - a line "WB Button" under Drive Button in the Fn Button Setting screen (0x020000d1): its
 *    list is the other buttons' (Fn list controller 0x020000d2, list record of ISO's with our set
 *    and is-current), its value a free byte of the settings record;
 *  - the WB button runs the function chosen there: where its handler posts 0x93 (a press, the
 *    camera not busy, the 4-way controller not moving the AF point), White Balance stays the
 *    camera's own code, any other function goes through GetEventCustomize with the key's id (0xa,
 *    the one its AF point move uses).
 *
 * With `macro`, the same for the Macro button (the 4-way controller's up key, + 0x58, 0x532961e0):
 * its own behaviour depends on the focus mode (record + 0xc6) and the press (UI events 0x71, the
 * Macro Mode switch, on a short press's release (press 4); 0x4d, 0x4e, 0x72), so it stays the
 * camera's for Macro Mode; another function makes the key run the ISO button's handler (0x5329e200,
 * which sends every press to GetEventCustomize) with that function and the key's id 9 in place of
 * ISO's setting and id. A function "Macro Mode" (45, text 0xac, icon 381) runs the Macro button's
 * own handler as a short press (press 4). Its line "Macro Button" is under WB Button; its byte 0xac5
 * (padding too, one word read at + 0xac4 by the same dump): 0 Macro Mode, 45 Off.
 *
 * The setting byte 0xabb is padding of the record (no exact access by the firmware, one word read
 * at + 0xab8 by a debug dump, 0x53738494; tools/gr3x/settings_layout_probe.py): it follows the BOX
 * as the record does, and the factory record has 0 there. So 0 means White Balance (the camera's
 * default) and 44 means Off; any other value is that function (above 44: White Balance).
 */
import { branchWord, movWord } from '../aspect/arm';
import { FirmwareError } from '../types';
import type { Gr3xSite } from './round10';

const lo = (v: number) => v & 0xffff, hi = (v: number) => v >>> 16;
const fail = (what: string): never => { throw new FirmwareError('unexpected-layout', `IIIx WB button: ${what}`); };

/** The function number of White Balance (the camera's are 0..41, Film Advance 42, 43 retired). */
export const GR3X_WB_FUNCTION = 44;
/** Its text (the still menu's White Balance line) and icon (that line's Auto White Balance). */
export const GR3X_WB_TEXT = 0x94, GR3X_WB_ICON = 213;
/** The WB button's function: padding byte of the settings record (0: White Balance, 44: Off). */
export const GR3X_WB_SETTING = 0xabb;
/** The record in use (UserDataModel + 4). */
const RECORD_POINTER = 0x55063f34;
/** The WB Button line's list controller id (unused; the date imprint's and film mode's end at 0x020001b1). */
export const GR3X_WB_LINE_ID = 0x020001c0;
/** The Fn Button Setting lines' list controller (Fn Button's; the factory and key map give it to ours). */
export const GR3X_FN_LINE_CONTROLLER = 0x020000d2;
/** ISO Button's list record handlers: the count and draw of the functions' vector (+ 0x1a4). */
export const GR3X_FN_LIST_COUNT = 0x531b3be8, GR3X_FN_LIST_DRAW = 0x531b57b0;
/** The WB button handler's object, kept at its entry (round 10's zero-filled area, the key probe's
 * first word: only test builds use it, and never with this). */
export const GR3X_WB_THIS = 0x55804390;
/** Macro Mode (function 45), its text and icon (the still menu's Macro Mode line, On), its byte. */
export const GR3X_MACRO_FUNCTION = 45, GR3X_MACRO_TEXT = 0xac, GR3X_MACRO_ICON = 381, GR3X_MACRO_SETTING = 0xac5;
export const GR3X_MACRO_LINE_ID = 0x020001c1;
/** The Macro button's handler (its native body after `mov ip,sp` at + 4), its key id. */
export const GR3X_MACRO_KEY_HANDLER = 0x532961e0;
const MACRO_KEY_ID = 9, MACRO_SHORT_PRESS = 4;
/** The ISO button's handler and, in it, its setting's getter call and its key id (`mov r3,#0xb`). */
export const GR3X_ISO_KEY_HANDLER = 0x5329e200, GR3X_ISO_GETTER_CALL = 0x5329e2f4, GR3X_ISO_KEY_ID = 0x5329e2f8;
const ISO_GETTER = 0x53246384;
/** While the Macro button runs the ISO handler: bytes { on, function, key id } (the key probe's area,
 * zero at start-up; only test builds use it, never with this). */
export const GR3X_KEY_OVERRIDE = 0x55804394;

// CaptureReadySwitchFunctionModel's WB button.
export const GR3X_WB_KEY_HANDLER = 0x53296694, GR3X_WB_KEY_EVENT = 0x532969e8, GR3X_WB_KEY_DONE = 0x53296730;
const WB_EVENT = 0x93, WB_KEY_ID = 0xa;
const EVENT_MAKE = 0x53207c8c, EVENT_ADD = 0x53200594, EVENT_FREE = 0x53207c98;
const APP = 0x5320ad88, SHOOTING = 0x5320b19c, STATE = 0x5320b61c, AF_MOVE = 0x532a441c, LIVE_VALUES = 0x53525d5c, LIVE_KIND = 0x535493ac;
/** The WB button's checks before 0x93 (on the shooting model, then the state model's, two more). */
const BUSY_SHOOTING = [0x53237328, 0x53236f38, 0x53236f30] as const, BUSY_STATE = 0x532a88a0, BUSY_SHOOTING2 = [0x532374e0, 0x532380ac] as const;

// The Fn Button Setting screen (0x020000d1, constructor 0x531c9774).
const SCREEN_LINES = 0x53b40f00, SCREEN_ROWS = 8, SCREEN_ID = 0x020000d1;
const SCREEN_SETUP_CALL = 0x531c97c4, SCREEN_SETUP = 0x531c9528, LIST_TYPES = 0x53394610, LIST_ROW = 0x53394758, ROW_ICON = 0x533a6a70;
/** The three readers of the lines' table (movw / movt and their register). */
const SCREEN_SITES: readonly (readonly [number, number, number])[] = [[0x531c923c, 0x531c9244, 3], [0x531c99c4, 0x531c99c8, 6], [0x531c9adc, 0x531c9ae4, 3]];
/** The opening switch (kind → 0x020000d2 + kind), its default (an assertion) and the common end. */
const OPEN_DEFAULT = 0x531c9254, OPEN_ASSERT = 0x531c92ec, OPEN_GO = 0x531c9280;
/** The value loop: its default, its next row, its row count; the help's default and kinds 5..7's. */
const DRAW_DEFAULT = 0x531c9a20, DRAW_ASSERT = 0x531c9a98, DRAW_NEXT = 0x531c9a50, DRAW_COUNT = 0x531c9a58;
const HELP_DEFAULT = 0x531c9af4, HELP_ASSERT = 0x531c9b70, HELP_PLAIN = 0x531c9b40;
/** Key down with repeat: stops at the last row (`cmp r0,#7`). */
const LAST_ROW = 0x531c91c4;
const MODEL_TEXT = 0x5320b67c, ICON_OF = 0x53293e6c;

export interface Gr3xWbProgram {
  code(source: string): number;
  append(bytes: Uint8Array): number;
  patch(address: number, expected: number, replacement: number, reason: string): void;
  read(address: number, length: number): Uint8Array;
  u32(address: number): number;
  sites: readonly Gr3xSite[];
}

/** r: the stored byte → the function. `own`: the line's function (stored 0), `max`: the highest
 * function (above: `own`); `own` stored means Off. */
export const gr3xFnDecode = (r: string, own: number, max: number) => `cmp ${r},#${max};movhi ${r},#0;cmp ${r},#${own};moveq ${r},#0xff;` +
  `cmp ${r},#0;moveq ${r},#${own};cmp ${r},#0xff;moveq ${r},#0;`;

/** Opening White Balance as the WB button does, into the events list whose address is in r0
 * (a C++ shared pointer: [r0] the list). AAPCS: r0..r3, ip, lr clobbered. */
export function installGr3xWbOpen(p: Gr3xWbProgram) {
  const call = (f: number, on: string) => `mov r0,${on};bl #${f};cmp r0,#0;bne out;`;
  return p.code(`push {r4,r5,r6,lr};sub sp,sp,#16;ldr r4,[r0];
    bl #${APP};mov r5,r0;bl #${SHOOTING};mov r6,r0;
    ${BUSY_SHOOTING.map(f => call(f, 'r6')).join('')}
    mov r0,r5;bl #${STATE};bl #${BUSY_STATE};cmp r0,#0;bne out;
    ${BUSY_SHOOTING2.map(f => call(f, 'r6')).join('')}
    bl #${LIVE_VALUES};ldr r0,[r0];bl #${LIVE_KIND};cmp r0,#2;beq out;
    mov r0,sp;mov r1,#${WB_EVENT};mov r2,#0;mov r3,#0;bl #${EVENT_MAKE};
    mov r0,r4;mov r1,sp;bl #${EVENT_ADD};mov r0,sp;bl #${EVENT_FREE};
    out:add sp,sp,#16;pop {r4,r5,r6,pc};`);
}

/** Macro Mode as a short press of the Macro button: its handler's native body (r0 this, r1 the
 * events, r2 = 4); AAPCS. */
export function installGr3xMacroPress(p: Gr3xWbProgram) {
  return p.code(`mov r2,#${MACRO_SHORT_PRESS};mov ip,sp;b #${GR3X_MACRO_KEY_HANDLER + 4};`);
}

/**
 * The WB button (and with `macroText` the Macro button) runs its function, and their lines in Fn
 * Button Setting under Drive Button. `customize`: GetEventCustomize (its patched entry is
 * film-roll.ts's, which handles 42, 44 and 45). Returns the lists for the menu (datestamp.ts's
 * `fnLines`).
 */
export function installGr3xWbButton(p: Gr3xWbProgram, lineText: number, customize: number, macroText?: number) {
  const free = (at: number) => { if (p.sites.some(s => s.address === at)) fail(`${at.toString(16)} already patched`); };
  const expect = (at: number, w: number, what: string) => { free(at); if (p.u32(at) >>> 0 !== w >>> 0) fail(what); };
  const macro = macroText !== undefined;
  const max = macro ? GR3X_MACRO_FUNCTION : GR3X_WB_FUNCTION;
  // The stored byte r (0 or above max: the line's own function, branch to `label`) → the function.
  const choose = (r: string, own: number, label: string) => `cmp ${r},#0;beq ${label};cmp ${r},#${max};bhi ${label};cmp ${r},#${own};moveq ${r},#0;`;
  const record = (label: string) => `movw ip,#${lo(RECORD_POINTER)};movt ip,#${hi(RECORD_POINTER)};ldr ip,[ip];cmp ip,#0x40000000;blo ${label};cmp ip,#0xc0000000;bhs ${label};tst ip,#3;bne ${label};`;
  // --- The WB key.
  expect(GR3X_WB_KEY_HANDLER, 0xe1a0c00d, 'WB button handler');
  expect(GR3X_WB_KEY_EVENT, 0xe5987000, 'WB button event (ldr r7,[r8])');
  if (p.u32(GR3X_WB_KEY_EVENT + 4) !== 0xe1a03002 || p.u32(GR3X_WB_KEY_EVENT + 0xc) !== 0xe3a01093 || p.u32(GR3X_WB_KEY_EVENT + 0x28) !== branchWord(GR3X_WB_KEY_EVENT + 0x28, GR3X_WB_KEY_DONE))
    fail('WB button event 0x93');
  const entries: Record<string, number> = {};
  // At its entry (r0 this, r1 the events, r2 the press: 0 pressed, else held or released): the object
  // kept; a press other than 0 with a function of our choice and the AF point not moved by the 4-way
  // controller goes to GetEventCustomize as the ISO handler sends it (the camera's WB button does
  // nothing then), so the functions held down (Enable AF, AE Lock) also get their release.
  const copy = `sub sp,sp,#16;ldr r3,[r1];str r3,[sp,#8];ldr r3,[r1,#4];str r3,[sp,#12];cmp r3,#0;ldrne ip,[r3,#4];addne ip,ip,#1;strne ip,[r3,#4];
    mov ip,#${WB_KEY_ID};str ip,[sp];add r1,sp,#8;`;
  const uncopy = 'ldr r3,[sp,#12];cmp r3,#0;ldrne ip,[r3,#4];subne ip,ip,#1;strne ip,[r3,#4];add sp,sp,#16;';
  entries.wbKeyEntry = p.code(`movw ip,#${lo(GR3X_WB_THIS)};movt ip,#${hi(GR3X_WB_THIS)};str r0,[ip];cmp r2,#0;beq native;
    push {r0,r1,r2,r4,r5,lr};${record('back')}ldrb r4,[ip,#${GR3X_WB_SETTING}];${choose('r4', GR3X_WB_FUNCTION, 'back')}
    bl #${APP};bl #${STATE};bl #${AF_MOVE};cmp r0,#0;bne back;
    ldr r0,[sp];ldr r1,[sp,#4];ldr r2,[sp,#8];${copy}mov r3,r2;mov r2,r4;bl #${customize};${uncopy}pop {r0,r1,r2,r4,r5,pc};
    back:pop {r0,r1,r2,r4,r5,lr};native:mov ip,sp;b #${GR3X_WB_KEY_HANDLER + 4};`);
  p.patch(GR3X_WB_KEY_HANDLER, 0xe1a0c00d, branchWord(GR3X_WB_KEY_HANDLER, entries.wbKeyEntry), 'WB button: its object kept');
  // At the event: r8 the events (shared pointer), r2 = 0; r4..r6, r8, r9 live, r7 and r10 free.
  // White Balance: the camera's 0x93. Else GetEventCustomize(this, copy of the events, f, 0, key
  // 0xa), as the ISO handler calls it (the copy holds a reference).
  entries.wbKeyEvent = p.code(`${record('native')}ldrb r2,[ip,#${GR3X_WB_SETTING}];${choose('r2', GR3X_WB_FUNCTION, 'native')}
    movw r0,#${lo(GR3X_WB_THIS)};movt r0,#${hi(GR3X_WB_THIS)};ldr r0,[r0];
    mov r1,r8;${copy}mov r3,#0;bl #${customize};${uncopy}b #${GR3X_WB_KEY_DONE};
    native:mov r2,#0;ldr r7,[r8];b #${GR3X_WB_KEY_EVENT + 4};`);
  p.patch(GR3X_WB_KEY_EVENT, 0xe5987000, branchWord(GR3X_WB_KEY_EVENT, entries.wbKeyEvent), 'WB button: its function from Fn Button Settings');

  // --- The Macro key: another function → the ISO handler with that function and key id 9.
  if (macro) {
    expect(GR3X_MACRO_KEY_HANDLER, 0xe1a0c00d, 'Macro button handler');
    expect(GR3X_ISO_KEY_HANDLER, 0xe1a0c00d, 'ISO button handler');
    expect(GR3X_ISO_GETTER_CALL, blWord(GR3X_ISO_GETTER_CALL, ISO_GETTER), 'ISO button setting');
    expect(GR3X_ISO_KEY_ID, 0xe3a0300b, 'ISO button key id');
    const O = GR3X_KEY_OVERRIDE, at = `movw ip,#${lo(O)};movt ip,#${hi(O)};`;
    entries.macroKeyEntry = p.code(`push {r0,r1,r2,r4,r5,lr};${record('back')}ldrb r4,[ip,#${GR3X_MACRO_SETTING}];${choose('r4', GR3X_MACRO_FUNCTION, 'back')}
      bl #${APP};bl #${STATE};bl #${AF_MOVE};cmp r0,#0;bne back;
      ${at}mov r0,#1;strb r0,[ip];strb r4,[ip,#1];mov r0,#${MACRO_KEY_ID};strb r0,[ip,#2];
      ldr r0,[sp];ldr r1,[sp,#4];ldr r2,[sp,#8];bl #${GR3X_ISO_KEY_HANDLER};
      ${at}mov r0,#0;strb r0,[ip];pop {r0,r1,r2,r4,r5,pc};
      back:pop {r0,r1,r2,r4,r5,lr};mov ip,sp;b #${GR3X_MACRO_KEY_HANDLER + 4};`);
    p.patch(GR3X_MACRO_KEY_HANDLER, 0xe1a0c00d, branchWord(GR3X_MACRO_KEY_HANDLER, entries.macroKeyEntry), 'WB button: the Macro button\'s function from Fn Button Settings');
    // In the ISO handler (r1..r3 free at the getter's call; r0 kept at the key id's).
    entries.isoKeySetting = p.code(`${at}ldrb r1,[ip];cmp r1,#0;ldrbne r0,[ip,#1];bxne lr;b #${ISO_GETTER};`);
    p.patch(GR3X_ISO_GETTER_CALL, blWord(GR3X_ISO_GETTER_CALL, ISO_GETTER), blWord(GR3X_ISO_GETTER_CALL, entries.isoKeySetting), 'WB button: the ISO handler runs the Macro button\'s function');
    entries.isoKeyId = p.code(`${at}ldrb r3,[ip];cmp r3,#0;moveq r3,#0xb;ldrbne r3,[ip,#2];bx lr;`);
    p.patch(GR3X_ISO_KEY_ID, 0xe3a0300b, blWord(GR3X_ISO_KEY_ID, entries.isoKeyId), 'WB button: the ISO handler with the Macro button\'s key id');
  }

  // --- The Fn Button Setting screen: WB Button (kind 8) and Macro Button (kind 9) under Drive Button.
  const lines = p.read(SCREEN_LINES, SCREEN_ROWS * 4), lv = new DataView(lines.buffer, lines.byteOffset, lines.byteLength);
  for (let k = 0; k < SCREEN_ROWS; k++) if (lv.getUint16(k * 4, true) !== k) fail('Fn Button Setting lines');
  if (lv.getUint16(2, true) !== 0x1b7 || lv.getUint16(6, true) !== 0x1bd || lv.getUint16(10, true) !== 0x1bf) fail('Fn Button Setting texts');
  for (const [low, high, r] of SCREEN_SITES) {
    expect(low, movWord(r, lo(SCREEN_LINES)), 'Fn Button Setting lines (low)'); expect(high, movWord(r, hi(SCREEN_LINES), true), 'Fn Button Setting lines (high)');
  }
  const added = [[SCREEN_ROWS, lineText], ...(macro ? [[SCREEN_ROWS + 1, macroText!]] : [])];
  const rows = SCREEN_ROWS + added.length, lastKind = SCREEN_ROWS + added.length - 1;
  const table = p.append(Uint8Array.from([...lines.subarray(0, 12), ...added.flatMap(([k, t]) => [k, 0, t & 0xff, t >>> 8]), ...lines.subarray(12)]));
  for (const [low, high, r] of SCREEN_SITES) {
    p.patch(low, movWord(r, lo(SCREEN_LINES)), movWord(r, lo(table)), 'WB button: Fn Button Setting lines with WB Button, low half');
    p.patch(high, movWord(r, hi(SCREEN_LINES), true), movWord(r, hi(table), true), 'WB button: Fn Button Setting lines with WB Button, high half');
  }
  entries.wbScreenLines = table;
  // The list set-up: the rows of the screen's row type 0x22 (its own: eight, 0x53394610(list, types, 8, 0x3a)).
  expect(SCREEN_SETUP_CALL, blWord(SCREEN_SETUP_CALL, SCREEN_SETUP), 'Fn Button Setting list set-up call');
  if (p.u32(SCREEN_SETUP + 0x48) !== 0xe3a02008 || p.u32(SCREEN_SETUP + 0x4c) !== 0xe3a0303a || p.u32(SCREEN_SETUP + 0x54) !== blWord(SCREEN_SETUP + 0x54, LIST_TYPES))
    fail('Fn Button Setting list set-up');
  entries.wbScreenSetup = p.code(`push {r4,lr};sub sp,sp,#16;mov r1,#0x22;mov r2,#0;loop:strb r1,[sp,r2];add r2,r2,#1;cmp r2,#${rows};blo loop;
    ldr r0,[r0,#0x16c];mov r1,sp;mov r2,#${rows};mov r3,#0x3a;bl #${LIST_TYPES};add sp,sp,#16;pop {r4,pc};`);
  p.patch(SCREEN_SETUP_CALL, blWord(SCREEN_SETUP_CALL, SCREEN_SETUP), blWord(SCREEN_SETUP_CALL, entries.wbScreenSetup), `WB button: Fn Button Setting has ${rows} rows`);
  // Opening: kinds 8, 9 → our lists (parent: the screen, as the others).
  expect(OPEN_DEFAULT, branchWord(OPEN_DEFAULT, OPEN_ASSERT), 'Fn Button Setting opening');
  if (p.u32(OPEN_DEFAULT - 4) !== 0x979ff103 || p.u32(OPEN_DEFAULT - 8) !== 0xe3530007) fail('Fn Button Setting opening switch');
  const ids = [GR3X_WB_LINE_ID, ...(macro ? [GR3X_MACRO_LINE_ID] : [])];
  entries.wbScreenOpen = p.code(ids.map((id, k) => `cmp r3,#${SCREEN_ROWS + k};movweq r1,#${lo(id)};movteq r1,#${hi(id)};beq #${OPEN_GO};`).join('') + `b #${OPEN_ASSERT};`);
  p.patch(OPEN_DEFAULT, branchWord(OPEN_DEFAULT, OPEN_ASSERT), branchWord(OPEN_DEFAULT, entries.wbScreenOpen), 'WB button: Fn Button Setting opens the WB Button list');
  // The values: the function's icon (as kinds 0..4, 0x531c97f0), this [fp - 0x30], row r10.
  expect(DRAW_DEFAULT, branchWord(DRAW_DEFAULT, DRAW_ASSERT), 'Fn Button Setting values');
  expect(DRAW_COUNT, 0xe3540008, 'Fn Button Setting row count');
  const value = (setting: number, own: number) => p.code(`push {r4,r5,r6,lr};ldr r0,[r0,#0x16c];bl #${LIST_ROW};mov r4,r0;bl #${APP};bl #${MODEL_TEXT};mov r5,r0;
    mov r1,#0;${record('got')}ldrb r1,[ip,#${setting}];
    got:${gr3xFnDecode('r1', own, max)}mov r0,r5;bl #${ICON_OF};mov r1,r0;mov r0,r4;pop {r4,r5,r6,lr};b #${ROW_ICON};`);
  entries.wbScreenValue = value(GR3X_WB_SETTING, GR3X_WB_FUNCTION);
  if (macro) entries.macroScreenValue = value(GR3X_MACRO_SETTING, GR3X_MACRO_FUNCTION);
  const values = [entries.wbScreenValue, ...(macro ? [entries.macroScreenValue] : [])];
  entries.wbScreenDraw = p.code(values.map((v, k) => `cmp r2,#${SCREEN_ROWS + k};bne n${k};ldr r0,[fp,#-0x30];mov r1,r10;bl #${v};b #${DRAW_NEXT};n${k}:`).join('') + `b #${DRAW_ASSERT};`);
  p.patch(DRAW_DEFAULT, branchWord(DRAW_DEFAULT, DRAW_ASSERT), branchWord(DRAW_DEFAULT, entries.wbScreenDraw), 'WB button: the WB Button line\'s value');
  p.patch(DRAW_COUNT, 0xe3540008, 0xe3540000 | rows, `WB button: Fn Button Setting draws ${rows} rows`);
  // The help line: our kinds as kinds 5..7.
  expect(HELP_DEFAULT, branchWord(HELP_DEFAULT, HELP_ASSERT), 'Fn Button Setting help');
  entries.wbScreenHelp = p.code(`cmp r3,#${lastKind};bls #${HELP_PLAIN};b #${HELP_ASSERT};`);
  p.patch(HELP_DEFAULT, branchWord(HELP_DEFAULT, HELP_ASSERT), branchWord(HELP_DEFAULT, entries.wbScreenHelp), 'WB button: the WB Button line\'s help');
  expect(LAST_ROW, 0xe3500007, 'Fn Button Setting last row');
  p.patch(LAST_ROW, 0xe3500007, 0xe3500000 | (rows - 1), 'WB button: Fn Button Setting\'s last row');

  // --- The lists (record of ISO's, the functions' vector at + 0x1a4): set and is current.
  const list = (setting: number, own: number, name: string) => {
    entries[`${name}ListSet`] = p.code(`ldr r3,[r0,#0x1a4];ldrb r1,[r3,r1];${record('none')}cmp r1,#${own};moveq r1,#0;beq put;cmp r1,#0;moveq r1,#${own};
      put:strb r1,[ip,#${setting}];none:mov r0,#1;bx lr;`);
    entries[`${name}ListIsCurrent`] = p.code(`ldr r3,[r0,#0x1a4];ldrb r1,[r3,r1];mov r2,#0;${record('none')}ldrb r2,[ip,#${setting}];
      none:${gr3xFnDecode('r2', own, max)}cmp r1,r2;moveq r0,#1;movne r0,#0;bx lr;`);
    return { set: entries[`${name}ListSet`], isCurrent: entries[`${name}ListIsCurrent`] };
  };
  const wbList = list(GR3X_WB_SETTING, GR3X_WB_FUNCTION, 'wb');
  const lists = [{ id: GR3X_WB_LINE_ID, title: lineText, count: GR3X_FN_LIST_COUNT, draw: GR3X_FN_LIST_DRAW, ...wbList, controller: GR3X_FN_LINE_CONTROLLER }];
  if (macro) lists.push({ id: GR3X_MACRO_LINE_ID, title: macroText!, count: GR3X_FN_LIST_COUNT, draw: GR3X_FN_LIST_DRAW, ...list(GR3X_MACRO_SETTING, GR3X_MACRO_FUNCTION, 'macro'), controller: GR3X_FN_LINE_CONTROLLER });
  return { entries, lines: lists };
}

function blWord(from: number, to: number) {
  return (0xeb000000 | (((to - from - 8) >> 2) & 0xffffff)) >>> 0;
}

/** The WB Button line's name in each text row: the row's "ISO Button" with WB for ISO (the Chinese
 * rows say 感光度 for ISO: 白平衡, the camera's White Balance). */
export function gr3xWbLineName(isoButton: string): string {
  if (isoButton.includes('ISO')) return isoButton.replace('ISO', 'WB');
  if (isoButton.includes('感光度')) return isoButton.replace('感光度', '白平衡');
  return fail(`no ISO in "${isoButton}"`);
}

/** The Macro Button line's name in each text row (characters of that row's own texts: Macro Mode's
 * and ISO Button's). */
export const GR3X_MACRO_LINE_NAMES: readonly string[] = ['マクロボタン', 'Macro Button', 'Touche macro', 'Makro-Taste', 'Botón Macro', 'Botão Macro',
  'Pulsante Macro', 'Macro-knop', 'Makro-knap', 'Makro-knapp', 'Makro-painike', 'Przycisk makro', 'Tlačítko makro', 'Makró-gomb', 'Makro Düğmesi',
  'Κουμπί macro', 'Кнопка макро', '매크로 버튼', '微距按鈕', '微距按钮', 'ปุ่มระยะใกล้'];

export { SCREEN_ID as GR3X_FN_SCREEN_ID };
