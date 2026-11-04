// SPDX-License-Identifier: GPL-2.0-only
// The Grain and Size rows of a film's Image Control parameter screen (halation-rows.ts, films.c
// -DGRAIN). What their code does is checked in the emulator (tools/gr3x/halation_rows_probe.py,
// films_r10_verify.py).
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { planGr3xMenu } from '../src/fw/gr3x/geometry';
import { buildGr3xTestFirmware } from '../src/fw/gr3x/research-package';
import { GR3X_GRAIN_SIZE_NAMES } from '../src/fw/gr3x/image-control';
import { GR3X_FILMS_MODULE, GR3X_FILMS_MODULE_GRAIN } from '../src/fw/gr3x/films-native';

const input = process.env.GRMOD_GR3_FIRMWARE;
const menu = planGr3xMenu([{ ratio: '65:24', name: 'XPan' }]);
const curve = Array.from({ length: 256 }, (_, i) => Math.round(16383 * i / 255));
const preset = { matrixQ13: Int16Array.from([8192, 0, 0, 0, 8192, 0, 0, 0, 8192]), curves: [Uint16Array.from(curve), Uint16Array.from(curve), Uint16Array.from(curve)] };
const looks = { displayRevision: 3, ownParameters: true, filmCount: 2, films: [{ name: 'Portra', preset }, { name: 'Film 2' }] };
const film = { adjSoftFocus: true, dateImprint: true, dateMenu: 'submenu', round7: true, round8: true, round9: true, round10: true, filmMode: { codes: {} }, dateHidden: true } as const;

describe('grain rows: names and module', () => {
  it('has a Size name per text row and a films module with the grain functions', () => {
    expect(GR3X_GRAIN_SIZE_NAMES.length).toBe(21);
    expect(GR3X_GRAIN_SIZE_NAMES[2]).toBe('Taille du grain');
    for (const n of [1, 3, 20]) {
      const plain = (GR3X_FILMS_MODULE as unknown as { variants: Record<string, { exports: Record<string, number> }> }).variants[n];
      const grain = (GR3X_FILMS_MODULE_GRAIN as unknown as { variants: Record<string, { exports: Record<string, number> }> }).variants[n];
      expect(Object.keys(plain.exports)).not.toContain('sp_grain');
      for (const k of ['sp_grain', 'sp_grain_put', 'sp_size', 'sp_size_put', 'sp_grain_text', 'sp_size_text']) expect(grain.exports).toHaveProperty(k);
    }
  });
});

describe.skipIf(!input)('GR III grain rows', () => {
  let raw: Uint8Array;
  beforeAll(() => { raw = new Uint8Array(readFileSync(input!)); });
  it('adds the two rows\' hooks to a film mode build and only them', async () => {
    const plain = await buildGr3xTestFirmware(raw, [], looks, menu, film);
    const grain = await buildGr3xTestFirmware(raw, [], looks, menu, { ...film, grain: true });
    const added = grain.manifest.sites.filter(s => !plain.manifest.sites.some(t => t.address === s.address));
    expect(added.length).toBe(13);
    expect(added.every(s => /^grain:/.test(s.reason))).toBe(true);
    expect((grain.manifest as unknown as { grain?: boolean }).grain).toBe(true);
  }, 600000);
  it('needs the film mode', async () => {
    const { filmMode: _, dateHidden: __, ...noFilm } = film;
    await expect(buildGr3xTestFirmware(raw, [], looks, menu, { ...noFilm, grain: true })).rejects.toThrow(/grain/);
  }, 600000);
});
