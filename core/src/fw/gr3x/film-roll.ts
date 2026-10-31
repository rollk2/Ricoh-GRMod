// SPDX-License-Identifier: GPL-2.0-only
/**
 * GR III 2.10 / IIIx 1.60, film mode phase 3.1: the roll's state and its frame counter
 * (CAHIER_DES_CHARGES.md, docs/film-mode-notes.md). Test builds only for now. Without the menu line
 * every BOX recalled by U1..U3 is in film mode (mode byte 1..6); with it (form 'menu', phase 4) only
 * a U mode whose record in use has Film Roll Mode on (bit 0 of 0x9b1, see installMenu).
 *
 * The roll's state lives in padding bytes of the settings record (tested to persist, one per BOX):
 *  - 0x9b1: bit 0 the film mode (the coming menu line; unused here), bit 1 a roll is started,
 *    bits 2 and 3 the folder number's high bits (coming);
 *  - 0x9b2: the frame to take (1 .. length);
 *  - 0x9b3: the folder number's low byte (coming).
 * Each change is written to the record in use (*0x55063f34) and to the active BOX's stored record
 * (0x55063f38 + 4 * mode): a mode recall copies the stored record into use, so the stored one must
 * follow (GR Mod's author's warning).
 *
 * Hooks:
 *  - the first exposure (SetShootingInfoResultBeforeExpose, 0x534322d8, in front of the date
 *    imprint's hook, as the film probe): in a U mode with no roll started, the roll starts at frame 1;
 *  - the shooting model's end (0x5323a080, the UI task; Complete, MENU, the mode dial, power off),
 *    when the multi-exposure state is 2 (a frame was exposed): the frame advances; past the roll's
 *    length (from the ratio, +0x4c2) the roll ends (a new one starts at the next exposure). Then the
 *    record in use and the BOX's record are saved to the camera's own storage at once (0x53826c54,
 *    files APData01 and APData(mode + 2), as the power-off save 0x5323f274 does for every record):
 *    the camera saves its settings only at power off;
 *  - the remaining-shots counter on the screen (0x532aa1f4, tested; text made by 0x532aa140,
 *    snprintf(buffer, 6, "%d", count)): in a U mode the hook writes "frame/length" itself
 *    (snprintf 0x53141100 with the firmware's own "%d/%d", 0x53c0ca59; frame 1 before the roll
 *    starts; at most "72/72", 5 characters) and returns from the text function; the count elsewhere;
 *  - Save Settings into BOX n (0x5324b760(object, n), memcpy of the record in use then the merge):
 *    then BOX n's roll is ended (bit 1 and the frame cleared), and the record in use's too when n is
 *    the active mode: saving over a started roll rewinds it;
 *  - (form 'folders', T11-ROLL2) the DCF service's SetFilePath (0x535b2e8c, folder number at path
 *    + 4: when not 0 it is used as given, and created when it does not exist; docs/film-mode-notes.md):
 *    in a U mode with a roll started, the roll's folder (0x9b3 | (0x9b1 bits 2..3) << 8) when it
 *    exists; else the camera's next new folder number (0x535b742c, max(highest, reserved) + 1, 0 past
 *    999), which SetFilePath creates as it creates a new folder, and which becomes the roll's folder.
 *    Elsewhere (free modes), when the highest folder (the one the camera would use) is a started
 *    roll's folder of any BOX, the next new folder number is given instead: free pictures never go
 *    into a roll's folder. The roll's folder is cleared when a roll starts, ends or is rewound;
 *    the multi-exposure folder mark goes to the folder written (0x535a6dac, as T10-FILMPROBE7);
 *  - (form 'folders-diag', T11-ROLL2D, diagnostic) the same, and the hook records what it saw in
 *    free RAM words (round 10's zero-filled sbrk area): 0x55804390 halfword the folder number given
 *    at the entry, + 2 the path taken (1 free mode unchanged, 2 the roll's folder, 3 a new folder
 *    given, 4 no next number, 5 a folder already given, 6 a free mode moved off a roll's folder),
 *    + 3 SetFilePath's result (1 when not 0: the hook then runs the function as a call, its return
 *    address kept at 0x5580438c, as in every folders form), + 4 calls, + 6 halfword the next number asked; the date imprint
 *    shows them instead of the date: 20YY.MM.DD HH:mm, YY entry folder % 100, MM path + 6 when the
 *    function succeeded, DD 1 + calls % 28, HH the record in use's roll folder % 24, mm next % 60;
 *  - the mode recall (through the settings guard's recall hook, guard.ts): recalling U1..U3 sets
 *    Save Interim Images (+0x482, StillMultiExposureSaveProcess) to Off (0) and the drive mode
 *    (+0x472, StillDriveMode: 0 single, 1 continuous, 2 bracket, 3 multi-exposure, 4 interval,
 *    5 interval multi-exposure; setter 0x5327b744) to multi-exposure (3) in the record in use,
 *    before the record goes to the live values (0x532750f8, which the setter also calls). With interim images the camera puts the sequence in
 *    a folder of its own (tested), which a roll's folder must not get.
 */
import { branchWord, movWord } from '../aspect/arm';
import { FirmwareError } from '../types';
import type { Gr3xSite } from './round10';
import type { Gr3xMenuRatio } from './geometry';
import { GR3X_FOLDER_MARK, GR3X_GET_TIME, GR3X_SET_FILE_PATH } from './film-probe';

export const GR3X_ROLL_FLAGS = 0x9b1, GR3X_ROLL_FRAME = 0x9b2, GR3X_ROLL_FOLDER = 0x9b3;
export const GR3X_ROLL_STARTED = 2;
/** Bit 0 of 0x9b1: the BOX's Film Roll Mode (the menu line, form 'menu'). */
export const GR3X_FILM_ON = 1;
/** Save Interim Images (0 Off, 1 Unblended, 2 Blended, 3 Unblended + Blended). */
export const GR3X_INTERIM = 0x482;
export const GR3X_DRIVE = 0x472, GR3X_DRIVE_MULTI = 3;
/** snprintf(buffer, size, format, ...) and the firmware's "%d/%d" (the end of "%f, %d/%d"). */
export const GR3X_SNPRINTF = 0x53141100, GR3X_FRAME_FORMAT = 0x53c0ca59;
export const GR3X_RATIO = 0x4c2;
/** The shooting model's end, the screen counter, Save Settings into a BOX. */
export const GR3X_ROLL_MODEL_END = 0x5323a080, GR3X_ROLL_COUNTER = 0x532aa1f4, GR3X_BOX_SAVE = 0x5324b760;
/** The settings storage (0x53828014() + 8) and its write (store, file index, size, data). */
export const GR3X_APP_DATA = 0x53828014, GR3X_APP_DATA_WRITE = 0x53826c54;
/** The directory list's next new folder number (directory service [service + 8]). */
export const GR3X_NEXT_FOLDER = 0x535b742c;
/** Bits of 0x9b1 holding the folder number's high bits. */
const FOLDER_HIGH = 0xc;
/** Diagnostic words (T11-ROLL2D): round 10's zero-filled sbrk area, after its six words (round10.ts). */
export const GR3X_ROLL_DIAG = 0x55804390;
const mod = (r: string, n: number, label: string) => `${label}:cmp ${r},#${n};subhs ${r},${r},#${n};bhs ${label};`;
const MODEL = 0x55063f30, POINTER = MODEL + 4, STORED = MODEL + 8, RECORD = 0xb26;
const SINGLETON = 0x553458b0;

