// SPDX-License-Identifier: GPL-2.0-only
// The WB button in Fn Button Settings (wb-button.ts). What its code does when it runs is checked in
// an emulator (tools/gr3x/wb_button_probe.py, and film_roll_check.py for the functions' list).
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildGr3xAdjResearch } from '../src/fw/gr3x/adj';
import { Engine } from '../src/app/engine';
import { planGr3xMenu } from '../src/fw/gr3x/geometry';
import { GR3X_ISO_GETTER_CALL, GR3X_ISO_KEY_ID, GR3X_MACRO_KEY_HANDLER, GR3X_MACRO_LINE_NAMES, GR3X_WB_KEY_EVENT, GR3X_WB_KEY_HANDLER, gr3xWbLineName } from '../src/fw/gr3x/wb-button';
import { readGr3xBuildRecipe, encodeGr3xRatioRecipe } from '../src/fw/gr3x/ratio-recipe';

const input = process.env.GRMOD_GR3_FIRMWARE;
const menu = planGr3xMenu([{ ratio: '65:24', name: 'XPan' }]);
const film = { dateImprint: true, dateMenu: 'submenu', round7: true, round8: true, round9: true, round10: true, filmMode: { codes: { 64: 'PORT' } }, dateHidden: true, afPoint: true, memoryU: true } as const;

describe('WB button names and recipe', () => {
  it('names the line after each language\'s ISO Button', () => {
    expect(gr3xWbLineName('ISO Button')).toBe('WB Button');
    expect(gr3xWbLineName('Touche ISO')).toBe('Touche WB');
    expect(gr3xWbLineName('ISOボタン')).toBe('WBボタン');
    expect(gr3xWbLineName('感光度按鈕')).toBe('白平衡按鈕');
    expect(() => gr3xWbLineName('Fn Button')).toThrow(/no ISO/);
  });
  it('is recorded in the recipe with the film mode only', () => {
    const at = (r: Uint8Array) => readGr3xBuildRecipe(r)!;
    const withWb = encodeGr3xRatioRecipe(menu, { round7: true, round8: true, round9: true, round10: true, dateImprint: true, filmMode: { codes: { 64: 'PORT' } }, wbButton: true });
    expect(at(withWb)).toMatchObject({ wbButton: true, filmMode: { codes: { 64: 'PORT' } } });
    const noFilm = encodeGr3xRatioRecipe(menu, { round7: true, round8: true, round9: true, round10: true, dateImprint: true, wbButton: true });
    expect(at(noFilm)).not.toHaveProperty('wbButton');
    const withMacro = encodeGr3xRatioRecipe(menu, { round7: true, round8: true, round9: true, round10: true, dateImprint: true, filmMode: { codes: {} }, wbButton: true, macroButton: true });
    expect(at(withMacro)).toMatchObject({ wbButton: true, macroButton: true });
    const macroAlone = encodeGr3xRatioRecipe(menu, { round7: true, round8: true, round9: true, round10: true, dateImprint: true, filmMode: { codes: {} }, macroButton: true });
    expect(at(macroAlone)).not.toHaveProperty('macroButton');
  });
  it('has a Macro Button name for each of the 21 text rows', () => {
    expect(GR3X_MACRO_LINE_NAMES.length).toBe(21);
    expect(GR3X_MACRO_LINE_NAMES[1]).toBe('Macro Button');
    expect(GR3X_MACRO_LINE_NAMES[2]).toBe('Touche macro');
  });
});

