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
import { GR3X_FOLDER_MARK, GR3X_SET_FILE_PATH } from '../src/fw/gr3x/film-probe';
import { GR3X_CUSTOM_ENTRY_IMAGE, GR3X_CUSTOM_MENU, GR3X_FILM_MENU_ID } from '../src/fw/gr3x/datestamp';

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
  it('also gives SetFilePath the roll\'s folder and moves the folder mark (second form)', async () => {
    const roll = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: true });
    const folders = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'folders' });
    expect(folders).toMatchObject({ filmRoll: 'folders' });
    expect(roll.sites.some(s => s.address === GR3X_SET_FILE_PATH)).toBe(false);
    expect(folders.sites.find(s => s.address === GR3X_SET_FILE_PATH)!).toMatchObject({ expected: '0dc0a0e1', reason: expect.stringMatching(/^film roll/) });
    expect(folders.sites.find(s => s.address === GR3X_FOLDER_MARK)!).toMatchObject({ expected: '0720a0e1', replacement: 'b021d6e1' });
    expect(folders.sites.length).toBe(roll.sites.length + 2);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'folders' });
    expect(built.report.revision).toBe('T11-ROLL3');
  }, 240000);
  it('the diagnostic form adds only its clock to the second form', async () => {
    const folders = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'folders' });
    const diag = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'folders-diag' });
    expect(diag.sites.map(s => s.address).sort()).toEqual(folders.sites.map(s => s.address).sort());
    expect(folders.entries).not.toHaveProperty('filmProbeTime');
    expect((diag.entries as Record<string, number>).filmProbeTime).toBeGreaterThan(0x53000000);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'folders-diag' });
    expect(built.report.revision).toBe('T11-ROLL2D');
  }, 240000);
  it('puts Film Roll Mode under Save Settings in Customize Settings (phase 4)', async () => {
    const folders = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'folders' });
    const film = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'menu' });
    const e = film.entries as Record<string, number>;
    expect(film).toMatchObject({ filmRoll: 'menu' });
    const site = film.sites.find(s => s.address === GR3X_CUSTOM_ENTRY_IMAGE)!;
    expect(site).toMatchObject({ expected: '9c64b353', reason: expect.stringMatching(/^film roll/) });
    expect(folders.sites.some(s => s.address === GR3X_CUSTOM_ENTRY_IMAGE)).toBe(false);
    const copy = new DataView(Uint8Array.from(Buffer.from(site.replacement, 'hex')).buffer).getUint32(0, true);
    const bytes = Uint8Array.from(Buffer.from(film.append.bytes, 'hex'));
    const d = new DataView(bytes.buffer, copy - film.append.address, 0x384);
    expect(d.getUint8(0x8b)).toBe(23);
    expect([d.getUint8(0x80), d.getUint8(0x81), d.getUint8(0x82)]).toEqual([0, 5, 14]);
    expect(d.getUint32(0x1bc, true)).toBe(0x020000e1);
    expect(d.getUint32(0x1bc + 4, true)).toBe(GR3X_FILM_MENU_ID);
    expect(d.getUint32(0x8c + 8, true)).toBe(e.filmLine);
    expect(d.getUint32(0x254 + 8, true)).toBe(e.filmMenuVisible);
    expect(d.getUint32(0x1bc + 22 * 4, true)).not.toBe(0x10000000);
    expect(d.getUint32(0x1bc + 23 * 4, true)).toBe(0x10000000);
    for (const k of ['filmMenuSet', 'filmMenuIsCurrent', 'filmDraw', 'filmCount']) expect(e[k]).toBeGreaterThan(0x53000000);
    expect(GR3X_CUSTOM_MENU).toBe(0x53b3649c);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'menu' });
    expect(built.report.revision).toBe('T12-MENU1');
  }, 240000);
});