/** The menu line's name, in `LANGS` order (cs da en fi fr de el hu it ja ko nl pl pt ru zh-CN es sv
 * th zh-TW tr; ../aspect/datestamp-menu.ts). Every character is in the camera's own texts of that
 * language, except zh-CN's 底 (in zh-TW's texts; 胶卷 is in no text of the firmware). */
export const GR3X_FILM_ROLL_MODE_NAMES: readonly string[] = [
  'Režim kinofilmu', 'Filmrulle-tilstand', 'Film Roll Mode', 'Filmirullatila', 'Mode pellicule', 'Filmrollen-Modus', 'Λειτουργία φιλμ',
  'Filmtekercs mód', 'Modalità rullino', 'フィルムロールモード', '필름 롤 모드', 'Filmrolmodus', 'Tryb kliszy', 'Modo rolo de filme',
  'Режим плёнки', '底片模式', 'Modo carrete', 'Filmrullsläge', 'โหมดม้วนฟิล์ม', '底片模式', 'Film rulosu modu',
];

/** Frames of a roll by ratio (CAHIER_DES_CHARGES.md); 36 for any other. */
export const GR3X_ROLL_LENGTHS: Record<string, number> = { '3:2': 36, '3:4': 72, '65:24': 21, '4:3': 15, '1:1': 12 };

const lo = (v: number) => v & 0xffff, hi = (v: number) => v >>> 16;
const ram = (r: string, label: string) => `cmp ${r},#0x40000000;blo ${label};cmp ${r},#0xc0000000;bhs ${label};tst ${r},#3;bne ${label};`;
/** r1 = mode 1..6 (else to `label`), r2 = record in use, r3 = the BOX's stored record (r0 free).
 * `film`: also the record in use's Film Roll Mode (bit 0 of 0x9b1, the menu line), else to `label`. */
const records = (label: string, film = false) => `movw r0,#${lo(MODEL)};movt r0,#${hi(MODEL)};ldr r1,[r0];${ram('r1', label)}ldrb r1,[r1];
  cmp r1,#0;beq ${label};cmp r1,#6;bhi ${label};ldr r2,[r0,#4];${ram('r2', label)}add r3,r0,#8;ldr r3,[r3,r1,lsl #2];${ram('r3', label)}` +
  (film ? `ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_FILM_ON};beq ${label};` : '');

export interface Gr3xRollProgram {
  code(source: string): number;
  sites: Gr3xSite[];
  patch(address: number, expected: number, replacement: number, reason: string): void;
}

