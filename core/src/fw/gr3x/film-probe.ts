// SPDX-License-Identifier: GPL-2.0-only
/**
 * GR III 2.10 / IIIx 1.60, film mode phase 2: a test of the roll's storage bytes, 0x9b1..0x9b3 of
 * the user-settings record (docs/film-mode-notes.md). Test builds only: never in a release.
 *
 * Three counters, in the record in use (*0x55063f34) only, so that what the camera does with them
 * (power off, start, mode recall, Save Settings) shows as it is:
 *  - 0x9b1, starts: + 1 after the settings load (round 10's settings scaffold, round10.ts);
 *  - 0x9b2, pictures: + 1 each time the date imprint asks for the time (once per JPEG);
 *  - 0x9b3, power-offs: + 1 just before the settings save.
 * The date imprint (datestamp.ts) shows them instead of the date: its `get_time` is a stub that
 * writes { year 2000 + starts % 100, month mode + 1 (at most 12), day 1, hour power-offs % 24,
 * minute pictures % 60 }. The mode is the byte UserDataModel's first word points at (0 the
 * camera's own settings, n a recalled box; 0x53279fa8). Before the settings are loaded (record
 * pointer 0) the stub is the camera's own clock.
 *
 * In the long style, "2026.10.08 17:34" reads 20SS.MM.01 OO:PP: SS starts, MM mode + 1, OO
 * power-offs, PP pictures.
 *
 * Second form, 'exposures' (phase 2.3, revision T10-FILMPROBE2): 0x9b2 counts the still exposures
 * instead, + 1 at the start of SetShootingInfoResultBeforeExpose (0x534322d8, called only for
 * exposures of type 1: not for the slow-shutter noise reduction's dark frame, the noise
 * calibration or RAW development; docs/film-mode-notes.md), in front of the date imprint's own
 * hook there (datestamp.ts); the clock stub then only reads it.
 *
 * Third form, 'sequence' (phase 2.4, revision T10-FILMPROBE3), for the multi-exposure sequence; no
 * settings hooks (starts and power-offs are not counted):
 *  - 0x9b1: ends of a sequence, + 1 at the entry of 0x5346a910 (message 0x42411c16, phase and
 *    state back to 0: "Complete");
 *  - 0x9b2: exposures, as in the second form;
 *  - 0x9b3: retakes, + 1 at the entry of 0x5346a8d8 (message 0x42411817);
 *  - the multi-exposure state (byte 0x6c0 of the live shooting record: singleton 0x553458b0,
 *    + 0x518, [0]; 2 in a multi-exposure) at the last exposure, in the byte at 0x55804388 (round
 *    10's word kept for the End Screen choice, unused: test builds only).
 * The clock then shows 20SS.MM.01 OO:PP: SS ends, MM state + 1, OO retakes, PP exposures.
 *
 * Fourth form, 'emitters' (phase 2.6, revision T10-FILMPROBE4): as the third, but MM tells which
 * of the nine posters of UI event 0xb8 (the end) asked for the end. Each poster's entry leaves its
 * number (GR3X_END_EMITTERS, 1..9) in the byte at 0x55804388; the model's end (0x5323a080, before
 * the command goes to the capture side, so before the final picture is encoded) copies it to the
 * byte at 0x55804389 (10 when none of the nine ran) and clears the first; each exposure clears
 * both. MM = that byte + 1 (01: the end did not go through the model's end).
 *
 * Fifth form, 'folders' (phase 2.8, revision T10-FILMPROBE5): exposures in 0x9b2 (as the second
 * form), ends of a sequence in 0x9b1 (as the third), and:
 *  - the remaining-shots counter on the screen shows the exposures instead (0x532aa1f4, right
 *    after its only getter 0x53239e34; the count itself is untouched);
 *  - at the model's end (0x5323a080, the UI task; MENU, the mode dial, power off), the folder name
 *    becomes "TEST" + a letter ('A' + ends % 26; 0x5326caa0, all eight records and the live
 *    shooting record), the folder name type the free name (0x53258604, 1 = "Any") and the new folder
 *    flag is raised (0x5358515c(0x53584c74(), 1), as Create New Folder);
 *  - the clock shows the candidate folder and file numbers of the file information ([0x53584c74()
 *    + 0x248]: word + 0x118, halfword + 0x11c, flags + 0x116 / + 0x117): 20YY.MM.01 HH:mm with YY
 *    folder number % 100 (99 above 999), MM 1 + flag 0x116 + 2 * flag 0x117 (as 0 / 1), HH ends % 24,
 *    mm file number % 60.
 *
 * Sixth form, 'return' (phase 2.9, revision T10-FILMPROBE6): a picture goes into an older folder.
 * The DCF service's SetFilePath (0x535b2e8c) takes the folder number from its path argument
 * (halfword + 4) when it is not 0, and else picks the highest folder (docs/film-mode-notes.md). At
 * its entry, when that halfword is 0 and a mode is recalled (U1..U3: mode byte not 0), the hook
 * writes the lowest existing folder number there (directory list: [[service + 8] + 8], lowest
 * index halfword + 0x28, table of 900 entries at + 0x10, folders 100..999), only if its entry is
 * not empty. Every register kept, then the function's own first instruction. Nothing else: the
 * camera's clock, no counters.
 *
 * Seventh form, 'return2' (revision T10-FILMPROBE7): the sixth, and the folder mark of a closed
 * multi-exposure file goes to the folder the file was written in: at 0x535a6dac
 * (EventCloseCreateContents, request byte + 0x21 set), `mov r2,r7` (the highest folder) becomes
 * `ldrh r2,[r6,#0x10]` (the request's folder number). Without a given folder both are the same.
 */
