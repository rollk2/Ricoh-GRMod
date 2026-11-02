/* SPDX-License-Identifier: GPL-2.0-only
 *
 * GR Mod Film: film grain (docs/SPEC-developpement-diptyque-grain.md, "Algorithme de référence").
 *
 * Grain is not uniform noise: it is two octaves of blurred noise (fine and coarse, in clumps),
 * weighted by a tone curve of the film (little in the highlights), its size tied to the film,
 * with a decorrelated chroma grain for colour films. Textures are made once, deterministically,
 * from seeds; each frame reads them from its own offset and orientation (from the roll and frame
 * numbers), with a step of 1 / size, bilinearly. The same frame always gets the same grain.
 *
 * Camera rules (see develop.h): no division, no data, no floating point, no library.
 */
#include "develop.h"

/* ------------------------------------------------------------------ helpers */

static u32 xorshift(u32 *s) {
  u32 x = *s;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  *s = x;
  return x;
}

/* murmur3's finaliser: a good 32-bit mix without division. */
static u32 mix32(u32 h) {
  h ^= h >> 16; h *= 0x85ebca6bu;
  h ^= h >> 13; h *= 0xc2b2ae35u;
  h ^= h >> 16;
  return h;
}

/* v mod n, for v at most a few dozen times n (no division). */
static u32 mod_small(u32 v, u32 n) {
  while (v >= n) v -= n;
  return v;
}

/* (a * b) mod m by doubling, every value kept below m (m below 2^30). */
static u32 mulmod(u32 a, u32 b, u32 m) {
  u32 r = 0;
  b = mod_small(b, m);
  while (a) {
    if (a & 1u) { r += b; if (r >= m) r -= m; }
    b += b; if (b >= m) b -= m;
    a >>= 1;
  }
  return r;
}

/* ------------------------------------------------------------------ textures */

static void blur_line(s16 *line, s16 *tmp, u32 n, u32 step, const struct dv_tex_recipe *r) {
  u32 i, k, half = r->taps >> 1;
  for (i = 0; i < n; i++) tmp[i] = line[i * step];
  for (i = 0; i < n; i++) {
    s32 acc = 0;
    for (k = 0; k < r->taps; k++) {
      s32 j = (s32)i + (s32)k - (s32)half;
      if (j < 0) j += (s32)n; else if (j >= (s32)n) j -= (s32)n;
      acc += (s32)r->tap[k] * tmp[j];
    }
    line[i * step] = (s16)((acc + 2048) >> 12);
  }
}

void dv_tex_noise(const struct dv_tex_recipe *r, s16 *work) {
  u32 n = r->n, i, s = r->seed ? r->seed : 0x6d2b79f5u;
  s16 *tmp = work + n * n;
  for (i = 0; i < n * n; i++) {
    u32 v = xorshift(&s);
    work[i] = (s16)((s32)((v & 255u) + ((v >> 8) & 255u) + ((v >> 16) & 255u) + (v >> 24)) - 510);
  }
  for (i = 0; i < n; i++) blur_line(work + i * n, tmp, n, 1, r);   /* rows */
  for (i = 0; i < n; i++) blur_line(work + i, tmp, n, n, r);       /* columns */
}

static void make_one(s8 *out, const struct dv_tex_recipe *r, s16 *work) {
  u32 n = r->n, i;
  dv_tex_noise(r, work);
  for (i = 0; i < n * n; i++) {
    s32 v = ((s32)work[i] * (s32)r->scale_q16 + 32768) >> 16;
    if (v > 127) v = 127; else if (v < -127) v = -127;
    out[i] = (s8)v;
  }
}

void dv_textures_make(const struct dv_textures *t, const struct dv_tex_recipe recipe[4], s16 *work) {
  make_one(t->fine, &recipe[0], work);
  make_one(t->coarse, &recipe[1], work);
  make_one(t->cb, &recipe[2], work);
  make_one(t->cr, &recipe[3], work);
}

/* ------------------------------------------------------------------ frame set-up */

u32 dv_frame_seed(u32 roll, u32 frame) {
  return mix32(mix32(roll * 0x9e3779b1u + 0x632be5abu) ^ (frame * 0x85ebca77u + 0x27d4eb2fu));
}

static u32 tex_n(u32 i) {
  return i == 0 ? DV_FINE_N : i == 1 ? DV_COARSE_N : i == 2 ? DV_CB_N : DV_CR_N;
}

