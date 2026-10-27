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
 */
import { gr3xSettingsHook, gr3xSettingsPrior } from './round10';
import type { Gr3xSite } from './round10';

export const GR3X_FILM_STARTS = 0x9b1;
export const GR3X_FILM_PICTURES = 0x9b2;
export const GR3X_FILM_POWER_OFFS = 0x9b3;
const MODEL = 0x55063f30, POINTER = MODEL + 4;
/** The camera's clock (the date imprint's get_time, datestamp.ts). */
export const GR3X_GET_TIME = 0x536b6510;

const lo = (v: number) => v & 0xffff, hi = (v: number) => v >>> 16;
const mod = (r: string, n: number, label: string) => `${label}:cmp ${r},#${n};subhs ${r},${r},#${n};bhs ${label};`;

export interface Gr3xFilmProbeProgram {
  code(source: string): number;
  sites: Gr3xSite[];
}

/** The two settings hooks (the scaffold must be installed) and the clock stub for the date imprint. */
export function installGr3xFilmProbe(p: Gr3xFilmProbeProgram, form: 'encodes' | 'exposures' = 'encodes') {
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
