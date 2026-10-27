// SPDX-License-Identifier: GPL-2.0-only
/**
 * GR III 2.10 / IIIx 1.60, film mode phase 3.1: the roll's state and its frame counter
 * (CAHIER_DES_CHARGES.md, docs/film-mode-notes.md). Test builds only for now: the film mode's menu
 * line comes in phase 4, so here every BOX recalled by U1..U3 is in film mode (mode byte 1..6).
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
 *  - the remaining-shots counter on the screen (0x532aa1f4, tested): the frame to take in a U mode
 *    (1 before the roll starts), the count elsewhere;
 *  - Save Settings into BOX n (0x5324b760(object, n), memcpy of the record in use then the merge):
 *    then BOX n's roll is ended (bit 1 and the frame cleared), and the record in use's too when n is
 *    the active mode: saving over a started roll rewinds it;
 *  - the mode recall (through the settings guard's recall hook, guard.ts): recalling U1..U3 sets
 *    Save Interim Images (+0x482, StillMultiExposureSaveProcess) to Off (0) in the record in use,
 *    before the record goes to the live values. With interim images the camera puts the sequence in
 *    a folder of its own (tested), which a roll's folder must not get.
 */
import { branchWord } from '../aspect/arm';
import { FirmwareError } from '../types';
import type { Gr3xSite } from './round10';
import type { Gr3xMenuRatio } from './geometry';

export const GR3X_ROLL_FLAGS = 0x9b1, GR3X_ROLL_FRAME = 0x9b2, GR3X_ROLL_FOLDER = 0x9b3;
export const GR3X_ROLL_STARTED = 2;
/** Save Interim Images (0 Off, 1 Unblended, 2 Blended, 3 Unblended + Blended). */
export const GR3X_INTERIM = 0x482;
export const GR3X_RATIO = 0x4c2;
/** The shooting model's end, the screen counter, Save Settings into a BOX. */
export const GR3X_ROLL_MODEL_END = 0x5323a080, GR3X_ROLL_COUNTER = 0x532aa1f4, GR3X_BOX_SAVE = 0x5324b760;
/** The settings storage (0x53828014() + 8) and its write (store, file index, size, data). */
export const GR3X_APP_DATA = 0x53828014, GR3X_APP_DATA_WRITE = 0x53826c54;
const MODEL = 0x55063f30, POINTER = MODEL + 4, STORED = MODEL + 8, RECORD = 0xb26;
const SINGLETON = 0x553458b0;

/** Frames of a roll by ratio (CAHIER_DES_CHARGES.md); 36 for any other. */
export const GR3X_ROLL_LENGTHS: Record<string, number> = { '3:2': 36, '3:4': 72, '65:24': 21, '4:3': 15, '1:1': 12 };

const lo = (v: number) => v & 0xffff, hi = (v: number) => v >>> 16;
const ram = (r: string, label: string) => `cmp ${r},#0x40000000;blo ${label};cmp ${r},#0xc0000000;bhs ${label};tst ${r},#3;bne ${label};`;
/** r1 = mode 1..6 (else to `label`), r2 = record in use, r3 = the BOX's stored record (r0 free). */
const records = (label: string) => `movw r0,#${lo(MODEL)};movt r0,#${hi(MODEL)};ldr r1,[r0];${ram('r1', label)}ldrb r1,[r1];
  cmp r1,#0;beq ${label};cmp r1,#6;bhi ${label};ldr r2,[r0,#4];${ram('r2', label)}add r3,r0,#8;ldr r3,[r3,r1,lsl #2];${ram('r3', label)}`;

export interface Gr3xRollProgram {
  code(source: string): number;
  sites: Gr3xSite[];
  patch(address: number, expected: number, replacement: number, reason: string): void;
}