void dv_grain_setup(struct dv_grain *g, const struct dv_textures *t, const struct dv_grain_profile *p,
                    u32 intensity, u32 size, u32 seed) {
  u32 i, m, h = seed;
  /* Intensity: Off, Low, Profile, High = 0, 0.6, 1.0, 1.5 of the profile (Q8). */
  m = intensity == DV_INTENSITY_LOW ? 154u : intensity == DV_INTENSITY_PROFILE ? 256u : intensity == DV_INTENSITY_HIGH ? 384u : 0u;
  g->tex = t;
  g->amount = (p->amount * m + 128u) >> 8;
  g->chroma = (p->chroma * m + 128u) >> 8;
  g->mix = p->octave_mix > 100u ? 100u : p->octave_mix;
  g->step_q16 = p->step_q16[size > 2u ? 1u : size];
  for (i = 0; i < 4; i++) {
    u32 n = tex_n(i);
    h = mix32(h + 0x9e3779b9u);
    g->offx[i] = (mod_small(h >> 16, n) << 16) | (h & 0xffffu);
    h = mix32(h + 0x9e3779b9u);
    g->offy[i] = (mod_small(h >> 16, n) << 16) | (h & 0xffffu);
    g->orient[i] = h >> 29;
    h = mix32(h + 0x9e3779b9u);
    g->salt[i] = h;
  }
  /* The tone curve: 17 points 16 levels apart (the last at 255), linear in between. */
  for (i = 0; i < 256; i++) {
    u32 k = i >> 4, f = i & 15u;
    s32 a = p->tone[k], b = p->tone[k + 1];
    g->lut[i] = (u8)(a + (((b - a) * (s32)f) >> 4));
  }
}

/* ------------------------------------------------------------------ sampling */

/* A texture is periodic: read straight across a frame it would repeat every n * size pixels (717
 * pixels for 512 at size 1.4, a visible pattern on a plain sky). So the frame is cut into tiles of
 * DV_TILE pixels, each reading the texture from its own offset (from the frame's seed and the
 * tile's position): a tile never spans a period, and two tiles are independent. Across a band of
 * DV_SEAM pixels at each tile edge the two readings are blended, with a gain that keeps the grain's
 * strength (two independent fields blended with weights w and 1 - w have the variance
 * w^2 + (1 - w)^2 of one). */
#define TILE_SHIFT 7u
#define SEAM_SHIFT 5u
#define TILE (1u << TILE_SHIFT)
#define SEAM (1u << SEAM_SHIFT)

/* Bilinear sample of a texture at (x, y), Q16 and wrapped: Q8, -32512..32512. */
static s32 tex_at(const s8 *t, u32 n, u32 x, u32 y) {
  u32 i0 = x >> 16, j0 = y >> 16, i1 = i0 + 1, j1 = j0 + 1;
  s32 fx = (s32)((x >> 8) & 255u), fy = (s32)((y >> 8) & 255u), top, bot;
  const s8 *r0, *r1;
  if (i1 == n) i1 = 0;
  if (j1 == n) j1 = 0;
  r0 = t + j0 * n; r1 = t + j1 * n;
  top = r0[i0] * (256 - fx) + r0[i1] * fx;
  bot = r1[i0] * (256 - fx) + r1[i1] * fx;
  return (top * (256 - fy) + bot * fy) >> 8;
}

static u32 wrap_add(u32 v, s32 d, u32 n16) {
  s32 r = (s32)v + d;
  if (r < 0) r += (s32)n16; else if (r >= (s32)n16) r -= (s32)n16;
  return (u32)r;
}

/* One texture read along the frame: the frame's position in it without the tiles' offsets (Q16,
 * wrapped), how that moves for one step right (ax, ay) and one row down (bx, by), and the offsets
 * of the tiles around the current pixel. */
struct octave {
  const s8 *t;
  u32 n, n16, salt;
  s32 ax, ay, bx, by;
  u32 rx, ry;            /* row start */
  u32 x, y;              /* current */
  s32 kx, ky;            /* tiles whose offsets are cached */
  u32 ox[4], oy[4];      /* offsets of tiles (kx - 1, ky - 1), (kx, ky - 1), (kx - 1, ky), (kx, ky) */
};

