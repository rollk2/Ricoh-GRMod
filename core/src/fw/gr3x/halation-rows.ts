// SPDX-License-Identifier: GPL-2.0-only
/**
 * GR III 2.10 / IIIx 1.60, round 7 (as GR Mod 0.8.2): a film's Halation on the camera's Image
 * Control parameter screen (ImageControlDetailController). GR IV 0.8.2 turns Cinema's Toning row
 * into a "Halation" row built like its Grain Effect (Off / On, and Fn opens Grain Effect's
 * submenu with Strength Weak / Medium / Strong and Colour red / white). GR III's own Grain Effect
 * is a single row, Off / 1 / 2 / 3 (no submenu, no Fn on this screen), so a GR III film gets the
 * same settings the GR III way: two rows at the end of its parameter list (stills only, as the
 * halation is made at the JPEG step):
 *  - "Halation": Grain Effect's row (parameter kind 15): its four-position slider and its scale
 *    (Off and three bars, 57), the value text as Grain Effect's ("--", "1", "2", "3"; slots3.c,
 *    sp_hal_text), GR IV's halation icon (1, 2, 3: GR IV's Weak, Medium, Strong);
 *  - "Colour" (GR IV's name of the submenu row): HDR Tone's Toning row (kind 10) with two
 *    positions (GR IV's way: count 1, spacing 0x168) and GR IV's colour scale (a red and a white
 *    light, drawn on GR III's scale 211), a red or a white light as its icon, no value text.
 * The settings are kept per film and photo set by native/slots3.c (bits 0..1 strength, bit 2
 * white): nothing of Grain Effect's or HDR Tone's own values changes (for a film no native getter
 * or setter of those rows is called).
 *
 * Read from the official 2.10 code (round 6's halation-screen.ts has the rest):
 *  - kind 15 (Grain Effect): slider builder 0x531ae818 (start: getter 0x532c9744, then the
 *    value-to-position map 0x531ac868 over {0, 3, 2, 1}: Off, Weak "1", Medium "2", Strong "3"),
 *    position 0x531b0564 (getter 0x532c2a5c, map), list line 0x531af6ac (text 0x532ace68 at
 *    0x531af6ec, icon 0x1de at 0x531af700), setter case 0x531b0d1c (value {0, 3, 2, 1}[position
 *    r6], SetParticle 0x532c1780 at 0x531b0d28);
 *  - kind 10 (HDR Tone's Toning): builder 0x531adc6c (positions `mov r2,#2; mov r3,#0xb4` at
 *    0x531adce0, scale 0xd3 at 0x531adcbc), the rest as in round 6.
 */
import { branchWord, movWord } from '../aspect/arm';
import { FirmwareError } from '../types';

