# SPDX-License-Identifier: GPL-2.0-only
"""Build and check the development library (tools/develop, docs/ARCHITECTURE.md).

  python3 tools/develop/build.py [IMAGES_FOLDER]

1. PC: compile the library with the tests (host/), run them; with a folder, also write the
   reference images (ramps, and the sample photo ui/src/assets/preview.jpg with each archetype).
2. Camera: compile every library source with the camera modules' flags (tools/datestamp/gen.py:
   cortex-a9, ARM, soft float, -Os, position independent, no library) and check that the result
   has no data section of any kind (.data, .bss, .rodata, .got), calls nothing outside itself
   (no __aeabi_* helper: no division) and does not depend on where it is loaded (linked at two
   addresses, the bytes are the same). Prints each function's size.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LIB = ['grain.c', 'text.c', 'date.c', 'diptych.c']
HOST = ['host/host.c', 'host/test.c']
ARM_FLAGS = ['-target', 'armv7-none-eabi', '-mcpu=cortex-a9', '-marm', '-mfloat-abi=soft', '-Os',
             '-ffreestanding', '-fno-builtin', '-fno-unwind-tables', '-fno-asynchronous-unwind-tables', '-nostdlib',
             '-fropi', '-frwpi', '-fno-jump-tables', '-Wall', '-Wextra', '-Werror']


def run(cmd, **kw):
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, **kw)
    if r.returncode:
        sys.exit(f'{" ".join(map(str, cmd))}\n{r.stdout}{r.stderr}')
    return r.stdout


def host(tmp, images):
    exe = tmp / 'test'
    run(['cc', '-O2', '-Wall', '-Wextra', '-Werror', '-o', exe] + [HERE / f for f in LIB + HOST] + ['-lm'])
    args = [exe]
    if images:
        images.mkdir(parents=True, exist_ok=True)
        args.append(images)
        photo = ROOT / 'ui' / 'src' / 'assets' / 'preview.jpg'
        try:
            from PIL import Image
            ppm = tmp / 'photo.ppm'
            Image.open(photo).convert('RGB').save(ppm)
            args.append(ppm)
        except Exception as e:  # no Pillow: ramps only
            print(f'(photo non convertie : {e})')
    r = subprocess.run([str(a) for a in args], capture_output=True, text=True)
    print(r.stdout, end='')
    if images:
        try:
            from PIL import Image
            for p in sorted(images.glob('*.ppm')):
                Image.open(p).save(p.with_suffix('.png'))
                p.unlink()
        except Exception:
            pass
    return r.returncode == 0


def camera(tmp):
    objs = []
    for src in LIB:
        obj = tmp / (Path(src).stem + '.o')
        run(['clang'] + ARM_FLAGS + ['-I', HERE, '-c', HERE / src, '-o', obj])
        objs.append(obj)
    blobs = []
    for origin in (0x60000000, 0x60123450):
        elf = tmp / f'dev_{origin:x}.elf'
        run(['ld.lld', f'-Ttext=0x{origin:x}', '--no-undefined', '-e', '0', '-o', elf] + objs)
        sections = run(['readelf', '-S', '-W', elf])
        for name in ('.data', '.bss', '.rodata', '.got'):
            if f' {name} ' in sections or f' {name}.' in sections:
                sys.exit(f'camera build: a {name} section')
        out = tmp / f'dev_{origin:x}.bin'
        run(['llvm-objcopy', '-O', 'binary', '-j', '.text', elf, out])
        blobs.append(out.read_bytes())
    if blobs[0] != blobs[1]:
        sys.exit('camera build: the code depends on its address')
    undefined = [l for l in run(['readelf', '-s', '-W', tmp / 'dev_60000000.elf']).splitlines() if ' UND ' in l and l.split()[-1] != 'UND']
    if undefined:
        sys.exit('camera build: calls outside the library\n' + '\n'.join(undefined))
    symbols = run(['llvm-nm', '--size-sort', '-S', tmp / 'dev_60000000.elf']).split('\n')
    print(f'boîtier : {len(blobs[0])} octets de code, sans données, indépendant de l\'adresse')
    for line in symbols:
        parts = line.split()
        if len(parts) == 4 and parts[2] in 'Tt':
            print(f'  {parts[3]:<20} {int(parts[1], 16):6d} octets')
    return True


def main():
    images = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        ok = host(tmp, images)
        if shutil.which('clang') and shutil.which('ld.lld'):
            camera(tmp)
        else:
            print('(clang / ld.lld absents : compilation pour le boîtier non vérifiée)')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