/* Position of frame pixel (X, Y), `pitch` frame pixels per step (2 for the chroma grid). */
static void octave_init(struct octave *o, const s8 *t, u32 n, u32 offx, u32 offy, u32 orient, u32 step,
                        u32 X, u32 Y, u32 pitch, u32 salt) {
  s32 sx = (orient & 1u) ? -1 : 1, sy = (orient & 2u) ? -1 : 1;
  u32 px, py, n16 = n << 16, dx = mulmod(X, step * pitch, n16), dy = mulmod(Y, step, n16);
  o->t = t; o->n = n; o->n16 = n16; o->salt = salt; o->kx = 0x7fffffff; o->ky = 0x7fffffff;
  if (orient & 4u) { o->ax = 0; o->ay = sy * (s32)(step * pitch); o->bx = sx * (s32)step; o->by = 0; }
  else { o->ax = sx * (s32)(step * pitch); o->ay = 0; o->bx = 0; o->by = sy * (s32)step; }
  px = mod_small(offx, n16); py = mod_small(offy, n16);
  if (o->ax) px = wrap_add(px, o->ax > 0 ? (s32)dx : -(s32)dx, n16);
  if (o->ay) py = wrap_add(py, o->ay > 0 ? (s32)dx : -(s32)dx, n16);
  if (o->bx) px = wrap_add(px, o->bx > 0 ? (s32)dy : -(s32)dy, n16);
  if (o->by) py = wrap_add(py, o->by > 0 ? (s32)dy : -(s32)dy, n16);
  o->rx = px; o->ry = py; o->x = px; o->y = py;
}

static void octave_row(struct octave *o) {
  o->rx = wrap_add(o->rx, o->bx, o->n16); o->ry = wrap_add(o->ry, o->by, o->n16);
  o->x = o->rx; o->y = o->ry;
}

static void octave_next(struct octave *o) {
  o->x = wrap_add(o->x, o->ax, o->n16); o->y = wrap_add(o->y, o->ay, o->n16);
}

static void tile_offset(const struct octave *o, s32 kx, s32 ky, u32 *ox, u32 *oy) {
  u32 h = mix32(o->salt ^ mix32((u32)kx * 0x9e3779b1u ^ (u32)ky * 0x85ebca77u));
  *ox = (mod_small(h >> 16, o->n) << 16) | ((h & 255u) << 8);
  h = mix32(h + 0x632be5abu);
  *oy = (mod_small(h >> 16, o->n) << 16) | ((h & 255u) << 8);
}

static s32 tile_sample(const struct octave *o, u32 k) {
  return tex_at(o->t, o->n, wrap_add(o->x, (s32)o->ox[k], o->n16), wrap_add(o->y, (s32)o->oy[k], o->n16));
}

/* The grain value of the current position in tile cell (kx, ky) with seam weights (Q8 of the
 * right / lower tile, or -1 outside a seam), Q8. */
static s32 octave_take(struct octave *o, s32 kx, s32 ky, s32 wx, s32 wy, const u16 *gain) {
  s32 v;
  if (kx != o->kx || ky != o->ky) {
    tile_offset(o, kx - 1, ky - 1, &o->ox[0], &o->oy[0]); tile_offset(o, kx, ky - 1, &o->ox[1], &o->oy[1]);
    tile_offset(o, kx - 1, ky, &o->ox[2], &o->oy[2]); tile_offset(o, kx, ky, &o->ox[3], &o->oy[3]);
    o->kx = kx; o->ky = ky;
  }
  if (wx < 0 && wy < 0) v = tile_sample(o, 3);
  else if (wy < 0) v = ((((256 - wx) * tile_sample(o, 2) + wx * tile_sample(o, 3)) >> 8) * gain[wx]) >> 12;
  else if (wx < 0) v = ((((256 - wy) * tile_sample(o, 1) + wy * tile_sample(o, 3)) >> 8) * gain[wy]) >> 12;
  else {
    s32 up = ((((256 - wx) * tile_sample(o, 0) + wx * tile_sample(o, 1)) >> 8) * gain[wx]) >> 12;
    s32 dn = ((((256 - wx) * tile_sample(o, 2) + wx * tile_sample(o, 3)) >> 8) * gain[wx]) >> 12;
    v = ((((256 - wy) * up + wy * dn) >> 8) * gain[wy]) >> 12;
  }
  octave_next(o);
  return v;
}

