/* SPDX-License-Identifier: GPL-2.0-only
 *
 * GR Mod Film, development library: PC side. See host.h.
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "host.h"

static void gaussian_taps(struct dv_tex_recipe *r, double sigma) {
  int half = (int)ceil(3.0 * sigma), k, taps, sum = 0, mid;
  double w[DV_TAPS_MAX], total = 0;
  if (half > (int)DV_TAPS_MAX / 2) half = DV_TAPS_MAX / 2;
  taps = 2 * half + 1;
  for (k = 0; k < taps; k++) { double d = k - half; w[k] = exp(-d * d / (2 * sigma * sigma)); total += w[k]; }
  for (k = 0; k < taps; k++) { r->tap[k] = (unsigned short)lround(w[k] / total * 4096); sum += r->tap[k]; }
  mid = half;
  r->tap[mid] = (unsigned short)(r->tap[mid] + 4096 - sum);  /* exactly 4096 */
  r->taps = (unsigned short)taps;
}

static double texture_sd(const struct dv_tex_recipe *r) {
  s16 *work = malloc(sizeof(s16) * DV_WORK_S16);
  double sum = 0, sq = 0, nn = (double)r->n * r->n;
  unsigned i;
  dv_tex_noise(r, work);
  for (i = 0; i < r->n * r->n; i++) { sum += work[i]; sq += (double)work[i] * work[i]; }
  free(work);
  sum /= nn;
  return sqrt(sq / nn - sum * sum);
}

void host_recipes(struct dv_tex_recipe r[4]) {
  static const unsigned ns[4] = { DV_FINE_N, DV_COARSE_N, DV_CB_N, DV_CR_N };
  static const double sig[4] = { 0.6, 1.8, 1.2, 1.2 };
  static const unsigned seeds[4] = { 0x1f2e3d4cu, 0x5a6b7c8du, 0x13579bdfu, 0x2468ace0u };
  int i;
  memset(r, 0, sizeof(*r) * 4);
  for (i = 0; i < 4; i++) {
    r[i].n = (unsigned short)ns[i]; r[i].seed = seeds[i];
    gaussian_taps(&r[i], sig[i]);
    r[i].scale_q16 = (unsigned)lround(DV_TEX_SD / texture_sd(&r[i]) * 65536.0);
  }
}

void host_textures(struct dv_textures *t, const struct dv_tex_recipe r[4]) {
  s16 *work = malloc(sizeof(s16) * DV_WORK_S16);
  t->fine = malloc(DV_FINE_N * DV_FINE_N); t->coarse = malloc(DV_COARSE_N * DV_COARSE_N);
  t->cb = malloc(DV_CB_N * DV_CB_N); t->cr = malloc(DV_CR_N * DV_CR_N);
  dv_textures_make(t, r, work);
  free(work);
}

/* ------------------------------------------------------------------ profiles */

void host_profile_make(struct dv_grain_profile *p, int amount, double size, int mix, int chroma, const double tone[17]) {
  static const double mult[3] = { 0.75, 1.0, 1.4 };
  int i;
  memset(p, 0, sizeof(*p));
  p->amount = (u8)amount; p->octave_mix = (u8)mix; p->chroma = (u8)chroma;
  for (i = 0; i < 17; i++) p->tone[i] = (u8)lround(tone[i] < 0 ? 0 : tone[i] > 255 ? 255 : tone[i]);
  for (i = 0; i < 3; i++) p->step_q16[i] = (u32)lround(65536.0 / (size * mult[i]));
}

/* A tone curve: a bump centred at `c` (0..1 of the luma) of width `w`, over a floor in the
 * shadows that fades to `top` at white. */
static void tone_curve(double out[17], double c, double w, double shadow, double top) {
  int i;
  for (i = 0; i < 17; i++) {
    double l = i == 16 ? 1.0 : i / 16.0, b = exp(-(l - c) * (l - c) / (2 * w * w));
    double floor_ = shadow * (1 - l) + top * l;
    double v = floor_ + (255 - floor_) * b;
    if (l > 0.94) v = v * (1 - l) / 0.06 + top * (l - 0.94) / 0.06;  /* clean whites */
    out[i] = v;
  }
}

static const char *const NAMES[ARCH_COUNT] = {
  "N&B 400 poussable", "N&B 100 fin", "Negatif couleur 400", "Negatif couleur 160 portrait", "Diapositive 100", "Cinema 500T",
};
const char *host_arch_name(int a) { return a >= 0 && a < ARCH_COUNT ? NAMES[a] : "?"; }

void host_profile(struct dv_grain_profile *p, int a) {
  double t[17];
  switch (a) {
  case ARCH_BW400:    tone_curve(t, 0.45, 0.22, 170, 30); host_profile_make(p, 70, 1.8, 60, 0, t); break;
  case ARCH_BW100:    tone_curve(t, 0.50, 0.18, 90, 20);  host_profile_make(p, 30, 1.0, 30, 0, t); break;
  case ARCH_NEG400:   tone_curve(t, 0.60, 0.22, 80, 8);   host_profile_make(p, 45, 1.4, 45, 25, t); break;
  case ARCH_NEG160:   tone_curve(t, 0.50, 0.20, 60, 4);   host_profile_make(p, 25, 1.0, 30, 15, t); break;
  case ARCH_SLIDE100: tone_curve(t, 0.22, 0.18, 120, 6);  host_profile_make(p, 20, 0.9, 25, 10, t); break;
  default:            tone_curve(t, 0.35, 0.24, 150, 8);  host_profile_make(p, 55, 1.6, 55, 35, t); break;
  }
}

/* ------------------------------------------------------------------ pictures */

void host_image_new(struct host_image *h, unsigned w, unsigned hgt, unsigned char y, unsigned char cb, unsigned char cr) {
  unsigned i;
  h->buf = malloc((size_t)w * hgt * 2);
  h->im.y = h->buf; h->im.c = h->buf + (size_t)w * hgt;
  h->im.width = w; h->im.height = hgt; h->im.stride = w;
  memset(h->im.y, y, (size_t)w * hgt);
  for (i = 0; i < w * hgt; i += 2) { h->im.c[i] = cb; h->im.c[i + 1] = cr; }
}

void host_image_free(struct host_image *h) { free(h->buf); h->buf = 0; }

int host_write_pgm(const char *path, const struct dv_image *im) {
  FILE *f = fopen(path, "wb");
  unsigned y;
  if (!f) return -1;
  fprintf(f, "P5\n%u %u\n255\n", im->width, im->height);
  for (y = 0; y < im->height; y++) fwrite(im->y + y * im->stride, 1, im->width, f);
  return fclose(f);
}

static unsigned char sat(double v) { return (unsigned char)(v < 0 ? 0 : v > 255 ? 255 : lround(v)); }

int host_write_ppm(const char *path, const struct dv_image *im) {
  FILE *f = fopen(path, "wb");
  unsigned x, y;
  if (!f) return -1;
  fprintf(f, "P6\n%u %u\n255\n", im->width, im->height);
  for (y = 0; y < im->height; y++)
    for (x = 0; x < im->width; x++) {
      double Y = im->y[y * im->stride + x], cb = im->c[y * im->stride + (x & ~1u)] - 128.0, cr = im->c[y * im->stride + (x | 1u)] - 128.0;
      unsigned char rgb[3] = { sat(Y + 1.402 * cr), sat(Y - 0.344136 * cb - 0.714136 * cr), sat(Y + 1.772 * cb) };
      fwrite(rgb, 1, 3, f);
    }
  return fclose(f);
}