describe.skipIf(!input)('GR III WB button', () => {
  let raw: Uint8Array;
  beforeAll(() => { raw = new Uint8Array(readFileSync(input!)); });
  it('adds its hooks to the film mode build and nothing else', async () => {
    const plain = await buildGr3xAdjResearch(raw, menu, film);
    const wb = await buildGr3xAdjResearch(raw, menu, { ...film, wbButton: true });
    expect(wb).toMatchObject({ wbButton: true });
    expect(plain).not.toHaveProperty('wbButton');
    const added = wb.sites.filter(s => !plain.sites.some(t => t.address === s.address));
    expect(added.every(s => /^WB button/.test(s.reason))).toBe(true);
    expect(added.length).toBe(14);
    expect(wb.sites.find(s => s.address === GR3X_WB_KEY_HANDLER)!).toMatchObject({ expected: '0dc0a0e1' });
    expect(wb.sites.find(s => s.address === GR3X_WB_KEY_EVENT)!).toMatchObject({ expected: '007098e5' });
    // The sites both builds patch keep their place; only the appended code differs.
    for (const s of plain.sites) expect(wb.sites.find(t => t.address === s.address)!.expected).toBe(s.expected);
    const e = wb.entries as Record<string, number>;
    for (const k of ['wbOpen', 'wbKeyEntry', 'wbKeyEvent', 'wbScreenLines', 'wbScreenSetup', 'wbScreenOpen', 'wbScreenDraw', 'wbScreenHelp', 'wbListSet', 'wbListIsCurrent']) expect(e[k]).toBeGreaterThan(0x53000000);
  }, 240000);
  it('adds the Macro button\'s three sites to the WB button\'s', async () => {
    const wb = await buildGr3xAdjResearch(raw, menu, { ...film, wbButton: true });
    const both = await buildGr3xAdjResearch(raw, menu, { ...film, wbButton: true, macroButton: true });
    expect(both).toMatchObject({ wbButton: true, macroButton: true });
    const added = both.sites.filter(s => !wb.sites.some(t => t.address === s.address)).map(s => s.address).sort();
    expect(added).toEqual([GR3X_MACRO_KEY_HANDLER, GR3X_ISO_GETTER_CALL, GR3X_ISO_KEY_ID].sort());
    const e = both.entries as Record<string, number>;
    for (const k of ['macroPress', 'macroKeyEntry', 'isoKeySetting', 'isoKeyId', 'macroScreenValue', 'macroListSet', 'macroListIsCurrent']) expect(e[k]).toBeGreaterThan(0x53000000);
    await expect(buildGr3xAdjResearch(raw, menu, { ...film, macroButton: true })).rejects.toMatchObject({ code: 'unexpected-layout' });
  }, 240000);
  it('needs the film mode', async () => {
    await expect(buildGr3xAdjResearch(raw, menu, { dateImprint: true, dateMenu: 'submenu', round7: true, round8: true, round9: true, round10: true, wbButton: true })).rejects.toMatchObject({ code: 'unexpected-layout' });
    await expect(buildGr3xAdjResearch(raw, menu, { dateImprint: true, dateMenu: 'submenu', round7: true, round8: true, round9: true, round10: true, filmRoll: 'fn7', wbButton: true })).rejects.toMatchObject({ code: 'unexpected-layout' });
  }, 240000);
  it('is built by the engine with the film mode, recorded and recognised', async () => {
    const engine = await Engine.open(raw);
    const ratios = [{ ratio: '65:24', name: 'XPan' }];
    const built = await engine.buildFirmware([], ratios, [], { filmCount: 3, adjSoftFocus: true, afPoint: true, memoryU: true, filmMode: { codes: {} }, noMovie: true, wbButton: true, macroButton: true });
    expect(await (await Engine.open(raw)).inspect(built.file)).toMatchObject({ verified: true });
    await expect(engine.buildFirmware([], ratios, [], { filmCount: 3, filmMode: { codes: {} }, macroButton: true })).rejects.toThrow(/WB button/);
    const without = await engine.buildFirmware([], ratios, [], { filmCount: 3, adjSoftFocus: true, afPoint: true, memoryU: true, filmMode: { codes: {} }, noMovie: true });
    expect(without.sha256).not.toBe(built.sha256);
    await expect(engine.buildFirmware([], ratios, [], { filmCount: 0, dateStamp: true, wbButton: true })).rejects.toThrow(/film mode/);
  }, 600000);
});