const FIRST = 64;
const TABLE = 0x53b3488c, ENTRIES = 36, KIND_TONING = 10, KIND_GRAIN = 15;
const TABLE_SITES: readonly (readonly [number, number, number])[] = [
  [0x531afa20, 0x531afa24, 12], [0x531afabc, 0x531afacc, 3], [0x531affa0, 0x531affa8, 12], [0x531b01f4, 0x531b01f8, 3],
];
const BASE_DEFAULT = 0x531acb24, BASE_DEFAULT_TARGET = 0x531acbbc, BASE_RETURN = 0x531acb5c;
const SUBTITLE = 0x531b0254;
// Kind 10 (Colour).
const SCALE10 = 0x531adcbc, POSITIONS10 = 0x531adce0, START10 = 0x531adca0, POSITION10 = 0x531b0514;
const LIST_TEXT10 = 0x531af494, LIST_ICON10 = 0x531af4a8, SETTER10 = 0x531b0d8c;
const STORED_GETTER10 = 0x532c70e4, LIVE_GETTER10 = 0x532c297c, TEXT10 = 0x532aca68, HDR_SETTER = 0x532c0894;
// Kind 15 (Halation).
const START15 = 0x531ae84c, POSITION15 = 0x531b0564, LIST_TEXT15 = 0x531af6ec, LIST_ICON15 = 0x531af700, SETTER15 = 0x531b0d28;
const STORED_GETTER15 = 0x532c9744, LIVE_GETTER15 = 0x532c2a5c, TEXT15 = 0x532ace68, PARTICLE_SETTER = 0x532c1780;
const GRAIN_ICON = 0x1de, TONING_ICON = 0x1e9, TONING_SCALE = 0xd3;
// Grain (kind 12, the filter effect of the black-and-white looks, five positions: four for a film)
// and its size (kind 8, Bleach Bypass's Toning, three positions): grain-rows (round 10).
const KIND_GRAIN_FILM = 12, KIND_SIZE = 8, GRAIN_EFFECT_TEXT = 0x133, GRAIN_SCALE = 0x39, SIZE_SCALE = 0xd3;
const START12 = 0x531adf20, SCALE12 = 0x531adf3c, POSITIONS12 = 0x531adf60, POSITION12 = 0x531b0534, LIST_TEXT12 = 0x531af584, LIST_ICON12 = 0x531af598, SETTER12 = 0x531b0d64;
const STORED_GETTER12 = 0x532c7520, MAP12 = 0x531ac7a8, LIVE_GETTER12 = 0x532c1ac0, TEXT12 = 0x532acb50, SETTER_NATIVE12 = 0x532c0b3c, ICON12 = 0x1dd;
const START8 = 0x531ada20, SCALE8 = 0x531ada3c, POSITION8 = 0x531b04f4, LIST_TEXT8 = 0x531af3a4, LIST_ICON8 = 0x531af3b8, SETTER8 = 0x531b0db4;
const STORED_GETTER8 = 0x532c6b94, MAP8 = 0x531ac654, LIVE_GETTER8 = 0x532c293c, TEXT8 = 0x532ac86c, SETTER_NATIVE8 = 0x532c056c, ICON8 = 0x1e9;
/** The parameter screen's list set-up: its row capacity, read at ROWS_MAX. */
const ROWS_MAX = 0x531afc48;
const BACKUP = 0x532c337c, BACKUP_BODY = 0x532c325c, RESTORE = 0x532c34a8, RESTORE_BODY = 0x532c33c8;

export interface Gr3xHalationRowsProgram {
  code(source: string): number;
  append(bytes: Uint8Array): number;
  patch(address: number, expected: number, replacement: number, reason: string): void;
  u32(address: number): number;
  read(address: number, size: number): Uint8Array;
}
export interface Gr3xHalationRowsOptions {
  films: number;
  /** Texts: the Halation row's name, the Colour row's name. Icons: the halation icon, the colour scale, red and white lights. */
  halationText: number; colourText: number; halationIcon: number; colourScale: number; redIcon: number; whiteIcon: number;
  /** slots3.c: sp_hal / sp_hal_put / sp_hal_text, sp_col / sp_col_put, sp_hal_backup / sp_hal_restore. */
  hal: number; halPut: number; halText: number; col: number; colPut: number;
  /** Rounds 7..9: the settings kept and put back with the screen's own (round 10: the Toning byte is
   * one of the parameters the screen backs up and restores itself). */
  backup?: number; restore?: number;
  /** Round 10 with the grain (films.c -DGRAIN): two more rows, Grain (Grain Effect's name, Off / 1 /
   * 2 / 3) and its size (S / M / L), kept in the Toning byte's high nibble. */
  grain?: { sizeText: number; grain: number; grainPut: number; grainText: number; size: number; sizePut: number; sizeText2: number };
}

const bl = (at: number, target: number) => (0xeb000000 | (((target - (at + 8)) >> 2) & 0xffffff)) >>> 0;
const fail = (m: string): never => { throw new FirmwareError('unexpected-instruction', `IIIx halation rows: ${m}`); };

