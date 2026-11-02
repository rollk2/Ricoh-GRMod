// SPDX-License-Identifier: GPL-2.0-only
// Film mode phase 2: the test build of the roll's bytes (film-probe.ts). What its code does when it
// runs is checked in an emulator (tools/gr3x/film_probe_check.py).
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildGr3xAdjResearch } from '../src/fw/gr3x/adj';
import { planGr3xMenu } from '../src/fw/gr3x/geometry';
import { buildGr3xTestFirmware } from '../src/fw/gr3x/research-package';
import { GR3X_SETTINGS_LOAD, GR3X_SETTINGS_SAVE } from '../src/fw/gr3x/round10';
import { GR3X_END_EMITTERS, GR3X_GET_TIME, GR3X_MODEL_END, GR3X_MULTI_END, GR3X_MULTI_RETAKE, GR3X_REMAINING_SHOTS, GR3X_SET_FILE_PATH, GR3X_FOLDER_MARK } from '../src/fw/gr3x/film-probe';
import { GR3X_BEFORE_EXPOSE } from '../src/fw/gr3x/datestamp';

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
  it('counts exposures in front of the date imprint\'s exposure hook (second form)', async () => {
    const enc = await buildGr3xAdjResearch(raw, menu, { ...r10, filmProbe: true });
    const exp = await buildGr3xAdjResearch(raw, menu, { ...r10, filmProbe: 'exposures' });
    expect(exp).toMatchObject({ filmProbe: 'exposures' });
    expect(exp.sites.map(s => s.address).sort()).toEqual(enc.sites.map(s => s.address).sort());
    expect(exp.sites.find(s => s.address === GR3X_BEFORE_EXPOSE)!.reason).toMatch(/direction/);
    expect(exp.append.bytes).not.toBe(enc.append.bytes);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmProbe: 'exposures' });
    expect(built.report.revision).toBe('T10-FILMPROBE2');
  }, 240000);
  it('hooks the multi-exposure end and retake, and no settings hook (third form)', async () => {
    const plain = await buildGr3xAdjResearch(raw, menu, r10);
    const seq = await buildGr3xAdjResearch(raw, menu, { ...r10, filmProbe: 'sequence' });
    const e = seq.entries as Record<string, number>;
    expect(seq).toMatchObject({ filmProbe: 'sequence' });
    expect(e).not.toHaveProperty('filmProbeLoad');
    for (const at of [GR3X_MULTI_END, GR3X_MULTI_RETAKE]) {
      expect(plain.sites.some(s => s.address === at)).toBe(false);
      expect(seq.sites.find(s => s.address === at)!).toMatchObject({ expected: '0dc0a0e1', reason: expect.stringMatching(/^film probe/) });
    }
    expect(seq.sites.length).toBe(plain.sites.length + 2);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmProbe: 'sequence' });
    expect(built.report.revision).toBe('T10-FILMPROBE3');
  }, 240000);
  it('marks which poster of the end ran (fourth form)', async () => {
    const seq = await buildGr3xAdjResearch(raw, menu, { ...r10, filmProbe: 'sequence' });
    const em = await buildGr3xAdjResearch(raw, menu, { ...r10, filmProbe: 'emitters' });
    expect(em).toMatchObject({ filmProbe: 'emitters' });
    for (const at of [...GR3X_END_EMITTERS, GR3X_MODEL_END]) {
      expect(seq.sites.some(s => s.address === at)).toBe(false);
      expect(em.sites.find(s => s.address === at)!).toMatchObject({ expected: '0dc0a0e1', reason: expect.stringMatching(/^film probe/) });
    }
    expect(em.sites.length).toBe(seq.sites.length + GR3X_END_EMITTERS.length + 1);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmProbe: 'emitters' });
    expect(built.report.revision).toBe('T10-FILMPROBE4');
  }, 240000);
  it('patches the screen counter, the model\'s end and the sequence end (fifth form)', async () => {
    const plain = await buildGr3xAdjResearch(raw, menu, r10);
    const fo = await buildGr3xAdjResearch(raw, menu, { ...r10, filmProbe: 'folders' });
    expect(fo).toMatchObject({ filmProbe: 'folders' });
    expect(fo.sites.find(s => s.address === GR3X_REMAINING_SHOTS)!).toMatchObject({ expected: '0020a0e1', reason: expect.stringMatching(/^film probe/) });
    for (const at of [GR3X_MODEL_END, GR3X_MULTI_END]) expect(fo.sites.find(s => s.address === at)!).toMatchObject({ expected: '0dc0a0e1', reason: expect.stringMatching(/^film probe/) });
    expect(fo.sites.length).toBe(plain.sites.length + 3);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmProbe: 'folders' });
    expect(built.report.revision).toBe('T10-FILMPROBE5');
  }, 240000);
  it('patches SetFilePath only, with the camera\'s clock (sixth form)', async () => {
    const plain = await buildGr3xAdjResearch(raw, menu, r10);
    const ret = await buildGr3xAdjResearch(raw, menu, { ...r10, filmProbe: 'return' });
    expect(ret).toMatchObject({ filmProbe: 'return' });
    expect(plain.sites.some(s => s.address === GR3X_SET_FILE_PATH)).toBe(false);
    expect(ret.sites.find(s => s.address === GR3X_SET_FILE_PATH)!).toMatchObject({ expected: '0dc0a0e1', reason: expect.stringMatching(/^film probe/) });
    expect(ret.sites.length).toBe(plain.sites.length + 1);
    expect(ret.entries).not.toHaveProperty('filmProbeTime');
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmProbe: 'return' });
    expect(built.report.revision).toBe('T10-FILMPROBE6');
  }, 240000);
  it('also moves the multi-exposure folder mark to the written folder (seventh form)', async () => {
    const ret = await buildGr3xAdjResearch(raw, menu, { ...r10, filmProbe: 'return' });
    const r2 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmProbe: 'return2' });
    expect(ret.sites.some(s => s.address === GR3X_FOLDER_MARK)).toBe(false);
    expect(r2.sites.find(s => s.address === GR3X_FOLDER_MARK)!).toMatchObject({ expected: '0720a0e1', replacement: 'b021d6e1' });
    expect(r2.sites.length).toBe(ret.sites.length + 1);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmProbe: 'return2' });
    expect(built.report.revision).toBe('T10-FILMPROBE7');
  }, 240000);
  it('also cancels the pending new folder request (eighth form)', async () => {
    const r2 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmProbe: 'return2' });
    const r3 = await buildGr3xAdjResearch(raw, menu, { ...r10, filmProbe: 'return3' });
    expect(r3.sites.map(s => s.address).sort()).toEqual(r2.sites.map(s => s.address).sort());
    expect(r3.append.bytes).not.toBe(r2.append.bytes);
    const built = await buildGr3xTestFirmware(raw, [], undefined, menu, { ...r10, filmProbe: 'return3' });
    expect(built.report.revision).toBe('T10-FILMPROBE8');
  }, 240000);
});
