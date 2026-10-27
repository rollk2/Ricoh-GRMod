// SPDX-License-Identifier: GPL-2.0-only
// Film mode phase 2: the test build of the roll's bytes 0x9b1..0x9b3 (core/src/fw/gr3x/film-probe.ts).
// --exposures: pictures counted at each still exposure (T10-FILMPROBE2); --sequence: the multi-exposure sequence (T10-FILMPROBE3); --emitters: which poster ended it (T10-FILMPROBE4). Round 10 with the date imprint, no films, one added ratio (XPan 65:24, the build needs one). Never discovers or writes a camera or card.
import { registerHooks } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (original) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      for (const suffix of ['.ts', '/index.ts']) {
        try { return next(specifier + suffix, context); } catch { /* next suffix */ }
      }
    }
    throw original;
  }
} });
const [input, directory, ...extra] = process.argv.slice(2);
if (!input || !directory || extra.length > 1 || (extra.length && !['--exposures', '--sequence', '--emitters'].includes(extra[0]))) {
  console.error('Usage: node tools/gr3x/build-film-probe.mjs OFFICIAL.bin NEW-directory [--exposures | --sequence | --emitters]');
  process.exit(2);
}
const { buildGr3xTestFirmware } = await import('../../core/src/fw/gr3x/research-package.ts');
const { planGr3xMenu } = await import('../../core/src/fw/gr3x/geometry.ts');
const raw = new Uint8Array(await readFile(input));
const result = await buildGr3xTestFirmware(raw, [], undefined, planGr3xMenu([{ ratio: '65:24', name: 'XPan' }]),
  { dateImprint: true, dateMenu: 'submenu', round7: true, round8: true, round9: true, round10: true, filmProbe: extra.length ? extra[0].slice(2) : true });
const target = resolve(directory);
await mkdir(target); // Never overwrite an earlier build or the official input.
await writeFile(join(target, result.report.filename), result.bytes, { flag: 'wx' });
await writeFile(join(target, 'patch-manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n', { flag: 'wx' });
await writeFile(join(target, 'build-report.json'), JSON.stringify(result.report, null, 2) + '\n', { flag: 'wx' });
await writeFile(join(target, 'SHA256SUMS.txt'), result.report.outputSha256 + '  ' + result.report.filename + '\n', { flag: 'wx' });
console.log(JSON.stringify({ directory: target, filename: result.report.filename, sha256: result.report.outputSha256,
  bytes: result.bytes.length, revision: result.report.revision, entries: Object.fromEntries(Object.entries(result.manifest.entries)
    .filter(([k]) => k.startsWith('filmProbe') || k.startsWith('settings')).map(([k, v]) => [k, '0x' + v.toString(16)])) }));
