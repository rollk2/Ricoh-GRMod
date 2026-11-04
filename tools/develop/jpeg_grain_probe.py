# SPDX-License-Identifier: GPL-2.0-only
"""The JPEG grain module (jpeg_grain.c, core/src/fw/gr3x/grain-module.ts) in the ARM emulator.

  python3 tools/develop/jpeg_grain_probe.py

The camera build of the module (from grain-module.ts, as the firmware carries it) runs in Unicorn
on a JPEG configuration of three synthetic pictures (a full one, two smaller; a fourth entry
repeats the full one's planes, as the camera's whole-sensor entry does), with the camera's
functions replaced (cache functions record their ranges, the heap is a bump allocator that
checks every release). Checked:
  - every byte of every picture is the PC reference's (host/grain_ref.c: the development
    library's textures, set-up and grain, the step scaled by the width as the module does), for
    the three levels, the three sizes, colour and black-and-white films;
  - nothing changes for a stash without the valid bit, Grain off, a style beyond 63, a refused
    picture format, a failed allocation (and then nothing leaks);
  - the planes are invalidated before and cleaned after, every allocation is released;
  - the instructions per pixel of the full picture (the camera's cost estimate).
"""
import base64
import re
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_ARM, UC_HOOK_CODE, UC_HOOK_BLOCK
from unicorn import arm_const as A

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
from build import LIB  # noqa: E402

TS = (ROOT / 'core/src/fw/gr3x/grain-module.ts').read_text()
get = lambda n: re.search(n + r" = '([^']*)'", TS).group(1)
CODE = base64.b64decode(get('GR3X_GRAIN_CODE'))
ENTRY = int(re.search(r'GR3X_GRAIN_ENTRY = (\d+)', TS).group(1))
RECIPES = base64.b64decode(get('GR3X_GRAIN_RECIPES'))
PROFILES = base64.b64decode(get('GR3X_GRAIN_PROFILES'))

BASE, STOP, STACK = 0x60000000, 0x60f00000, 0x70100000
FN = 0x61000000   # cache, invalidate, clean, alloc, release
CTX, STASH, DATA, CONFIG, PICS, HEAP = 0x62000000, 0x62000100, 0x62001000, 0x62002000, 0x63000000, 0x68000000
MAGIC = 0x314e5247
SIZES = [(768, 512), (384, 256), (160, 106)]


def fnv(y, w, h):
    hh, sy, sx = 0x811c9dc5, h >> 3, w >> 3
    for i in range(8):
        for j in range(8):
            hh = ((hh ^ y[(i * sy + (sy >> 1)) * w + j * sx + (sx >> 1)]) * 0x01000193) & 0xffffffff
    return hh