export function installGr3xFilmRoll(p: Gr3xRollProgram, menu: readonly Gr3xMenuRatio[], folders = false, diag = false, filmMenu = false, keys: false | 'sequence' | 'boot' | 'shot' = false, noReview: false | 'skip' | 'live' | 'next' | 'armed' = false) {
  const rec = (label: string) => records(label, filmMenu);
  const free = (at: number) => { if (p.sites.some(s => s.address === at)) throw new FirmwareError('unexpected-instruction', `IIIx film roll: ${at.toString(16)} already patched`); };
  const entries: Record<string, number> = {};
  // The roll's length from the ratio identity in r0 (r0 = length).
  const lengths = menu.filter(r => (GR3X_ROLL_LENGTHS[r.ratio] ?? 36) !== 36).map(r => `cmp r0,#${r.id};moveq r0,#${GR3X_ROLL_LENGTHS[r.ratio]};beq len;`).join('');
  const length = `${lengths}mov r0,#36;len:`;

  // The first exposure: every register kept (the flags are free at a function's entry).
  // ('shot', T13-FN3: the key probe's table cleared at each exposure first.)
  const exposure = `${keys === 'shot' ? keyClear : ''}push {r0,r1,r2,r3};${rec('rollkept')}
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};bne rollkept;
    orr r0,r0,#${GR3X_ROLL_STARTED};bic r0,r0,#${FOLDER_HIGH};strb r0,[r2,#${GR3X_ROLL_FLAGS}];
    ldrb r0,[r3,#${GR3X_ROLL_FLAGS}];orr r0,r0,#${GR3X_ROLL_STARTED};bic r0,r0,#${FOLDER_HIGH};strb r0,[r3,#${GR3X_ROLL_FLAGS}];
    mov r0,#1;strb r0,[r2,#${GR3X_ROLL_FRAME}];strb r0,[r3,#${GR3X_ROLL_FRAME}];
    mov r0,#0;strb r0,[r2,#${GR3X_ROLL_FOLDER}];strb r0,[r3,#${GR3X_ROLL_FOLDER}];
    rollkept:pop {r0,r1,r2,r3};`;

  // The model's end: advance, then save both records; every register kept.
  free(GR3X_ROLL_MODEL_END);
  entries.filmRollEnd = p.code(`${keys === 'sequence' ? keyClear : ''}push {r0,r1,r2,r3,r4,r5,r6,lr};${rec('out')}
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};beq out;
    movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', 'out')}
    ldr r0,[r0,#0x518];${ram('r0', 'out')}ldr r0,[r0];${ram('r0', 'out')}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne out;
    mov r4,r1;mov r5,r2;mov r6,r3;
    ldrb r0,[r5,#${GR3X_RATIO}];${length}
    ldrb r1,[r5,#${GR3X_ROLL_FRAME}];add r1,r1,#1;cmp r1,r0;movhi r1,#0;
    strb r1,[r5,#${GR3X_ROLL_FRAME}];strb r1,[r6,#${GR3X_ROLL_FRAME}];strbhi r1,[r5,#${GR3X_ROLL_FOLDER}];strbhi r1,[r6,#${GR3X_ROLL_FOLDER}];
    ldrb r2,[r5,#${GR3X_ROLL_FLAGS}];bichi r2,r2,#${GR3X_ROLL_STARTED | FOLDER_HIGH};strb r2,[r5,#${GR3X_ROLL_FLAGS}];
    ldrb r2,[r6,#${GR3X_ROLL_FLAGS}];bichi r2,r2,#${GR3X_ROLL_STARTED | FOLDER_HIGH};strb r2,[r6,#${GR3X_ROLL_FLAGS}];
    bl #${GR3X_APP_DATA};ldr r0,[r0,#8];mov r1,#1;movw r2,#${RECORD};mov r3,r5;bl #${GR3X_APP_DATA_WRITE};
    bl #${GR3X_APP_DATA};ldr r0,[r0,#8];add r1,r4,#2;movw r2,#${RECORD};mov r3,r6;bl #${GR3X_APP_DATA_WRITE};
    out:pop {r0,r1,r2,r3,r4,r5,r6,lr};mov ip,sp;b #${GR3X_ROLL_MODEL_END + 4};`);
  p.patch(GR3X_ROLL_MODEL_END, 0xe1a0c00d, branchWord(GR3X_ROLL_MODEL_END, entries.filmRollEnd), 'film roll: the frame advances at the model\'s end, settings saved');

  // The screen counter, inside 0x532aa1d4 (r4 the buffer, frame of {r4, r5, fp, ip, lr, pc}): in a
  // U mode "frame/length" written here, then that function's return (its `ldm sp, {r4, r5, fp, sp,
  // pc}` from fp - 0x14, spelled out); else the count (r0) as before.
  free(GR3X_ROLL_COUNTER);
  entries.filmRollCounter = p.code(`push {r0,r1,r3};${rec('count')}
    ldrb r0,[r2,#${GR3X_RATIO}];${length}mov r3,r0;
    ldrb r1,[r2,#${GR3X_ROLL_FLAGS}];tst r1,#${GR3X_ROLL_STARTED};moveq r1,#1;ldrbne r1,[r2,#${GR3X_ROLL_FRAME}];
    add sp,sp,#12;push {r3};mov r3,r1;mov r0,r4;mov r1,#6;movw r2,#${lo(GR3X_FRAME_FORMAT)};movt r2,#${hi(GR3X_FRAME_FORMAT)};
    bl #${GR3X_SNPRINTF};add sp,sp,#4;
    sub ip,fp,#0x14;ldr r4,[ip];ldr r5,[ip,#4];ldr lr,[ip,#0x10];ldr fp,[ip,#8];ldr sp,[ip,#0xc];bx lr;
    count:pop {r0,r1,r3};mov r2,r0;b #${GR3X_ROLL_COUNTER + 4};`);
  p.patch(GR3X_ROLL_COUNTER, 0xe1a02000, branchWord(GR3X_ROLL_COUNTER, entries.filmRollCounter), 'film roll: the screen counter shows the frame to take');

  // Save Settings into BOX n: the native save (its first instruction, then the rest), then the roll
  // of BOX n ends, and the record in use's when n is the active mode.
  free(GR3X_BOX_SAVE);
  const native = p.code(`cmp r1,#7;b #${GR3X_BOX_SAVE + 4};`);
  entries.filmRollBoxSave = p.code(`push {r4,r5,r6,lr};mov r4,r0;mov r5,r1;bl #${native};mov r6,r0;
    sub r0,r5,#1;cmp r0,#5;bhi saved;
    movw r0,#${lo(STORED)};movt r0,#${hi(STORED)};ldr r1,[r0,r5,lsl #2];${ram('r1', 'saved')}
    ldrb r2,[r1,#${GR3X_ROLL_FLAGS}];bic r2,r2,#${GR3X_ROLL_STARTED | FOLDER_HIGH};strb r2,[r1,#${GR3X_ROLL_FLAGS}];mov r2,#0;strb r2,[r1,#${GR3X_ROLL_FRAME}];strb r2,[r1,#${GR3X_ROLL_FOLDER}];
    movw r0,#${lo(MODEL)};movt r0,#${hi(MODEL)};ldr r1,[r0];${ram('r1', 'saved')}ldrb r1,[r1];cmp r1,r5;bne saved;
    ldr r1,[r0,#4];${ram('r1', 'saved')}
    ldrb r2,[r1,#${GR3X_ROLL_FLAGS}];bic r2,r2,#${GR3X_ROLL_STARTED | FOLDER_HIGH};strb r2,[r1,#${GR3X_ROLL_FLAGS}];mov r2,#0;strb r2,[r1,#${GR3X_ROLL_FRAME}];strb r2,[r1,#${GR3X_ROLL_FOLDER}];
    saved:mov r0,r6;pop {r4,r5,r6,pc};`);
  p.patch(GR3X_BOX_SAVE, 0xe3510007, branchWord(GR3X_BOX_SAVE, entries.filmRollBoxSave), 'film roll: Save Settings into a BOX rewinds its roll');

  // The mode recall (called by the guard's recall hook): r0 the record in use, r1 the mode recalled.
  entries.filmRollRecall = p.code(`sub r1,r1,#1;cmp r1,#5;bxhi lr;${ram('r0', 'none')}${filmMenu ? `ldrb r1,[r0,#${GR3X_ROLL_FLAGS}];tst r1,#${GR3X_FILM_ON};bxeq lr;` : ''}
    mov r1,#0;strb r1,[r0,#${GR3X_INTERIM}];mov r1,#${GR3X_DRIVE_MULTI};strb r1,[r0,#${GR3X_DRIVE}];none:bx lr;`);
  if (folders) installFolders(p, free, entries, diag, filmMenu);
  if (filmMenu) installMenu(p, entries);
  if (keys) installKeys(p, free, entries, keys === 'boot' || keys === 'shot', keys === 'shot');
  if (noReview === 'skip') installNoReview(p, free, entries);
  if (noReview === 'live') installReviewToLive(p, free, entries);
  if (noReview === 'next' || noReview === 'armed') installReviewNext(p, free, entries, noReview === 'armed');
  return { entries, exposure };
}

/** The roll's folder at SetFilePath's entry (r0 service, r2 path); every register kept. */
function installFolders(p: Gr3xRollProgram, free: (at: number) => void, entries: Record<string, number>, diag: boolean, film: boolean) {
  free(GR3X_SET_FILE_PATH);
  const D = GR3X_ROLL_DIAG, at = `movw ip,#${lo(D)};movt ip,#${hi(D)};`;
  const code = (n: number) => diag ? `${at}mov lr,#${n};strb lr,[ip,#2];` : '';
  const next = (r: string) => diag ? `${at}strh ${r},[ip,#6];` : '';
  const enter = diag ? `${at}ldrb r0,[ip,#4];add r0,r0,#1;strb r0,[ip,#4];ldrh r0,[r4,#4];strh r0,[ip];mov r0,#0;strb r0,[ip,#2];strb r0,[ip,#3];strh r0,[ip,#6];` : '';
  // The diagnostic runs the function as a call to see its result; stack arguments stay in place
  // (everything is popped first), the return address waits in a RAM word.
  // Every folders form runs the function as a call (as the diagnostic build tested on the camera).
  const tramp = p.code(`mov ip,sp;b #${GR3X_SET_FILE_PATH + 4};`);
  const result = diag ? `cmp r0,#0;movne lr,#1;moveq lr,#0;strb lr,[ip,#7];` : '';
  const exit = `movw ip,#${lo(D - 4)};movt ip,#${hi(D - 4)};str lr,[ip];bl #${tramp};
    movw ip,#${lo(D - 4)};movt ip,#${hi(D - 4)};${result}ldr lr,[ip];bx lr;`;
  // r0 = the folder of the record or copy in r0 (0x9b3 | (0x9b1 bits 2..3) << 8); r1 used.
  const folderOf = (rec: string) => `ldrb r1,[${rec},#${GR3X_ROLL_FLAGS}];mov r1,r1,lsr #2;and r1,r1,#3;ldrb r0,[${rec},#${GR3X_ROLL_FOLDER}];orr r0,r0,r1,lsl #8;`;
  entries.filmRollFolder = p.code(`push {r0,r1,r2,r3,r4,r5,r6,lr};mov r4,r2;mov r5,r0;${enter}
    ldrh r0,[r4,#4];cmp r0,#0;bne given;
    ${records('free', film)}ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};beq free;
    ${folderOf('r2')}cmp r0,#100;blo new;movw r1,#999;cmp r0,r1;bhi new;
    ldr r1,[r5,#8];${ram('r1', 'new')}ldr r1,[r1,#8];${ram('r1', 'new')}ldr r1,[r1,#0x10];${ram('r1', 'new')}
    sub r6,r0,#100;ldr r1,[r1,r6,lsl #2];cmp r1,#0;beq new;
    strh r0,[r4,#4];${code(2)}b native;
    new:ldr r0,[r5,#8];bl #${GR3X_NEXT_FOLDER};${next('r0')}movs r6,r0;beq nonext;strh r6,[r4,#4];${code(3)}
    ${records('native', film)}
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];bic r0,r0,#${FOLDER_HIGH};mov r1,r6,lsr #8;orr r0,r0,r1,lsl #2;strb r0,[r2,#${GR3X_ROLL_FLAGS}];
    ldrb r0,[r3,#${GR3X_ROLL_FLAGS}];bic r0,r0,#${FOLDER_HIGH};orr r0,r0,r1,lsl #2;strb r0,[r3,#${GR3X_ROLL_FLAGS}];
    strb r6,[r2,#${GR3X_ROLL_FOLDER}];strb r6,[r3,#${GR3X_ROLL_FOLDER}];b native;
    free:ldr r2,[r5,#8];${ram('r2', 'native')}ldr r2,[r2,#8];${ram('r2', 'native')}ldrh r2,[r2,#0x2a];add r2,r2,#100;mov r3,#1;
    loop:movw r6,#${lo(STORED)};movt r6,#${hi(STORED)};ldr r6,[r6,r3,lsl #2];${ram('r6', 'next')}
    ldrb r0,[r6,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};beq next;${folderOf('r6')}cmp r0,r2;beq fresh;
    next:add r3,r3,#1;cmp r3,#6;bls loop;${code(1)}b native;
    fresh:ldr r0,[r5,#8];bl #${GR3X_NEXT_FOLDER};${next('r0')}cmp r0,#0;strhne r0,[r4,#4];${code(6)}b native;
    given:${code(5)}b native;
    nonext:${code(4)}
    native:pop {r0,r1,r2,r3,r4,r5,r6,lr};${exit}`);
  p.patch(GR3X_SET_FILE_PATH, 0xe1a0c00d, branchWord(GR3X_SET_FILE_PATH, entries.filmRollFolder), 'film roll: the roll\'s folder at SetFilePath');
  if (diag) entries.filmProbeTime = p.code(`movw r3,#${lo(POINTER)};movt r3,#${hi(POINTER)};ldr r3,[r3];cmp r3,#0;beq clock;
    push {r4,lr};movw r4,#${lo(D)};movt r4,#${hi(D)};
    ldrh r0,[r4];${mod('r0', 100, 'year')}add r0,r0,#2000;strb r0,[r1];mov r0,r0,lsr #8;strb r0,[r1,#1];
    ldrb r0,[r4,#2];ldrb r2,[r4,#3];cmp r2,#0;addne r0,r0,#6;cmp r0,#0;moveq r0,#1;cmp r0,#12;movhi r0,#12;strb r0,[r1,#2];
    ldrb r0,[r4,#4];${mod('r0', 28, 'day')}add r0,r0,#1;strb r0,[r1,#3];
    ldrb r2,[r3,#${GR3X_ROLL_FLAGS}];mov r2,r2,lsr #2;and r2,r2,#3;ldrb r0,[r3,#${GR3X_ROLL_FOLDER}];orr r0,r0,r2,lsl #8;${mod('r0', 24, 'hour')}strb r0,[r1,#4];
    ldrh r0,[r4,#6];${mod('r0', 60, 'minute')}strb r0,[r1,#5];
    pop {r4,pc};
    clock:b #${GR3X_GET_TIME};`);
  free(GR3X_FOLDER_MARK);
  p.patch(GR3X_FOLDER_MARK, 0xe1a02007, 0xe1d621b0, 'film roll: the folder mark goes to the written folder');
}

/** UserDataModel (0x5320b31c(0x5320ad88())), Save Interim Images' and the drive mode's setters. */
const APP = 0x5320ad88, USER_DATA = 0x5320b31c, INTERIM_SET = 0x53262990, DRIVE_SET = 0x5327b744;

/**
 * Form 'menu' (phase 4): the Film Roll Mode list's handlers (datestamp.ts adds the line under Save
 * Settings in Customize Settings, the list record, controller and key map):
 *  - visible(this): 1 in a U mode (mode byte 1..6), else 0: the line is hidden in P, Av, Tv, M (the
 *    menu controller is built each time the menu opens, its builder asks each line's visibility);
 *  - set(this, value): in a U mode only, value 1 sets bit 0 of 0x9b1 in the record in use and sets
 *    Save Interim Images to Off and the drive mode to multi-exposure through the camera's setters
 *    (which apply them); value 0 clears it in the record in use only: film mode is suspended in
 *    this U mode, the roll is kept (decision of 2026-10-28) and goes on when the BOX is recalled
 *    again (the BOX keeps its own Film Roll Mode until Save Settings, which rewinds);
 *  - isCurrent(this, value): bit 0 == value (0 outside a U mode).
 */
function installMenu(p: Gr3xRollProgram, entries: Record<string, number>) {
  const mode = (label: string) => `movw r3,#${lo(MODEL)};movt r3,#${hi(MODEL)};ldr r2,[r3];${ram('r2', label)}ldrb r2,[r2];sub r2,r2,#1;cmp r2,#5;bhi ${label};`;
  entries.filmMenuVisible = p.code(`${mode('hidden')}mov r0,#1;bx lr;hidden:mov r0,#0;bx lr;`);
  entries.filmMenuIsCurrent = p.code(`${mode('none')}ldr r2,[r3,#4];${ram('r2', 'none')}ldrb r2,[r2,#${GR3X_ROLL_FLAGS}];and r2,r2,#${GR3X_FILM_ON};
    cmp r2,r1;moveq r0,#1;movne r0,#0;bx lr;none:mov r0,#0;bx lr;`);
  entries.filmMenuSet = p.code(`cmp r1,#1;bxhi lr;push {r4,r5,r6,lr};mov r4,r1;${records('done')}
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];cmp r4,#0;beq off;
    orr r0,r0,#${GR3X_FILM_ON};strb r0,[r2,#${GR3X_ROLL_FLAGS}];
    bl #${APP};bl #${USER_DATA};mov r5,r0;mov r1,#0;bl #${INTERIM_SET};mov r0,r5;mov r1,#${GR3X_DRIVE_MULTI};bl #${DRIVE_SET};b done;
    off:bic r0,r0,#${GR3X_FILM_ON};strb r0,[r2,#${GR3X_ROLL_FLAGS}];
    done:pop {r4,r5,r6,pc};`);
}

/** ActionModel::OnEvent (key code in r1, 1..0x40, translated for the current controller) and the
 * UI event poster 0x532288b0(model, event, ...). */
export const GR3X_KEY_EVENT = 0x53221a1c, GR3X_POST_EVENT = 0x532288b0;
/** Key probe words (T12-KEYS): round 10's zero-filled sbrk area (the folders' diagnostic words). */
const KEY_LAST = GR3X_ROLL_DIAG;

/**
 * Form 'keys' (T12-KEYS2, test builds only): which key and UI event the ADJ lever gives. A table of
 * four { key, count, event (halfword) } at 0x55804390 counts the keys seen at ActionModel::OnEvent's
 * entry (any key; a fifth different key is not counted) and keeps the first UI event posted after
 * each (pending entry + 1 in the byte at + 16, 0 none). The shooting model's end (Complete, MENU...)
 * clears it (before the final picture is encoded: read the date on the Next / Retake / Complete
 * screen, where its button hides the hour). The date imprint shows the most pressed key:
 * 20YY.MM.DD HH:mm, YY its key % 100, MM 1 + its count (at most 12), DD 1 + event / 60, HH the keys
 * in the table, mm event % 60 (zeros with an empty table). The gesture under test is repeated (5
 * times) so it outnumbers the keys around it.
 */
function installKeys(p: Gr3xRollProgram, free: (at: number) => void, entries: Record<string, number>, top2 = false, quiet = false) {
  const T = KEY_LAST, at = `movw ip,#${lo(T)};movt ip,#${hi(T)};`;
  free(GR3X_KEY_EVENT);
  // r1 = key: its entry (or the first empty one), count + 1 (at most 255), pending = entry + 1.
  // quiet (T13-FN3): keys 6 and 57, sent without a gesture, are not counted.
  entries.filmKeyEvent = p.code(`push {r0,r2,r3};${at}mov r2,#0;${quiet ? 'cmp r1,#6;beq skip;cmp r1,#57;beq skip;' : ''}
    find:ldrb r0,[ip,r2,lsl #2];cmp r0,r1;beq hit;cmp r0,#0;beq hit;add r2,r2,#1;cmp r2,#4;blo find;b skip;
    hit:add r3,ip,r2,lsl #2;strb r1,[r3];ldrb r0,[r3,#1];cmp r0,#255;addlo r0,r0,#1;strb r0,[r3,#1];add r2,r2,#1;strb r2,[ip,#16];
    skip:pop {r0,r2,r3};mov ip,sp;b #${GR3X_KEY_EVENT + 4};`);
  p.patch(GR3X_KEY_EVENT, 0xe1a0c00d, branchWord(GR3X_KEY_EVENT, entries.filmKeyEvent), 'film roll key probe: the key');
  free(GR3X_POST_EVENT);
  entries.filmPostEvent = p.code(`push {r0,r2};${at}ldrb r0,[ip,#16];cmp r0,#0;beq none;sub r0,r0,#1;add r2,ip,r0,lsl #2;strh r1,[r2,#2];
    mov r0,#0;strb r0,[ip,#16];none:pop {r0,r2};mov ip,sp;b #${GR3X_POST_EVENT + 4};`);
  p.patch(GR3X_POST_EVENT, 0xe1a0c00d, branchWord(GR3X_POST_EVENT, entries.filmPostEvent), 'film roll key probe: the event after it');
  // The clock: the most pressed key (the first of equals).
  if (!top2) entries.filmProbeTime = p.code(`movw r3,#${lo(POINTER)};movt r3,#${hi(POINTER)};ldr r3,[r3];cmp r3,#0;beq clock;
    push {r4,r5,r6,lr};movw r4,#${lo(T)};movt r4,#${hi(T)};mov r5,#0;mov r6,#0;mov r2,#0;
    scan:add r3,r4,r2,lsl #2;ldrb r0,[r3];cmp r0,#0;beq next;add r6,r6,#1;ldrb r0,[r3,#1];cmp r5,#0;beq take;ldrb ip,[r5,#1];cmp r0,ip;bls next;
    take:mov r5,r3;next:add r2,r2,#1;cmp r2,#4;blo scan;
    mov r0,#0;mov r2,#0;mov r3,#0;cmp r5,#0;ldrbne r0,[r5];ldrbne r2,[r5,#1];ldrhne r3,[r5,#2];
    ${mod('r0', 100, 'year')}add r0,r0,#2000;strb r0,[r1];mov r0,r0,lsr #8;strb r0,[r1,#1];
    cmp r2,#11;movhi r2,#11;add r2,r2,#1;strb r2,[r1,#2];strb r6,[r1,#4];
    mov r2,#1;day:cmp r3,#60;subhs r3,r3,#60;addhs r2,r2,#1;bhs day;strb r2,[r1,#3];strb r3,[r1,#5];
    pop {r4,r5,r6,pc};
    clock:b #${GR3X_GET_TIME};`);
  // T13-FN2 ('boot': the table is cleared only at start-up): the two most pressed keys,
  // 20YY.MM.DD HH:mm with YY the first's key % 100, MM 1 + its count (at most 12), DD 1 + the
  // second's count (at most 31), HH:mm the second's key as minutes (HH * 60 + mm).
  if (top2) entries.filmProbeTime = p.code(`movw r3,#${lo(POINTER)};movt r3,#${hi(POINTER)};ldr r3,[r3];cmp r3,#0;beq clock;
    push {r4,r5,r6,r7,lr};movw r4,#${lo(T)};movt r4,#${hi(T)};mov r5,#0;mov r6,#0;mov r2,#0;
    scan:add r3,r4,r2,lsl #2;ldrb r0,[r3];cmp r0,#0;beq next;ldrb r0,[r3,#1];
    cmp r5,#0;beq first;ldrb ip,[r5,#1];cmp r0,ip;bls second;
    first:mov r6,r5;mov r5,r3;b next;
    second:cmp r6,#0;beq take2;ldrb ip,[r6,#1];cmp r0,ip;bls next;take2:mov r6,r3;
    next:add r2,r2,#1;cmp r2,#4;blo scan;
    mov r0,#0;mov r2,#0;cmp r5,#0;ldrbne r0,[r5];ldrbne r2,[r5,#1];
    ${mod('r0', 100, 'year')}add r0,r0,#2000;strb r0,[r1];mov r0,r0,lsr #8;strb r0,[r1,#1];
    cmp r2,#11;movhi r2,#11;add r2,r2,#1;strb r2,[r1,#2];
    mov r0,#0;mov r2,#0;cmp r6,#0;ldrbne r0,[r6];ldrbne r2,[r6,#1];cmp r2,#30;movhi r2,#30;add r2,r2,#1;strb r2,[r1,#3];
    mov r2,#0;hour:cmp r0,#60;subhs r0,r0,#60;addhs r2,r2,#1;bhs hour;strb r2,[r1,#4];strb r0,[r1,#5];
    pop {r4,r5,r6,r7,pc};
    clock:b #${GR3X_GET_TIME};`);
}
/** The key table cleared (model's end, form 'keys'): every register kept but ip. */
const keyClear = `push {r0};movw ip,#${lo(KEY_LAST)};movt ip,#${hi(KEY_LAST)};mov r0,#0;str r0,[ip];str r0,[ip,#4];str r0,[ip,#8];str r0,[ip,#12];strb r0,[ip,#16];pop {r0};`;

/** Phase 6 (docs/film-mode-notes.md, Fn Button Settings): the custom functions' table (36 ids, read by
 * the button lists' constructor 0x531be67c), its text and icon (0x53292ed0 / 0x53293e6c(model, f)),
 * the button functions run by GetEventCustomize (Fn, ISO, Drive: 0x5329bcc8(this, out, f, ...)) and
 * GetEventSwitchWlan (Movie/Wireless, Hold: function in r6 at 0x5329a0a0, `cmp r6,#0x29`). */
export const GR3X_FN_TABLE = 0x53b4eb7c, GR3X_FN_COUNT = 36, GR3X_FN_LOOP_LOW = 0x531be684, GR3X_FN_LOOP_END = 0x531be698;
export const GR3X_FN_TEXT = 0x53292ed0, GR3X_FN_ICON = 0x53293e6c, GR3X_FN_CUSTOM = 0x5329bcc8, GR3X_FN_WLAN = 0x5329a0a0;
/** Film Advance's function number (the camera's are 0..41; 0 is Off). */
export const GR3X_FILM_ADVANCE = 42;
/** Function 43 (T13-FN4): Retake, with the camera's own text « Retake shot » (0x2b5, 21 languages). */
export const GR3X_FILM_RETAKE = 43, GR3X_RETAKE_TEXT = 0x2b5;
/** The UI action of event 0xb7 (Retake): the shooting model (0x5320b19c) then its Retake 0x5323a1a4. */
export const GR3X_RETAKE_ACTION = 0x532270d4;
/** For now Film Advance shows Drive Mode's icon (function 23's, 0x121). */
export const GR3X_FILM_ADVANCE_ICON = 0x121;
const END_POSTER = 0x531a4d80;

/** Film Advance's name, in `LANGS` order; every character is in the camera's texts of that language
 * (ja: フィルム送り, 巻 and げ are in no text of the firmware). */
export const GR3X_FILM_ADVANCE_NAMES: readonly string[] = [
  'Posun filmu', 'Filmfremføring', 'Film Advance', 'Filmin siirto', 'Avance du film', 'Filmtransport', 'Προώθηση φιλμ',
  'Filmtovábbítás', 'Avanzamento pellicola', 'フィルム送り', '필름 감기', 'Film doorspoelen', 'Przewijanie filmu', 'Avançar filme',
  'Перемотка плёнки', '过片', 'Avance de película', 'Filmframmatning', 'เลื่อนฟิล์ม', '過片', 'Film ilerletme',
];

export interface Gr3xFnProgram extends Gr3xRollProgram {
  append(bytes: Uint8Array): number;
  read(address: number, length: number): Uint8Array;
  u32(address: number): number;
}

/**
 * Form 'fn' (phase 6, T13-FN1): Film Advance, a function of Fn Button Settings (Fn, ISO, Drive,
 * Movie/Wireless, Hold Movie/Wireless; the list is the same for the five, filtered only for ND / HDF):
 *  - the table of 36 functions is copied with Film Advance (42) at the end, and the lists'
 *    constructor reads 37 (its table address and `add r6,r4,#0x24`);
 *  - its text (`text`, 21 languages) and icon through the text and icon functions;
 *  - pressed: at GetEventCustomize's entry (r2) and at GetEventSwitchWlan's switch (r6), function 42
 *    advances the film when a U mode with Film Roll Mode on has a frame exposed (the end poster
 *    0x531a4d80, as Complete), then the camera goes on as for Off (function 0): nothing else happens.
 */
export function installGr3xFilmAdvanceFn(p: Gr3xFnProgram, text: number, retake: false | 'event' | 'action' | 'probe' | 'cancel' = false, clamp = false) {
  // clamp (T13-FN7): a function above the last one (43 saved by an earlier build) reads as Off.
  const high = (r: string) => clamp ? `cmp ${r},#${GR3X_FILM_ADVANCE + 1};movhs ${r},#0;` : '';
  const fail = (what: string) => { throw new FirmwareError('unexpected-layout', `IIIx film advance: ${what}`); };
  const free = (at: number) => { if (p.sites.some(s => s.address === at)) throw new FirmwareError('unexpected-instruction', `IIIx film advance: ${at.toString(16)} already patched`); };
  const official = p.read(GR3X_FN_TABLE, GR3X_FN_COUNT);
  if ([...official].includes(GR3X_FILM_ADVANCE) || Math.max(...official) > 41 || official[0] !== 0) fail('functions table');
  if (p.u32(GR3X_FN_LOOP_LOW) !== movWord(4, lo(GR3X_FN_TABLE)) || p.u32(GR3X_FN_LOOP_LOW + 4) !== movWord(4, hi(GR3X_FN_TABLE), true) ||
    p.u32(GR3X_FN_LOOP_END) !== 0xe2846024) fail('lists constructor');
  for (const [at, w] of [[GR3X_FN_TEXT, 0xe3510000], [GR3X_FN_ICON, 0xe3510000], [GR3X_FN_CUSTOM, 0xe1a0c00d], [GR3X_FN_WLAN, 0xe3560029]] as const) {
    free(at); if (p.u32(at) !== w) fail(`instruction at ${at.toString(16)}`);
  }
  const entries: Record<string, number> = {};
  const added = retake ? [GR3X_FILM_ADVANCE, GR3X_FILM_RETAKE] : [GR3X_FILM_ADVANCE];
  const table = p.append(Uint8Array.from([...official, ...added]));
  entries.filmFnTable = table;
  for (const at of [GR3X_FN_LOOP_LOW, GR3X_FN_LOOP_LOW + 4, GR3X_FN_LOOP_END]) free(at);
  p.patch(GR3X_FN_LOOP_LOW, movWord(4, lo(GR3X_FN_TABLE)), movWord(4, lo(table)), 'film advance: the functions table with Film Advance, low half');
  p.patch(GR3X_FN_LOOP_LOW + 4, movWord(4, hi(GR3X_FN_TABLE), true), movWord(4, hi(table), true), 'film advance: the functions table with Film Advance, high half');
  p.patch(GR3X_FN_LOOP_END, 0xe2846024, 0xe2846024 + added.length, `film advance: the functions table has ${GR3X_FN_COUNT + added.length} entries`);
  const retakeText = retake ? `cmp r1,#${GR3X_FILM_RETAKE};movweq r0,#${GR3X_RETAKE_TEXT};bxeq lr;` : '';
  entries.filmFnText = p.code(`${high('r1')}cmp r1,#${GR3X_FILM_ADVANCE};movweq r0,#${text};bxeq lr;${retakeText}cmp r1,#0;b #${GR3X_FN_TEXT + 4};`);
  p.patch(GR3X_FN_TEXT, 0xe3510000, branchWord(GR3X_FN_TEXT, entries.filmFnText), 'film advance: its text');
  const retakeIcon = retake ? `cmp r1,#${GR3X_FILM_RETAKE};movweq r0,#${GR3X_FILM_ADVANCE_ICON};bxeq lr;` : '';
  entries.filmFnIcon = p.code(`${high('r1')}cmp r1,#${GR3X_FILM_ADVANCE};movweq r0,#${GR3X_FILM_ADVANCE_ICON};bxeq lr;${retakeIcon}cmp r1,#0;b #${GR3X_FN_ICON + 4};`);
  p.patch(GR3X_FN_ICON, 0xe3510000, branchWord(GR3X_FN_ICON, entries.filmFnIcon), 'film advance: its icon');
  // The advance (every register kept but the function's, which becomes Off).
  const advance = (label: string) => `push {r0,r1,r2,r3,ip,lr};${records(label, true)}bl #${END_POSTER};${label}:pop {r0,r1,r2,r3,ip,lr};`;
  // The retake (43), when a frame is exposed (state 2): 'event' (T13-FN4) posts UI event 0xb7, as the
  // screen's Retake shot (ignored in the live view on the camera); 'action' (T13-FN5) calls that
  // event's action 0x532270d4 (the shooting model's Retake 0x5323a1a4, which checks the state too).
  // 'probe' (T13-RT1): 'action', counting the presses (+ 5) and the calls (+ 6) in the Retake probe.
  const tally = (n: number) => retake === 'probe' ? retakeTally(n, 'r0') : '';
  const retakeCode = (label: string) => `push {r0,r1,r2,r3,ip,lr};${tally(5)}${records(label, true)}
    movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', label)}
    ldr r0,[r0,#0x518];${ram('r0', label)}ldr r0,[r0];${ram('r0', label)}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne ${label};
    ${retake === 'cancel' ? `movw ip,#${lo(CANCEL_FLAG)};movt ip,#${hi(CANCEL_FLAG)};ldrb r0,[ip];cmp r0,#0;bne ${label};mov r0,#1;strb r0,[ip];bl #${GR3X_RETAKE_ACTION};` : retake === 'action' || retake === 'probe' ? `${tally(6)}bl #${GR3X_RETAKE_ACTION};` : `bl #${UI_TASK};bl #${UI_QUEUE};mov r1,#0xb7;mov r2,#0;mov r3,#0;bl #${GR3X_POST_EVENT};`}${label}:pop {r0,r1,r2,r3,ip,lr};`;
  const retakeCustom = retake ? `cmp r2,#${GR3X_FILM_RETAKE};bne native;${retakeCode('rkept')}mov r2,#0;b native;` : '';
  const retakeWlan = retake ? `cmp r6,#${GR3X_FILM_RETAKE};bne go;${retakeCode('rkept')}mov r6,#0;b go;` : '';
  entries.filmFnCustom = p.code(`${high('r2')}cmp r2,#${GR3X_FILM_ADVANCE};bne ${retake ? 'other' : 'native'};${advance('kept')}mov r2,#0;${retake ? `b native;other:${retakeCustom}` : ''}native:mov ip,sp;b #${GR3X_FN_CUSTOM + 4};`);
  p.patch(GR3X_FN_CUSTOM, 0xe1a0c00d, branchWord(GR3X_FN_CUSTOM, entries.filmFnCustom), 'film advance: Fn, ISO and Drive buttons');
  // 'cancel' (T13-FN6): the capture machine's Retake, when the flag is up, takes the sequence for its
  // first frame (+ 4 = 1), so it ends empty (state 0) as when the first frame is retaken; the flag
  // falls there, or at the next exposure (GR3X_CANCEL_CLEAR).
  if (retake === 'cancel') {
    free(GR3X_MACHINE_RETAKE);
    entries.filmCancelMachine = p.code(`push {r1};movw ip,#${lo(CANCEL_FLAG)};movt ip,#${hi(CANCEL_FLAG)};ldrb r1,[ip];cmp r1,#0;beq go;
      mov r1,#0;strb r1,[ip];mov r1,#1;str r1,[r0,#4];go:pop {r1};mov ip,sp;b #${GR3X_MACHINE_RETAKE + 4};`);
    p.patch(GR3X_MACHINE_RETAKE, 0xe1a0c00d, branchWord(GR3X_MACHINE_RETAKE, entries.filmCancelMachine), 'film retake: the whole frame is cancelled');
  }
  entries.filmFnWlan = p.code(`${high('r6')}cmp r6,#${GR3X_FILM_ADVANCE};bne ${retake ? 'other' : 'go'};${advance('kept')}mov r6,#0;${retake ? `b go;other:${retakeWlan}` : ''}go:cmp r6,#0x29;b #${GR3X_FN_WLAN + 4};`);
  p.patch(GR3X_FN_WLAN, 0xe3560029, branchWord(GR3X_FN_WLAN, entries.filmFnWlan), 'film advance: Movie/Wireless buttons');
  return entries;
}

/** The UI action that opens the Next / Retake / Complete screen (UI event 0x90 from CaptureReadyModel;
 * QuickViewController, controller id 0x0800000c, from the current id). */
export const GR3X_OPEN_REVIEW = 0x53226738;

/**
 * Form 'fn2' (T13-FN2): no Next / Retake / Complete screen in film mode. At the opening action's
 * entry, in a U mode with Film Roll Mode on and the multi-exposure state 2 (a frame exposed), the
 * action returns without switching to the screen: the live view stays, as after Next shot (which only
 * sets the screen's flag + 0x180 and switches back to 0x08000000), returning 1 like Next shot.
 * Elsewhere the screen opens.
 */
function installNoReview(p: Gr3xRollProgram, free: (at: number) => void, entries: Record<string, number>) {
  free(GR3X_OPEN_REVIEW);
  entries.filmNoReview = p.code(`push {r0,r1,r2,r3,r4,lr};${records('open', true)}
    movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', 'open')}
    ldr r0,[r0,#0x518];${ram('r0', 'open')}ldr r0,[r0];${ram('r0', 'open')}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne open;
    pop {r0,r1,r2,r3,r4,lr};mov r0,#1;bx lr;
    open:pop {r0,r1,r2,r3,r4,lr};mov ip,sp;b #${GR3X_OPEN_REVIEW + 4};`);
  p.patch(GR3X_OPEN_REVIEW, 0xe1a0c00d, branchWord(GR3X_OPEN_REVIEW, entries.filmNoReview), 'film roll: no Next / Retake / Complete screen in film mode');
}

/** In the opening action: `mov r1,#0xc` then `movt r1,#0x800` give QuickViewController's id. */
export const GR3X_REVIEW_ID = 0x53226760;

/**
 * Form 'fn3' (T13-FN3): in film mode the opening action asks for the live view (0x08000000, as Next
 * shot does) instead of the Next / Retake / Complete screen (0x0800000c): r1's low half 0 instead of
 * 0xc where the action sets it, under the same conditions as 'fn2' (U mode, Film Roll Mode, state 2).
 * Every other register kept.
 */
function installReviewToLive(p: Gr3xRollProgram, free: (at: number) => void, entries: Record<string, number>) {
  free(GR3X_REVIEW_ID);
  entries.filmReviewToLive = p.code(`push {r0,r1,r2,r3,r4,lr};${records('screen', true)}
    movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', 'screen')}
    ldr r0,[r0,#0x518];${ram('r0', 'screen')}ldr r0,[r0];${ram('r0', 'screen')}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne screen;
    pop {r0,r1,r2,r3,r4,lr};mov r1,#0;b #${GR3X_REVIEW_ID + 4};
    screen:pop {r0,r1,r2,r3,r4,lr};mov r1,#0xc;b #${GR3X_REVIEW_ID + 4};`);
  p.patch(GR3X_REVIEW_ID, 0xe3a0100c, branchWord(GR3X_REVIEW_ID, entries.filmReviewToLive), 'film roll: the live view instead of Next / Retake / Complete in film mode');
}

/** QuickViewController (the Next / Retake / Complete screen): its start (table entry 7) and Next shot. */
export const GR3X_REVIEW_START = 0x531cbde4, GR3X_NEXT_SHOT = 0x531ca804;
/** The UI task and its queue: 0x532288b0(0x5320aefc(0x5320ad88()), event, 0, 0) posts a UI event. */
const UI_TASK = 0x5320ad88, UI_QUEUE = 0x5320aefc;

/**
 * Form 'fn4' (T13-FN4): the screen opens, then closes by itself in film mode. At its start's entry,
 * in a U mode with Film Roll Mode on and the multi-exposure state 2, the native start runs (called,
 * entry stack, ip = sp), then Next shot on the screen (r0 = this): the live view again, with the
 * frame shown over it, as when Next shot is chosen. Elsewhere the start runs alone.
 */
function installReviewNext(p: Gr3xRollProgram, free: (at: number) => void, entries: Record<string, number>, armed = false) {
  free(GR3X_REVIEW_START);
  // 'armed' (T13-FN7): only a start that follows the opening action (UI event 0x90, after a shot);
  // the flag is raised there and falls at the start (and at each exposure, GR3X_REVIEW_ARM_CLEAR).
  if (armed) {
    free(GR3X_OPEN_REVIEW);
    entries.filmReviewArm = p.code(`push {r0};movw ip,#${lo(REVIEW_ARM)};movt ip,#${hi(REVIEW_ARM)};mov r0,#1;strb r0,[ip];pop {r0};mov ip,sp;b #${GR3X_OPEN_REVIEW + 4};`);
    p.patch(GR3X_OPEN_REVIEW, 0xe1a0c00d, branchWord(GR3X_OPEN_REVIEW, entries.filmReviewArm), 'film roll: the Next / Retake / Complete screen opened after a shot');
  }
  const arm = armed ? `movw ip,#${lo(REVIEW_ARM)};movt ip,#${hi(REVIEW_ARM)};ldrb r0,[ip];mov r1,#0;strb r1,[ip];cmp r0,#0;beq alone;` : '';
  entries.filmReviewNext = p.code(`push {r0,r1,r2,r3,r4,lr};${arm}${records('alone', true)}
    movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', 'alone')}
    ldr r0,[r0,#0x518];${ram('r0', 'alone')}ldr r0,[r0];${ram('r0', 'alone')}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne alone;
    pop {r0,r1,r2,r3,r4,lr};push {r0,lr};mov ip,sp;bl #${GR3X_REVIEW_START + 4};pop {r0,lr};b #${GR3X_NEXT_SHOT};
    alone:pop {r0,r1,r2,r3,r4,lr};mov ip,sp;b #${GR3X_REVIEW_START + 4};`);
  p.patch(GR3X_REVIEW_START, 0xe1a0c00d, branchWord(GR3X_REVIEW_START, entries.filmReviewNext), 'film roll: Next / Retake / Complete closes by itself (Next shot) in film mode');
}

/** The shooting model's Retake (0x5323a1a4) tests the capture state at 0x5323a1d0 (`cmp r0,#2`); the
 * capture state machine's Retake is 0x5346a8d8, its end of a sequence 0x5346a910. */
export const GR3X_MODEL_RETAKE = 0x5323a1a4, GR3X_MODEL_RETAKE_TEST = 0x5323a1d0, GR3X_MACHINE_RETAKE = 0x5346a8d8, GR3X_MACHINE_END = 0x5346a910;
/** Byte n of the Retake probe + 1 (at most 255), with `r` and ip free. */
const retakeTally = (n: number, r: string) => `movw ip,#${lo(KEY_LAST)};movt ip,#${hi(KEY_LAST)};ldrb ${r},[ip,#${n}];cmp ${r},#255;addlo ${r},${r},#1;strb ${r},[ip,#${n}];`;

/**
 * Form 'rt1' (T13-RT1, test builds only): where Retake stops. Bytes at 0x55804390 (zero at start-up):
 * + 0 the model's Retake calls, + 1 its state test's value + 1 (last), + 2 the capture machine's
 * Retake calls, + 3 its phase (+ 4 of its object) + 1 (last), + 4 the machine's ends, + 5 presses of
 * function 43 in film mode... (every press), + 6 its action calls. The date of the pictures:
 * 20YY.MM.DD HH:mm, YY + 0, MM 1 + (+ 1, at most 11), DD 1 + (+ 2, at most 30), HH + 3 (at most 23),
 * mm 10 x (+ 6, at most 5) + (+ 5, at most 9).
 */
export function installGr3xRetakeProbe(p: Gr3xRollProgram) {
  const free = (at: number) => { if (p.sites.some(s => s.address === at)) throw new FirmwareError('unexpected-instruction', `IIIx retake probe: ${at.toString(16)} already patched`); };
  const entries: Record<string, number> = {};
  for (const at of [GR3X_MODEL_RETAKE, GR3X_MODEL_RETAKE_TEST, GR3X_MACHINE_RETAKE, GR3X_MACHINE_END]) free(at);
  entries.filmProbeModelRetake = p.code(`push {r0};${retakeTally(0, 'r0')}pop {r0};mov ip,sp;b #${GR3X_MODEL_RETAKE + 4};`);
  p.patch(GR3X_MODEL_RETAKE, 0xe1a0c00d, branchWord(GR3X_MODEL_RETAKE, entries.filmProbeModelRetake), 'film roll retake probe: the model\'s Retake');
  entries.filmProbeRetakeTest = p.code(`push {r1};movw ip,#${lo(KEY_LAST)};movt ip,#${hi(KEY_LAST)};add r1,r0,#1;strb r1,[ip,#1];pop {r1};cmp r0,#2;b #${GR3X_MODEL_RETAKE_TEST + 4};`);
  p.patch(GR3X_MODEL_RETAKE_TEST, 0xe3500002, branchWord(GR3X_MODEL_RETAKE_TEST, entries.filmProbeRetakeTest), 'film roll retake probe: the model\'s state test');
  entries.filmProbeMachineRetake = p.code(`push {r1};${retakeTally(2, 'r1')}ldr r1,[r0,#4];add r1,r1,#1;strb r1,[ip,#3];pop {r1};mov ip,sp;b #${GR3X_MACHINE_RETAKE + 4};`);
  p.patch(GR3X_MACHINE_RETAKE, 0xe1a0c00d, branchWord(GR3X_MACHINE_RETAKE, entries.filmProbeMachineRetake), 'film roll retake probe: the capture machine\'s Retake');
  entries.filmProbeMachineEnd = p.code(`push {r1};${retakeTally(4, 'r1')}pop {r1};mov ip,sp;b #${GR3X_MACHINE_END + 4};`);
  p.patch(GR3X_MACHINE_END, 0xe1a0c00d, branchWord(GR3X_MACHINE_END, entries.filmProbeMachineEnd), 'film roll retake probe: the capture machine\'s end');
  const cap = (n: number, max: number) => `ldrb r0,[ip,#${n}];cmp r0,#${max};movhi r0,#${max};`;
  entries.filmProbeTime = p.code(`movw r3,#${lo(POINTER)};movt r3,#${hi(POINTER)};ldr r3,[r3];cmp r3,#0;beq clock;
    movw ip,#${lo(KEY_LAST)};movt ip,#${hi(KEY_LAST)};
    ldrb r0,[ip];${mod('r0', 100, 'year')}add r0,r0,#2000;strb r0,[r1];mov r0,r0,lsr #8;strb r0,[r1,#1];
    ${cap(1, 11)}add r0,r0,#1;strb r0,[r1,#2];
    ${cap(2, 30)}add r0,r0,#1;strb r0,[r1,#3];
    ${cap(3, 23)}strb r0,[r1,#4];
    ${cap(6, 5)}add r0,r0,r0,lsl #2;mov r2,r0,lsl #1;${cap(5, 9)}add r0,r0,r2;strb r0,[r1,#5];
    bx lr;
    clock:b #${GR3X_GET_TIME};`);
  return entries;
}

/** T13-FN6: the frame cancel's flag (a byte zero at start-up, the key probe's area, unused there). */
const CANCEL_FLAG = KEY_LAST + 8;
/** The flag cleared at each exposure (every register kept but ip). */
export const GR3X_CANCEL_CLEAR = `push {r0};movw ip,#${lo(CANCEL_FLAG)};movt ip,#${hi(CANCEL_FLAG)};mov r0,#0;strb r0,[ip];pop {r0};`;

/** T13-FN7: the flag of a screen opened after a shot (a byte zero at start-up, the key probe's area). */
const REVIEW_ARM = KEY_LAST + 9;
/** That flag cleared at each exposure (every register kept but ip). */
export const GR3X_REVIEW_ARM_CLEAR = `push {r0};movw ip,#${lo(REVIEW_ARM)};movt ip,#${hi(REVIEW_ARM)};mov r0,#0;strb r0,[ip];pop {r0};`;
