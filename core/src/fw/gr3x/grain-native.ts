// SPDX-License-Identifier: GPL-2.0-only
/**
 * GR III 2.10 / IIIx 1.60: the camera's own grain (Grain Effect, "Particle") on the films.
 *
 * The development step's look parameters (0x536db7d8, its look read at 0x536db7f8 already an
 * adapter of image-control.ts that renders a film as Standard) write a block of halfwords at
 * +0x1e0 .. +0x1fe of its first argument, one case per look (11 .. 22), all ending at 0x536db9c0
 * (the four live bytes +0x793 .. +0x796 written back). +0x1f8 is the grain: the monochrome looks
 * (13 .. 16) and Negative Film (22, a colour look: the camera has its particle setting,
 * "AfterReleaseStillImageControlNo0ParamNegativeFilmParticle", without a menu line) copy the
 * live particle byte (+0x795) there; Standard and the others write 0. The values are Grain
 * Effect's: 0 off, then 3, 2, 1 for its positions "1", "2", "3" (halation-rows.ts, the map
 * 0x531ac868 over {0, 3, 2, 1}).
 *
 * T-GRAIN1 (test build): at 0x536db9c0, for a film of this build (the frame's look at +0x77c of
 * the live block in r3, 64 + k), +0x1f8 gets the film's fixed value `levels[k]`; nothing else
 * changes (the live particle byte is written back as Standard has it). To see on the camera
 * whether the pipeline puts its grain on a colour picture, and how it looks.
 */
import { branchWord } from '../aspect/arm';
import { FirmwareError } from '../types';
import type { Gr3xSite } from './round10';

export const GR3X_GRAIN_END = 0x536db9c0;
const FIRST = 64;
const lo = (v: number) => v & 0xffff, hi = (v: number) => v >>> 16;

export interface Gr3xGrainProgram {
  code(source: string): number;
  append(bytes: Uint8Array): number;
  patch(address: number, expected: number, replacement: number, reason: string): void;
  u32(address: number): number;
  sites: readonly Gr3xSite[];
}

/** `levels[k]`: film k's value at +0x1f8 (0 off, 3 weak, 2 medium, 1 strong). */
export function installGr3xNativeGrainTest(p: Gr3xGrainProgram, levels: readonly number[]) {
  const fail = (m: string): never => { throw new FirmwareError('unexpected-layout', `IIIx native grain: ${m}`); };
  if (!levels.length || levels.length > 20 || levels.some(v => !Number.isInteger(v) || v < 0 || v > 3)) fail('levels');
  if (p.sites.some(s => s.address === GR3X_GRAIN_END)) fail('end already patched');
  if (p.u32(GR3X_GRAIN_END) !== 0xe5c3a793 || p.u32(GR3X_GRAIN_END + 4) !== 0xe5c39794 || p.u32(GR3X_GRAIN_END + 8) !== 0xe5c36795)
    fail('look parameters end');
  const table = p.append(Uint8Array.from(levels));
  // r0 the parameters, r3 the live block; r2, r6, r9, r10 the bytes written back: kept.
  const grainEnd = p.code(`ldrb ip,[r3,#0x77c];sub ip,ip,#${FIRST};cmp ip,#${levels.length - 1};bhi go;
    push {r1};movw r1,#${lo(table)};movt r1,#${hi(table)};ldrb r1,[r1,ip];add ip,r0,#0x1f8;strh r1,[ip];pop {r1};
    go:strb r10,[r3,#0x793];b #${GR3X_GRAIN_END + 4};`);
  p.patch(GR3X_GRAIN_END, 0xe5c3a793, branchWord(GR3X_GRAIN_END, grainEnd), 'native grain: the films\' grain at the development step');
  return { grainEnd, grainLevels: table };
}