export function installGr3xHalationRows(p: Gr3xHalationRowsProgram, o: Gr3xHalationRowsOptions) {
  const n = o.films;
  if (!Number.isInteger(n) || n < 1 || n > 20) fail('number of films');
  // `film(r, ctl)`: flags "ls" when the controller's look is a film of this build (r clobbered).
  const film = (r: string, ctl: string) => `ldrb ${r},[${ctl},#0x198];sub ${r},${r},#${FIRST};cmp ${r},#${n - 1};`;
  const guards: readonly (readonly [number, number])[] = [
    [BASE_DEFAULT, 0xea000024], [BASE_DEFAULT - 8, 0xe354000b], [BASE_RETURN, 0xe24bd018],
    [SUBTITLE, 0xe1d310b2], [SUBTITLE - 0x14, 0xe3520001],
    // Kind 10.
    [SCALE10, 0xe3a030d3], [POSITIONS10, 0xe3a02002], [POSITIONS10 + 4, 0xe3a030b4], [POSITIONS10 + 8, 0xe24b0054],
    [START10, bl(START10, STORED_GETTER10)], [START10 + 4, bl(START10 + 4, 0x531ac6f0)], [POSITION10, bl(POSITION10, LIVE_GETTER10)],
    [LIST_TEXT10, bl(LIST_TEXT10, TEXT10)], [LIST_ICON10, movWord(1, TONING_ICON)], [SETTER10, bl(SETTER10, HDR_SETTER)],
    [SETTER10 - 0xc, 0xe30e3bc4], [SETTER10 - 8, 0xe34533b4], [SETTER10 - 4, 0xe7d31006],
    // Kind 15.
    [START15, bl(START15, STORED_GETTER15)], [START15 + 4, bl(START15 + 4, 0x531ac868)], [START15 + 0x1c, 0xe3a03039],
    [POSITION15, bl(POSITION15, LIVE_GETTER15)], [POSITION15 + 4, bl(POSITION15 + 4, 0x531ac868)],
    [LIST_TEXT15, bl(LIST_TEXT15, TEXT15)], [LIST_ICON15, movWord(1, GRAIN_ICON)], [SETTER15, bl(SETTER15, PARTICLE_SETTER)],
    [SETTER15 - 0xc, 0xe30930d8], [SETTER15 - 8, 0xe34533b5], [SETTER15 - 4, 0xe7d31006],
    // The registers the hooks read: the controller in r6 (builders, list lines), r5 (positions),
    // r4 (subtitle, setter), the slider position in r6 (setter), as the surrounding official code has it.
    [START10 - 0x18, 0xe1a06000], [START15 - 0x18, 0xe1a06000], [POSITION10 - 0x138, 0xe1a05000],
    [LIST_TEXT10 - 0x18, 0xe1a06000], [LIST_TEXT15 - 0x18, 0xe1a06000], [SUBTITLE - 0x38, 0xe1a04000],
    [0x531b0bbc, 0xe1a04000], [0x531b0bc4, 0xe59060f8],
  ];
  for (const [at, w] of guards) if (p.u32(at) !== w >>> 0) fail(`guard at ${at.toString(16)}`);
  // --- The table with the three film lists: Standard's lines, then Halation and Colour (stills).
  for (const [lo, hi, r] of TABLE_SITES)
    if (p.u32(lo) !== movWord(r, TABLE & 0xffff) || p.u32(hi) !== movWord(r, TABLE >>> 16, true)) fail('table site');
  const official = p.read(TABLE, ENTRIES * 8), ov = new DataView(official.buffer);
  const list = (entry: number) => {
    const at = ov.getUint32(entry * 8, true), count = ov.getUint32(entry * 8 + 4, true);
    const items = p.read(at, count * 2);
    for (let k = 0; k < count; k++) if ([KIND_TONING, KIND_GRAIN, ...(o.grain ? [KIND_GRAIN_FILM, KIND_SIZE] : [])].includes(items[2 * k + 1])) fail('Standard already has kind 10 or 15');
    return Uint8Array.from([...items, 0, KIND_GRAIN, 0, KIND_TONING, ...(o.grain ? [0, KIND_GRAIN_FILM, 0, KIND_SIZE] : [])]);
  };
  const set0 = list(0), set12 = list(12);
  const more = o.grain ? 4 : 0;
  if (set0.length !== 22 + more || set12.length !== 24 + more || set12[1] !== 17 || ov.getUint32(12 * 8, true) !== ov.getUint32(24 * 8, true)) fail('Standard lines');
  const l0 = p.append(set0), l12 = p.append(set12);
  const extra = new Uint8Array(24), ev = new DataView(extra.buffer);
  [[l0, set0.length / 2], [l12, set12.length / 2], [l12, set12.length / 2]].forEach(([a, c], k) => { ev.setUint32(k * 8, a, true); ev.setUint32(k * 8 + 4, c, true); });
  const table = p.append(Uint8Array.from([...official, ...extra]));
  for (const [lo, hi, r] of TABLE_SITES) {
    p.patch(lo, movWord(r, TABLE & 0xffff), movWord(r, table & 0xffff), 'halation: parameter lines with Halation and Colour, low half');
    p.patch(hi, movWord(r, TABLE >>> 16, true), movWord(r, table >>> 16, true), 'halation: parameter lines with Halation and Colour, high half');
  }
  // --- Base column (r4 = look - 11, r6 = controller; r0 the result, r1 free): 36 + set.
  const base = p.code(`sub r0,r4,#${FIRST - 11};cmp r0,#${n - 1};bhi native;ldrb r0,[r6,#0x199];cmp r0,#2;bhi native;
    cmp r0,#1;moveq r0,#25;movhi r0,#14;movlo r0,#36;b #${BASE_RETURN};native:b #${BASE_DEFAULT_TARGET};`);
  p.patch(BASE_DEFAULT, 0xea000024, branchWord(BASE_DEFAULT, base), 'halation: a film\'s parameter lines');
  // --- Names (r0 the kind, r3 the text table entry, r4 the controller).
  const grainNames = o.grain ? `cmp r0,#${KIND_GRAIN_FILM};bne gs;${film('ip', 'r4')}movwls r1,#${GRAIN_EFFECT_TEXT};b done;gs:cmp r0,#${KIND_SIZE};bne gn;${film('ip', 'r4')}movwls r1,#${o.grain.sizeText};b done;gn:` : '';
  const subtitle = p.code(`ldrh r1,[r3,#2];${grainNames}cmp r0,#${KIND_GRAIN};beq grain;cmp r0,#${KIND_TONING};bne done;
    ${film('ip', 'r4')}movwls r1,#${o.colourText};b done;
    grain:${film('ip', 'r4')}movwls r1,#${o.halationText};done:b #${SUBTITLE + 4};`);
  p.patch(SUBTITLE, 0xe1d310b2, branchWord(SUBTITLE, subtitle), 'halation: names of the lines');

  // ------------------------------------------------------------------ Halation (kind 15)
  // Start and position: Grain Effect's value of the stored strength, {0, 3, 2, 1}[strength]
  // ((4 - strength) & 3), which the native map turns into the position (= the strength).
  const strength = (at: number, ctl: string, native: number) => {
    const stub = p.code(`${film('r2', ctl)}bhi native;ldrb r0,[${ctl},#0x198];ldrb r1,[${ctl},#0x199];bl #${o.hal};rsb r0,r0,#4;and r0,r0,#3;b #${at + 4};
      native:bl #${native};b #${at + 4};`);
    p.patch(at, bl(at, native), bl(at, stub), 'halation: the stored strength');
    return stub;
  };
  const start15 = strength(START15, 'r6', STORED_GETTER15), position15 = strength(POSITION15, 'r5', LIVE_GETTER15);
  // List line: value text (r1 the 3-byte buffer) and icon (r0, r2 kept).
  const text15 = p.code(`${film('r2', 'r6')}bhi native;mov r2,r1;ldrb r0,[r6,#0x198];ldrb r1,[r6,#0x199];bl #${o.halText};b #${LIST_TEXT15 + 4};
    native:bl #${TEXT15};b #${LIST_TEXT15 + 4};`);
  p.patch(LIST_TEXT15, bl(LIST_TEXT15, TEXT15), bl(LIST_TEXT15, text15), 'halation: value of the line');
  const icon15 = p.code(`${film('r1', 'r6')}movw r1,#${GRAIN_ICON};movwls r1,#${o.halationIcon};b #${LIST_ICON15 + 4};`);
  p.patch(LIST_ICON15, movWord(1, GRAIN_ICON), branchWord(LIST_ICON15, icon15), 'halation: icon of the line');
  // Moving the slider (r6 the position = the strength, r4 the controller).
  const setter15 = p.code(`${film('r2', 'r4')}bhi native;mov r2,r6;ldrb r0,[r4,#0x198];ldrb r1,[r4,#0x199];bl #${o.halPut};b #${SETTER15 + 4};
    native:bl #${PARTICLE_SETTER};b #${SETTER15 + 4};`);
  p.patch(SETTER15, bl(SETTER15, PARTICLE_SETTER), bl(SETTER15, setter15), 'halation: store the strength');

  // ------------------------------------------------------------------ Colour (kind 10)
  const scale10 = p.code(`${film('r3', 'r6')}mov r3,#${TONING_SCALE};movwls r3,#${o.colourScale};b #${SCALE10 + 4};`);
  p.patch(SCALE10, 0xe3a030d3, branchWord(SCALE10, scale10), 'halation: colour scale');
  // Two positions for a film (count 1, spacing 0x168), as GR IV's colour row.
  const positions10 = p.code(`${film('r2', 'r6')}mov r2,#2;mov r3,#0xb4;movls r2,#1;movls r3,#0x168;b #${POSITIONS10 + 8};`);
  p.patch(POSITIONS10, 0xe3a02002, branchWord(POSITIONS10, positions10), 'halation: the colour has two positions');
  // Start and position: the colour (the native map of kind 10 is {0, 1, 2}: value = position).
  const colour = (at: number, ctl: string, native: number) => {
    const stub = p.code(`${film('r2', ctl)}bhi native;ldrb r0,[${ctl},#0x198];ldrb r1,[${ctl},#0x199];bl #${o.col};b #${at + 4};
      native:bl #${native};b #${at + 4};`);
    p.patch(at, bl(at, native), bl(at, stub), 'halation: the stored colour');
    return stub;
  };
  const start10 = colour(START10, 'r6', STORED_GETTER10), position10 = colour(POSITION10, 'r5', LIVE_GETTER10);
  // List line: no value text (GR IV's colour row shows no number); a red or a white light.
  const text10 = p.code(`${film('r2', 'r6')}bhi native;mov r2,#0;strb r2,[r1];b #${LIST_TEXT10 + 4};native:bl #${TEXT10};b #${LIST_TEXT10 + 4};`);
  p.patch(LIST_TEXT10, bl(LIST_TEXT10, TEXT10), bl(LIST_TEXT10, text10), 'halation: no colour text');
  const icon10 = p.code(`${film('r1', 'r6')}movw r1,#${TONING_ICON};bhi done;push {r0,r2,r3,lr};ldrb r0,[r6,#0x198];ldrb r1,[r6,#0x199];bl #${o.col};
    cmp r0,#0;movw r1,#${o.redIcon};movwne r1,#${o.whiteIcon};pop {r0,r2,r3,lr};done:b #${LIST_ICON10 + 4};`);
  p.patch(LIST_ICON10, movWord(1, TONING_ICON), branchWord(LIST_ICON10, icon10), 'halation: colour icon');
  // Moving the slider (r1 the value = the position, r4 the controller).
  const setter10 = p.code(`${film('r2', 'r4')}bhi native;mov r2,r1;ldrb r0,[r4,#0x198];ldrb r1,[r4,#0x199];bl #${o.colPut};b #${SETTER10 + 4};
    native:bl #${HDR_SETTER};b #${SETTER10 + 4};`);
  p.patch(SETTER10, bl(SETTER10, HDR_SETTER), bl(SETTER10, setter10), 'halation: store the colour');

  // ------------------------------------------------------------------ Cancel
  // The screen backs the parameters up when it opens (0x532c337c, a thunk to 0x532c325c) and
  // restores them on Cancel (0x532c34a8, a thunk to 0x532c33c8); the halation settings go with them.
  const thunk = (at: number, target: number, fn: number, what: string) => {
    if (p.u32(at) !== branchWord(at, target)) fail(`thunk at ${at.toString(16)}`);
    const stub = p.code(`push {r0-r3,ip,lr};bl #${fn};pop {r0-r3,ip,lr};b #${target};`);
    p.patch(at, branchWord(at, target), branchWord(at, stub), what);
    return stub;
  };
  const backup = o.backup !== undefined ? thunk(BACKUP, BACKUP_BODY, o.backup, 'halation: kept when the parameter screen opens') : undefined;
  const restore = o.restore !== undefined ? thunk(RESTORE, RESTORE_BODY, o.restore, 'halation: put back on Cancel') : undefined;
  // ------------------------------------------------------------------ Grain (kind 12) and size (kind 8)
  const grainRows = o.grain ? (() => {
    const G = o.grain!;
    const g: readonly (readonly [number, number])[] = [
      [START12, bl(START12, STORED_GETTER12)], [START12 + 4, bl(START12 + 4, MAP12)], [START12 - 0x18, 0xe1a06000], [START12 + 0x34, 0xe1a07000],
      [SCALE12, 0xe3a030c9], [POSITIONS12, 0xe3a02004], [POSITIONS12 + 4, 0xe3a0305a], [POSITIONS12 + 8, 0xe24b0054],
      [POSITION12, bl(POSITION12, LIVE_GETTER12)], [POSITION12 + 4, bl(POSITION12 + 4, MAP12)], [POSITION12 + 8, 0xe1a04000],
      [LIST_TEXT12, bl(LIST_TEXT12, TEXT12)], [LIST_TEXT12 - 0x18, 0xe1a06000], [LIST_ICON12, movWord(1, ICON12)],
      [SETTER12, bl(SETTER12, SETTER_NATIVE12)], [SETTER12 - 4, 0xe7d31006],
      [START8, bl(START8, STORED_GETTER8)], [START8 + 4, bl(START8 + 4, MAP8)], [START8 - 0x18, 0xe1a06000], [START8 + 0x34, 0xe1a07000],
      [SCALE8, 0xe3a030d2], [START8 + 0x40, 0xe3a02002], [START8 + 0x44, 0xe3a030b4],
      [POSITION8, bl(POSITION8, LIVE_GETTER8)], [POSITION8 + 4, bl(POSITION8 + 4, MAP8)], [POSITION8 + 8, 0xe1a04000],
      [LIST_TEXT8, bl(LIST_TEXT8, TEXT8)], [LIST_TEXT8 - 0x18, 0xe1a06000], [LIST_ICON8, movWord(1, ICON8)],
      [SETTER8, bl(SETTER8, SETTER_NATIVE8)], [SETTER8 - 4, 0xe7d31006],
    ];
    for (const [at, w] of g) if (p.u32(at) !== w >>> 0) fail(`grain guard at ${at.toString(16)}`);
    // Start and position: for a film, the position itself (the native value-to-position map is skipped).
    const pos = (at: number, ctl: string, native: number, get: number, what: string) => {
      const stub = p.code(`${film('r2', ctl)}bhi native;ldrb r0,[${ctl},#0x198];ldrb r1,[${ctl},#0x199];bl #${get};b #${at + 8};
        native:bl #${native};b #${at + 4};`);
      p.patch(at, bl(at, native), bl(at, stub), what);
      return stub;
    };
    const text = (at: number, native: number, fn: number, what: string) => {
      const stub = p.code(`${film('r2', 'r6')}bhi native;mov r2,r1;ldrb r0,[r6,#0x198];ldrb r1,[r6,#0x199];bl #${fn};b #${at + 4};
        native:bl #${native};b #${at + 4};`);
      p.patch(at, bl(at, native), bl(at, stub), what);
      return stub;
    };
    const icon = (at: number, native: number, what: string) => {
      const stub = p.code(`${film('r1', 'r6')}movw r1,#${native};movwls r1,#${GRAIN_ICON};b #${at + 4};`);
      p.patch(at, movWord(1, native), branchWord(at, stub), what);
      return stub;
    };
    const setter = (at: number, native: number, put: number, what: string) => {
      const stub = p.code(`${film('r2', 'r4')}bhi native;mov r2,r6;ldrb r0,[r4,#0x198];ldrb r1,[r4,#0x199];bl #${put};b #${at + 4};
        native:bl #${native};b #${at + 4};`);
      p.patch(at, bl(at, native), bl(at, stub), what);
      return stub;
    };
    const scale = (at: number, native: number, mine: number, what: string) => {
      const stub = p.code(`${film('r3', 'r6')}mov r3,#${native};movls r3,#${mine};b #${at + 4};`);
      p.patch(at, 0xe3a03000 | native, branchWord(at, stub), what);
      return stub;
    };
    // The screen's row capacity (0x531afbe0): the longest list of the camera's looks (columns 0..11
    // of each photo set, `cmp r4,#0xc`), which cut a film's list after its tenth line (Colour, Grain
    // and Size never showed). The screen is built once (0x531afe38, its look still Standard: the
    // look comes later, 0x531acbe4) and kept for every look, so the films' columns (36 - 11 * set)
    // always count too: the capacity is at least a film's longest list (all its lines, whatever the
    // photo or movie mode when the screen is built); a shorter list hides the rows after it
    // (0x531b0080), as for the camera's looks. r5 the screen.
    for (const [at, w] of [[ROWS_MAX, 0xe5d5019e], [ROWS_MAX + 4, bl(ROWS_MAX + 4, 0x536af31c)], [ROWS_MAX - 0x18, 0xe354000c]] as const)
      if (p.u32(at) !== w >>> 0) fail(`rows guard at ${at.toString(16)}`);
    const filmRows = Math.max(set0.length, set12.length) / 2;
    const rowsMax = p.code(`ldrb r0,[r5,#0x19e];cmp r0,#${filmRows};movlo r0,#${filmRows};strblo r0,[r5,#0x19e];b #${ROWS_MAX + 4};`);
    p.patch(ROWS_MAX, 0xe5d5019e, branchWord(ROWS_MAX, rowsMax), 'grain: the parameter screen has room for a film\'s lines');
    // Four positions for a film's Grain (as Grain Effect's: count 3, spacing 0x78).
    const positions12 = p.code(`${film('r2', 'r6')}mov r2,#4;mov r3,#0x5a;movls r2,#3;movls r3,#0x78;b #${POSITIONS12 + 8};`);
    p.patch(POSITIONS12, 0xe3a02004, branchWord(POSITIONS12, positions12), 'grain: a film\'s Grain has four positions');
    return {
      grainRowsMax: rowsMax,
      grainStart: pos(START12, 'r6', STORED_GETTER12, G.grain, 'grain: the stored grain'),
      grainPosition: pos(POSITION12, 'r5', LIVE_GETTER12, G.grain, 'grain: the grain\'s position'),
      grainScale: scale(SCALE12, 0xc9, GRAIN_SCALE, 'grain: Grain Effect\'s scale'), grainPositions: positions12,
      grainText: text(LIST_TEXT12, TEXT12, G.grainText, 'grain: value of the Grain line'),
      grainIcon: icon(LIST_ICON12, ICON12, 'grain: icon of the Grain line'),
      grainSetter: setter(SETTER12, SETTER_NATIVE12, G.grainPut, 'grain: store the grain'),
      sizeStart: pos(START8, 'r6', STORED_GETTER8, G.size, 'grain: the stored size'),
      sizePosition: pos(POSITION8, 'r5', LIVE_GETTER8, G.size, 'grain: the size\'s position'),
      sizeScale: scale(SCALE8, 0xd2, SIZE_SCALE, 'grain: the size\'s scale'),
      sizeText: text(LIST_TEXT8, TEXT8, G.sizeText2, 'grain: value of the Size line'),
      sizeIcon: icon(LIST_ICON8, ICON8, 'grain: icon of the Size line'),
      sizeSetter: setter(SETTER8, SETTER_NATIVE8, G.sizePut, 'grain: store the size'),
    };
  })() : undefined;

  return { ...(grainRows ?? {}), table, lists: [l0, l12], base, subtitle, start15, position15, text15, icon15, setter15,
    scale10, positions10, start10, position10, text10, icon10, setter10, ...(backup !== undefined ? { backup, restore } : {}) };
}
