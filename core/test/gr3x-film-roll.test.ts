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
    expect(built.report.revision).toBe('T12-MENU2');
  }, 240000);
  it('the key probe adds two hooks and its clock to the menu form', async () => {
    const film = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'menu' });
    const keys = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'keys' });
    for (const at of [0x53221a1c, 0x532288b0]) {
      expect(film.sites.some(s => s.address === at)).toBe(false);
      expect(keys.sites.find(s => s.address === at)!).toMatchObject({ expected: '0dc0a0e1', reason: expect.stringMatching(/^film roll key probe/) });
    }
    expect(keys.sites.length).toBe(film.sites.length + 2);
    expect((keys.entries as Record<string, number>).filmProbeTime).toBeGreaterThan(0x53000000);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'keys' });
    expect(built.report.revision).toBe('T12-KEYS2');
  }, 240000);
  it('adds Film Advance to Fn Button Settings (phase 6)', async () => {
    const film = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'menu' });
    const fn = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn' });
    for (const [at, expected] of [[0x53292ed0, '000051e3'], [0x53293e6c, '000051e3'], [0x5329bcc8, '0dc0a0e1'], [0x5329a0a0, '290056e3'], [0x531be698, '246084e2']] as const) {
      expect(film.sites.some(s => s.address === at)).toBe(false);
      expect(fn.sites.find(s => s.address === at)!).toMatchObject({ expected, reason: expect.stringMatching(/^film advance/) });
    }
    expect(fn.sites.find(s => s.address === 0x531be698)!.replacement).toBe('256084e2');
    expect(fn.sites.length).toBe(film.sites.length + 7);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'fn' });
    expect(built.report.revision).toBe('T13-FN1');
  }, 240000);
  it('drops the Next / Retake / Complete screen in film mode, with the two-key probe (T13-FN2)', async () => {
    const fn = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn' });
    const fn2 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn2' });
    for (const at of [0x53226738, 0x53221a1c, 0x532288b0]) {
      expect(fn.sites.some(s => s.address === at)).toBe(false);
      expect(fn2.sites.find(s => s.address === at)!).toMatchObject({ expected: '0dc0a0e1', reason: expect.stringMatching(/^film roll/) });
    }
    expect(fn2.sites.length).toBe(fn.sites.length + 3);
    expect((fn2.entries as Record<string, number>).filmNoReview).toBeGreaterThan(0x53000000);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'fn2' });
    expect(built.report.revision).toBe('T13-FN2');
  }, 240000);
  it('asks for the live view instead of that screen, and clears the key probe at each exposure (T13-FN3)', async () => {
    const fn = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn' });
    const fn3 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn3' });
    expect(fn3.sites.find(s => s.address === 0x53226760)!).toMatchObject({ expected: '0c10a0e3', reason: expect.stringMatching(/^film roll: the live view/) });
    expect(fn3.sites.some(s => s.address === 0x53226738)).toBe(false);
    for (const at of [0x53221a1c, 0x532288b0]) expect(fn3.sites.find(s => s.address === at)!.reason).toMatch(/^film roll key probe/);
    expect(fn3.sites.length).toBe(fn.sites.length + 3);
    expect((fn3.entries as Record<string, number>).filmReviewToLive).toBeGreaterThan(0x53000000);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'fn3' });
    expect(built.report.revision).toBe('T13-FN3');
  }, 240000);
  it('closes that screen by itself and adds Retake to Fn Button Settings (T13-FN4)', async () => {
    const fn = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn' });
    const fn4 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn4' });
    expect(fn4.sites.find(s => s.address === 0x531cbde4)!).toMatchObject({ expected: '0dc0a0e1', reason: expect.stringMatching(/^film roll: Next \/ Retake \/ Complete closes/) });
    for (const at of [0x53226738, 0x53226760, 0x53221a1c, 0x532288b0]) expect(fn4.sites.some(s => s.address === at)).toBe(false);
    expect(fn4.sites.find(s => s.address === 0x531be698)!.replacement).toBe('266084e2');
    expect(fn4.sites.length).toBe(fn.sites.length + 1);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'fn4' });
    expect(built.report.revision).toBe('T13-FN4');
  }, 240000);
  it('Retake calls the shooting model\'s Retake action instead of posting the event (T13-FN5)', async () => {
    const fn4 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn4' });
    const fn5 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn5' });
    expect(fn5.sites.map(s => s.address)).toEqual(fn4.sites.map(s => s.address));
    expect(fn5.append.bytes).not.toBe(fn4.append.bytes);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'fn5' });
    expect(built.report.revision).toBe('T13-FN5');
  }, 240000);
  it('adds the Retake probe to the T13-FN5 form (T13-RT1)', async () => {
    const fn5 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn5' });
    const rt1 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'rt1' });
    for (const [at, expected] of [[0x5323a1a4, '0dc0a0e1'], [0x5323a1d0, '020050e3'], [0x5346a8d8, '0dc0a0e1'], [0x5346a910, '0dc0a0e1']] as const) {
      expect(fn5.sites.some(s => s.address === at)).toBe(false);
      expect(rt1.sites.find(s => s.address === at)!).toMatchObject({ expected, reason: expect.stringMatching(/^film roll retake probe/) });
    }
    expect(rt1.sites.length).toBe(fn5.sites.length + 4);
    expect((rt1.entries as Record<string, number>).filmProbeTime).toBeGreaterThan(0x53000000);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'rt1' });
    expect(built.report.revision).toBe('T13-RT1');
  }, 240000);
  it('Retake cancels the whole frame (T13-FN6)', async () => {
    const fn5 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn5' });
    const fn6 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn6' });
    expect(fn5.sites.some(s => s.address === 0x5346a8d8)).toBe(false);
    expect(fn6.sites.find(s => s.address === 0x5346a8d8)!).toMatchObject({ expected: '0dc0a0e1', reason: expect.stringMatching(/^film retake: the whole frame/) });
    expect(fn6.sites.length).toBe(fn5.sites.length + 1);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'fn6' });
    expect(built.report.revision).toBe('T13-FN6');
  }, 240000);
  it('closes that screen only after a shot, without Retake (T13-FN7)', async () => {
    const fn = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn' });
    const fn7 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn7' });
    expect(fn7.sites.find(s => s.address === 0x531cbde4)!.reason).toMatch(/^film roll: Next \/ Retake \/ Complete closes/);
    expect(fn7.sites.find(s => s.address === 0x53226738)!).toMatchObject({ expected: '0dc0a0e1', reason: expect.stringMatching(/^film roll: the Next \/ Retake \/ Complete screen opened after a shot/) });
    expect(fn7.sites.find(s => s.address === 0x531be698)!.replacement).toBe('256084e2');
    expect(fn7.sites.length).toBe(fn.sites.length + 2);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'fn7' });
    expect(built.report.revision).toBe('T13-FN7');
  }, 240000);
  it('names the roll folder from the film and the roll length (T14-DIR1)', async () => {
    const fn7 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'fn7' });
    const dir1 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'dir1' });
    const e = dir1.entries as Record<string, number>;
    expect(dir1.sites.map(s => s.address)).toEqual(fn7.sites.map(s => s.address));
    for (const k of ['filmFolderNameSet', 'filmFolderNameRestore']) expect(e[k]).toBeGreaterThan(0x53000000);
    expect((fn7.entries as Record<string, number>).filmFolderNameSet).toBeUndefined();
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'dir1' });
    expect(built.report.revision).toBe('T14-DIR1');
  }, 240000);
  it('presses Next shot at the screen\'s first event (T14-DIR2)', async () => {
    const dir1 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'dir1' });
    const dir2 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'dir2' });
    expect(dir1.sites.some(s => s.address === 0x531cbfc4)).toBe(false);
    expect(dir2.sites.find(s => s.address === 0x531cbfc4)!).toMatchObject({ expected: '0dc0a0e1', reason: expect.stringMatching(/^film roll: Next shot at the screen's first event/) });
    expect(dir2.sites.find(s => s.address === 0x531cbde4)!.reason).toMatch(/noted for Next shot/);
    expect(dir2.sites.length).toBe(dir1.sites.length + 1);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'dir2' });
    expect(built.report.revision).toBe('T14-DIR2');
  }, 240000);
  it('posts one Complete per frame from Film Advance (T14-DIR3)', async () => {
    const dir2 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'dir2' });
    const dir3 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmRoll: 'dir3' });
    expect(dir3.sites.map(s => s.address)).toEqual(dir2.sites.map(s => s.address));
    expect(dir3.append.bytes).not.toBe(dir2.append.bytes);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmRoll: 'dir3' });
    expect(built.report.revision).toBe('T14-DIR3');
  }, 240000);
});
