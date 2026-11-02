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
3. Emulator (Unicorn, when installed): the camera build makes the textures, the seed and a frame's
   set-up and puts the grain on a band of 6000 x 16; every byte must be the PC's (the spec's
   "same print to the bit on PC and camera"). Prints the instructions per pixel.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LIB = ['grain.c', 'text.c', 'date.c', 'diptych.c', 'sheet.c']
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


def emulate(tmp, exe):
    try:
        import struct
        from unicorn import Uc, UC_ARCH_ARM, UC_MODE_ARM, UC_HOOK_BLOCK
        from unicorn import arm_const as A
    except ImportError:
        print('(Unicorn absent : vérification dans l\'émulateur non faite)')
        return True
    dump = tmp / 'dump'
    dump.mkdir()
    run([exe, '--dump', dump])
    sym = {}
    for line in run(['llvm-nm', tmp / 'dev_60000000.elf']).split('\n'):
        p = line.split()
        if len(p) == 3:
            sym[p[2]] = int(p[0], 16)
    code = (tmp / 'dev_60000000.bin').read_bytes()
    CODE, STOP, STACK, D = 0x60000000, 0x60f00000, 0x70100000, 0x80000000
    uc = Uc(UC_ARCH_ARM, UC_MODE_ARM)
    uc.mem_map(CODE, 0x01000000); uc.mem_write(CODE, code)
    uc.mem_map(STACK - 0x100000, 0x100000)
    uc.mem_map(D, 0x01000000)
    count = [0]
    starts = sorted((a, n) for n, a in sym.items() if CODE <= a < CODE + len(code))
    prof = {}

    def block(u, a, size, d):
        count[0] += size // 4
        if PROFILE_ON[0]:
            name = '?'
            for s0, n in starts:
                if s0 > a:
                    break
                name = n
            prof[name] = prof.get(name, 0) + size // 4
    PROFILE_ON = [False]
    uc.hook_add(UC_HOOK_BLOCK, block)

    def call(name, *args):
        regs = [A.UC_ARM_REG_R0, A.UC_ARM_REG_R1, A.UC_ARM_REG_R2, A.UC_ARM_REG_R3]
        sp = STACK - 0x100
        extra = args[4:]
        for i, v in enumerate(extra):
            uc.mem_write(sp + 4 * i, struct.pack('<I', v & 0xffffffff))
        for r, v in zip(regs, args[:4]):
            uc.reg_write(r, v & 0xffffffff)
        uc.reg_write(A.UC_ARM_REG_SP, sp); uc.reg_write(A.UC_ARM_REG_LR, STOP)
        count[0] = 0
        uc.emu_start(sym[name], STOP)
        return uc.reg_read(A.UC_ARM_REG_R0), count[0]

    rd = lambda n: (dump / n).read_bytes()
    RECIPES, PROFILE, TEX, GRAIN, IMG = D, D + 0x200, D + 0x300, D + 0x400, D + 0x800
    FINE, COARSE, CB, CR = D + 0x1000, D + 0x50000, D + 0xa0000, D + 0xc0000
    WORK, Y, C = D + 0x100000, D + 0x300000, D + 0x400000
    uc.mem_write(RECIPES, rd('recipes.bin')); uc.mem_write(PROFILE, rd('profile.bin'))
    uc.mem_write(TEX, struct.pack('<4I', FINE, COARSE, CB, CR))
    _, n_tex = call('dv_textures_make', TEX, RECIPES, WORK)
    ok = True
    for name, at in (('fine.bin', FINE), ('coarse.bin', COARSE), ('cb.bin', CB), ('cr.bin', CR)):
        ref = rd(name)
        same = bytes(uc.mem_read(at, len(ref))) == ref
        ok &= same
        print(f'{"ok    " if same else "ÉCHEC "} émulateur : texture {name[:-4]} identique au PC')
    seed, _ = call('dv_frame_seed', 23, 7)
    call('dv_grain_setup', GRAIN, TEX, PROFILE, 3, 1, seed)
    band = rd('band_in.bin')
    W, H = 2048, 128
    uc.mem_write(Y, band[:W * H]); uc.mem_write(C, band[W * H:])
    uc.mem_write(IMG, struct.pack('<5I', Y, C, W, H, W))
    PROFILE_ON[0] = True
    _, n_apply = call('dv_grain_apply', GRAIN, IMG, 0, 1000)
    PROFILE_ON[0] = False
    out = bytes(uc.mem_read(Y, W * H)) + bytes(uc.mem_read(C, W * H))
    same = out == rd('band_out.bin')
    ok &= same
    print(f'{"ok    " if same else "ÉCHEC "} émulateur : grain sur une bande de {W} x {H} identique au PC, au bit près')
    per_px = n_apply / (W * H)
    for n, c in sorted(prof.items(), key=lambda kv: -kv[1])[:6]:
        print(f'  {n:<20} {c / (W * H):6.1f} instructions par pixel')
    print(f'boîtier (émulateur) : textures {n_tex / 1e6:.0f} M instructions, grain {per_px:.0f} instructions par pixel '
          f'({per_px * 24e6 / 1e9:.1f} G instructions pour 24 Mpx)')
    return ok


def camera(tmp):
    objs = []
    for src in LIB:
        obj = tmp / (Path(src).stem + '.o')
        # The grain's loop is the hot one: optimised for speed, the rest for size (as the modules).
        flags = [f for f in ARM_FLAGS if f != '-Os'] + ['-O2'] if src == 'grain.c' else ARM_FLAGS
        run(['clang'] + flags + ['-I', HERE, '-c', HERE / src, '-o', obj])
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
            ok &= emulate(tmp, tmp / 'test')
        else:
            print('(clang / ld.lld absents : compilation pour le boîtier non vérifiée)')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