def picture(w, h, salt):
    """A smooth picture: a luma ramp with a soft bump and chroma gradients."""
    y = bytes(((x * 255 // (w - 1)) + ((r * 37 + salt) % 23)) & 0xff for r in range(h) for x in range(w))
    c = bytes((96 + (x * 64 // w) if x % 2 == 0 else 160 - (r * 64 // h)) for r in range(h) for x in range(w))
    return y, c


class Probe:
    def __init__(self):
        u = self.uc = Uc(UC_ARCH_ARM, UC_MODE_ARM)
        u.mem_map(BASE, 0x1000000); u.mem_write(BASE, CODE)
        for a, n in ((FN, 0x1000), (STACK - 0x100000, 0x100000), (CTX, 0x10000), (PICS, 0x2000000), (HEAP, 0x4000000)):
            u.mem_map(a, n)
        self.count = 0
        u.hook_add(UC_HOOK_CODE, self.hook, begin=FN, end=FN + 0x100)
        u.hook_add(UC_HOOK_BLOCK, self.block, begin=BASE, end=BASE + len(CODE))

    def block(self, u, a, size, d):
        self.count += size // 4

    def hook(self, u, a, size, d):
        r = lambda n: u.reg_read(getattr(A, 'UC_ARM_REG_R%d' % n))
        k = (a - FN) // 4
        ret = 0
        if k == 0: ret = 0xcace
        elif k in (1, 2):
            assert r(0) == 0xcace
            self.syncs.append(('inv' if k == 1 else 'clean', r(1), r(2)))
        elif k == 3:
            n = r(0)
            if self.fail_alloc or n > 0x200000: ret = 0
            else:
                ret = self.top; self.top += (n + 63) & ~63; self.live.add(ret)
        elif k == 4:
            assert r(0) in self.live, hex(r(0)); self.live.discard(r(0))
        u.reg_write(A.UC_ARM_REG_R0, ret); u.reg_write(A.UC_ARM_REG_PC, u.reg_read(A.UC_ARM_REG_LR))

    def run(self, stash, pics, mono=b'', fmt=1, fail_alloc=False):
        u = self.uc
        self.syncs, self.live, self.top, self.fail_alloc = [], set(), HEAP, fail_alloc
        monomap = bytearray(64)
        for s in mono: monomap[s] = 1
        u.mem_write(DATA, RECIPES + PROFILES + bytes(monomap))
        u.mem_write(CTX, struct.pack('<10I', FN, FN + 4, FN + 8, FN + 12, FN + 16, STASH, DATA, DATA + len(RECIPES), DATA + len(RECIPES) + len(PROFILES), MAGIC))
        u.mem_write(STASH, struct.pack('<I', stash))
        entries, at = [], PICS
        for w, h, y, c in pics:
            u.mem_write(at, y); u.mem_write(at + 0x800000, c)
            desc = CTX + 0x4000 + len(entries) * 0x40
            u.mem_write(desc, struct.pack('<B3xIIIHHHHHH4x', fmt, at, at + 0x800000, w * h, w, h, w, h, 0, 0))
            entries.append(desc); at += 0x200000
        entries.append(entries[0])   # the whole sensor: the full picture's planes again
        entries += [0] * (4 - len(entries))
        u.mem_write(CONFIG, bytes(0x3c) + struct.pack('<4I', *entries))
        u.reg_write(A.UC_ARM_REG_R0, CTX); u.reg_write(A.UC_ARM_REG_R1, CONFIG)
        u.reg_write(A.UC_ARM_REG_SP, STACK); u.reg_write(A.UC_ARM_REG_LR, STOP)
        self.count = 0
        u.emu_start(BASE + ENTRY, STOP)
        out = []
        at = PICS
        for w, h, _, _ in pics:
            out.append((bytes(u.mem_read(at, w * h)), bytes(u.mem_read(at + 0x800000, w * h)))); at += 0x200000
        assert not self.live, 'allocation not released'
        return out


def main():
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        ref = tmp / 'grain_ref'
        subprocess.run(['cc', '-O2', '-I', str(HERE / 'host'), '-o', str(ref), str(HERE / 'host/grain_ref.c'), str(HERE / 'host/host.c')] +
                       [str(HERE / f) for f in LIB] + ['-lm'], check=True)
        (tmp / 'r.bin').write_bytes(RECIPES); (tmp / 'p.bin').write_bytes(PROFILES)
        p = Probe()
        pics = [(w, h) + picture(w, h, k * 11) for k, (w, h) in enumerate(SIZES)]
        cases = 0
        for level in (1, 2, 3):
            for code, size in ((0, 1), (1, 0), (2, 2)):
                for style, mono in ((32, False), (33, True), (11, False)):
                    stash = style | 0x10000 | level << 20 | code << 22 | 3 << 8 | 0x20000   # plus a halation level and its white bit
                    out = p.run(stash, pics, mono=[33] if mono else [])
                    seed = fnv(pics[0][2], *SIZES[0])
                    args = [str(ref), str(tmp / 'r.bin'), str(tmp / 'p.bin'), str(level), str(size), str(int(mono)), str(seed), str(SIZES[0][0])]
                    for k, (w, h, y, c) in enumerate(pics):
                        (tmp / f'in{k}').write_bytes(y + c); args += [str(w), str(h), str(tmp / f'in{k}'), str(tmp / f'out{k}')]
                    subprocess.run(args, check=True)
                    for k, (w, h, y, c) in enumerate(pics):
                        want = (tmp / f'out{k}').read_bytes()
                        assert out[k][0] + out[k][1] == want, (level, size, style, k)
                        assert out[k][0] != y, 'no grain'
                    regions = {(a, n) for _, a, n in p.syncs}
                    assert len([s for s in p.syncs if s[0] == 'inv']) == 6 and len([s for s in p.syncs if s[0] == 'clean']) == 6, p.syncs
                    assert {(s[1], s[2]) for s in p.syncs if s[0] == 'inv'} == {(s[1], s[2]) for s in p.syncs if s[0] == 'clean'} == regions
                    cases += 1
                    if level == 2 and code == 0 and style == 32:
                        full = p.count
                        p.run(stash, pics[2:]); small = p.count     # the smallest picture alone
                        px_full, px_small = sum(w * h for w, h in SIZES), SIZES[2][0] * SIZES[2][1]
                        per_px = (full - small) / (px_full - px_small); textures = full - per_px * px_full
        base_stash = 32 | 0x10000 | 2 << 20
        for stash, kw in ((base_stash & ~0x10000, {}), (base_stash & ~(3 << 20), {}), (64 | 0x10000 | 2 << 20, {}), (base_stash, {'fmt': 2}), (base_stash, {'fail_alloc': True})):
            out = p.run(stash, pics, **kw)
            assert all(out[k] == (pics[k][2], pics[k][3]) for k in range(3)), (hex(stash), kw)
            cases += 1
        print(f'ok    émulateur : grain du JPEG identique au PC au bit près ({cases} cas, 3 images par cas)')
        print(f'boîtier (émulateur) : textures {textures / 1e6:.0f} M instructions, grain {per_px:.0f} instructions par pixel, '
              f'soit environ {(textures + per_px * 24.6e6) / 1e9:.1f} G instructions pour 24 Mpx et ses aperçus')


if __name__ == '__main__':
    main()
