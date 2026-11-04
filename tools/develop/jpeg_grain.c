/* SPDX-License-Identifier: GPL-2.0-only
 *
 * GR Mod Film: the grain on the JPEG at the shot (GR III / IIIx, round 10). A picture module of the
 * JPEG encode step (core/src/fw/gr3x/jpeg-stage.ts, after the halation, before the date), built
 * with the development library's grain (grain.c) into one position-independent blob
 * (tools/develop/gen_jpeg_grain.py).
 *
 * Which film and how much grain: the stash word the development step writes (image-control.ts,
 * round 10): bits 0..7 the style (a film 64 + k as 32 + k), bit 16 valid, bits 20..21 the film's
 * Grain (0 off, 1..3, from the parameter screen's Grain row) and bits 22..23 its Size (0 medium,
 * 1 fine, 2 coarse). The profile is the colour one, or the black-and-white one for a film the
 * build marks black and white (`mono`, by style).
 *
 * Each call: the four textures made from their recipes into a buffer taken from the camera's heap
 * (650 770 bytes, and 525 312 of scratch while they are made), then the grain on every picture of
 * the configuration (the full one and the smaller ones, each once), the texture step scaled by the
 * picture's width against the largest one (the grain keeps its size on the photo in every picture);
 * the buffers go back to the heap. The frame's seed is a hash of the full picture before the grain.
 * A picture this does not recognise (format, sizes) is left alone, as the halation does.
 */
#include "develop.h"

struct picture {
  u8 format;          /* 1: YCbCr 4:2:2, Cb/Cr interleaved in their own plane */
  u8 pad[3];
  u8 *y;
  u8 *c;
  u32 size;
  u16 width, height, stride, c_height;
  u16 x, y_off;
  u8 tail[4];
};

struct gctx {
  void *(*cache)(void);
  void (*invalidate)(void *cache, u32 addr, u32 n);
  void (*clean)(void *cache, u32 addr, u32 n);
  void *(*alloc)(u32 n);
  void (*release)(void *p);
  const volatile u32 *stash;
  const struct dv_tex_recipe *recipes;       /* the four textures' */
  const struct dv_grain_profile *profiles;   /* [0] colour, [1] black and white */
  const u8 *mono;                            /* 64 entries, by style: 1 black and white */
  u32 magic;                                 /* 'GRN1' */
};

#define GRAIN_MAGIC 0x314e5247u
#define STASH_VALID 0x10000u
#define TEX_BYTES (DV_FINE_N * DV_FINE_N + DV_COARSE_N * DV_COARSE_N + DV_CB_N * DV_CB_N + DV_CR_N * DV_CR_N)

static int ram(const void *p) {
  u32 a = (u32)p;
  return a >= 0x40000000u && a < 0xc0000000u && (a & 3) == 0;
}

static int picture_ok(const struct picture *p) {
  u32 w = p->width, h = p->height;
  if (p->format != 1 || !ram(p->y) || !ram(p->c) || w < 64 || h < 48 || p->stride < w || p->c_height < h) return 0;
  return w <= 12000 && h <= 12000;
}

static u32 udiv(u32 n, u32 d) {
  u32 q = 0, r = 0;
  s32 i;
  if (!d) return 0;
  for (i = 31; i >= 0; i--) {
    r = (r << 1) | ((n >> i) & 1u);
    if (r >= d) { r -= d; q |= 1u << i; }
  }
  return q;
}

static void sync(const struct gctx *k, void *cache, const struct picture *p, int clean) {
  u32 a, b;
  a = (u32)p->y & ~63u; b = ((u32)p->y + (u32)p->height * p->stride + 63u) & ~63u;
  if (clean) k->clean(cache, a, b - a); else k->invalidate(cache, a, b - a);
  a = (u32)p->c & ~63u; b = ((u32)p->c + (u32)p->height * p->stride + 63u) & ~63u;
  if (clean) k->clean(cache, a, b - a); else k->invalidate(cache, a, b - a);
}

/* 64 luma samples of the picture, FNV-1a: a different seed for every frame, the same for a frame. */
static u32 seed_of(const struct picture *p) {
  u32 h = 0x811c9dc5u, i, j, sy = p->height >> 3, sx = p->width >> 3;
  for (i = 0; i < 8; i++)
    for (j = 0; j < 8; j++) {
      h ^= p->y[(i * sy + (sy >> 1)) * p->stride + j * sx + (sx >> 1)];
      h *= 0x01000193u;
    }
  return h;
}

void grain_stage(const struct gctx *k, u32 *config) {
  u32 st, style, level, code, size, i, j, widest = 0, step;
  struct picture *seen[4], *main = 0;
  struct dv_textures tex;
  struct dv_grain g;
  void *cache;
  u8 *buf;
  s16 *work;
  if (!ram(k) || k->magic != GRAIN_MAGIC || !ram(config) || !ram(k->recipes) || !ram(k->profiles) || !ram(k->mono)) return;
  st = *k->stash;
  if (!(st & STASH_VALID)) return;
  style = st & 0xffu; level = (st >> 20) & 3u; code = (st >> 22) & 3u;
  if (!level || style >= 64u) return;
  size = code == 1u ? DV_SIZE_SMALL : code == 2u ? DV_SIZE_LARGE : DV_SIZE_PROFILE;
  /* One picture per buffer (another entry with the same planes describes the whole sensor). */
  for (i = 0; i < 4; i++) {
    struct picture *p = (struct picture *)config[(0x3c >> 2) + i];
    seen[i] = 0;
    if (!ram(p) || !picture_ok(p)) continue;
    for (j = 0; j < i; j++) if (seen[j] && seen[j]->y == p->y) break;
    if (j == i) { seen[i] = p; if (p->width > widest) { widest = p->width; main = p; } }
  }
  if (!main) return;
  buf = (u8 *)k->alloc((TEX_BYTES + 63u) & ~63u);
  if (!buf) return;
  work = (s16 *)k->alloc(DV_WORK_S16 * 2u);
  if (!work) { k->release(buf); return; }
  tex.fine = (s8 *)buf;
  tex.coarse = tex.fine + DV_FINE_N * DV_FINE_N;
  tex.cb = tex.coarse + DV_COARSE_N * DV_COARSE_N;
  tex.cr = tex.cb + DV_CB_N * DV_CB_N;
  dv_textures_make(&tex, k->recipes, work);
  k->release(work);
  cache = k->cache();
  sync(k, cache, main, 0);
  dv_grain_setup(&g, &tex, &k->profiles[k->mono[style] ? 1 : 0], level, size, seed_of(main));
  step = g.step_q16;
  for (i = 0; i < 4; i++) {
    struct picture *p = seen[i];
    struct dv_image im;
    if (!p) continue;
    if (p != main) sync(k, cache, p, 0);
    im.y = p->y; im.c = p->c; im.width = p->width & ~1u; im.height = p->height; im.stride = p->stride;
    g.step_q16 = p == main ? step : udiv(step * widest, p->width);
    dv_grain_apply(&g, &im, 0, 0);
    sync(k, cache, p, 1);
  }
  k->release(buf);
}