import { branchWord } from '../aspect/arm';
import { FirmwareError } from '../types';
import { GR3X_R10, gr3xSettingsHook, gr3xSettingsPrior } from './round10';
import type { Gr3xSite } from './round10';

export const GR3X_FILM_STARTS = 0x9b1;
export const GR3X_FILM_PICTURES = 0x9b2;
export const GR3X_FILM_POWER_OFFS = 0x9b3;
const MODEL = 0x55063f30, POINTER = MODEL + 4;
/** Phase 2.4: the multi-exposure sequence's end and retake (docs/film-mode-notes.md). */
export const GR3X_MULTI_END = 0x5346a910;
export const GR3X_MULTI_RETAKE = 0x5346a8d8;
/** Test builds only: the state at the last exposure (round 10's unused End Screen word). */
export const GR3X_FILM_STATE = GR3X_R10.endScreenChoice;
const SINGLETON = 0x553458b0;
/** Phase 2.6: the posters of UI event 0xb8 (docs/film-mode-notes.md), numbered 1..9 in this order. */
export const GR3X_END_EMITTERS = [0x531a4d80, 0x531a6ef4, 0x531b3838, 0x531cb5f4, 0x532a7c84, 0x532a7cb0, 0x532a7cdc, 0x532a7d08, 0x532a7f6c] as const;
/** The shooting model's end (UI event 0xb8 -> 0x532270f4 -> here; sends 0x42411c16 when the state is 2). */
export const GR3X_MODEL_END = 0x5323a080;
const EMITTER = GR3X_FILM_STATE, SHOWN = GR3X_FILM_STATE + 1;
/** Phase 2.7: the remaining-shots text takes the count here (`mov r2,r0` after the getter 0x53239e34). */
export const GR3X_REMAINING_SHOTS = 0x532aa1f4;
/** Phase 2.8: folder name (0x5326caa0(UserDataModel, char[5])), its type (0x53258604(UserDataModel, 1 free name)),
 * the file information (0x53584c74()) and its new folder flag (0x5358515c(information, 1)). */
export const GR3X_FOLDER_NAME_SET = 0x5326caa0, GR3X_FOLDER_TYPE_SET = 0x53258604;
export const GR3X_FILE_INFO = 0x53584c74, GR3X_NEW_FOLDER = 0x5358515c;
const APP = 0x5320ad88, USER_DATA = 0x5320b31c;
/** Phase 2.9: the DCF service's SetFilePath(service, naming, path (+ 4 folder number), ...). */
export const GR3X_SET_FILE_PATH = 0x535b2e8c;
/** The folder mark at a created file's close: `mov r2,r7` before 0x5358533c(info, slot, folder, 1). */
export const GR3X_FOLDER_MARK = 0x535a6dac;
/** The camera's clock (the date imprint's get_time, datestamp.ts). */
export const GR3X_GET_TIME = 0x536b6510;

