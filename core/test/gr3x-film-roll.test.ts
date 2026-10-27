// SPDX-License-Identifier: GPL-2.0-only
// Film mode phase 3.1: the roll's state and frame counter (film-roll.ts). What its code does when it
// runs is checked in an emulator (tools/gr3x/film_roll_check.py, and guard_probe.py for the recall).
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildGr3xAdjResearch } from '../src/fw/gr3x/adj';
import { planGr3xMenu } from '../src/fw/gr3x/geometry';
import { buildGr3xTestFirmware } from '../src/fw/gr3x/research-package';
import { GR3X_BOX_SAVE, GR3X_ROLL_COUNTER, GR3X_ROLL_MODEL_END } from '../src/fw/gr3x/film-roll';
import { GR3X_RECALL_COPY } from '../src/fw/gr3x/guard';

const input = process.env.GRMOD_GR3_FIRMWARE;
const menu = planGr3xMenu([{ ratio: '65:24', name: 'XPan' }]);
const r10 = { dateImprint: true, dateMenu: 'submenu', round7: true, round8: true, round9: true, round10: true } as const;

describe.skipIf(!input)('GR III film roll (film mode phase 3.1)', () => {
  let raw: Uint8Array;
  beforeAll(() => { raw = new Uint8Array(readFileSync(input!)); });
  it('patches the model\'s end, the screen counter and the BOX save, and rides on the guard\'s recall', async () => {
    const plain = await buildGr3xAdjResearch(raw, menu, r10);
    const roll = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: true });
    const e = roll.entries as Record<string, number>;
    expect(roll).toMatchObject({ filmRoll: true });
    expect(plain).not.toHaveProperty('filmRoll');
    for (const [at, expected] of [[GR3X_ROLL_MODEL_END, '0dc0a0e1'], [GR3X_ROLL_COUNTER, '0020a0e1'], [GR3X_BOX_SAVE, '070051e3']] as const) {
      expect(plain.sites.some(s => s.address === at)).toBe(false);
      expect(roll.sites.find(s => s.address === at)!).toMatchObject({ expected, reason: expect.stringMatching(/^film roll/) });
    }
    expect(roll.sites.length).toBe(plain.sites.length + 3);
    for (const k of ['filmRollEnd', 'filmRollCounter', 'filmRollBoxSave', 'filmRollRecall']) expect(e[k]).toBeGreaterThan(0x53000000);
    expect(roll.sites.find(s => s.address === GR3X_RECALL_COPY)!.reason).toMatch(/guard/);
    expect(roll.append.bytes).not.toBe(plain.append.bytes);
  }, 240000);
  it('needs round 10 with the date imprint and no film probe, and is named as a test build', async () => {
    await expect(buildGr3xAdjResearch(raw, menu, { ...r10, dateImprint: false, filmRoll: true })).rejects.toMatchObject({ code: 'unexpected-layout' });
    await expect(buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: true, filmProbe: true })).rejects.toMatchObject({ code: 'unexpected-layout' });
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: true });
    expect(built.report.revision).toBe('T11-ROLL1');
    expect(built.report.filename).toBe('fwdc239b.bin');
  }, 240000);
});
