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
const bl = (at: number, target: number) => (0xeb000000 | (((target - (at + 8)) >> 2) & 0xffffff)) >>> 0;
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
/** T22-NAME2: the free modes' folder (a halfword of every record: padding bytes 0x906 and 0x907, no
 * exact access by the firmware, a word read at + 0x904 by a debug dump, copied at a recall). */
export const GR3X_FREE_FOLDER = 0x906;
/** T19-CARD3: the folder services' singleton (its guard word, then the object: + 0x14 / + 0x18 the two
 * storages' folder services; getter 0x535bb010). */
export const GR3X_STORAGES_GUARD = 0x55357678;
/** T19-CARD2: the folder log (3 bytes; the area's last free bytes, + 0x28 .. + 0x2f; zero at start-up). */
const FOLDER_LOG = GR3X_ROLL_DIAG + 0x28;
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

export function installGr3xFilmRoll(p: Gr3xRollProgram, menu: readonly Gr3xMenuRatio[], folders = false, diag = false, filmMenu = false, keys: false | 'sequence' | 'boot' | 'shot' = false, noReview: false | 'skip' | 'live' | 'next' | 'armed' | 'deferred' | 'logged' | 'posted' | 'closed' | 'timed' | 'timedNext' | 'plain' | 'noButtons' | 'plainId' | 'plainReview' | 'plainOff' | 'plainOff25' | 'plainOff10' | 'plainOff1' = false, folderName = false, late = false, rollEnd = false, closure: boolean | 'recall' = false, fromZero = false, rewind = false, lost: boolean | 'probe' | 'early' = false, pFolder = false, filmCodes: Readonly<Record<number, string>> = {}) {
  const rec = (label: string) => records(label, filmMenu);
  const free = (at: number) => { if (p.sites.some(s => s.address === at)) throw new FirmwareError('unexpected-instruction', `IIIx film roll: ${at.toString(16)} already patched`); };
  const entries: Record<string, number> = {};
  // The roll's length from the ratio identity in r0 (r0 = length).
  const lengths = menu.filter(r => (GR3X_ROLL_LENGTHS[r.ratio] ?? 36) !== 36).map(r => `cmp r0,#${r.id};moveq r0,#${GR3X_ROLL_LENGTHS[r.ratio]};beq len;`).join('');
  const length = `${lengths}mov r0,#36;len:`;

  // The first exposure: every register kept (the flags are free at a function's entry).
  // ('shot', T13-FN3: the key probe's table cleared at each exposure first.)
  // late (T14-DIR14): the U mode of the frame being exposed (0 elsewhere), for a frame ended after
  // another mode was recalled (the mode dial): its BOX's roll advances and keeps the picture.
  const pendingAt = `movw ip,#${lo(PENDING_FRAME)};movt ip,#${hi(PENDING_FRAME)};`;
  const exposure = `${keys === 'shot' ? keyClear : ''}push {r0,r1,r2,r3};${late ? `${pendingAt}mov r0,#0;strb r0,[ip];` : ''}${rec('rollkept')}${late ? `${pendingAt}strb r1,[ip];` : ''}
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};${rollEnd ? `beq rollstart;ldrb r0,[r2,#${GR3X_ROLL_FRAME}];cmp r0,#0;bne rollkept;
    rollstart:ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];` : 'bne rollkept;'}
    orr r0,r0,#${GR3X_ROLL_STARTED};bic r0,r0,#${FOLDER_HIGH};strb r0,[r2,#${GR3X_ROLL_FLAGS}];${closure ? `
    ldrb r0,[r2,#${GR3X_LOOK}];strb r0,[r2,#${GR3X_ROLL_LOOK}];strb r0,[r3,#${GR3X_ROLL_LOOK}];ldrb r0,[r2,#${GR3X_RATIO}];strb r0,[r2,#${GR3X_ROLL_RATIO}];strb r0,[r3,#${GR3X_ROLL_RATIO}];
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];` : ''}
    ldrb r0,[r3,#${GR3X_ROLL_FLAGS}];orr r0,r0,#${GR3X_ROLL_STARTED};bic r0,r0,#${FOLDER_HIGH};strb r0,[r3,#${GR3X_ROLL_FLAGS}];
    mov r0,#1;strb r0,[r2,#${GR3X_ROLL_FRAME}];strb r0,[r3,#${GR3X_ROLL_FRAME}];
    mov r0,#0;strb r0,[r2,#${GR3X_ROLL_FOLDER}];strb r0,[r3,#${GR3X_ROLL_FOLDER}];
    rollkept:pop {r0,r1,r2,r3};`;

  // T14-DIR1 (folderName): the roll's folder name, NNN + film code + length (112NEG36), given to the
  // live shooting values only (the saved Folder Name is never changed): set at each advance (before
  // the frame's picture is saved, so a roll's new folder takes it), and the saved name and type given
  // back when a free mode or a U mode without Film Roll Mode is recalled, or when it is set to Off.
  if (folderName) {
    const folderCodes: Record<string, string> = { ...GR3X_LOOK_CODES, ...Object.fromEntries(Object.entries(filmCodes).map(([l, c]) => [l, c.slice(0, 3)])) };
    const codes = Object.entries(folderCodes).map(([look, code]) =>
      `cmp r0,#${look};movweq r3,#${code.charCodeAt(0) | code.charCodeAt(1) << 8};movteq r3,#${code.charCodeAt(2)};beq code;`).join('');
    const unknown = GR3X_UNKNOWN_LOOK_CODE;
    // r0 = record in use: name buffer filled, then the live name and type (free name).
    entries.filmFolderNameSet = p.code(`push {r0,r1,r2,r3,r4,r5,r6,lr};mov r5,r0;movw r4,#${lo(FOLDER_NAME)};movt r4,#${hi(FOLDER_NAME)};
      ldrb r0,[r5,#${GR3X_LOOK}];${codes}movw r3,#${unknown.charCodeAt(0) | unknown.charCodeAt(1) << 8};movt r3,#${unknown.charCodeAt(2)};
      code:strb r3,[r4];mov r3,r3,lsr #8;strb r3,[r4,#1];mov r3,r3,lsr #8;strb r3,[r4,#2];
      ldrb r0,[r5,#${GR3X_RATIO}];${length}mov r1,#0;tens:cmp r0,#10;subhs r0,r0,#10;addhs r1,r1,#1;bhs tens;
      add r1,r1,#48;strb r1,[r4,#3];add r0,r0,#48;strb r0,[r4,#4];mov r0,#0;strb r0,[r4,#5];
      bl #${GR3X_LIVE_VALUES};ldr r0,[r0];mov r1,r4;bl #${GR3X_LIVE_FOLDER_NAME};
      bl #${GR3X_LIVE_VALUES};ldr r0,[r0];mov r1,#1;bl #${GR3X_LIVE_FOLDER_TYPE};
      pop {r0,r1,r2,r3,r4,r5,r6,pc};`);
    // r0 = a record: its saved name (5 characters) and type to the live values.
    entries.filmFolderNameRestore = p.code(`push {r0,r1,r2,r3,r4,r5,r6,lr};mov r5,r0;movw r4,#${lo(FOLDER_NAME)};movt r4,#${hi(FOLDER_NAME)};
      mov r1,#0;copy:add r2,r5,r1;ldrb r0,[r2,#${GR3X_FOLDER_NAME}];strb r0,[r4,r1];add r1,r1,#1;cmp r1,#5;blo copy;mov r0,#0;strb r0,[r4,#5];
      bl #${GR3X_LIVE_VALUES};ldr r0,[r0];mov r1,r4;bl #${GR3X_LIVE_FOLDER_NAME};
      bl #${GR3X_LIVE_VALUES};ldr r0,[r0];ldrb r1,[r5,#${GR3X_FOLDER_TYPE}];bl #${GR3X_LIVE_FOLDER_TYPE};
      pop {r0,r1,r2,r3,r4,r5,r6,pc};`);
  }

  // rollEnd (T15-END1): the last frame's advance keeps the roll's folder and started bit (frame 0 =
  // ended), so its picture still goes to the roll's folder; the next exposure starts a new roll. It
  // asks for the message « New roll loaded. » (NEW_ROLL_MESSAGE) and opens the camera's message
  // screen 0x08000007 (closed by itself after 5 s; its text replaced, installGr3xFilmMessage).
  const openMessage = `bl #${UI_TASK};bl #${UI_QUEUE};mov r5,r0;bl #${GR3X_SCREEN_MANAGER};mov r4,r0;mov r0,r5;bl #${GR3X_SCREEN_CURRENT};
    mov r2,r0;mov r0,r4;mov r1,#${GR3X_MESSAGE_SCREEN & 0xff};movt r1,#${GR3X_MESSAGE_SCREEN >>> 16};bl #${GR3X_SCREEN_SWITCH};`;
  // The model's end: advance, then save both records; every register kept.
  free(GR3X_ROLL_MODEL_END);
  // late: a frame of another U mode (still pending, not handled yet): that BOX's roll advances and is
  // saved (its record only), then nothing else (the mode in use took no frame).
  const lateEnd = late ? `${pendingAt}ldrb r0,[ip];cmp r0,#0;beq usual;tst r0,#0x80;bne usual;
    movw r1,#${lo(MODEL)};movt r1,#${hi(MODEL)};ldr r1,[r1];${ram('r1', 'usual')}ldrb r1,[r1];cmp r1,r0;beq usual;
    movw r6,#${lo(STORED)};movt r6,#${hi(STORED)};ldr r6,[r6,r0,lsl #2];${ram('r6', 'usual')}
    ldrb r2,[r6,#${GR3X_ROLL_FLAGS}];tst r2,#${GR3X_ROLL_STARTED};beq usual;mov r4,r0;
    movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', 'usual')}
    ldr r0,[r0,#0x518];${ram('r0', 'usual')}ldr r0,[r0];${ram('r0', 'usual')}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne usual;
    orr r0,r4,#0x80;strb r0,[ip];
    ldrb r0,[r6,#${GR3X_RATIO}];${length.replace('len:', 'llen:').replace(/beq len;/g, 'beq llen;')}
    ldrb r1,[r6,#${GR3X_ROLL_FRAME}];add r1,r1,#1;cmp r1,r0;movhi r1,#0;
    strb r1,[r6,#${GR3X_ROLL_FRAME}];${rollEnd ? '' : `strbhi r1,[r6,#${GR3X_ROLL_FOLDER}];
    ldrb r2,[r6,#${GR3X_ROLL_FLAGS}];bichi r2,r2,#${GR3X_ROLL_STARTED | FOLDER_HIGH};strb r2,[r6,#${GR3X_ROLL_FLAGS}];`}
    bl #${GR3X_APP_DATA};ldr r0,[r0,#8];add r1,r4,#2;movw r2,#${RECORD};mov r3,r6;bl #${GR3X_APP_DATA_WRITE};
    b out;usual:` : '';
  // lost 'early' (T19-CARD3): at the advance, before the counter is drawn, a going roll whose folder is
  // on none of the two storages (the folder services of the singleton 0x5535767c, + 0x14 and + 0x18,
  // their directory base at + 8, its table at + 0x10) is lost: frame 1 (2 after this advance) and
  // folder 0 (SetFilePath then gives the next new folder). SetFilePath's own check stays (a folder of
  // that number on the other storage).
  // r2 counts the storages whose table could be read: none, no decision.
  const slot = (off: number, label: string) => `ldr r1,[r0,#${off}];${ram('r1', label)}ldr r1,[r1,#8];${ram('r1', label)}ldr r1,[r1,#0x10];${ram('r1', label)}
    add r2,r2,#1;ldr r1,[r1,r3,lsl #2];cmp r1,#0;bne kept;${label}:`;
  const earlyLost = `ldrb r0,[r5,#${GR3X_ROLL_FRAME}];cmp r0,#0;beq kept;
    ldrb r1,[r5,#${GR3X_ROLL_FLAGS}];mov r1,r1,lsr #2;and r1,r1,#3;ldrb r3,[r5,#${GR3X_ROLL_FOLDER}];orr r3,r3,r1,lsl #8;
    sub r3,r3,#100;cmp r3,#900;bhs kept;
    movw r0,#${lo(GR3X_STORAGES_GUARD)};movt r0,#${hi(GR3X_STORAGES_GUARD)};ldr r1,[r0];tst r1,#1;beq kept;add r0,r0,#4;mov r2,#0;
    ${slot(0x14, 's0')}${slot(0x18, 's1')}cmp r2,#0;beq kept;
    mov r0,#1;strb r0,[r5,#${GR3X_ROLL_FRAME}];strb r0,[r6,#${GR3X_ROLL_FRAME}];mov r0,#0;strb r0,[r5,#${GR3X_ROLL_FOLDER}];strb r0,[r6,#${GR3X_ROLL_FOLDER}];
    ldrb r0,[r5,#${GR3X_ROLL_FLAGS}];bic r0,r0,#${FOLDER_HIGH};strb r0,[r5,#${GR3X_ROLL_FLAGS}];ldrb r0,[r6,#${GR3X_ROLL_FLAGS}];bic r0,r0,#${FOLDER_HIGH};strb r0,[r6,#${GR3X_ROLL_FLAGS}];
    kept:`;
  entries.filmRollEnd = p.code(`${keys === 'sequence' ? keyClear : ''}push {r0,r1,r2,r3,r4,r5,r6,lr};${lateEnd}${rec('out')}
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};beq out;
    movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', 'out')}
    ldr r0,[r0,#0x518];${ram('r0', 'out')}ldr r0,[r0];${ram('r0', 'out')}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne out;
    mov r4,r1;mov r5,r2;mov r6,r3;${folderName ? `mov r0,r5;bl #${entries.filmFolderNameSet};` : ''}${lost === 'early' ? earlyLost : ''}
    ldrb r0,[r5,#${GR3X_RATIO}];${length}
    ldrb r1,[r5,#${GR3X_ROLL_FRAME}];add r1,r1,#1;cmp r1,r0;movhi r1,#0;
    strb r1,[r5,#${GR3X_ROLL_FRAME}];strb r1,[r6,#${GR3X_ROLL_FRAME}];${rollEnd ? `movwhi ip,#${lo(NEW_ROLL_MESSAGE)};movthi ip,#${hi(NEW_ROLL_MESSAGE)};movhi r2,#1;strbhi r2,[ip];` : `strbhi r1,[r5,#${GR3X_ROLL_FOLDER}];strbhi r1,[r6,#${GR3X_ROLL_FOLDER}];
    ldrb r2,[r5,#${GR3X_ROLL_FLAGS}];bichi r2,r2,#${GR3X_ROLL_STARTED | FOLDER_HIGH};strb r2,[r5,#${GR3X_ROLL_FLAGS}];
    ldrb r2,[r6,#${GR3X_ROLL_FLAGS}];bichi r2,r2,#${GR3X_ROLL_STARTED | FOLDER_HIGH};strb r2,[r6,#${GR3X_ROLL_FLAGS}];`}
    bl #${GR3X_APP_DATA};ldr r0,[r0,#8];mov r1,#1;movw r2,#${RECORD};mov r3,r5;bl #${GR3X_APP_DATA_WRITE};
    bl #${GR3X_APP_DATA};ldr r0,[r0,#8];add r1,r4,#2;movw r2,#${RECORD};mov r3,r6;bl #${GR3X_APP_DATA_WRITE};
    ${rollEnd ? `movw ip,#${lo(NEW_ROLL_MESSAGE)};movt ip,#${hi(NEW_ROLL_MESSAGE)};ldrb r0,[ip];cmp r0,#0;beq out;${openMessage}` : ''}
    out:pop {r0,r1,r2,r3,r4,r5,r6,lr};mov ip,sp;b #${GR3X_ROLL_MODEL_END + 4};`);
  p.patch(GR3X_ROLL_MODEL_END, 0xe1a0c00d, branchWord(GR3X_ROLL_MODEL_END, entries.filmRollEnd), 'film roll: the frame advances at the model\'s end, settings saved');

  // The screen counter, inside 0x532aa1d4 (r4 the buffer, frame of {r4, r5, fp, ip, lr, pc}): in a
  // U mode "frame/length" written here, then that function's return (its `ldm sp, {r4, r5, fp, sp,
  // pc}` from fp - 0x14, spelled out); else the count (r0) as before.
  free(GR3X_ROLL_COUNTER);
  entries.filmRollCounter = p.code(`push {r0,r1,r3};${rec('count')}
    ldrb r0,[r2,#${GR3X_RATIO}];${length}mov r3,r0;
    ldrb r1,[r2,#${GR3X_ROLL_FLAGS}];tst r1,#${GR3X_ROLL_STARTED};${fromZero ? `moveq r1,#0;ldrbne r1,[r2,#${GR3X_ROLL_FRAME}];cmp r1,#0;subne r1,r1,#1;` : `moveq r1,#1;ldrbne r1,[r2,#${GR3X_ROLL_FRAME}];${rollEnd ? 'cmp r1,#0;moveq r1,#1;' : ''}`}
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

  // closure (T16-CLO1): r0 = 1 when the roll of the U mode in use was going (started, frame not 0) and
  // its film or format (noted at its start, 0x9c2 / 0x9c3) is no longer the record's: the roll ends
  // (frame 0, both records saved; the next exposure starts a new roll). A roll noted before (0x9c2 = 0)
  // takes the record's film and format. Registers r4..r11 kept.
  const checkBody = `ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};beq none;ldrb r0,[r2,#${GR3X_ROLL_FRAME}];cmp r0,#0;beq none;
    ldrb r0,[r2,#${GR3X_ROLL_LOOK}];cmp r0,#0;bne compare;
    ldrb r0,[r2,#${GR3X_LOOK}];strb r0,[r2,#${GR3X_ROLL_LOOK}];strb r0,[r3,#${GR3X_ROLL_LOOK}];ldrb r0,[r2,#${GR3X_RATIO}];strb r0,[r2,#${GR3X_ROLL_RATIO}];strb r0,[r3,#${GR3X_ROLL_RATIO}];b none;
    compare:ldrb r4,[r2,#${GR3X_LOOK}];cmp r0,r4;bne close;ldrb r0,[r2,#${GR3X_ROLL_RATIO}];ldrb r4,[r2,#${GR3X_RATIO}];cmp r0,r4;beq none;
    close:mov r0,#0;strb r0,[r2,#${GR3X_ROLL_FRAME}];strb r0,[r3,#${GR3X_ROLL_FRAME}];mov r4,r1;mov r5,r2;mov r6,r3;
    bl #${GR3X_APP_DATA};ldr r0,[r0,#8];mov r1,#1;movw r2,#${RECORD};mov r3,r5;bl #${GR3X_APP_DATA_WRITE};
    bl #${GR3X_APP_DATA};ldr r0,[r0,#8];add r1,r4,#2;movw r2,#${RECORD};mov r3,r6;bl #${GR3X_APP_DATA_WRITE};
    mov r0,#1;pop {r4,r5,r6,pc};
    none:mov r0,#0;pop {r4,r5,r6,pc};`;
  // fromZero (T16-CLO3): the check on the way back to the live view also needs the record in use to
  // match the BOX's roll (started bit, frame, film noted): during a mode change the active mode can
  // still read U while the record in use is already another mode's (it closed U3's roll on P).
  const synced = fromZero ? `ldrb r0,[r2,#${GR3X_ROLL_FRAME}];ldrb r4,[r3,#${GR3X_ROLL_FRAME}];cmp r0,r4;bne none;
    ldrb r0,[r2,#${GR3X_ROLL_LOOK}];ldrb r4,[r3,#${GR3X_ROLL_LOOK}];cmp r0,r4;bne none;
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];ldrb r4,[r3,#${GR3X_ROLL_FLAGS}];eor r0,r0,r4;tst r0,#${GR3X_ROLL_STARTED};bne none;` : '';
  if (closure) entries.filmRollCheck = p.code(`push {r4,r5,r6,lr};${rec('none')}${synced}${checkBody}`);
  // rewind (T17-RWD1): the Rewind Film line's action. In a U mode with Film Roll Mode on, a going roll
  // (started, frame not 0) ends as at a closure (frame 0, both records saved; the next exposure starts
  // a new roll): r0 = 1, else 0. Its visibility: a U mode with Film Roll Mode on.
  if (rewind) {
    entries.filmRollRewind = p.code(`push {r4,r5,r6,lr};${records('none', true)}
      ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};beq none;ldrb r0,[r2,#${GR3X_ROLL_FRAME}];cmp r0,#0;beq none;
      mov r0,#0;strb r0,[r2,#${GR3X_ROLL_FRAME}];strb r0,[r3,#${GR3X_ROLL_FRAME}];mov r4,r1;mov r5,r2;mov r6,r3;
      bl #${GR3X_APP_DATA};ldr r0,[r0,#8];mov r1,#1;movw r2,#${RECORD};mov r3,r5;bl #${GR3X_APP_DATA_WRITE};
      bl #${GR3X_APP_DATA};ldr r0,[r0,#8];add r1,r4,#2;movw r2,#${RECORD};mov r3,r6;bl #${GR3X_APP_DATA_WRITE};
      mov r0,#1;pop {r4,r5,r6,pc};
      none:mov r0,#0;pop {r4,r5,r6,pc};`);
    entries.filmRewindVisible = p.code(`${records('hidden', true)}mov r0,#1;bx lr;hidden:mov r0,#0;bx lr;`);
  }
  // 'recall' (T16-CLO2): the same check at a U mode's recall (r0 its record in use, r1 the mode), whose
  // way back to the shooting screen is not a switch to the live view: the roll ends there, and the
  // message screen opens at once.
  if (closure === 'recall') entries.filmRollCheckAt = p.code(`push {r4,r5,r6,lr};mov r2,r0;${ram('r2', 'none')}sub r3,r1,#1;cmp r3,#5;bhi none;
    movw r3,#${lo(STORED)};movt r3,#${hi(STORED)};ldr r3,[r3,r1,lsl #2];${ram('r3', 'none')}
    ${filmMenu ? `ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_FILM_ON};beq none;` : ''}${checkBody}`);
  // The mode recall (called by the guard's recall hook): r0 the record in use, r1 the mode recalled.
  entries.filmRollRecall = p.code(`sub r1,r1,#1;cmp r1,#5;bxhi lr;${ram('r0', 'none')}${filmMenu ? `ldrb r1,[r0,#${GR3X_ROLL_FLAGS}];tst r1,#${GR3X_FILM_ON};bxeq lr;` : ''}
    mov r1,#0;strb r1,[r0,#${GR3X_INTERIM}];mov r1,#${GR3X_DRIVE_MULTI};strb r1,[r0,#${GR3X_DRIVE}];none:bx lr;`);
  // folderName: then, outside film mode (a free mode, or a U mode with Film Roll Mode off), the saved
  // folder name and type back in the live values.
  if (folderName) {
    const core = entries.filmRollRecall;
    entries.filmRollRecall = p.code(`push {r4,r5,r6,lr};mov r4,r0;mov r5,r1;bl #${core};${ram('r4', 'done')}
      sub r0,r5,#1;cmp r0,#5;bhi restore;ldrb r0,[r4,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_FILM_ON};bne done;
      restore:mov r0,r4;bl #${entries.filmFolderNameRestore};done:${closure === 'recall' ? `mov r0,r4;mov r1,r5;bl #${entries.filmRollCheckAt};cmp r0,#0;beq fin;
      movw ip,#${lo(NEW_ROLL_MESSAGE)};movt ip,#${hi(NEW_ROLL_MESSAGE)};mov r0,#1;strb r0,[ip];${openMessage}fin:` : ''}pop {r4,r5,r6,pc};`);
  }
  if (folders) installFolders(p, free, entries, diag, filmMenu, late, lost === 'early' ? true : lost, pFolder);
  if (filmMenu) installMenu(p, entries, folderName ? entries.filmFolderNameRestore : 0);
  if (keys) installKeys(p, free, entries, keys === 'boot' || keys === 'shot', keys === 'shot');
  if (noReview === 'skip') installNoReview(p, free, entries);
  if (noReview === 'live') installReviewToLive(p, free, entries);
  if (noReview === 'next' || noReview === 'armed' || noReview === 'deferred' || noReview === 'logged') installReviewNext(p, free, entries, noReview !== 'next', noReview === 'deferred' || noReview === 'logged', noReview === 'logged');
  if (noReview === 'plain') installReviewPlain(p, free, entries);
  if (noReview === 'noButtons') installReviewNoButtons(p, free, entries);
  if (noReview === 'plainId' || noReview === 'plainReview' || noReview === 'plainOff' || noReview === 'plainOff25' || noReview === 'plainOff10' || noReview === 'plainOff1') installReviewPlainId(p, free, entries, noReview === 'plainReview' ? 'offHold' : noReview === 'plainOff' ? 'off' : noReview === 'plainOff25' ? 'off25' : noReview === 'plainOff10' ? 'off10' : noReview === 'plainOff1' ? 'off1' : false, closure === 'recall');
  if (noReview === 'timed' || noReview === 'timedNext') installReviewTimer(p, free, entries, noReview === 'timedNext');
  if (noReview === 'posted' || noReview === 'closed') installReviewHalfPress(p, free, entries, noReview === 'posted' ? GR3X_DELETE_EVENT : GR3X_REVIEW_CLOSE_EVENT);
  return { entries, exposure };
}

/** The roll's folder at SetFilePath's entry (r0 service, r2 path); every register kept. */
function installFolders(p: Gr3xRollProgram, free: (at: number) => void, entries: Record<string, number>, diag: boolean, film: boolean, late = false, lost: boolean | 'probe' = false, pFolder = false) {
  // 'probe' (T19-CARD2): a log of the last call (bytes at FOLDER_LOG: call count, path taken, the roll
  // folder's table entry: 0 none, else its state byte + 0xe plus 1) shown in the picture's date.
  const L = FOLDER_LOG, lat = `movw ip,#${lo(L)};movt ip,#${hi(L)};`;
  const lcode = (n: number) => lost === 'probe' ? `${lat}mov lr,#${n};strb lr,[ip,#1];` : '';
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
  // lost (T19-CARD1): a going roll whose folder is no longer on the card (another card, the folder
  // deleted) is lost: its picture is the first frame of a new roll in a new folder (frame 2: one frame
  // recorded, the frame having advanced at the model's end; a roll that has just ended, frame 0, keeps
  // its 0). The records are saved at the next advance, as the new folder.
  // r0 = the folder of the record or copy in r0 (0x9b3 | (0x9b1 bits 2..3) << 8); r1 used.
  // late (T14-DIR14): the picture of a frame of another U mode (the pending frame, see the model's
  // end) goes to that mode's roll (its BOX record in r2 and r3).
  const lateFolder = `movw ip,#${lo(PENDING_FRAME)};movt ip,#${hi(PENDING_FRAME)};ldrb r0,[ip];and r0,r0,#7;cmp r0,#0;beq usual;
    movw r1,#${lo(MODEL)};movt r1,#${hi(MODEL)};ldr r1,[r1];${ram('r1', 'usual')}ldrb r1,[r1];cmp r1,r0;beq usual;
    movw r3,#${lo(STORED)};movt r3,#${hi(STORED)};ldr r3,[r3,r0,lsl #2];${ram('r3', 'usual')}mov r2,r3;mov r1,r0;
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};bne roll;usual:`;
  const folderOf = (rec: string) => `ldrb r1,[${rec},#${GR3X_ROLL_FLAGS}];mov r1,r1,lsr #2;and r1,r1,#3;ldrb r0,[${rec},#${GR3X_ROLL_FOLDER}];orr r0,r0,r1,lsl #8;`;
  const lenter = lost === 'probe' ? `${lat}ldrb lr,[ip];add lr,lr,#1;strb lr,[ip];mov lr,#0;strb lr,[ip,#1];strb lr,[ip,#2];` : '';
  const lentry = lost === 'probe' ? `${lat}mov lr,#0;cmp r1,#0;beq lnull;${ram('r1', 'lnull')}ldrb lr,[r1,#0xe];add lr,lr,#1;cmp lr,#255;movhi lr,#255;lnull:strb lr,[ip,#2];` : '';
  // pFolder (T22-NAME2): the free modes' pictures (P, Av, Tv, M, a U mode out of film mode) all go to
  // one folder, remembered at GR3X_FREE_FOLDER (a halfword of every record: the record in use and the
  // seven stored ones, not the factory record at index 7): used while it is on the card and no started roll's folder; else the highest
  // folder if it is no roll's, else the next new folder, and that one is remembered. r0 the folder
  // table, r2 the candidate; r1, r3, ip, lr free (pushed or rebuilt).
  const usable = (tag: string, ok: string, bad: string) => `sub r1,r2,#100;cmp r1,#900;bhs ${bad};ldr r1,[r0,r1,lsl #2];cmp r1,#0;beq ${bad};mov r1,#1;
    l${tag}:movw ip,#${lo(STORED)};movt ip,#${hi(STORED)};ldr ip,[ip,r1,lsl #2];${ram('ip', `n${tag}`)}
    ldrb lr,[ip,#${GR3X_ROLL_FLAGS}];tst lr,#${GR3X_ROLL_STARTED};beq n${tag};ldrb r3,[ip,#${GR3X_ROLL_FOLDER}];mov lr,lr,lsr #2;and lr,lr,#3;orr r3,r3,lr,lsl #8;cmp r3,r2;beq ${bad};
    n${tag}:add r1,r1,#1;cmp r1,#6;bls l${tag};b ${ok};`;
  const pFree = `free:${lcode(1)}ldr r2,[r5,#8];${ram('r2', 'native')}ldr r6,[r2,#8];${ram('r6', 'native')}ldr r0,[r6,#0x10];${ram('r0', 'native')}
    movw r3,#${lo(POINTER)};movt r3,#${hi(POINTER)};ldr r3,[r3];${ram('r3', 'native')}add r3,r3,#${GR3X_FREE_FOLDER & 0xf00};ldrh r2,[r3,#${GR3X_FREE_FOLDER & 0xff}];
    ${usable('a', 'puse', 'phigh')}
    phigh:ldrh r2,[r6,#0x2a];add r2,r2,#100;${usable('b', 'pkeep', 'pnew')}
    pnew:ldr r0,[r5,#8];bl #${GR3X_NEXT_FOLDER};movs r2,r0;beq native;
    pkeep:movw r3,#${lo(POINTER)};movt r3,#${hi(POINTER)};ldr r3,[r3];${ram('r3', 'pstored')}add r3,r3,#${GR3X_FREE_FOLDER & 0xf00};strh r2,[r3,#${GR3X_FREE_FOLDER & 0xff}];
    pstored:mov r1,#0;pl:movw ip,#${lo(STORED)};movt ip,#${hi(STORED)};ldr ip,[ip,r1,lsl #2];${ram('ip', 'pn')}add ip,ip,#${GR3X_FREE_FOLDER & 0xf00};strh r2,[ip,#${GR3X_FREE_FOLDER & 0xff}];
    pn:add r1,r1,#1;cmp r1,#6;bls pl;
    puse:strh r2,[r4,#4];b native;`;
  entries.filmRollFolder = p.code(`push {r0,r1,r2,r3,r4,r5,r6,lr};mov r4,r2;mov r5,r0;${enter}${lenter}
    ldrh r0,[r4,#4];cmp r0,#0;bne given;
    ${late ? lateFolder : ''}${records('free', film)}ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};beq free;
    roll:${folderOf('r2')}cmp r0,#100;blo new;movw r1,#999;cmp r0,r1;bhi new;
    ldr r1,[r5,#8];${ram('r1', 'new')}ldr r1,[r1,#8];${ram('r1', 'new')}ldr r1,[r1,#0x10];${ram('r1', 'new')}
    sub r6,r0,#100;ldr r1,[r1,r6,lsl #2];${lentry}cmp r1,#0;beq ${lost ? 'lost' : 'new'};
    strh r0,[r4,#4];${code(2)}${lcode(2)}b native;
    ${lost ? `lost:${lcode(7)}ldrb r0,[r2,#${GR3X_ROLL_FRAME}];cmp r0,#0;movne r0,#2;strbne r0,[r2,#${GR3X_ROLL_FRAME}];strbne r0,[r3,#${GR3X_ROLL_FRAME}];` : ''}
    new:${lost === 'probe' ? `${lat}ldrb lr,[ip,#1];cmp lr,#7;movne lr,#3;strbne lr,[ip,#1];` : ''}${late ? 'push {r2,r3};' : ''}ldr r0,[r5,#8];bl #${GR3X_NEXT_FOLDER};${late ? 'pop {r2,r3};' : ''}${next('r0')}movs r6,r0;beq nonext;strh r6,[r4,#4];${code(3)}
    ${late ? '' : records('native', film)}
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];bic r0,r0,#${FOLDER_HIGH};mov r1,r6,lsr #8;orr r0,r0,r1,lsl #2;strb r0,[r2,#${GR3X_ROLL_FLAGS}];
    ldrb r0,[r3,#${GR3X_ROLL_FLAGS}];bic r0,r0,#${FOLDER_HIGH};orr r0,r0,r1,lsl #2;strb r0,[r3,#${GR3X_ROLL_FLAGS}];
    strb r6,[r2,#${GR3X_ROLL_FOLDER}];strb r6,[r3,#${GR3X_ROLL_FOLDER}];b native;
    ${pFolder ? pFree : `free:${lcode(1)}ldr r2,[r5,#8];${ram('r2', 'native')}ldr r2,[r2,#8];${ram('r2', 'native')}ldrh r2,[r2,#0x2a];add r2,r2,#100;mov r3,#1;
    loop:movw r6,#${lo(STORED)};movt r6,#${hi(STORED)};ldr r6,[r6,r3,lsl #2];${ram('r6', 'next')}
    ldrb r0,[r6,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};beq next;${folderOf('r6')}cmp r0,r2;beq fresh;
    next:add r3,r3,#1;cmp r3,#6;bls loop;${code(1)}b native;
    fresh:${lcode(6)}ldr r0,[r5,#8];bl #${GR3X_NEXT_FOLDER};${next('r0')}cmp r0,#0;strhne r0,[r4,#4];${code(6)}b native;`}
    given:${code(5)}${lcode(5)}b native;
    nonext:${code(4)}${lcode(4)}
    native:pop {r0,r1,r2,r3,r4,r5,r6,lr};${exit}`);
  p.patch(GR3X_SET_FILE_PATH, 0xe1a0c00d, branchWord(GR3X_SET_FILE_PATH, entries.filmRollFolder), 'film roll: the roll\'s folder at SetFilePath');
  // The date (r1 the time, record in use at POINTER): year 2000 + calls, month the path (12: none),
  // day 1 no table entry, else 2 + its state's low nibble; hour its state's high nibble; minute the
  // roll's folder % 60.
  if (lost === 'probe') entries.filmProbeTime = p.code(`movw r3,#${lo(POINTER)};movt r3,#${hi(POINTER)};ldr r3,[r3];cmp r3,#0;beq clock;
    ${lat}ldrb r0,[ip];${mod('r0', 100, 'year')}add r0,r0,#2000;strb r0,[r1];mov r0,r0,lsr #8;strb r0,[r1,#1];
    ldrb r0,[ip,#1];cmp r0,#0;moveq r0,#12;strb r0,[r1,#2];
    ldrb r0,[ip,#2];cmp r0,#0;moveq r2,#1;subne r0,r0,#1;andne r2,r0,#15;addne r2,r2,#2;strb r2,[r1,#3];
    movne r2,r0,lsr #4;moveq r2,#0;strb r2,[r1,#4];
    ldrb r2,[r3,#${GR3X_ROLL_FLAGS}];mov r2,r2,lsr #2;and r2,r2,#3;ldrb r0,[r3,#${GR3X_ROLL_FOLDER}];orr r0,r0,r2,lsl #8;${mod('r0', 60, 'minute')}strb r0,[r1,#5];
    bx lr;
    clock:b #${GR3X_GET_TIME};`);
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
function installMenu(p: Gr3xRollProgram, entries: Record<string, number>, restore = 0) {
  const mode = (label: string) => `movw r3,#${lo(MODEL)};movt r3,#${hi(MODEL)};ldr r2,[r3];${ram('r2', label)}ldrb r2,[r2];sub r2,r2,#1;cmp r2,#5;bhi ${label};`;
  entries.filmMenuVisible = p.code(`${mode('hidden')}mov r0,#1;bx lr;hidden:mov r0,#0;bx lr;`);
  entries.filmMenuIsCurrent = p.code(`${mode('none')}ldr r2,[r3,#4];${ram('r2', 'none')}ldrb r2,[r2,#${GR3X_ROLL_FLAGS}];and r2,r2,#${GR3X_FILM_ON};
    cmp r2,r1;moveq r0,#1;movne r0,#0;bx lr;none:mov r0,#0;bx lr;`);
  entries.filmMenuSet = p.code(`cmp r1,#1;bxhi lr;push {r4,r5,r6,lr};mov r4,r1;${records('done')}
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];cmp r4,#0;beq off;
    orr r0,r0,#${GR3X_FILM_ON};strb r0,[r2,#${GR3X_ROLL_FLAGS}];
    bl #${APP};bl #${USER_DATA};mov r5,r0;mov r1,#0;bl #${INTERIM_SET};mov r0,r5;mov r1,#${GR3X_DRIVE_MULTI};bl #${DRIVE_SET};b done;
    off:bic r0,r0,#${GR3X_FILM_ON};strb r0,[r2,#${GR3X_ROLL_FLAGS}];${restore ? `mov r0,r2;bl #${restore};` : ''}
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
export function installGr3xFilmAdvanceFn(p: Gr3xFnProgram, text: number, retake: false | 'event' | 'action' | 'probe' | 'cancel' = false, clamp = false, once = false, icon = GR3X_FILM_ADVANCE_ICON,
  wb?: { open: number; function: number; text: number; icon: number;
    /** Macro Mode (45): runs the Macro button's own handler as a short press (`press`: (this, events)). */
    macro?: { function: number; text: number; icon: number; press: number } }) {
  // clamp (T13-FN7): a function above the last one (43 saved by an earlier build) reads as Off.
  // wb (WB button, wb-button.ts): White Balance is 44, so 43 and above 44 read as Off.
  if (wb && (retake || !clamp || wb.function !== GR3X_FILM_ADVANCE + 2 || (wb.macro && wb.macro.function !== wb.function + 1))) throw new FirmwareError('unexpected-layout', 'IIIx film advance: White Balance needs the release form');
  const top = wb?.macro ? wb.macro.function : wb?.function;
  const high = (r: string) => wb ? `cmp ${r},#${top};movhi ${r},#0;cmp ${r},#${GR3X_FILM_ADVANCE + 1};moveq ${r},#0;` : clamp ? `cmp ${r},#${GR3X_FILM_ADVANCE + 1};movhs ${r},#0;` : '';
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
  const added = retake ? [GR3X_FILM_ADVANCE, GR3X_FILM_RETAKE] : wb ? [GR3X_FILM_ADVANCE, wb.function, ...(wb.macro ? [wb.macro.function] : [])] : [GR3X_FILM_ADVANCE];
  const table = p.append(Uint8Array.from([...official, ...added]));
  entries.filmFnTable = table;
  for (const at of [GR3X_FN_LOOP_LOW, GR3X_FN_LOOP_LOW + 4, GR3X_FN_LOOP_END]) free(at);
  p.patch(GR3X_FN_LOOP_LOW, movWord(4, lo(GR3X_FN_TABLE)), movWord(4, lo(table)), 'film advance: the functions table with Film Advance, low half');
  p.patch(GR3X_FN_LOOP_LOW + 4, movWord(4, hi(GR3X_FN_TABLE), true), movWord(4, hi(table), true), 'film advance: the functions table with Film Advance, high half');
  p.patch(GR3X_FN_LOOP_END, 0xe2846024, 0xe2846024 + added.length, `film advance: the functions table has ${GR3X_FN_COUNT + added.length} entries`);
  const retakeText = retake ? `cmp r1,#${GR3X_FILM_RETAKE};movweq r0,#${GR3X_RETAKE_TEXT};bxeq lr;` : '';
  const M = wb?.macro;
  const wbText = wb ? `cmp r1,#${wb.function};movweq r0,#${wb.text};bxeq lr;${M ? `cmp r1,#${M.function};movweq r0,#${M.text};bxeq lr;` : ''}` : '';
  const wbIcon = wb ? `cmp r1,#${wb.function};movweq r0,#${wb.icon};bxeq lr;${M ? `cmp r1,#${M.function};movweq r0,#${M.icon};bxeq lr;` : ''}` : '';
  entries.filmFnText = p.code(`${high('r1')}cmp r1,#${GR3X_FILM_ADVANCE};movweq r0,#${text};bxeq lr;${retakeText}${wbText}cmp r1,#0;b #${GR3X_FN_TEXT + 4};`);
  p.patch(GR3X_FN_TEXT, 0xe3510000, branchWord(GR3X_FN_TEXT, entries.filmFnText), 'film advance: its text');
  const retakeIcon = retake ? `cmp r1,#${GR3X_FILM_RETAKE};movweq r0,#${icon};bxeq lr;` : '';
  entries.filmFnIcon = p.code(`${high('r1')}cmp r1,#${GR3X_FILM_ADVANCE};movweq r0,#${icon};bxeq lr;${retakeIcon}${wbIcon}cmp r1,#0;b #${GR3X_FN_ICON + 4};`);
  p.patch(GR3X_FN_ICON, 0xe3510000, branchWord(GR3X_FN_ICON, entries.filmFnIcon), 'film advance: its icon');
  // The advance (every register kept but the function's, which becomes Off).
  // once (T14-DIR3): a press runs this 4 times; only the first posts Complete until the next exposure
  // (GR3X_ADVANCE_ONCE_CLEAR), so the live view gets one end of sequence, not four.
  const single = (label: string) => once ? `movw ip,#${lo(ADVANCE_ONCE)};movt ip,#${hi(ADVANCE_ONCE)};ldrb r0,[ip];cmp r0,#0;bne ${label};mov r0,#1;strb r0,[ip];` : '';
  const advance = (label: string) => `push {r0,r1,r2,r3,ip,lr};${records(label, true)}${single(label)}bl #${END_POSTER};${label}:pop {r0,r1,r2,r3,ip,lr};`;
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
  // White Balance (44), pressed (r3 = 0, as the camera's functions): opened into the events (r1), then as Off.
  // Macro Mode (45), pressed: the Macro button's short press (this r0, the events r1).
  const macroCustom = M ? `b native;mc:cmp r2,#${M.function};bne native;cmp r3,#0;bne mcoff;push {r0,r1,r2,r3,ip,lr};bl #${M.press};pop {r0,r1,r2,r3,ip,lr};mcoff:mov r2,#0;` : '';
  const wbCustom = wb ? `cmp r2,#${wb.function};bne ${M ? 'mc' : 'native'};cmp r3,#0;bne wboff;push {r0,r1,r2,r3,ip,lr};mov r0,r1;bl #${wb.open};pop {r0,r1,r2,r3,ip,lr};wboff:mov r2,#0;${macroCustom}` : '';
  const macroWlan = M ? `b go;mw:cmp r6,#${M.function};bne go;push {r0,r1,r2,r3,ip,lr};mov r0,r10;mov r1,r8;bl #${M.press};pop {r0,r1,r2,r3,ip,lr};mov r6,#0;` : '';
  const wbWlan = wb ? `cmp r6,#${wb.function};bne ${M ? 'mw' : 'go'};push {r0,r1,r2,r3,ip,lr};mov r0,r8;bl #${wb.open};pop {r0,r1,r2,r3,ip,lr};mov r6,#0;${macroWlan}` : '';
  entries.filmFnCustom = p.code(`${high('r2')}cmp r2,#${GR3X_FILM_ADVANCE};bne ${retake ? 'other' : wb ? 'wb' : 'native'};${advance('kept')}mov r2,#0;${retake ? `b native;other:${retakeCustom}` : wb ? `b native;wb:${wbCustom}` : ''}native:mov ip,sp;b #${GR3X_FN_CUSTOM + 4};`);
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
  entries.filmFnWlan = p.code(`${high('r6')}cmp r6,#${GR3X_FILM_ADVANCE};bne ${retake ? 'other' : wb ? 'wb' : 'go'};${advance('kept')}mov r6,#0;${retake ? `b go;other:${retakeWlan}` : wb ? `b go;wb:${wbWlan}` : ''}go:cmp r6,#0x29;b #${GR3X_FN_WLAN + 4};`);
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
function installReviewNext(p: Gr3xRollProgram, free: (at: number) => void, entries: Record<string, number>, armed = false, deferred = false, log = false) {
  free(GR3X_REVIEW_START);
  // 'armed' (T13-FN7): only a start that follows the opening action (UI event 0x90, after a shot);
  // the flag is raised there and falls at the start (and at each exposure, GR3X_REVIEW_ARM_CLEAR).
  if (armed) {
    free(GR3X_OPEN_REVIEW);
    entries.filmReviewArm = p.code(`push {r0};movw ip,#${lo(REVIEW_ARM)};movt ip,#${hi(REVIEW_ARM)};mov r0,#1;strb r0,[ip];pop {r0};mov ip,sp;b #${GR3X_OPEN_REVIEW + 4};`);
    p.patch(GR3X_OPEN_REVIEW, 0xe1a0c00d, branchWord(GR3X_OPEN_REVIEW, entries.filmReviewArm), 'film roll: the Next / Retake / Complete screen opened after a shot');
  }
  const arm = armed ? `movw ip,#${lo(REVIEW_ARM)};movt ip,#${hi(REVIEW_ARM)};ldrb r0,[ip];mov r1,#0;strb r1,[ip];cmp r0,#0;beq alone;` : '';
  if (deferred) {
    // 'deferred' (T14-DIR2): the start only notes the screen (its address, 0 otherwise); Next shot is
    // pressed when that screen gets its first UI event (its handler, table entry 10), after the
    // native handling of that event: the screen is then the active one, as for a real press.
    free(GR3X_REVIEW_EVENT);
    // log (T14-DG1): the screen's events from its start to its stop (REVIEW_LOG: first two codes,
    // count), cleared at the start, frozen at the stop, shown in the pictures' date.
    const clearLog = log ? `str r0,[ip,#4];str r0,[ip,#8];` : '';
    const logEvent = log ? `push {r1,r2,r3};movw ip,#${lo(REVIEW_LOG)};movt ip,#${hi(REVIEW_LOG)};ldrb r2,[ip,#5];cmp r2,#0;bne logged;
      ldrb r2,[ip,#4];ldrh r3,[r1];cmp r2,#0;strheq r3,[ip];cmp r2,#1;strheq r3,[ip,#2];cmp r2,#255;addlo r2,r2,#1;strb r2,[ip,#4];
      logged:pop {r1,r2,r3};` : '';
    entries.filmReviewNext = p.code(`push {r0,r1,r2,r3,r4,lr};mov r4,r0;movw ip,#${lo(REVIEW_PENDING)};movt ip,#${hi(REVIEW_PENDING)};mov r0,#0;str r0,[ip];${clearLog}
      ${arm}${records('alone', true)}
      movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', 'alone')}
      ldr r0,[r0,#0x518];${ram('r0', 'alone')}ldr r0,[r0];${ram('r0', 'alone')}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne alone;
      movw ip,#${lo(REVIEW_PENDING)};movt ip,#${hi(REVIEW_PENDING)};str r4,[ip];
      alone:pop {r0,r1,r2,r3,r4,lr};mov ip,sp;b #${GR3X_REVIEW_START + 4};`);
    p.patch(GR3X_REVIEW_START, 0xe1a0c00d, branchWord(GR3X_REVIEW_START, entries.filmReviewNext), 'film roll: Next / Retake / Complete noted for Next shot in film mode');
    entries.filmReviewEvent = p.code(`${logEvent}push {r1};movw ip,#${lo(REVIEW_PENDING)};movt ip,#${hi(REVIEW_PENDING)};ldr r1,[ip];cmp r1,r0;bne native;
      mov r1,#0;str r1,[ip];pop {r1};push {r0,lr};mov ip,sp;bl #${GR3X_REVIEW_EVENT + 4};pop {r0,lr};b #${GR3X_NEXT_SHOT};
      native:pop {r1};mov ip,sp;b #${GR3X_REVIEW_EVENT + 4};`);
    p.patch(GR3X_REVIEW_EVENT, 0xe1a0c00d, branchWord(GR3X_REVIEW_EVENT, entries.filmReviewEvent), 'film roll: Next shot at the screen\'s first event in film mode');
    if (log) {
      free(GR3X_REVIEW_STOP);
      entries.filmReviewStop = p.code(`push {r0};movw ip,#${lo(REVIEW_LOG)};movt ip,#${hi(REVIEW_LOG)};mov r0,#1;strb r0,[ip,#5];pop {r0};mov ip,sp;b #${GR3X_REVIEW_STOP + 4};`);
      p.patch(GR3X_REVIEW_STOP, 0xe1a0c00d, branchWord(GR3X_REVIEW_STOP, entries.filmReviewStop), 'film roll review probe: the screen\'s stop');
      // 20YY.MM.DD HH:mm: HH:mm the first code (HH * 60 + mm), YY the second % 100 and DD 1 + its
      // hundreds, MM 1 + the count (at most 11).
      entries.filmProbeTime = p.code(`movw r3,#${lo(POINTER)};movt r3,#${hi(POINTER)};ldr r3,[r3];cmp r3,#0;beq clock;
        movw ip,#${lo(REVIEW_LOG)};movt ip,#${hi(REVIEW_LOG)};
        ldrh r0,[ip,#2];mov r2,#0;hund:cmp r0,#100;subhs r0,r0,#100;addhs r2,r2,#1;bhs hund;
        add r0,r0,#2000;strb r0,[r1];mov r0,r0,lsr #8;strb r0,[r1,#1];cmp r2,#30;movhi r2,#30;add r2,r2,#1;strb r2,[r1,#3];
        ldrb r0,[ip,#4];cmp r0,#11;movhi r0,#11;add r0,r0,#1;strb r0,[r1,#2];
        ldrh r0,[ip];mov r2,#0;hour:cmp r0,#60;subhs r0,r0,#60;addhs r2,r2,#1;bhs hour;cmp r2,#23;movhi r2,#23;strb r2,[r1,#4];strb r0,[r1,#5];
        bx lr;
        clock:b #${GR3X_GET_TIME};`);
    }
    return;
  }
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

/** T14-DIR1: the roll folder's name. The look of the photo set in use (+0x1c2: 11 Standard to 22
 * Negative Film) gives 3 characters (decision of 2026-10-31); other looks (GR Mod's films) FLM until
 * the application asks each film's code. */
export const GR3X_LOOK = 0x1c2;
export const GR3X_LOOK_CODES: Readonly<Record<number, string>> = {
  11: 'STD', 12: 'VIV', 13: 'MON', 14: 'SMO', 15: 'HMO', 16: 'HCB', 17: 'POS', 18: 'BLB', 19: 'RET', 20: 'HDR', 21: 'CRP', 22: 'NEG',
};
export const GR3X_UNKNOWN_LOOK_CODE = 'FLM';
/** The saved Folder Name (5 bytes) and its type, in each record. */
export const GR3X_FOLDER_NAME = 0x936, GR3X_FOLDER_TYPE = 0x934;
/** The live shooting values (*0x53525d5c()) and their folder name (item 0xfd) and type (item 0xfc)
 * setters, as Folder Name's own setters use them (0x5326caa0, 0x53258604). */
export const GR3X_LIVE_VALUES = 0x53525d5c, GR3X_LIVE_FOLDER_NAME = 0x5354d138, GR3X_LIVE_FOLDER_TYPE = 0x5354d104;
/** The name given (6 bytes: 5 characters and a zero), round 10's zero-filled sbrk area. */
const FOLDER_NAME = GR3X_ROLL_DIAG + 0x20;

/** QuickViewController's UI event handler (its table entry 10). */
export const GR3X_REVIEW_EVENT = 0x531cbfc4;
/** T14-DIR2: the screen waiting for Next shot (a word, zero at start-up, the key probe's area). */
const REVIEW_PENDING = KEY_LAST + 12;

/** T14-DIR3: Complete posted since the last exposure (a byte, zero at start-up, the key probe's area). */
const ADVANCE_ONCE = KEY_LAST + 10;
/** That flag cleared at each exposure (every register kept but ip). */
export const GR3X_ADVANCE_ONCE_CLEAR = `push {r0};movw ip,#${lo(ADVANCE_ONCE)};movt ip,#${hi(ADVANCE_ONCE)};mov r0,#0;strb r0,[ip];pop {r0};`;

/** QuickViewController's stop (its table entry 8). */
export const GR3X_REVIEW_STOP = 0x531cab24;
/** T14-DG1: the screen's event log (halfwords: first code, second code; bytes: count, frozen). */
const REVIEW_LOG = KEY_LAST + 16;

/** UI events on QuickViewController (its handler 0x531cbfc4): 0xe7 → 0x531cbf5c opens the delete
 * dialog (Cancel / Delete, seen on the camera with T14-DG2: not the half press); 0xb6 (no global
 * action, 0x53228520) → 0x531cc124: + 0x180 = 1 and back to the live view, as Next shot. */
export const GR3X_DELETE_EVENT = 0xe7, GR3X_REVIEW_CLOSE_EVENT = 0xb6;

/**
 * Forms 'dg2' / 'dg3' (T14-DG2 / T14-DG3): in film mode (after a shot, as 'armed'), the screen's
 * start is followed by a UI event posted to the queue (dg2 0xe7, which proved to be the delete
 * dialog; dg3 0xb6, the screen's own way back to the live view): the screen gets it after its own
 * start-up events. The screen's events are logged as in T14-DG1.
 */
function installReviewHalfPress(p: Gr3xRollProgram, free: (at: number) => void, entries: Record<string, number>, event: number) {
  for (const at of [GR3X_REVIEW_START, GR3X_OPEN_REVIEW, GR3X_REVIEW_EVENT, GR3X_REVIEW_STOP]) free(at);
  entries.filmReviewArm = p.code(`push {r0};movw ip,#${lo(REVIEW_ARM)};movt ip,#${hi(REVIEW_ARM)};mov r0,#1;strb r0,[ip];pop {r0};mov ip,sp;b #${GR3X_OPEN_REVIEW + 4};`);
  p.patch(GR3X_OPEN_REVIEW, 0xe1a0c00d, branchWord(GR3X_OPEN_REVIEW, entries.filmReviewArm), 'film roll: the Next / Retake / Complete screen opened after a shot');
  entries.filmReviewNext = p.code(`push {r0,r1,r2,r3,r4,lr};movw ip,#${lo(REVIEW_LOG)};movt ip,#${hi(REVIEW_LOG)};mov r0,#0;str r0,[ip];str r0,[ip,#4];
    movw ip,#${lo(REVIEW_ARM)};movt ip,#${hi(REVIEW_ARM)};ldrb r0,[ip];mov r1,#0;strb r1,[ip];cmp r0,#0;beq alone;${records('alone', true)}
    movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', 'alone')}
    ldr r0,[r0,#0x518];${ram('r0', 'alone')}ldr r0,[r0];${ram('r0', 'alone')}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne alone;
    pop {r0,r1,r2,r3,r4,lr};push {r0,lr};mov ip,sp;bl #${GR3X_REVIEW_START + 4};
    bl #${UI_TASK};bl #${UI_QUEUE};mov r1,#${event};mov r2,#0;mov r3,#0;bl #${GR3X_POST_EVENT};pop {r0,lr};bx lr;
    alone:pop {r0,r1,r2,r3,r4,lr};mov ip,sp;b #${GR3X_REVIEW_START + 4};`);
  p.patch(GR3X_REVIEW_START, 0xe1a0c00d, branchWord(GR3X_REVIEW_START, entries.filmReviewNext), `film roll: UI event ${event.toString(16)} posted to Next / Retake / Complete in film mode`);
  entries.filmReviewEvent = p.code(`push {r1,r2,r3};movw ip,#${lo(REVIEW_LOG)};movt ip,#${hi(REVIEW_LOG)};ldrb r2,[ip,#5];cmp r2,#0;bne logged;
    ldrb r2,[ip,#4];ldrh r3,[r1];cmp r2,#0;strheq r3,[ip];cmp r2,#1;strheq r3,[ip,#2];cmp r2,#255;addlo r2,r2,#1;strb r2,[ip,#4];
    logged:pop {r1,r2,r3};mov ip,sp;b #${GR3X_REVIEW_EVENT + 4};`);
  p.patch(GR3X_REVIEW_EVENT, 0xe1a0c00d, branchWord(GR3X_REVIEW_EVENT, entries.filmReviewEvent), 'film roll review probe: the screen\'s events');
  entries.filmReviewStop = p.code(`push {r0};movw ip,#${lo(REVIEW_LOG)};movt ip,#${hi(REVIEW_LOG)};mov r0,#1;strb r0,[ip,#5];pop {r0};mov ip,sp;b #${GR3X_REVIEW_STOP + 4};`);
  p.patch(GR3X_REVIEW_STOP, 0xe1a0c00d, branchWord(GR3X_REVIEW_STOP, entries.filmReviewStop), 'film roll review probe: the screen\'s stop');
  entries.filmProbeTime = p.code(`movw r3,#${lo(POINTER)};movt r3,#${hi(POINTER)};ldr r3,[r3];cmp r3,#0;beq clock;
    movw ip,#${lo(REVIEW_LOG)};movt ip,#${hi(REVIEW_LOG)};
    ldrh r0,[ip,#2];mov r2,#0;hund:cmp r0,#100;subhs r0,r0,#100;addhs r2,r2,#1;bhs hund;
    add r0,r0,#2000;strb r0,[r1];mov r0,r0,lsr #8;strb r0,[r1,#1];cmp r2,#30;movhi r2,#30;add r2,r2,#1;strb r2,[r1,#3];
    ldrb r0,[ip,#4];cmp r0,#11;movhi r0,#11;add r0,r0,#1;strb r0,[r1,#2];
    ldrh r0,[ip];mov r2,#0;hour:cmp r0,#60;subhs r0,r0,#60;addhs r2,r2,#1;bhs hour;cmp r2,#23;movhi r2,#23;strb r2,[r1,#4];strb r0,[r1,#5];
    bx lr;
    clock:b #${GR3X_GET_TIME};`);
}

/** The screen's own review timer (0x531caa7c, Rec Review in milliseconds: 0, 500 ... 3000, -1 hold):
 * 0x5322b468(0x5320b01c(0x5320ad88()), ms, this + 0x158) kept at + 0x178; when it fires, 0x531ca86c
 * goes back to the live view (+ 0x180 = 1) if the state + 0x16c is at most 1. */
export const GR3X_TIMER_QUEUE = 0x5320b01c, GR3X_TIMER_START = 0x5322b468, GR3X_FILM_REVIEW_MS = 500;

/**
 * Form 'dir4' (T14-DIR4): in film mode (after a shot, as 'armed'), the screen's start is followed by
 * the screen's own review timer (GR3X_FILM_REVIEW_MS) when none runs: the screen shows for that time,
 * then goes back to the live view by itself, as after a single picture with Rec Review on.
 */
function installReviewTimer(p: Gr3xRollProgram, free: (at: number) => void, entries: Record<string, number>, next = false) {
  for (const at of [GR3X_REVIEW_START, GR3X_OPEN_REVIEW]) free(at);
  // next (T14-DIR5): the timer's handler ignores the multi-exposure screen (state + 0x16c above 1), so
  // our timer is noted (the screen in REVIEW_PENDING) and its expiry presses Next shot on that screen.
  const note = next ? `movw ip,#${lo(REVIEW_PENDING)};movt ip,#${hi(REVIEW_PENDING)};str r4,[ip];` : '';
  const clearNote = next ? `movw ip,#${lo(REVIEW_PENDING)};movt ip,#${hi(REVIEW_PENDING)};mov r0,#0;str r0,[ip];` : '';
  if (next) {
    free(GR3X_REVIEW_TIMER);
    entries.filmReviewTimer = p.code(`push {r2};movw ip,#${lo(REVIEW_PENDING)};movt ip,#${hi(REVIEW_PENDING)};ldr r2,[ip];cmp r2,r0;bne native;
      ldr r2,[r0,#0x178];cmp r2,r1;bne native;mov r2,#0;str r2,[ip];str r2,[r0,#0x178];pop {r2};b #${GR3X_NEXT_SHOT};
      native:pop {r2};ldr r2,[r0,#0x178];b #${GR3X_REVIEW_TIMER + 4};`);
    p.patch(GR3X_REVIEW_TIMER, 0xe5902178, branchWord(GR3X_REVIEW_TIMER, entries.filmReviewTimer), 'film roll: Next shot when our review timer expires');
  }
  entries.filmReviewArm = p.code(`push {r0};movw ip,#${lo(REVIEW_ARM)};movt ip,#${hi(REVIEW_ARM)};mov r0,#1;strb r0,[ip];pop {r0};mov ip,sp;b #${GR3X_OPEN_REVIEW + 4};`);
  p.patch(GR3X_OPEN_REVIEW, 0xe1a0c00d, branchWord(GR3X_OPEN_REVIEW, entries.filmReviewArm), 'film roll: the Next / Retake / Complete screen opened after a shot');
  entries.filmReviewNext = p.code(`push {r0,r1,r2,r3,r4,lr};${clearNote}
    movw ip,#${lo(REVIEW_ARM)};movt ip,#${hi(REVIEW_ARM)};ldrb r0,[ip];mov r1,#0;strb r1,[ip];cmp r0,#0;beq alone;${records('alone', true)}
    movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', 'alone')}
    ldr r0,[r0,#0x518];${ram('r0', 'alone')}ldr r0,[r0];${ram('r0', 'alone')}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne alone;
    pop {r0,r1,r2,r3,r4,lr};push {r4,lr};mov r4,r0;mov ip,sp;bl #${GR3X_REVIEW_START + 4};
    ldr r0,[r4,#0x178];cmp r0,#0;bne done;
    bl #${UI_TASK};bl #${GR3X_TIMER_QUEUE};movw r1,#${GR3X_FILM_REVIEW_MS};add r2,r4,#0x158;bl #${GR3X_TIMER_START};str r0,[r4,#0x178];${note}
    done:pop {r4,pc};
    alone:pop {r0,r1,r2,r3,r4,lr};mov ip,sp;b #${GR3X_REVIEW_START + 4};`);
  p.patch(GR3X_REVIEW_START, 0xe1a0c00d, branchWord(GR3X_REVIEW_START, entries.filmReviewNext), 'film roll: the screen\'s review timer in film mode');
}

/** QuickViewController's timer handler (table entry 15; first instruction `ldr r2,[r0,#0x178]`). */
export const GR3X_REVIEW_TIMER = 0x531ca86c;

/** In QuickViewController's start: `bl 0x531cb028` gives the layout (the controller id - 0x0800000c),
 * then `mov r1,r0` before `bl 0x531cb7bc(this, layout)`, which sets the state + 0x16c to it; a state
 * at most 1 then follows Rec Review (0x531caa7c), as after a single picture. */
export const GR3X_REVIEW_LAYOUT = 0x531cbe4c;

/**
 * Form 'dir6' (T14-DIR6): in film mode (after a shot, as 'armed'), the screen takes the layout of a
 * single picture's review (0) instead of the multi-exposure one: the picture without Next shot /
 * Retake / Complete, closed by a half press or by Rec Review's own timer, as after a single picture.
 */
function installReviewPlain(p: Gr3xRollProgram, free: (at: number) => void, entries: Record<string, number>) {
  for (const at of [GR3X_REVIEW_LAYOUT, GR3X_OPEN_REVIEW]) free(at);
  entries.filmReviewArm = p.code(`push {r0};movw ip,#${lo(REVIEW_ARM)};movt ip,#${hi(REVIEW_ARM)};mov r0,#1;strb r0,[ip];pop {r0};mov ip,sp;b #${GR3X_OPEN_REVIEW + 4};`);
  p.patch(GR3X_OPEN_REVIEW, 0xe1a0c00d, branchWord(GR3X_OPEN_REVIEW, entries.filmReviewArm), 'film roll: the Next / Retake / Complete screen opened after a shot');
  entries.filmReviewLayout = p.code(`push {r0,r1,r2,r3,r4,lr};
    movw ip,#${lo(REVIEW_ARM)};movt ip,#${hi(REVIEW_ARM)};ldrb r0,[ip];mov r1,#0;strb r1,[ip];cmp r0,#0;beq keep;${records('keep', true)}
    movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', 'keep')}
    ldr r0,[r0,#0x518];${ram('r0', 'keep')}ldr r0,[r0];${ram('r0', 'keep')}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne keep;
    pop {r0,r1,r2,r3,r4,lr};mov r1,#0;b #${GR3X_REVIEW_LAYOUT + 4};
    keep:pop {r0,r1,r2,r3,r4,lr};mov r1,r0;b #${GR3X_REVIEW_LAYOUT + 4};`);
  p.patch(GR3X_REVIEW_LAYOUT, 0xe1a01000, branchWord(GR3X_REVIEW_LAYOUT, entries.filmReviewLayout), 'film roll: a single picture\'s review layout in film mode');
}

/** In QuickViewController's start: `cmp r0,r5` (r0 = 0x53233930(model): a multi-exposure going on),
 * then `movne r1,#3` / `moveq r1,r5 (0)` the set of buttons (3 Next shot / Retake / Complete, 0 none)
 * for 0x5316d354(this, set, [this + 0x15c]) at 0x531cbe34. */
export const GR3X_REVIEW_BUTTONS = 0x531cbe2c;

/**
 * Form 'dir7' (T14-DIR7): in film mode (after a shot, as 'armed'), the screen gets no buttons (set 0,
 * as after a single picture): the picture alone, closed by a half press (or Rec Review's timer).
 */
function installReviewNoButtons(p: Gr3xRollProgram, free: (at: number) => void, entries: Record<string, number>) {
  for (const at of [GR3X_REVIEW_BUTTONS, GR3X_OPEN_REVIEW]) free(at);
  entries.filmReviewArm = p.code(`push {r0};movw ip,#${lo(REVIEW_ARM)};movt ip,#${hi(REVIEW_ARM)};mov r0,#1;strb r0,[ip];pop {r0};mov ip,sp;b #${GR3X_OPEN_REVIEW + 4};`);
  p.patch(GR3X_OPEN_REVIEW, 0xe1a0c00d, branchWord(GR3X_OPEN_REVIEW, entries.filmReviewArm), 'film roll: the Next / Retake / Complete screen opened after a shot');
  entries.filmReviewButtons = p.code(`movne r1,#3;moveq r1,#0;push {r0,r1,r2,r3,r4,lr};
    movw ip,#${lo(REVIEW_ARM)};movt ip,#${hi(REVIEW_ARM)};ldrb r0,[ip];mov r1,#0;strb r1,[ip];cmp r0,#0;beq keep;${records('keep', true)}
    movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', 'keep')}
    ldr r0,[r0,#0x518];${ram('r0', 'keep')}ldr r0,[r0];${ram('r0', 'keep')}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne keep;
    pop {r0,r1,r2,r3,r4,lr};mov r1,#0;b #${GR3X_REVIEW_BUTTONS + 8};
    keep:pop {r0,r1,r2,r3,r4,lr};b #${GR3X_REVIEW_BUTTONS + 8};`);
  p.patch(GR3X_REVIEW_BUTTONS, 0x13a01003, branchWord(GR3X_REVIEW_BUTTONS, entries.filmReviewButtons), 'film roll: no Next / Retake / Complete buttons in film mode');
}

/** QuickViewController's own id (table entry 6, 0x531ca6b4): from the byte + 0x799 of 0x532372e8()
 * (`ldrb r3,[r0,#0x799]` here): 3 → 0x08000011 (the multi-exposure review: state 5, the buttons
 * Next shot / Retake / Complete of the table 0x53b412a4 + 5 × 0x20), 4 → 0x0800000d, 5 → 0x0800000c or
 * 0x0800000e, otherwise 0x0800000c (a single picture's review, state 0, no buttons). */
export const GR3X_REVIEW_ID_KIND = 0x531ca6e8;

/**
 * Form 'dir8' (T14-DIR8): in film mode (a U mode with Film Roll Mode on, a frame exposed), the screen
 * takes the id of a single picture's review (kind 3 read as 0): the picture without buttons, kept as
 * Rec Review says, closed by a half press as after a single picture.
 */
function installReviewPlainId(p: Gr3xRollProgram, free: (at: number) => void, entries: Record<string, number>, review: false | 'offHold' | 'off' | 'off25' | 'off10' | 'off1' = false, anyState = false) {
  // anyState (T16-CLO2): film mode alone, whatever the multi-exposure state (Film Advance pressed early
  // ends the sequence before the review opens: it then opened with Next / Retake / Complete).
  const state2 = (label: string) => anyState ? '' : `movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', label)}
      ldr r0,[r0,#0x518];${ram('r0', label)}ldr r0,[r0];${ram('r0', label)}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne ${label};`;
  free(GR3X_REVIEW_ID_KIND);
  // review (T14-DIR9): that review closing at once (Instant Review Off) or never (Hold) loses the live
  // view's indications in a multi-exposure (seen on the camera); in film mode both read as 500 ms.
  // 'off' (T14-DIR10, the user's choice): only Off, read as 100 ms; Hold stays Hold.
  if (review) {
    // 'off25' (T14-DIR11) / 'off10' (T14-DIR12) / 'off1' (T14-DIR13): Off read as 25 / 10 / 1 ms.
    const off = review === 'off' || review === 'off25' || review === 'off10' || review === 'off1';
    const ms = review === 'off1' ? 1 : review === 'off10' ? 10 : review === 'off25' ? 25 : review === 'off' ? GR3X_FILM_OFF_REVIEW_MS : GR3X_FILM_REVIEW_MS;
    free(GR3X_REVIEW_TIME);
    entries.filmReviewTime = p.code(`cmp r0,#0;beq check;${off ? 'b done' : 'cmn r0,#1;bne done'};
      check:push {r0,r1,r2,r3,r4,lr};${records('keep', true)}
      ${state2('keep')}
      pop {r0,r1,r2,r3,r4,lr};movw r0,#${ms};b done;
      keep:pop {r0,r1,r2,r3,r4,lr};
      done:subs r5,r0,#0;b #${GR3X_REVIEW_TIME + 4};`);
    p.patch(GR3X_REVIEW_TIME, 0xe2505000, branchWord(GR3X_REVIEW_TIME, entries.filmReviewTime), off ? `film roll: Instant Review Off read as ${ms} ms in film mode` : 'film roll: Instant Review Off or Hold read as 500 ms in film mode');
  }
  entries.filmReviewId = p.code(`ldrb r3,[r0,#0x799];cmp r3,#3;bne back;push {r0,r1,r2,r3,r4,lr};${records('keep', true)}
    ${state2('keep')}
    pop {r0,r1,r2,r3,r4,lr};mov r3,#0;b back;
    keep:pop {r0,r1,r2,r3,r4,lr};
    back:b #${GR3X_REVIEW_ID_KIND + 4};`);
  p.patch(GR3X_REVIEW_ID_KIND, 0xe5d03799, branchWord(GR3X_REVIEW_ID_KIND, entries.filmReviewId), 'film roll: a single picture\'s review instead of the multi-exposure one');
}

/** In the review's own return (0x531caa7c): `subs r5,r0,#0` on Instant Review (ms; 0 Off, -1 Hold). */
export const GR3X_REVIEW_TIME = 0x531caaa4;

/** T14-DIR10: Instant Review Off in film mode (the user's choice, 2026-11-01). */
export const GR3X_FILM_OFF_REVIEW_MS = 100;

/** T14-DIR14: the U mode (1..6) of the frame being exposed, + 0x80 once a late end advanced it (a byte,
 * zero at start-up, the key probe's area). */
const PENDING_FRAME = KEY_LAST + 11;

/** The screen switch as the opening action 0x53226738 does it: 0x5316c9d8(0x53228a90(queue), id,
 * 0x53228c4c(queue)), queue = 0x5320aefc(0x5320ad88()). */
export const GR3X_SCREEN_MANAGER = 0x53228a90, GR3X_SCREEN_CURRENT = 0x53228c4c, GR3X_SCREEN_SWITCH = 0x5316c9d8;
/** The camera's message screen « Unable to store image. » (text 0x2be at 0x531ce174), closed after 5 s. */
export const GR3X_MESSAGE_SCREEN = 0x08000007, GR3X_MESSAGE_TEXT_AT = 0x531ce174, GR3X_MESSAGE_TEXT_SET = 0x531ce128;
/** T15-END1: a film mode message is waiting (a byte, zero at start-up, the key probe's area). */
const NEW_ROLL_MESSAGE = KEY_LAST + 7;

/** « New roll loaded. » in the 21 languages (order of GR3X_FILM_ADVANCE_NAMES; every character
 * checked against the camera's own texts of that language). */
export const GR3X_FILM_NEW_ROLL_NAMES: readonly string[] = [
  'Nový film vložen.', 'Ny film isat.', 'New roll loaded.', 'Uusi filmi ladattu.', 'Nouvelle pellicule chargée.', 'Neuer Film eingelegt.',
  'Τοποθετήθηκε νέο φιλμ.', 'Új film betöltve.', 'Nuovo rullino caricato.', '新しいフィルムをセットしました。', '새 필름이 장전되었습니다.',
  'Nieuwe film geladen.', 'Załadowano nowy film.', 'Novo rolo carregado.', 'Новая плёнка заряжена.', '已更换新片。', 'Nuevo carrete cargado.',
  'Ny film laddad.', 'ใส่ฟิล์มม้วนใหม่แล้ว', '已裝入新底片。', 'Yeni film takıldı.',
];

/** T17-RWD1: « Rewind Film » and its question in the 21 languages (order of GR3X_FILM_ADVANCE_NAMES;
 * every character checked against the camera's own texts of that language). */
export const GR3X_FILM_REWIND_NAMES: readonly string[] = [
  'Převinout film', 'Spol filmen tilbage', 'Rewind Film', 'Kelaa filmi takaisin', 'Rembobiner',
  'Film zurückspulen', 'Επανατύλιξη φιλμ', 'Film visszatekerése', 'Riavvolgi rullino', 'フィルムリセット',
  '필름 되감기', 'Film terugspoelen', 'Przewijanie wsteczne', 'Rebobinar filme', 'Обратная перемотка',
  '倒片', 'Rebobinar carrete', 'Spola tillbaka film', 'กรอฟิล์มกลับ', '倒片',
  'Filmi geri sar',
];
export const GR3X_FILM_REWIND_QUESTIONS: readonly string[] = [
  'Převinout film?\nDalší snímek začne\nnový film.', 'Spol filmen tilbage?\nNæste billede starter\nen ny film.', 'Rewind the film?\nThe next shot starts\na new roll.', 'Kelataanko filmi takaisin?\nSeuraava kuva aloittaa\nuuden filmin.', 'Rembobiner la pellicule ?\nLa prochaine vue démarre\nune nouvelle pellicule.',
  'Film zurückspulen?\nDie nächste Aufnahme\nbeginnt einen neuen Film.', 'Επανατύλιξη φιλμ;\nΗ επόμενη λήψη ξεκινά\nνέο φιλμ.', 'Visszatekeri a filmet?\nA következő kép új\nfilmet kezd.', 'Riavvolgere il rullino?\nLo scatto successivo\navvia un nuovo rullino.', 'フィルムをリセットしますか?\n次の撮影から新しい\nフィルムになります。',
  '필름을 되감습니다.\n다음 촬영부터 새 필름이\n시작됩니다.', 'Film terugspoelen?\nDe volgende opname start\neen nieuwe film.', 'Przewinąć film?\nNastępne zdjęcie rozpocznie\nnowy film.', 'Rebobinar o filme?\nA próxima foto inicia\num novo rolo.', 'Перемотать плёнку назад?\nСледующий снимок начнёт\nновую плёнку.',
  '将倒片。\n下一张将使用新片。', 'Rebobina el carrete.\nLa siguiente foto inicia\nun carrete nuevo.', 'Spola tillbaka filmen?\nNästa bild startar\nen ny film.', 'กรอฟิล์มกลับหรือไม่?\nภาพถัดไปจะเริ่ม\nฟิล์มม้วนใหม่', '將倒片。\n下次拍攝將使用新片。',
  'Film geri sarılsın mı?\nSonraki çekim yeni bir\nfilm başlatır.',
];

/**
 * T15-END1: the message screen 0x08000007 shows our text (`text`) instead of its own while a film mode
 * message waits (the byte is then cleared): `movw r1,#0x2be` at 0x531ce174 becomes that choice.
 */
export function installGr3xFilmMessage(p: Gr3xRollProgram, text: number, redirect = false, guard = false, probe = guard, check = 0, fromMenu = false, quick = false) {
  if (p.sites.some(s => s.address === GR3X_MESSAGE_TEXT_AT)) throw new FirmwareError('unexpected-instruction', 'IIIx film message: already patched');
  const entries: Record<string, number> = {};
  entries.filmMessageText = p.code(`movw ip,#${lo(NEW_ROLL_MESSAGE)};movt ip,#${hi(NEW_ROLL_MESSAGE)};ldrb r1,[ip];cmp r1,#0;movweq r1,#0x2be;beq back;
    ${redirect ? '' : 'mov r1,#0;strb r1,[ip];'}movw r1,#${text};back:b #${GR3X_MESSAGE_TEXT_SET};`);
  // redirect (T15-END2): the review screen that follows the last frame (Instant Review) covered the
  // message at once; while the message waits, the review's way back to the live view goes to the
  // message screen instead, and the message screen's own way back clears the byte (also cleared at
  // each exposure, GR3X_MESSAGE_CLEAR). The text no longer clears it.
  if (redirect) {
    if (p.sites.some(s => s.address === GR3X_SCREEN_SWITCH)) throw new FirmwareError('unexpected-instruction', 'IIIx film message: switch already patched');
    // guard (T15-END3, with a probe): while the message waits, the message screen goes back to the
    // live view only from its own 5 s timer (return address 0x531cdd80); every switch asked meanwhile
    // is logged (the last two: tag × 32 + id & 31, tag 1 review, 2 message, 3 other; and a count) for
    // the pictures' date.
    const log = probe ? `push {r0,r1,r2,r3};ldr r3,[r0];mov r2,#3;movw r0,#${lo(GR3X_REVIEW_VTABLE)};movt r0,#${hi(GR3X_REVIEW_VTABLE)};cmp r3,r0;moveq r2,#1;
      movw r0,#${lo(GR3X_MESSAGE_VTABLE)};movt r0,#${hi(GR3X_MESSAGE_VTABLE)};cmp r3,r0;moveq r2,#2;and r1,r1,#31;add r2,r1,r2,lsl #5;
      movw r0,#${lo(MESSAGE_LOG)};movt r0,#${hi(MESSAGE_LOG)};ldrb r1,[r0,#1];strb r1,[r0];strb r2,[r0,#1];ldrb r1,[r0,#2];cmp r1,#255;addlo r1,r1,#1;strb r1,[r0,#2];
      pop {r0,r1,r2,r3};` : '';
    const hold = guard ? `ldr r3,[r0];movw r2,#${lo(GR3X_MESSAGE_VTABLE)};movt r2,#${hi(GR3X_MESSAGE_VTABLE)};cmp r3,r2;bne free;
      movw r2,#${lo(GR3X_MESSAGE_TIMER_RETURN)};movt r2,#${hi(GR3X_MESSAGE_TIMER_RETURN)};cmp lr,r2;beq free;
      ${quick ? `movw r2,#${lo(GR3X_MESSAGE_OK_RETURN)};movt r2,#${hi(GR3X_MESSAGE_OK_RETURN)};cmp lr,r2;bne held;ldrb r2,[ip,#${MESSAGE_STAGE - NEW_ROLL_MESSAGE}];cmp r2,#2;beq free;held:` : ''}
      pop {r2,r3};mov r0,#0;bx lr;free:` : '';
    // check (T16-CLO1): with no message waiting, a way back to the live view first checks the roll
    // (filmRollCheck: the film or the format changed → the roll ends); it then goes to the message.
    // fromMenu (T16-CLO4): only a menu screen's way back (its id at + 0x124 in the 0x02 family).
    const menuOnly = fromMenu ? 'ldr r2,[r0,#0x124];mov r2,r2,lsr #24;cmp r2,#2;bne native;' : '';
    const closing = check ? `bne waiting;cmp r1,#0x8000000;bne native;${menuOnly}push {r0,r1,ip,lr};bl #${check};mov r2,r0;pop {r0,r1,ip,lr};cmp r2,#0;beq native;
      mov r2,#1;strb r2,[ip];mov r1,#${GR3X_MESSAGE_SCREEN & 0xff};movt r1,#${GR3X_MESSAGE_SCREEN >>> 16};b native;waiting:` : 'beq native;';
    entries.filmMessageSwitch = p.code(`push {r2,r3};movw ip,#${lo(NEW_ROLL_MESSAGE)};movt ip,#${hi(NEW_ROLL_MESSAGE)};ldrb r2,[ip];cmp r2,#0;${closing}${log}
      cmp r1,#0x8000000;bne native;${hold}ldr r3,[r0];
      movw r2,#${lo(GR3X_REVIEW_VTABLE)};movt r2,#${hi(GR3X_REVIEW_VTABLE)};cmp r3,r2;bne other;
      mov r1,#${GR3X_MESSAGE_SCREEN & 0xff};movt r1,#${GR3X_MESSAGE_SCREEN >>> 16};b native;
      other:movw r2,#${lo(GR3X_MESSAGE_VTABLE)};movt r2,#${hi(GR3X_MESSAGE_VTABLE)};cmp r3,r2;moveq r2,#0;strbeq r2,[ip];
      native:pop {r2,r3};mov ip,sp;b #${GR3X_SCREEN_SWITCH + 4};`);
    p.patch(GR3X_SCREEN_SWITCH, 0xe1a0c00d, branchWord(GR3X_SCREEN_SWITCH, entries.filmMessageSwitch), 'film roll: the review gives way to the waiting message');
  }
  // quick (T17-MSG1, with the guard): our message lasts 2 s instead of 5 and OK closes it after 0.5 s.
  // Its timer is first armed for 0.5 s (stage 1, the switches the screen asks by itself at its opening
  // stay held); when it fires, stage 2 and the timer again for 1.5 s; from then on the guard lets the
  // OK key's way back (the screen's event 0xd8, return address 0x531cddc0) through.
  if (quick) {
    if (!guard) throw new FirmwareError('unexpected-instruction', 'IIIx film message: quick needs the guard');
    const stage = `movw ip,#${lo(MESSAGE_STAGE)};movt ip,#${hi(MESSAGE_STAGE)};`;
    entries.filmMessageArm = p.code(`movw ip,#${lo(NEW_ROLL_MESSAGE)};movt ip,#${hi(NEW_ROLL_MESSAGE)};ldrb r1,[ip];cmp r1,#0;movweq r1,#${GR3X_MESSAGE_MS};beq arm;
      mov r1,#1;strb r1,[ip,#${MESSAGE_STAGE - NEW_ROLL_MESSAGE}];movw r1,#${GR3X_FILM_MESSAGE_GRACE_MS};arm:b #${GR3X_MESSAGE_TIMER_ARM + 4};`);
    p.patch(GR3X_MESSAGE_TIMER_ARM, 0xe3011388, branchWord(GR3X_MESSAGE_TIMER_ARM, entries.filmMessageArm), 'film roll: the message timer, first its grace (0.5 s)');
    entries.filmMessageFire = p.code(`${stage}ldrb r2,[ip];cmp r2,#1;bne native;ldr r2,[r0,#0x168];cmp r2,r1;bne native;mov r2,#2;strb r2,[ip];
      push {r4,lr};mov r4,r0;bl #${APP};bl #${GR3X_TIMER_QUEUE};movw r1,#${GR3X_FILM_MESSAGE_MS - GR3X_FILM_MESSAGE_GRACE_MS};add r2,r4,#0x158;
      bl #${GR3X_TIMER_START};str r0,[r4,#0x168];pop {r4,pc};
      native:mov ip,sp;b #${GR3X_MESSAGE_TIMER_FIRE + 4};`);
    p.patch(GR3X_MESSAGE_TIMER_FIRE, 0xe1a0c00d, branchWord(GR3X_MESSAGE_TIMER_FIRE, entries.filmMessageFire), 'film roll: the message timer, after its grace the rest (1.5 s)');
  }
  if (probe) entries.filmProbeTime = p.code(`movw r3,#${lo(POINTER)};movt r3,#${hi(POINTER)};ldr r3,[r3];cmp r3,#0;beq clock;
    movw ip,#${lo(MESSAGE_LOG)};movt ip,#${hi(MESSAGE_LOG)};
    ldrb r0,[ip,#1];mov r2,#0;hund:cmp r0,#100;subhs r0,r0,#100;addhs r2,r2,#1;bhs hund;
    add r0,r0,#2000;strb r0,[r1];mov r0,r0,lsr #8;strb r0,[r1,#1];add r2,r2,#1;strb r2,[r1,#3];
    ldrb r0,[ip,#2];cmp r0,#11;movhi r0,#11;add r0,r0,#1;strb r0,[r1,#2];
    ldrb r0,[ip];mov r2,#0;hour:cmp r0,#60;subhs r0,r0,#60;addhs r2,r2,#1;bhs hour;strb r2,[r1,#4];strb r0,[r1,#5];
    bx lr;
    clock:b #${GR3X_GET_TIME};`);
  p.patch(GR3X_MESSAGE_TEXT_AT, 0xe30012be, branchWord(GR3X_MESSAGE_TEXT_AT, entries.filmMessageText), 'film roll: « New roll loaded. » on the message screen');
  return entries;
}

/** T17-RWD1: the Rewind Film line's id (unused; GR Mod's lists use 0x020001a0..) and Create New
 * Folder's dialog (FolderCreateController, built by the factory for 0x02000128..0x0200012b). */
export const GR3X_FILM_REWIND_ID = 0x020001b1, GR3X_FOLDER_DIALOG_ID = 0x02000128;
/** The menu's ids (the factory builds the menu controller, slot + 0x74, for 0x0200004a..0x0200004d). */
export const GR3X_MENU_IDS = [0x0200004a, 0x0200004d] as const;
/** T17-RWD1: the dialog is the rewind's (1, set by the factory for the Rewind Film line) or Create
 * New Folder's (0); a byte, zero at start-up. */
export const GR3X_REWIND_MODE = KEY_LAST + 14;
/** FolderCreateController's sites (official 2.10): its start's card and storage checks (bl), its
 * question's text (movw r1,#0x2ab), its Execute's action (bl 0x5358515c), its end text (movw r1,#0x2bb). */
const DIALOG_CARD = 0x531e6558, DIALOG_CARD_FN = 0x53237460, DIALOG_STORAGE = 0x531e6568, DIALOG_STORAGE_FN = 0x531e64a8;
const DIALOG_QUESTION = 0x531e5ee8, DIALOG_ACTION = 0x531e65c8, DIALOG_ACTION_FN = 0x5358515c, DIALOG_DONE = 0x531e5f40;

/**
 * T17-RWD1: Create New Folder's dialog serves the Rewind Film line (Execute / Cancel, the camera's own
 * buttons). While the rewind byte is set: no card or storage check, our question (`question`), Execute
 * ends the roll (`action`, filmRollRewind) instead of asking for a new folder, then our end text
 * (`done`, « New roll loaded. ») for its 3 s. The byte is set by the factory (datestamp.ts).
 */
export function installGr3xFilmRewind(p: Gr3xRollProgram, question: number, done: number, action: number) {
  const entries: Record<string, number> = {};
  const mode = `movw ip,#${lo(GR3X_REWIND_MODE)};movt ip,#${hi(GR3X_REWIND_MODE)};ldrb ip,[ip];cmp ip,#0;`;
  for (const at of [DIALOG_CARD, DIALOG_STORAGE, DIALOG_QUESTION, DIALOG_ACTION, DIALOG_DONE])
    if (p.sites.some(s => s.address === at)) throw new FirmwareError('unexpected-instruction', 'IIIx film rewind: dialog already patched');
  entries.filmRewindCard = p.code(`${mode}movne r0,#1;bxne lr;b #${DIALOG_CARD_FN};`);
  p.patch(DIALOG_CARD, bl(DIALOG_CARD, DIALOG_CARD_FN), bl(DIALOG_CARD, entries.filmRewindCard), 'film rewind: no card check');
  entries.filmRewindStorage = p.code(`${mode}movne r0,#0;bxne lr;b #${DIALOG_STORAGE_FN};`);
  p.patch(DIALOG_STORAGE, bl(DIALOG_STORAGE, DIALOG_STORAGE_FN), bl(DIALOG_STORAGE, entries.filmRewindStorage), 'film rewind: no storage check');
  // The two texts are set where ip still holds the function's entry sp (the end text's `movw` comes
  // right after `mov ip,sp`, before the push): only r1, which they set anyway, is used.
  const text = (native: number, ours: number) => `movw r1,#${lo(GR3X_REWIND_MODE)};movt r1,#${hi(GR3X_REWIND_MODE)};ldrb r1,[r1];cmp r1,#0;
    movweq r1,#${native};movwne r1,#${ours};`;
  entries.filmRewindQuestion = p.code(`${text(0x2ab, question)}b #${DIALOG_QUESTION + 4};`);
  p.patch(DIALOG_QUESTION, 0xe30012ab, branchWord(DIALOG_QUESTION, entries.filmRewindQuestion), 'film rewind: the question');
  entries.filmRewindAction = p.code(`${mode}beq #${DIALOG_ACTION_FN};b #${action};`);
  p.patch(DIALOG_ACTION, bl(DIALOG_ACTION, DIALOG_ACTION_FN), bl(DIALOG_ACTION, entries.filmRewindAction), 'film rewind: Execute ends the roll');
  entries.filmRewindDone = p.code(`${text(0x2bb, done)}b #${DIALOG_DONE + 4};`);
  p.patch(DIALOG_DONE, 0xe30012bb, branchWord(DIALOG_DONE, entries.filmRewindDone), 'film rewind: the end text');
  return entries;
}

/** The menu controller (built once, factory slot + 0x74): its start 0x53199f04 restores each tab's
 * place (0x53199334), then sets the page's line count (`bl 0x53199eb0` at 0x53199f3c). The tab
 * builder 0x5319a778(menu) copies each tab's visible lines (at + 0x384 × tab: the page count + 0x290,
 * each page's first line + 0x2a8 + page, the line count + 0x2b3, the ids + 0x3e4 + 4 × line); each
 * tab's place: page (byte + 0x1b4 + 0xc × tab), list position (word + 0x1b8) and focused line (the
 * tab's line, halfword + 0x1bc). */
export const GR3X_MENU_START_LINES = 0x53199f3c, GR3X_MENU_LINES = 0x53199eb0, GR3X_MENU_BUILDER = 0x5319a778;

/**
 * T18-HIDE1: the menu's lines are built again at each opening of the menu, so each line's visibility
 * (Film Roll Mode and Rewind Film: a U mode) is asked each time, not only at the first opening after
 * power-on. The camera then sets the list from each tab's remembered place without any check: a page
 * beyond the tab's pages becomes the first, a focused line outside its page the page's first line
 * (list position 0).
 */
export function installGr3xMenuRebuild(p: Gr3xRollProgram) {
  if (p.sites.some(s => s.address === GR3X_MENU_START_LINES)) throw new FirmwareError('unexpected-instruction', 'IIIx menu rebuild: already patched');
  const entries: Record<string, number> = {};
  entries.menuRebuild = p.code(`push {r4,r5,r6,r7,r8,lr};mov r4,r0;bl #${GR3X_MENU_BUILDER};
    mov r5,#0;mov r0,r4;mov r1,r4;
    tab:ldrb r3,[r0,#0x290];ldrb r2,[r1,#0x1b4];cmp r2,r3;movhs r2,#0;strbhs r2,[r1,#0x1b4];
    add r6,r0,r2;ldrb r7,[r6,#0x2a8];add r2,r2,#1;cmp r2,r3;ldrblo r8,[r6,#0x2a9];ldrbhs r8,[r0,#0x2b3];
    add r6,r1,#0x1bc;ldrh r2,[r6];cmp r2,r7;blo top;cmp r2,r8;blo next;
    top:strh r7,[r6];mov r2,#0;str r2,[r1,#0x1b8];
    next:add r0,r0,#0x384;add r1,r1,#0xc;add r5,r5,#1;cmp r5,#5;bne tab;
    mov r0,r4;pop {r4,r5,r6,r7,r8,lr};b #${GR3X_MENU_LINES};`);
  p.patch(GR3X_MENU_START_LINES, bl(GR3X_MENU_START_LINES, GR3X_MENU_LINES), bl(GR3X_MENU_START_LINES, entries.menuRebuild), 'menu: lines built again at each opening, places kept within them');
  return entries;
}

/** The Movie Settings tab's descriptor: its first word is the tab's visibility (a method pointer, a
 * function returning 1 in the camera, 0x5319665c), asked at each tab change and at the menu's start. */
export const GR3X_MOVIE_TAB = 0x53b37514, GR3X_MOVIE_TAB_VISIBLE = 0x5319665c;

/** T21-TAB1: the Film Mode tab's title (and its page's), Film Roll Mode's names but « Film Mode » in
 * English (in `LANGS` order, as GR3X_FILM_ROLL_MODE_NAMES). */
export const GR3X_FILM_TAB_NAMES: readonly string[] = GR3X_FILM_ROLL_MODE_NAMES.map((n, k) => k === 2 ? 'Film Mode' : n);
/** T21-TAB1: the menu table's Movie Settings entry (RAM 0x55001ebc, initialised from 0x5407d404 - 8;
 * read only by the tab builder): it gets the Film Mode tab's descriptor. */
export const GR3X_MOVIE_ENTRY_IMAGE = 0x5407d3fc;

/** T20-VID1: the Movie Settings tab hidden (its visibility returns 0; the movie mode itself stays). */
export function installGr3xHideMovieTab(p: Gr3xRollProgram) {
  if (p.sites.some(s => s.address === GR3X_MOVIE_TAB)) throw new FirmwareError('unexpected-instruction', 'IIIx movie tab: already patched');
  const hidden = p.code('mov r0,#0;bx lr;');
  p.patch(GR3X_MOVIE_TAB, GR3X_MOVIE_TAB_VISIBLE, hidden, 'menu: the Movie Settings tab hidden');
  return { movieTabHidden: hidden };
}

/** The still / movie setter 0x5327b7cc(UserDataModel, value: 0 still, 1 movie): writes + 0x46 and
 * + 0x44 of every record, then notifies when the value changed. Its callers: the toggle action
 * (0x532261fc, value = (current == 0)), ApplyStillMovieForceProperty (0x5316dda8, 0x5316ddbc), 0x531b6938,
 * debug settings (0x532dcb40, 0x532dcb58). */
export const GR3X_STILL_MOVIE_SET = 0x5327b7cc;

/** T20-VID2: the movie mode blocked: every request for movie (1) becomes still (0); unchanged, the
 * camera notifies nothing (the movie key then does nothing). */
export function installGr3xBlockMovie(p: Gr3xRollProgram) {
  if (p.sites.some(s => s.address === GR3X_STILL_MOVIE_SET)) throw new FirmwareError('unexpected-instruction', 'IIIx movie block: already patched');
  const still = p.code(`cmp r1,#0;movne r1,#0;mov r3,r0;b #${GR3X_STILL_MOVIE_SET + 4};`);
  p.patch(GR3X_STILL_MOVIE_SET, 0xe1a03000, branchWord(GR3X_STILL_MOVIE_SET, still), 'movie: still / movie always still');
  return { movieBlocked: still };
}

/** The tab builder's call of a line's visibility (`bl 0x5319a720` at 0x5319a978): sl then points to
 * the line's id in the tab's descriptor. */
export const GR3X_LINE_VISIBLE_CALL = 0x5319a978, GR3X_LINE_VISIBLE = 0x5319a720;
/** T20-VID3: the lines hidden by id: Still Image Settings' (and Movie Settings') Still/Movie, Playback
 * Settings' Movie Edit. */
export const GR3X_HIDDEN_LINES = [0x0200006e, 0x04000033] as const;
/** The Fn functions' filter 0x531b9410(f) (1: listed; the button lists' constructor asks it for each
 * function of the table); T20-VID3 lists no Still/Movie (function 17). */
export const GR3X_FN_FILTER = 0x531b9410, GR3X_FN_STILL_MOVIE = 17;

/** T20-VID3: lines hidden by id (whatever the tab), and Fn functions taken out of the button lists. */
export function installGr3xHideLines(p: Gr3xRollProgram, ids: readonly number[], functions: readonly number[]) {
  if (p.sites.some(s => s.address === GR3X_LINE_VISIBLE_CALL || (functions.length && s.address === GR3X_FN_FILTER))) throw new FirmwareError('unexpected-instruction', 'IIIx hidden lines: already patched');
  const entries: Record<string, number> = {};
  entries.linesHidden = p.code(`ldr ip,[sl];${ids.map(id => `movw r3,#${lo(id)};movt r3,#${hi(id)};cmp ip,r3;beq hidden;`).join('')}
    b #${GR3X_LINE_VISIBLE};hidden:mov r0,#0;bx lr;`);
  p.patch(GR3X_LINE_VISIBLE_CALL, bl(GR3X_LINE_VISIBLE_CALL, GR3X_LINE_VISIBLE), bl(GR3X_LINE_VISIBLE_CALL, entries.linesHidden), 'menu: lines hidden by id');
  if (!functions.length) return entries;
  entries.fnHidden = p.code(`${functions.map(f => `cmp r0,#${f};moveq r0,#0;bxeq lr;`).join('')}cmp r0,#0x16;b #${GR3X_FN_FILTER + 4};`);
  p.patch(GR3X_FN_FILTER, 0xe3500016, branchWord(GR3X_FN_FILTER, entries.fnHidden), 'Fn: functions taken out of the button lists');
  return entries;
}

/** T20-VID4: the side button's names (texts 0x1c1 short, 0x1c2 long; hold: 0x1c3, 0x1c4) without the
 * movie, in the camera's text rows' order (ja en fr de es pt it nl da sv fi pl cs hu tr el ru ko zh-TW
 * zh-CN th): each a part of the camera's own name in that language. */
export const GR3X_SIDE_BUTTON_TEXTS = [0x1c1, 0x1c2, 0x1c3, 0x1c4] as const;
export const GR3X_SIDE_BUTTON_NAMES: readonly (readonly [string, string, string, string])[] = [
  ['無線ボタン', '無線ボタン', '無線ボタン長押し', '無線ボタン長押し'],
  ['Wireless Button', 'Wireless Button', 'Hold Wireless Btn.', 'Hold Wireless Button'],
  ['Touche sans fil', 'Touche liaison sans fil', 'Maint. tche sans fil', 'Maintenir touche liaison sans fil'],
  ['Drahtlostaste', 'Drahtlostaste', 'Drahtlostaste halten', 'Drahtlostaste halten'],
  ['Botón inalámbrico', 'Botón inalámbrico', 'Botón Mant. inalám.', 'Botón Mantener inalámbrico'],
  ['Botão Sem Fios', 'Botão Sem Fios', 'Botão Manter Sem Fios', 'Botão Manter Sem Fios'],
  ['Puls. Wireless', 'Pulsante Wireless', 'Mant. Wireless', 'Pressione prolungata pulsante Wireless'],
  ['Knop draadloos', 'Knop draadloos', 'Draadl. indrukken', 'Knop draadloos ingedrukt houden'],
  ['Trådløs knap', 'Trådløs knap', 'Hold Trådløs knap', 'Hold Trådløs knap'],
  ['Wi-Fi-knapp', 'Wi-Fi-knapp', 'Håll Wi-Fi', 'Tryck ner Wi-Fi-knapp'],
  ['Langaton painike', 'Langaton painike', 'Pito lan:tonpnk', 'Pito langaton painike'],
  ['Przycisk bezprz', 'Przycisk bezprz', 'Prz wstrz bezprz', 'Prz wstrz bezprz'],
  ['Tlačítko bezdr.', 'Tlačítko bezdrátové', 'Tl. podr. bezd.', 'Tlačítko podržet bezdrátové'],
  ['Veze. n. gomb', 'Vezeték nélküli gomb', 'Tartás v. n. gomb', 'Tartás vezeték nélküli gomb'],
  ['Kablosuz Düğmesi', 'Kablosuz Düğmesi', 'Tut Kablsz Düğ.', 'Tut Kablosuz Düğmesi'],
  ['Κουμπί Ασύρμ.', 'Κουμπί Ασύρματου', 'Κουμπί αναμ. Ασύρμ.', 'Κουμπί αναμονής Ασύρμ.'],
  ['Кн. беспр.св.', 'Кнопка беспроводной связи', 'Кн.удерж. б.св.', 'Кнопка удержания беспр. связи'],
  ['무선 버튼', '무선 버튼', '무선버튼 긴누름', '무선버튼 긴누름'],
  ['無線按鈕', '無線按鈕', '長按無線按鈕', '長按無線按鈕'],
  ['无线按钮', '无线按钮', '长按无线按钮', '长按无线按钮'],
  ['ปุ่มไร้สาย', 'ปุ่มไร้สาย', 'กดปุ่มไร้สายค้าง', 'กดปุ่มไร้สายค้าง'],
];
/** T20-VID4: the Fn function Framerate (16), movie only, also taken out of the button lists. */
export const GR3X_FN_FRAMERATE = 16;

/** A new file's name prefix (4 characters; the camera then writes "%s%04d.%s" with the number's last
 * four digits, 0x535b87f0): the naming method 0x535b6b28(this, type, ...) gives 0x535850a0 (the File
 * Name setting's 2 characters + the counter's top 2 digits, "%s%02d", buffer 0x553497f8) or, for types 6
 * and 7 (Adobe RGB, "_" first), 0x53584ff4 (buffer 0x55349800). */
export const GR3X_FILE_PREFIX = 0x535b6b28, GR3X_FILE_PREFIX_BUFFER = 0x553497f8;
/** T22-NAME2: the camera's Image Controls' 4-letter file codes (the folders keep GR3X_LOOK_CODES). */
export const GR3X_LOOK_FILE_CODES: Readonly<Record<number, string>> = {
  11: 'STND', 12: 'VIVD', 13: 'MONO', 14: 'SMON', 15: 'HMON', 16: 'HCBW', 17: 'POSF', 18: 'BLBP', 19: 'RETR', 20: 'HDRT', 21: 'XPRO', 22: 'NEGF',
};
export const GR3X_UNKNOWN_LOOK_FILE_CODE = 'FILM';

/** T22-NAME1: in a U mode with Film Roll Mode on, a new file's prefix is the film's code and "_"
 * (NEG_6857.JPG): the record in use's look (as the roll's folder name), FLM for an unknown one. */
export function installGr3xFilmFileNames(p: Gr3xRollProgram, four = false, filmCodes: Readonly<Record<number, string>> = {}) {
  if (p.sites.some(s => s.address === GR3X_FILE_PREFIX)) throw new FirmwareError('unexpected-instruction', 'IIIx file names: already patched');
  // four: (T22-NAME2) the film's 4-letter file code (NEGF6857.JPG) instead of its 3 letters and "_".
  const word4 = (c: string) => `movw r3,#${c.charCodeAt(0) | c.charCodeAt(1) << 8};movt r3,#${c.charCodeAt(2) | c.charCodeAt(3) << 8};`;
  const codes = four
    ? Object.entries({ ...GR3X_LOOK_FILE_CODES, ...filmCodes }).map(([look, code]) => `cmp r0,#${look};bne n${look};${word4(code)}b code;n${look}:`).join('')
    : Object.entries(GR3X_LOOK_CODES).map(([look, code]) =>
      `cmp r0,#${look};movweq r3,#${code.charCodeAt(0) | code.charCodeAt(1) << 8};movteq r3,#${code.charCodeAt(2) | 0x5f << 8};beq code;`).join('');
  const u = four ? GR3X_UNKNOWN_LOOK_FILE_CODE : GR3X_UNKNOWN_LOOK_CODE + '_';
  const prefix = p.code(`push {r0,r1,r2,r3,r4,lr};${records('native', true)}
    ldrb r0,[r2,#${GR3X_LOOK}];${codes}${word4(u)}
    code:movw r4,#${lo(GR3X_FILE_PREFIX_BUFFER)};movt r4,#${hi(GR3X_FILE_PREFIX_BUFFER)};
    str r3,[r4];mov r3,#0;strb r3,[r4,#4];
    mov ip,r4;pop {r0,r1,r2,r3,r4,lr};mov r0,ip;bx lr;
    native:pop {r0,r1,r2,r3,r4,lr};mov ip,sp;b #${GR3X_FILE_PREFIX + 4};`);
  p.patch(GR3X_FILE_PREFIX, 0xe1a0c00d, branchWord(GR3X_FILE_PREFIX, prefix), 'film mode: the files\' prefix is the film\'s code');
  return { filmFilePrefix: prefix };
}

/** Mode Memory (0x5324075c, the end of the merge with the factory values 0x53246df8, for the free
 * modes' records at loading): with its Focus box unticked (+ 0xaf2 of the record in use 0), the focus
 * modes go back to the factory's (+ 0x11c, + 0x11e, + 0x4fc, + 0x4fe; r3 the factory record, r4 the
 * record loaded), the last of them at 0x53240870 (`strh lr,[r4,r1]`); the AF area's place
 * (StillFocusAreaCenter, 8 bytes at + 0x120) is always kept. */
export const GR3X_MEMORY_FOCUS_END = 0x53240870, GR3X_AF_AREA_CENTER = 0x120;

/** T24-AF1: with Mode Memory's Focus unticked, the AF point also goes back to the factory's (the
 * centre) at power-on, as GR IV can. */
export function installGr3xAfReset(p: Gr3xRollProgram) {
  if (p.sites.some(s => s.address === GR3X_MEMORY_FOCUS_END)) throw new FirmwareError('unexpected-instruction', 'IIIx AF reset: already patched');
  const reset = p.code(`add ip,r4,r1;strh lr,[ip];add ip,r3,#${GR3X_AF_AREA_CENTER};ldr r0,[ip];ldr r1,[ip,#4];add ip,r4,#${GR3X_AF_AREA_CENTER};str r0,[ip];str r1,[ip,#4];b #${GR3X_MEMORY_FOCUS_END + 4};`);
  p.patch(GR3X_MEMORY_FOCUS_END, 0xe184e0b1, branchWord(GR3X_MEMORY_FOCUS_END, reset), 'Mode Memory: Focus unticked resets the AF point too');
  return { afReset: reset };
}

/** Mode Memory's items (ModeMemoryController): 24 records of 0x28 bytes at 0x53b4d550 { number, text,
 * draw (this, row: the tick, icon 0x10f / 0x10e), toggle (this: its state byte and the row drawn again),
 * write (this: the setting), visible? } copied into the screen's list by 0x53207348 (movw / movt r4 at
 * 0x53207350 / 0x53207354, end `add r5,r4,#0x3c0` at 0x53207364); the states are read at the screen's
 * start, which ends with `b 0x53206a30` (the list filled) at 0x532071f8. Row drawing: 0x53394758(list,
 * row) then 0x533a8990(row, icon). */
export const GR3X_MEMORY_ITEMS = 0x53b4d550, GR3X_MEMORY_ITEM_COUNT = 24, GR3X_MEMORY_FOCUS_ITEM = 2;
const MEMORY_COPY_LOW = 0x53207350, MEMORY_COPY_HIGH = 0x53207354, MEMORY_COPY_END = 0x53207364, MEMORY_START_END = 0x532071f8, MEMORY_FILL = 0x53206a30;
const LIST_ROW = 0x53394758, ROW_ICON = 0x533a8990, TICK_ON = 0x10f, TICK_OFF = 0x10e;
/** Mode Memory's merge, after the Focus box (0x53240874: `ldr r2,[fp,#-0x30]`, the record in use;
 * r3 the factory record, r4 the record loaded). */
const MEMORY_AFTER_FOCUS = 0x53240874;
/** T24-AF2: the AF Point box's setting: padding byte 0x905 of every record (0 kept, the default;
 * 1 the AF point back to the centre at power-on; the record in use and the seven stored ones), and its state while the screen is open (a RAM byte,
 * zero at start-up, the key probe's area; 1 ticked). */
export const GR3X_AF_POINT_SETTING = 0x905;
const AF_POINT_STATE = KEY_LAST + 0x2c, AF_POINT_ITEM = 24;
/** « AF Point » in `LANGS` order: the AF point part of the camera's own « AF Point+Focus » (0x211). */
export const GR3X_AF_POINT_NAMES: readonly string[] = [
  'Bod AF', 'AF-punkt', 'AF Point', 'AF-piste', 'Point AF', 'AF-Punkt', 'Σημείο AF', 'AF-pont', 'Punto AF', '測距点', '측거점',
  'AF-punt', 'Punkt AF', 'Ponto AF', 'Точка АФ', '对焦点', 'Punto AF', 'AF-punkt', 'จุด AF', '對焦點', 'AF Nokta',
];

/** V1-RC2: the « Apply to U modes » box's setting: padding byte 0x943 of every record (0 the camera's
 * way, the default: Mode Memory applies to the free modes only; 1 also at power-on in U1 to U3, to the
 * record in use only), no exact access by the firmware (a word read at + 0x940 by a debug dump), copied
 * at a recall; its state while the screen is open: a RAM byte (zero at start-up, 1 ticked). */
export const GR3X_MEMORY_U_SETTING = 0x943;
const MEMORY_U_STATE = KEY_LAST + 0x2d, MEMORY_U_ITEM = 25;
/** « Apply to U modes » in `LANGS` order; every character is in the camera's texts of that language. */
export const GR3X_MEMORY_U_NAMES: readonly string[] = [
  'Použít v U', 'Anvend i U', 'Apply to U modes', 'Käytä U-tiloissa', 'Appliquer en U', 'In U anwenden', 'Εφαρμογή σε U',
  'Alkalmazás U-ban', 'Applica in U', 'Uにも適用', 'U에도 적용', 'Toepassen in U', 'Zastosuj w U', 'Aplicar em U', 'Применять в U',
  '在U中应用', 'Aplicar en U', 'Använd i U', 'ใช้กับ U', '在U中應用', "U'da uygula",
];
/** The settings merge (0x53246df8; r6 UserDataModel, r4 the record merged, r7 the mode: the record in
 * use at power-on with the active mode, each stored copy with its index) chooses at 0x5324b154
 * (`cmp r7,#0`): mode 0, Mode Memory (0x5324075c, at 0x5324b168); else the BOXes' short merge
 * (0x532419cc, at 0x5324b15c). */
const MERGE_CHOICE = 0x5324b154, MERGE_MEMORY = 0x5324b168, MERGE_BOX = 0x5324b15c, MERGE_MEMORY_FN = 0x5324075c;
/** Mode Memory's Drive, Aspect Ratio and Image Control boxes (AfterReleaseModeMemoryDrive,
 * ...AspectRatio, ...ImageControl: 1 memorized), left out in a film BOX (V1-RC5). */
export const GR3X_MEMORY_FILM_KEPT = [0xb04, 0xb0a, 0xb0e] as const;
/** Mode Memory's Still/Movie item (text 0x5f), hidden with the movie taken out. */
export const GR3X_MEMORY_STILL_MOVIE_ITEM = 8;
/** The screen's list set-up (0x532067dc, called at 0x532074e8): one view type byte per row (0x2a),
 * from a stack array of 24 bytes, given to the list 0x53394610(list, types, rows, 0x3a); an unknown type
 * (past the array: the stack guard's bytes) stops the camera on an assertion (0x533ade50). */
const MEMORY_LIST_CALL = 0x532074e8, MEMORY_LIST_SETUP = 0x532067dc, LIST_TYPES = 0x53394610, MEMORY_ROWS_MAX = 32;
const blWord = (at: number, to: number) => (0xeb000000 | (((to - at - 8) >> 2) & 0xffffff)) >>> 0;

/**
 * T24-AF2: an « AF Point » box in Mode Memory, after Focus. Ticked (the default), the AF point is kept
 * as the camera does; unticked, at power-on (where Mode Memory applies) the AF point goes back to the
 * factory's, the centre (StillFocusAreaCenter, 8 bytes at + 0x120); the focus mode keeps following the
 * Focus box. With `uText` (V1-RC2), an « Apply to U modes » box last: ticked, Mode Memory also applies at
 * power-on in U1 to U3, to the record in use (the BOXes saved are never changed).
 */
export function installGr3xAfPointMemory(p: Gr3xRollProgram & { read(at: number, n: number): Uint8Array; append(b: Uint8Array): number }, text: number, uText?: number,
  o: { film?: boolean; filmRecall?: number; hideStillMovie?: boolean } = {}) {
  const withU = uText !== undefined;
  for (const at of [MEMORY_COPY_LOW, MEMORY_COPY_HIGH, MEMORY_COPY_END, MEMORY_START_END, MEMORY_AFTER_FOCUS, ...(withU ? [MERGE_CHOICE] : [])])
    if (p.sites.some(s => s.address === at)) throw new FirmwareError('unexpected-instruction', 'IIIx Mode Memory boxes: already patched');
  if (p.sites.some(s => s.address === MEMORY_LIST_CALL)) throw new FirmwareError('unexpected-instruction', 'IIIx Mode Memory list: already patched');
  const entries: Record<string, number> = {};
  // The list's set-up with a view type (0x2a) for every row, up to 32 (the camera's array has 24).
  entries.memoryListSetup = p.code(`push {r4,lr};sub sp,sp,#${MEMORY_ROWS_MAX};mov r2,#0x2a;mov r3,#0;
    fill:strb r2,[sp,r3];add r3,r3,#1;cmp r3,#${MEMORY_ROWS_MAX};blo fill;
    ldr r3,[r0,#0x16c];ldr r2,[r0,#0x168];sub r2,r3,r2;mov r2,r2,asr #3;movw ip,#0xcccd;movt ip,#0xcccc;mul r2,ip,r2;
    and r2,r2,#0xff;cmp r2,#${MEMORY_ROWS_MAX};movhi r2,#${MEMORY_ROWS_MAX};
    ldr r0,[r0,#0x164];mov r1,sp;mov r3,#0x3a;bl #${LIST_TYPES};add sp,sp,#${MEMORY_ROWS_MAX};pop {r4,pc};`);
  p.patch(MEMORY_LIST_CALL, blWord(MEMORY_LIST_CALL, MEMORY_LIST_SETUP), blWord(MEMORY_LIST_CALL, entries.memoryListSetup), 'Mode Memory: a view type for every row (the camera\'s array has 24)');
  // One box: its state byte (1 ticked), its item number, its setting; `inverted`: ticked is setting 0.
  const box = (name: string, state: number, item: number, setting: number, inverted: boolean) => {
    const st = `movw ip,#${lo(state)};movt ip,#${hi(state)};`;
    const tick = `ldrb ip,[ip];cmp ip,#0;movwne r1,#${TICK_ON};movweq r1,#${TICK_OFF};`;
    entries[`${name}Draw`] = p.code(`${st}mov r0,r1;${tick}b #${ROW_ICON};`);
    entries[`${name}Toggle`] = p.code(`push {r4,lr};mov r4,r0;${st}ldrb r3,[ip];eor r3,r3,#1;strb r3,[ip];
      ldr r2,[r4,#0x168];ldr ip,[r4,#0x16c];mov r1,#0;
      find:cmp r2,ip;bhs none;ldrb r3,[r2];cmp r3,#${item};beq found;add r2,r2,#0x28;add r1,r1,#1;b find;
      none:mov r1,#0;
      found:ldr r0,[r4,#0x164];bl #${LIST_ROW};${st}${tick}pop {r4,lr};b #${ROW_ICON};`);
    // The setting into the record in use and the seven stored copies (0..6; not the factory record).
    entries[`${name}Write`] = p.code(`${st}ldrb r1,[ip];${inverted ? 'eor r1,r1,#1;' : ''}and r1,r1,#1;
      movw r2,#${lo(POINTER)};movt r2,#${hi(POINTER)};ldr r3,[r2];${ram('r3', 'w0')}strb r1,[r3,#${setting}];w0:
      mov r0,#0;wl:movw r2,#${lo(STORED)};movt r2,#${hi(STORED)};ldr r3,[r2,r0,lsl #2];${ram('r3', 'wn')}strb r1,[r3,#${setting}];
      wn:add r0,r0,#1;cmp r0,#6;bls wl;bx lr;`);
    // Its state at the screen's start, from the record in use (r3; r1, r2 free).
    return (tag: string) => inverted
      ? `mov r1,#1;${ram('r3', `r${tag}`)}ldrb r2,[r3,#${setting}];cmp r2,#1;moveq r1,#0;r${tag}:${st}strb r1,[ip];`
      : `mov r1,#0;${ram('r3', `r${tag}`)}ldrb r2,[r3,#${setting}];cmp r2,#1;moveq r1,#1;r${tag}:${st}strb r1,[ip];`;
  };
  const readAf = box('afPoint', AF_POINT_STATE, AF_POINT_ITEM, GR3X_AF_POINT_SETTING, true);
  const readU = withU ? box('memoryU', MEMORY_U_STATE, MEMORY_U_ITEM, GR3X_MEMORY_U_SETTING, false) : undefined;
  entries.afPointRead = p.code(`movw r2,#${lo(POINTER)};movt r2,#${hi(POINTER)};ldr r3,[r2];${readAf('a')}${readU ? readU('u') : ''}b #${MEMORY_FILL};`);
  p.patch(MEMORY_START_END, branchWord(MEMORY_START_END, MEMORY_FILL), branchWord(MEMORY_START_END, entries.afPointRead), 'Mode Memory: our boxes read at the screen\'s start');
  // The items: the camera's 24 with AF Point after Focus, Apply to U modes last.
  const items = p.read(GR3X_MEMORY_ITEMS, GR3X_MEMORY_ITEM_COUNT * 0x28);
  const iv = new DataView(items.buffer, items.byteOffset, items.byteLength);
  for (let k = 0; k < GR3X_MEMORY_ITEM_COUNT; k++) if (iv.getUint32(k * 0x28, true) !== k) throw new FirmwareError('unexpected-layout', 'IIIx Mode Memory items');
  if (iv.getUint32(GR3X_MEMORY_FOCUS_ITEM * 0x28 + 4, true) !== 0x2a) throw new FirmwareError('unexpected-layout', 'IIIx Mode Memory Focus item');
  // V1-RC4: with the movie taken out, Mode Memory's Still/Movie item hidden (its visibility method).
  if (o.hideStillMovie) {
    if (iv.getUint32(GR3X_MEMORY_STILL_MOVIE_ITEM * 0x28 + 4, true) !== 0x5f || iv.getUint32(GR3X_MEMORY_STILL_MOVIE_ITEM * 0x28 + 0x20, true) !== 0)
      throw new FirmwareError('unexpected-layout', 'IIIx Mode Memory Still/Movie item');
    entries.memoryHidden = p.code('mov r0,#0;bx lr;');
    iv.setUint32(GR3X_MEMORY_STILL_MOVIE_ITEM * 0x28 + 0x20, entries.memoryHidden, true);
    iv.setUint32(GR3X_MEMORY_STILL_MOVIE_ITEM * 0x28 + 0x24, 0, true);
  }
  const item = (n: number, t: number, name: string) => {
    const b = new Uint8Array(0x28), v = new DataView(b.buffer);
    v.setUint32(0, n, true); v.setUint32(4, t, true);
    v.setUint32(8, entries[`${name}Draw`], true); v.setUint32(0x10, entries[`${name}Toggle`], true); v.setUint32(0x18, entries[`${name}Write`], true);
    return b;
  };
  const at = (GR3X_MEMORY_FOCUS_ITEM + 1) * 0x28, count = GR3X_MEMORY_ITEM_COUNT + (withU ? 2 : 1);
  const table = p.append(new Uint8Array([...items.subarray(0, at), ...item(AF_POINT_ITEM, text, 'afPoint'), ...items.subarray(at),
    ...(withU ? item(MEMORY_U_ITEM, uText!, 'memoryU') : [])]));
  entries.afPointItems = table;
  p.patch(MEMORY_COPY_LOW, movWord(4, lo(GR3X_MEMORY_ITEMS)), movWord(4, lo(table)), `Mode Memory: ${count} items (low half)`);
  p.patch(MEMORY_COPY_HIGH, movWord(4, hi(GR3X_MEMORY_ITEMS), true), movWord(4, hi(table), true), `Mode Memory: ${count} items (high half)`);
  // `add r5,r4,#count * 0x28`: 25 items 0x3e8 (0xfa ror 30), 26 items 0x410 (0x41 ror 28).
  p.patch(MEMORY_COPY_END, 0xe2845d0f, withU ? 0xe2845e41 : 0xe2845ffa, `Mode Memory: ${count} items (end: + 0x${(count * 0x28).toString(16)})`);
  // Power-on, where Mode Memory applies: the AF point back to the factory's when the box is unticked.
  entries.afPointReset = p.code(`ldr r2,[fp,#-0x30];ldrb ip,[r2,#${GR3X_AF_POINT_SETTING}];cmp ip,#1;bne kept;
    add ip,r3,#${GR3X_AF_AREA_CENTER};ldr r0,[ip];ldr r1,[ip,#4];add ip,r4,#${GR3X_AF_AREA_CENTER};str r0,[ip];str r1,[ip,#4];
    kept:b #${MEMORY_AFTER_FOCUS + 4};`);
  p.patch(MEMORY_AFTER_FOCUS, 0xe51b2030, branchWord(MEMORY_AFTER_FOCUS, entries.afPointReset), 'Mode Memory: AF Point unticked, the AF point to the centre');
  if (withU) {
    // The film mode's drive (multi-exposure) and Save Interim Images (Off) again on the record r4 when its
    // Film Roll Mode is on: Mode Memory may have put them back to the factory's (V1-RC4).
    const reforce = o.film ? `ldrb ip,[r4,#${GR3X_ROLL_FLAGS}];tst ip,#${GR3X_FILM_ON};beq rf;mov ip,#0;strb ip,[r4,#${GR3X_INTERIM}];
      mov ip,#${GR3X_DRIVE_MULTI};strb ip,[r4,#${GR3X_DRIVE}];rf:` : '';
    // V1-RC5: in a BOX with Film Roll Mode on, Mode Memory leaves the roll's film, format and drive alone:
    // its Image Control, Aspect Ratio and Drive boxes (flags of the record in use r4) ticked during the call,
    // then put back (kept in register `k`, bit 24 set when saved).
    const keep = (k: string, t: string) => o.film ? `mov ${k},#0;ldrb ip,[r4,#${GR3X_ROLL_FLAGS}];tst ip,#${GR3X_FILM_ON};beq k${t};
      ldrb ${k},[r4,#${GR3X_MEMORY_FILM_KEPT[0]}];ldrb ip,[r4,#${GR3X_MEMORY_FILM_KEPT[1]}];orr ${k},${k},ip,lsl #8;ldrb ip,[r4,#${GR3X_MEMORY_FILM_KEPT[2]}];orr ${k},${k},ip,lsl #16;orr ${k},${k},#0x1000000;
      mov ip,#1;strb ip,[r4,#${GR3X_MEMORY_FILM_KEPT[0]}];strb ip,[r4,#${GR3X_MEMORY_FILM_KEPT[1]}];strb ip,[r4,#${GR3X_MEMORY_FILM_KEPT[2]}];k${t}:` : '';
    const back = (k: string, t: string) => o.film ? `tst ${k},#0x1000000;beq b${t};strb ${k},[r4,#${GR3X_MEMORY_FILM_KEPT[0]}];mov ip,${k},lsr #8;strb ip,[r4,#${GR3X_MEMORY_FILM_KEPT[1]}];
      mov ip,${k},lsr #16;strb ip,[r4,#${GR3X_MEMORY_FILM_KEPT[2]}];b${t}:` : '';
    // The merge's own way out (`sub sp,fp,#0x1c; ldm sp,{r4-r7,fp,sp,pc}`), as raw words (no ldm in our code).
    entries.memoryMergeReturn = p.append(new Uint8Array(new Uint32Array([0xe24bd01c, 0xe89da8f0]).buffer));
    // The merge's choice: Mode Memory also for a U mode (1..6) when the record merged is the record in use
    // and its « Apply to U modes » is 1, called (r0 UserDataModel, r1 the record) so that the film mode is
    // forced again after it; flags and r0..r3 untouched by the camera after this point.
    entries.memoryUMerge = p.code(`cmp r7,#0;beq mm;cmp r7,#6;bhi box;ldr ip,[r6,#4];cmp ip,r4;bne box;
      ldrb ip,[ip,#${GR3X_MEMORY_U_SETTING}];cmp ip,#1;bne box;
      ${keep('r5', 'p')}mov r0,r6;mov r1,r4;bl #${MERGE_MEMORY_FN};${back('r5', 'p')}${reforce}b #${entries.memoryMergeReturn};
      mm:b #${MERGE_MEMORY};box:b #${MERGE_BOX};`);
    // A U mode's recall (the settings guard's hook, after the BOX was copied into the record in use and
    // fixed: r0 the record, r1 the mode): Mode Memory too when « Apply to U modes » is 1, then the film
    // mode's own recall (which forces its drive again).
    entries.memoryURecall = p.code(`push {r4,r5,r6,lr};mov r4,r0;mov r5,r1;sub r2,r1,#1;cmp r2,#5;bhi done;${ram('r4', 'done')}
      ldrb r2,[r4,#${GR3X_MEMORY_U_SETTING}];cmp r2,#1;bne done;movw r0,#${lo(MODEL)};movt r0,#${hi(MODEL)};ldr r2,[r0,#4];cmp r2,r4;bne done;
      ${keep('r6', 'r')}movw r0,#${lo(MODEL)};movt r0,#${hi(MODEL)};mov r1,r4;bl #${MERGE_MEMORY_FN};${back('r6', 'r')}
      done:mov r0,r4;mov r1,r5;pop {r4,r5,r6,lr};${o.filmRecall ? `b #${o.filmRecall};` : 'bx lr;'}`);
    p.patch(MERGE_CHOICE, 0xe3570000, branchWord(MERGE_CHOICE, entries.memoryUMerge), 'Mode Memory: also in U modes at power-on when Apply to U modes is ticked');
  }
  return entries;
}

/** The tables of methods of QuickViewController (the review) and of the message screens. */
export const GR3X_REVIEW_VTABLE = 0x53b41380, GR3X_MESSAGE_VTABLE = 0x53b41ca8;
/** T15-END2: the message byte cleared at each exposure (every register kept but ip). */
export const GR3X_MESSAGE_CLEAR = `push {r0};movw ip,#${lo(NEW_ROLL_MESSAGE)};movt ip,#${hi(NEW_ROLL_MESSAGE)};mov r0,#0;strb r0,[ip];pop {r0};`;

/** The message screen's own timer, back to the live view: return address of its switch call. */
export const GR3X_MESSAGE_TIMER_RETURN = 0x531cdd80;
/** The message screen's OK key (event 0xd8 at 0x531cdd94), back to the live view: return address. */
export const GR3X_MESSAGE_OK_RETURN = 0x531cddc0;
/** The message screen's timer: armed at 0x531ce2d0 (`movw r1,#0x1388`, 5000 ms; 0x5322b468(service,
 * ms, this + 0x158), the id kept at + 0x168), fired at 0x531cdd58 (this, id). */
export const GR3X_MESSAGE_TIMER_ARM = 0x531ce2d0, GR3X_MESSAGE_TIMER_FIRE = 0x531cdd58, GR3X_MESSAGE_MS = 5000;
/** T17-MSG1: our message's length, and its first part during which OK is held. */
export const GR3X_FILM_MESSAGE_MS = 2000, GR3X_FILM_MESSAGE_GRACE_MS = 500;
/** T17-MSG1: the message timer's stage (1 grace, 2 OK closes; a byte, zero at start-up). */
const MESSAGE_STAGE = KEY_LAST + 13;
/** T15-END3: the switch log (bytes: previous, last, count; zero at start-up, the key probe's area). */
const MESSAGE_LOG = KEY_LAST + 16;

/** T16-CLO1: the roll's film (look) and format (ratio), noted at its start: two padding bytes of the
 * record (no exact access by the firmware; one word read at + 0x9c0 by a debug dump, 0x537381d4). */
export const GR3X_ROLL_LOOK = 0x9c2, GR3X_ROLL_RATIO = 0x9c3;