export function installGr3xFilmRoll(p: Gr3xRollProgram, menu: readonly Gr3xMenuRatio[]) {
  const free = (at: number) => { if (p.sites.some(s => s.address === at)) throw new FirmwareError('unexpected-instruction', `IIIx film roll: ${at.toString(16)} already patched`); };
  const entries: Record<string, number> = {};
  // The roll's length from the ratio identity in r0 (r0 = length).
  const lengths = menu.filter(r => (GR3X_ROLL_LENGTHS[r.ratio] ?? 36) !== 36).map(r => `cmp r0,#${r.id};moveq r0,#${GR3X_ROLL_LENGTHS[r.ratio]};beq len;`).join('');
  const length = `${lengths}mov r0,#36;len:`;

  // The first exposure: every register kept (the flags are free at a function's entry).
  const exposure = `push {r0,r1,r2,r3};${records('rollkept')}
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};bne rollkept;
    orr r0,r0,#${GR3X_ROLL_STARTED};strb r0,[r2,#${GR3X_ROLL_FLAGS}];
    ldrb r0,[r3,#${GR3X_ROLL_FLAGS}];orr r0,r0,#${GR3X_ROLL_STARTED};strb r0,[r3,#${GR3X_ROLL_FLAGS}];
    mov r0,#1;strb r0,[r2,#${GR3X_ROLL_FRAME}];strb r0,[r3,#${GR3X_ROLL_FRAME}];
    rollkept:pop {r0,r1,r2,r3};`;

  // The model's end: advance, then save both records; every register kept.
  free(GR3X_ROLL_MODEL_END);
  entries.filmRollEnd = p.code(`push {r0,r1,r2,r3,r4,r5,r6,lr};${records('out')}
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};beq out;
    movw r0,#${lo(SINGLETON)};movt r0,#${hi(SINGLETON)};ldr r0,[r0];${ram('r0', 'out')}
    ldr r0,[r0,#0x518];${ram('r0', 'out')}ldr r0,[r0];${ram('r0', 'out')}ldrb r0,[r0,#0x6c0];cmp r0,#2;bne out;
    mov r4,r1;mov r5,r2;mov r6,r3;
    ldrb r0,[r5,#${GR3X_RATIO}];${length}
    ldrb r1,[r5,#${GR3X_ROLL_FRAME}];add r1,r1,#1;cmp r1,r0;movhi r1,#0;
    strb r1,[r5,#${GR3X_ROLL_FRAME}];strb r1,[r6,#${GR3X_ROLL_FRAME}];
    ldrb r2,[r5,#${GR3X_ROLL_FLAGS}];bichi r2,r2,#${GR3X_ROLL_STARTED};strb r2,[r5,#${GR3X_ROLL_FLAGS}];
    ldrb r2,[r6,#${GR3X_ROLL_FLAGS}];bichi r2,r2,#${GR3X_ROLL_STARTED};strb r2,[r6,#${GR3X_ROLL_FLAGS}];
    bl #${GR3X_APP_DATA};ldr r0,[r0,#8];mov r1,#1;movw r2,#${RECORD};mov r3,r5;bl #${GR3X_APP_DATA_WRITE};
    bl #${GR3X_APP_DATA};ldr r0,[r0,#8];add r1,r4,#2;movw r2,#${RECORD};mov r3,r6;bl #${GR3X_APP_DATA_WRITE};
    out:pop {r0,r1,r2,r3,r4,r5,r6,lr};mov ip,sp;b #${GR3X_ROLL_MODEL_END + 4};`);
  p.patch(GR3X_ROLL_MODEL_END, 0xe1a0c00d, branchWord(GR3X_ROLL_MODEL_END, entries.filmRollEnd), 'film roll: the frame advances at the model\'s end, settings saved');

  // The screen counter: r2 = the frame to take in a U mode (1 before the roll starts), else r0.
  free(GR3X_ROLL_COUNTER);
  entries.filmRollCounter = p.code(`push {r0,r1,r3};${records('count')}
    ldrb r0,[r2,#${GR3X_ROLL_FLAGS}];tst r0,#${GR3X_ROLL_STARTED};moveq r0,#1;ldrbne r0,[r2,#${GR3X_ROLL_FRAME}];
    mov r2,r0;pop {r0,r1,r3};b #${GR3X_ROLL_COUNTER + 4};
    count:pop {r0,r1,r3};mov r2,r0;b #${GR3X_ROLL_COUNTER + 4};`);
  p.patch(GR3X_ROLL_COUNTER, 0xe1a02000, branchWord(GR3X_ROLL_COUNTER, entries.filmRollCounter), 'film roll: the screen counter shows the frame to take');

  // Save Settings into BOX n: the native save (its first instruction, then the rest), then the roll
  // of BOX n ends, and the record in use's when n is the active mode.
  free(GR3X_BOX_SAVE);
  const native = p.code(`cmp r1,#7;b #${GR3X_BOX_SAVE + 4};`);
  entries.filmRollBoxSave = p.code(`push {r4,r5,r6,lr};mov r4,r0;mov r5,r1;bl #${native};mov r6,r0;
    sub r0,r5,#1;cmp r0,#5;bhi saved;
    movw r0,#${lo(STORED)};movt r0,#${hi(STORED)};ldr r1,[r0,r5,lsl #2];${ram('r1', 'saved')}
    ldrb r2,[r1,#${GR3X_ROLL_FLAGS}];bic r2,r2,#${GR3X_ROLL_STARTED};strb r2,[r1,#${GR3X_ROLL_FLAGS}];mov r2,#0;strb r2,[r1,#${GR3X_ROLL_FRAME}];
    movw r0,#${lo(MODEL)};movt r0,#${hi(MODEL)};ldr r1,[r0];${ram('r1', 'saved')}ldrb r1,[r1];cmp r1,r5;bne saved;
    ldr r1,[r0,#4];${ram('r1', 'saved')}
    ldrb r2,[r1,#${GR3X_ROLL_FLAGS}];bic r2,r2,#${GR3X_ROLL_STARTED};strb r2,[r1,#${GR3X_ROLL_FLAGS}];mov r2,#0;strb r2,[r1,#${GR3X_ROLL_FRAME}];
    saved:mov r0,r6;pop {r4,r5,r6,pc};`);
  p.patch(GR3X_BOX_SAVE, 0xe3510007, branchWord(GR3X_BOX_SAVE, entries.filmRollBoxSave), 'film roll: Save Settings into a BOX rewinds its roll');

  // The mode recall (called by the guard's recall hook): r0 the record in use, r1 the mode recalled.
  entries.filmRollRecall = p.code(`sub r1,r1,#1;cmp r1,#5;bxhi lr;${ram('r0', 'none')}
    mov r1,#0;strb r1,[r0,#${GR3X_INTERIM}];none:bx lr;`);
  return { entries, exposure };
}