/* Tile cell and seam weight of frame coordinate v (the seam centred on the tile edge). */
static void cell(u32 v, s32 *k, s32 *w) {
  u32 s = v + (SEAM >> 1), t = s & (TILE - 1u);
  *k = (s32)(s >> TILE_SHIFT);
  *w = t < SEAM ? (s32)((t << 8) >> SEAM_SHIFT) : -1;
}

static u8 clamp8(s32 v) { return (u8)(v < 0 ? 0 : v > 255 ? 255 : v); }

/* 1 / sqrt(w^2 + (1 - w)^2) for w = i / 256, Q12, by Newton's iteration (no division). */
static void seam_gains(u16 *gain) {
  u32 i, k;
  for (i = 0; i <= 256; i++) {
    s32 w = (s32)i << 4, x = (w * w + (4096 - w) * (4096 - w)) >> 12, y = 5000;  /* Q12, x in 0.5..1 */
    for (k = 0; k < 6; k++) y = (y * ((3 << 12) - ((((x * y) >> 12) * y) >> 12))) >> 13;
    gain[i] = (u16)y;
  }
}

/* ------------------------------------------------------------------ application */

void dv_grain_apply(const struct dv_grain *g, struct dv_image *img, u32 x0, u32 y0) {
  const struct dv_textures *t = g->tex;
  struct octave of, oc, ob, orr;
  u16 gain[257];
  u32 x, y, w = img->width & ~1u, mf = 100u - g->mix, mc = g->mix;
  s32 half = 1 << (DV_GRAIN_SHIFT - 1);
  if (!g->amount && !g->chroma) return;
  seam_gains(gain);
  octave_init(&of, t->fine, DV_FINE_N, g->offx[0], g->offy[0], g->orient[0], g->step_q16, x0, y0, 1, g->salt[0]);
  octave_init(&oc, t->coarse, DV_COARSE_N, g->offx[1], g->offy[1], g->orient[1], g->step_q16, x0, y0, 1, g->salt[1]);
  octave_init(&ob, t->cb, DV_CB_N, g->offx[2], g->offy[2], g->orient[2], g->step_q16, x0 >> 1, y0, 2, g->salt[2]);
  octave_init(&orr, t->cr, DV_CR_N, g->offx[3], g->offy[3], g->orient[3], g->step_q16, x0 >> 1, y0, 2, g->salt[3]);
  for (y = 0; y < img->height; y++) {
    u8 *Y = img->y + y * img->stride, *C = img->c + y * img->stride;
    s32 ky, wy;
    cell(y0 + y, &ky, &wy);
    if (y) { octave_row(&of); octave_row(&oc); octave_row(&ob); octave_row(&orr); }
    for (x = 0; x < w; x += 2) {
      u32 y0v = Y[x], y1v = Y[x + 1];
      s32 kx, wx;
      cell(x0 + x, &kx, &wx);
      if (g->amount) {
        s32 m0 = ((s32)mf * octave_take(&of, kx, ky, wx, wy, gain) + (s32)mc * octave_take(&oc, kx, ky, wx, wy, gain)) >> 8, m1;
        cell(x0 + x + 1, &kx, &wx);
        m1 = ((s32)mf * octave_take(&of, kx, ky, wx, wy, gain) + (s32)mc * octave_take(&oc, kx, ky, wx, wy, gain)) >> 8;
        Y[x] = clamp8((s32)y0v + ((m0 * (s32)g->amount * (s32)g->lut[y0v] + half) >> DV_GRAIN_SHIFT));
        Y[x + 1] = clamp8((s32)y1v + ((m1 * (s32)g->amount * (s32)g->lut[y1v] + half) >> DV_GRAIN_SHIFT));
        cell(x0 + x, &kx, &wx);
      }
      if (g->chroma) {
        s32 wgt = g->lut[(y0v + y1v) >> 1];
        s32 db = (100 * octave_take(&ob, kx, ky, wx, wy, gain)) >> 8, dr = (100 * octave_take(&orr, kx, ky, wx, wy, gain)) >> 8;
        C[x] = clamp8((s32)C[x] + ((db * (s32)g->chroma * wgt + half) >> DV_GRAIN_SHIFT));
        C[x + 1] = clamp8((s32)C[x + 1] + ((dr * (s32)g->chroma * wgt + half) >> DV_GRAIN_SHIFT));
      }
    }
  }
}