const lo = (v: number) => v & 0xffff, hi = (v: number) => v >>> 16;
const mod = (r: string, n: number, label: string) => `${label}:cmp ${r},#${n};subhs ${r},${r},#${n};bhs ${label};`;

export interface Gr3xFilmProbeProgram {
  code(source: string): number;
  sites: Gr3xSite[];
  /** The third form patches two function entries. */
  patch?(address: number, expected: number, replacement: number, reason: string): void;
}
const ram = (r: string, label: string) => `cmp ${r},#0x40000000;blo ${label};cmp ${r},#0xc0000000;bhs ${label};tst ${r},#3;bne ${label};`;
const bump = (offset: number, label: string) => `push {r0,r1};movw r0,#${lo(POINTER)};movt r0,#${hi(POINTER)};ldr r0,[r0];cmp r0,#0;beq ${label};
  ldrb r1,[r0,#${offset}];add r1,r1,#1;strb r1,[r0,#${offset}];${label}:pop {r0,r1};`;

/** The two settings hooks (the scaffold must be installed) and the clock stub for the date imprint. */
export function installGr3xFilmProbe(p: Gr3xFilmProbeProgram, form: 'encodes' | 'exposures' | 'sequence' | 'emitters' | 'folders' | 'return' | 'return2' = 'encodes') {
  if (form === 'sequence' || form === 'emitters') return installSequence(p, form === 'emitters');
  if (form === 'folders') return installFolders(p);
  if (form === 'return' || form === 'return2') return installReturn(p, form === 'return2');
  const priorLoad = gr3xSettingsPrior(p, 'load'), priorSave = gr3xSettingsPrior(p, 'save');
  // The load works from r0 (the settings object, record in use at +4), as every load hook.
  const load = p.code(`push {r4,r5,r6,lr};mov r4,r0;bl #${priorLoad};mov r5,r0;
    ldr r3,[r4,#4];cmp r3,#0;beq done;ldrb r2,[r3,#${GR3X_FILM_STARTS}];add r2,r2,#1;strb r2,[r3,#${GR3X_FILM_STARTS}];
    done:mov r0,r5;pop {r4,r5,r6,pc};`);
  gr3xSettingsHook(p, 'load', load, 'film probe: the settings load, then starts + 1');
  const save = p.code(`push {r4,lr};mov r4,r0;
    ldr r3,[r4,#4];cmp r3,#0;beq go;ldrb r2,[r3,#${GR3X_FILM_POWER_OFFS}];add r2,r2,#1;strb r2,[r3,#${GR3X_FILM_POWER_OFFS}];
    go:mov r0,r4;pop {r4,lr};b #${priorSave};`);
  gr3xSettingsHook(p, 'save', save, 'film probe: power-offs + 1, then the settings save');
  // get_time(clock, time): r1 = time (u16 year, then month, day, hour, minute bytes).
  const time = p.code(`movw r3,#${lo(POINTER)};movt r3,#${hi(POINTER)};ldr r3,[r3];cmp r3,#0;beq clock;
    push {r4,lr};
    ${form === 'encodes' ? `ldrb r2,[r3,#${GR3X_FILM_PICTURES}];add r2,r2,#1;strb r2,[r3,#${GR3X_FILM_PICTURES}];` : ''}
    ldrb r0,[r3,#${GR3X_FILM_STARTS}];${mod('r0', 100, 'year')}add r0,r0,#2000;strb r0,[r1];mov r0,r0,lsr #8;strb r0,[r1,#1];
    movw r4,#${lo(MODEL)};movt r4,#${hi(MODEL)};ldr r4,[r4];mov r0,#1;cmp r4,#0;ldrbne r0,[r4];addne r0,r0,#1;cmp r0,#12;movhi r0,#12;strb r0,[r1,#2];
    mov r0,#1;strb r0,[r1,#3];
    ldrb r0,[r3,#${GR3X_FILM_POWER_OFFS}];${mod('r0', 24, 'hour')}strb r0,[r1,#4];
    ldrb r0,[r3,#${GR3X_FILM_PICTURES}];${mod('r0', 60, 'minute')}strb r0,[r1,#5];
    pop {r4,pc};
    clock:b #${GR3X_GET_TIME};`);
  // The exposure count, for the date imprint's exposure hook (datestamp.ts): every register kept
  // (the flags are free at a function's entry).
  const exposure = form === 'exposures' ? `push {r0,r1};movw r0,#${lo(POINTER)};movt r0,#${hi(POINTER)};ldr r0,[r0];cmp r0,#0;
    ldrbne r1,[r0,#${GR3X_FILM_PICTURES}];addne r1,r1,#1;strbne r1,[r0,#${GR3X_FILM_PICTURES}];pop {r0,r1};` : '';
  return { entries: { filmProbeLoad: load, filmProbeSave: save, filmProbeTime: time }, exposure };
}

/** The third form: the sequence's end and retake hooks, the exposure count and state, the clock. */
function installSequence(p: Gr3xFilmProbeProgram, emitters = false) {
  if (!p.patch) throw new FirmwareError('internal', 'IIIx film probe: the sequence form patches');
  const entries: Record<string, number> = {};
  const hook = (at: number, body: string, name: string, reason: string) => {
    if (p.sites.some(s => s.address === at)) throw new FirmwareError('unexpected-instruction', `IIIx film probe: ${at.toString(16)} already patched`);
    const stub = p.code(`${body}mov ip,sp;b #${at + 4};`);
    p.patch!(at, 0xe1a0c00d, branchWord(at, stub), reason);
    entries[name] = stub;
  };
  const setByte = (address: number, value: string) => `push {r0,r1};movw r0,#${lo(address)};movt r0,#${hi(address)};${value}strb r1,[r0];pop {r0,r1};`;
  if (emitters) {
    GR3X_END_EMITTERS.forEach((at, i) => hook(at, setByte(EMITTER, `mov r1,#${i + 1};`), `filmProbeEmitter${i + 1}`, `film probe: end poster ${i + 1}`));
    hook(GR3X_MODEL_END, `push {r0,r1,r2};movw r0,#${lo(EMITTER)};movt r0,#${hi(EMITTER)};ldrb r1,[r0];cmp r1,#0;moveq r1,#10;strb r1,[r0,#1];
      mov r2,#0;strb r2,[r0];pop {r0,r1,r2};`, 'filmProbeModelEnd', 'film probe: the model\'s end, which poster');
  }
  for (const [name, at, offset] of [['filmProbeEnd', GR3X_MULTI_END, GR3X_FILM_STARTS], ['filmProbeRetake', GR3X_MULTI_RETAKE, GR3X_FILM_POWER_OFFS]] as const) {
    if (p.sites.some(s => s.address === at)) throw new FirmwareError('unexpected-instruction', `IIIx film probe: ${at.toString(16)} already patched`);
    const stub = p.code(`${bump(offset, 'done')}mov ip,sp;b #${at + 4};`);
    p.patch(at, 0xe1a0c00d, branchWord(at, stub), `film probe: ${name === 'filmProbeEnd' ? 'multi-exposure end' : 'multi-exposure retake'} + 1`);
    entries[name] = stub;
  }
  const time = p.code(`movw r3,#${lo(POINTER)};movt r3,#${hi(POINTER)};ldr r3,[r3];cmp r3,#0;beq clock;
    push {r4,lr};
    ldrb r0,[r3,#${GR3X_FILM_STARTS}];${mod('r0', 100, 'year')}add r0,r0,#2000;strb r0,[r1];mov r0,r0,lsr #8;strb r0,[r1,#1];
    movw r4,#${lo(emitters ? SHOWN : GR3X_FILM_STATE)};movt r4,#${hi(emitters ? SHOWN : GR3X_FILM_STATE)};ldrb r0,[r4];add r0,r0,#1;cmp r0,#12;movhi r0,#12;strb r0,[r1,#2];
    mov r0,#1;strb r0,[r1,#3];
    ldrb r0,[r3,#${GR3X_FILM_POWER_OFFS}];${mod('r0', 24, 'hour')}strb r0,[r1,#4];
    ldrb r0,[r3,#${GR3X_FILM_PICTURES}];${mod('r0', 60, 'minute')}strb r0,[r1,#5];
    pop {r4,pc};
    clock:b #${GR3X_GET_TIME};`);
  if (emitters) {
    const exposure = `${bump(GR3X_FILM_PICTURES, 'counted')}push {r0,r1};movw r0,#${lo(EMITTER)};movt r0,#${hi(EMITTER)};mov r1,#0;strb r1,[r0];strb r1,[r0,#1];pop {r0,r1};`;
    return { entries: { ...entries, filmProbeTime: time }, exposure };
  }
  // At each exposure: exposures + 1, and the state (0 when a pointer is missing).
  const exposure = `${bump(GR3X_FILM_PICTURES, 'counted')}push {r0,r1};mov r1,#0;
    movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', 'state')}
    ldr r0,[r0,#0x518];${ram('r0', 'state')}ldr r0,[r0];${ram('r0', 'state')}ldrb r1,[r0,#0x6c0];
    state:movw r0,#${lo(GR3X_FILM_STATE)};movt r0,#${hi(GR3X_FILM_STATE)};strb r1,[r0];pop {r0,r1};`;
  return { entries: { ...entries, filmProbeTime: time }, exposure };
}

/** The fifth form: the screen counter, the folder actions at the model's end, the folder numbers. */
function installFolders(p: Gr3xFilmProbeProgram) {
  if (!p.patch) throw new FirmwareError('internal', 'IIIx film probe: the folder form patches');
  const entries: Record<string, number> = {};
  const free = (at: number) => { if (p.sites.some(s => s.address === at)) throw new FirmwareError('unexpected-instruction', `IIIx film probe: ${at.toString(16)} already patched`); };
  // Ends of a sequence (as the third form).
  free(GR3X_MULTI_END);
  entries.filmProbeEnd = p.code(`${bump(GR3X_FILM_STARTS, 'done')}mov ip,sp;b #${GR3X_MULTI_END + 4};`);
  p.patch(GR3X_MULTI_END, 0xe1a0c00d, branchWord(GR3X_MULTI_END, entries.filmProbeEnd), 'film probe: multi-exposure end + 1');
  // The screen counter: r2 = exposures when the settings are loaded, else the count (r0).
  free(GR3X_REMAINING_SHOTS);
  entries.filmProbeCounter = p.code(`movw r2,#${lo(POINTER)};movt r2,#${hi(POINTER)};ldr r2,[r2];cmp r2,#0;moveq r2,r0;
    ldrbne r2,[r2,#${GR3X_FILM_PICTURES}];b #${GR3X_REMAINING_SHOTS + 4};`);
  p.patch(GR3X_REMAINING_SHOTS, 0xe1a02000, branchWord(GR3X_REMAINING_SHOTS, entries.filmProbeCounter), 'film probe: the screen counter shows the exposures');
  // The model's end: folder name TEST + letter, free name type, new folder flag; then the function.
  free(GR3X_MODEL_END);
  entries.filmProbeFolder = p.code(`push {r0,r1,r2,r3,r4,lr};sub sp,sp,#8;
    movw r4,#${lo(POINTER)};movt r4,#${hi(POINTER)};ldr r4,[r4];cmp r4,#0;beq out;
    ldrb r0,[r4,#${GR3X_FILM_STARTS}];${mod('r0', 26, 'letter')}add r0,r0,#0x41;
    movw r1,#0x4554;movt r1,#0x5453;str r1,[sp];strb r0,[sp,#4];mov r0,#0;strb r0,[sp,#5];
    bl #${APP};bl #${USER_DATA};mov r4,r0;mov r1,sp;bl #${GR3X_FOLDER_NAME_SET};
    mov r0,r4;mov r1,#1;bl #${GR3X_FOLDER_TYPE_SET};
    bl #${GR3X_FILE_INFO};mov r1,#1;bl #${GR3X_NEW_FOLDER};
    out:add sp,sp,#8;pop {r0,r1,r2,r3,r4,lr};mov ip,sp;b #${GR3X_MODEL_END + 4};`);
  p.patch(GR3X_MODEL_END, 0xe1a0c00d, branchWord(GR3X_MODEL_END, entries.filmProbeFolder), 'film probe: folder name, type and new folder at the model\'s end');
  // The clock: the file information's numbers (r1 = time; r0, r2, r3 free).
  const time = p.code(`movw r3,#${lo(POINTER)};movt r3,#${hi(POINTER)};ldr r3,[r3];cmp r3,#0;beq clock;
    push {r4,r5,r6,lr};mov r5,r1;mov r6,r3;bl #${GR3X_FILE_INFO};ldr r4,[r0,#0x248];mov r1,r5;
    ldr r0,[r4,#0x118];movw r2,#999;cmp r0,r2;movhi r0,#99;${mod('r0', 100, 'year')}add r0,r0,#2000;strb r0,[r1];mov r0,r0,lsr #8;strb r0,[r1,#1];
    ldrb r0,[r4,#0x116];cmp r0,#0;movne r0,#1;ldrb r2,[r4,#0x117];cmp r2,#0;movne r2,#2;add r0,r0,r2;add r0,r0,#1;strb r0,[r1,#2];
    mov r0,#1;strb r0,[r1,#3];
    ldrb r0,[r6,#${GR3X_FILM_STARTS}];${mod('r0', 24, 'hour')}strb r0,[r1,#4];
    add r2,r4,#0x100;ldrh r0,[r2,#0x1c];${mod('r0', 60, 'minute')}strb r0,[r1,#5];
    pop {r4,r5,r6,pc};
    clock:b #${GR3X_GET_TIME};`);
  const exposure = `${bump(GR3X_FILM_PICTURES, 'counted')}`;
  return { entries: { ...entries, filmProbeTime: time }, exposure };
}

/** The sixth form: in a recalled mode, SetFilePath gets the lowest existing folder. */
function installReturn(p: Gr3xFilmProbeProgram, mark = false) {
  if (!p.patch) throw new FirmwareError('internal', 'IIIx film probe: the return form patches');
  if (p.sites.some(s => s.address === GR3X_SET_FILE_PATH)) throw new FirmwareError('unexpected-instruction', `IIIx film probe: ${GR3X_SET_FILE_PATH.toString(16)} already patched`);
  // r0 service, r2 path; r1 and r3 used, then restored.
  const stub = p.code(`push {r0,r1,r3,lr};ldrh r3,[r2,#4];cmp r3,#0;bne out;
    movw r3,#${lo(MODEL)};movt r3,#${hi(MODEL)};ldr r3,[r3];cmp r3,#0;beq out;ldrb r3,[r3];cmp r3,#0;beq out;
    ldr r3,[r0,#8];${ram('r3', 'out')}ldr r3,[r3,#8];${ram('r3', 'out')}
    ldrh r1,[r3,#0x28];cmp r1,#0x384;bhs out;ldr r3,[r3,#0x10];${ram('r3', 'out')}ldr r3,[r3,r1,lsl #2];cmp r3,#0;beq out;
    add r1,r1,#100;strh r1,[r2,#4];
    out:pop {r0,r1,r3,lr};mov ip,sp;b #${GR3X_SET_FILE_PATH + 4};`);
  p.patch(GR3X_SET_FILE_PATH, 0xe1a0c00d, branchWord(GR3X_SET_FILE_PATH, stub), 'film probe: SetFilePath, the lowest folder in a recalled mode');
  if (mark) {
    if (p.sites.some(s => s.address === GR3X_FOLDER_MARK)) throw new FirmwareError('unexpected-instruction', `IIIx film probe: ${GR3X_FOLDER_MARK.toString(16)} already patched`);
    p.patch(GR3X_FOLDER_MARK, 0xe1a02007, 0xe1d621b0, 'film probe: the folder mark goes to the written folder');
  }
  return { entries: { filmProbeReturn: stub } as Record<string, number>, exposure: '' };
}
