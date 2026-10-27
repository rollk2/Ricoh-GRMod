// SPDX-License-Identifier: GPL-2.0-only
// Film mode phase 2: the test build of the roll's bytes (film-probe.ts). What its code does when it
// runs is checked in an emulator (tools/gr3x/film_probe_check.py).
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildGr3xAdjResearch } from '../src/fw/gr3x/adj';
import { planGr3xMenu } from '../src/fw/gr3x/geometry';
import { buildGr3xTestFirmware } from '../src/fw/gr3x/research-package';
import { GR3X_SETTINGS_LOAD, GR3X_SETTINGS_SAVE } from '../src/fw/gr3x/round10';
import { GR3X_GET_TIME } from '../src/fw/gr3x/film-probe';

const input = process.env.GRMOD_GR3_FIRMWARE;
const menu = planGr3xMenu([{ ratio: '65:24', name: 'XPan' }]);
const r10 = { dateImprint: true, dateMenu: 'submenu', round7: true, round8: true, round9: true, round10: true } as const;

describe.skipIf(!input)('GR III film probe (film mode test build)', () => {
  let raw: Uint8Array;
  beforeAll(() => { raw = new Uint8Array(readFileSync(input!)); });
  it('hooks the settings load and save under the guard and gives the date imprint its clock', async () => {
    const plain = await buildGr3xAdjResearch(raw, menu, r10);
    const probe = await buildGr3xAdjResearch(raw, menu, { ...r10, filmProbe: true });
    const e = probe.entries as Record<string, number>;
    expect(probe).toMatchObject({ filmProbe: true });
    expect(plain).not.toHaveProperty('filmProbe');
    expect(plain.entries).not.toHaveProperty('filmProbeTime');
    for (const k of ['filmProbeLoad', 'filmProbeSave', 'filmProbeTime']) expect(e[k]).toBeGreaterThan(0x53000000);
    // The guard stays outermost at both entries; the probe is under it.
    for (const at of [GR3X_SETTINGS_LOAD, GR3X_SETTINGS_SAVE]) expect(probe.sites.find(s => s.address === at)!.reason).toMatch(/guard/);
    // The same patch sites as the build without the probe: only appended code differs.
    expect(probe.sites.map(s => s.address).sort()).toEqual(plain.sites.map(s => s.address).sort());
    expect(GR3X_GET_TIME).toBe(0x536b6510);
  }, 240000);
  it('needs round 10 with the date imprint, and is named as a test build', async () => {
    await expect(buildGr3xAdjResearch(raw, menu, { ...r10, dateImprint: false, filmProbe: true })).rejects.toMatchObject({ code: 'unexpected-layout' });
    await expect(buildGr3xAdjResearch(raw, menu, { dateImprint: true, filmProbe: true })).rejects.toMatchObject({ code: 'unexpected-layout' });
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmProbe: true });
    expect(built.report.revision).toBe('T10-FILMPROBE');
    expect(built.report.filename).toBe('fwdc239b.bin');
  }, 240000);
});
