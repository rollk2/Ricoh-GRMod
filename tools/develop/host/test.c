/* SPDX-License-Identifier: GPL-2.0-only
 *
 * GR Mod Film, development library: tests on the PC (docs/SPEC-developpement-diptyque-grain.md,
 * "Tests et critères d'acceptation", the grain's part). Usage: test [output folder for images].
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "host.h"

static int failures = 0;
#define CHECK(cond, ...) do { if (!(cond)) { failures++; printf("ÉCHEC  "); printf(__VA_ARGS__); printf("\n"); } else { printf("ok     "); printf(__VA_ARGS__); printf("\n"); } } while (0)

static struct dv_tex_recipe R[4];
static struct dv_textures T;

static void grain_on(struct host_image *h, int arch, unsigned intensity, unsigned size, unsigned roll, unsigned frame, unsigned x0, unsigned y0) {
  struct dv_grain_profile p;
  struct dv_grain g;
  host_profile(&p, arch);
  dv_grain_setup(&g, &T, &p, intensity, size, dv_frame_seed(roll, frame));
  dv_grain_apply(&g, &h->im, x0, y0);
}

static double sd_rect(const struct dv_image *im, unsigned x0, unsigned y0, unsigned w, unsigned h, double *mean) {
  double s = 0, q = 0, n = (double)w * h;
  unsigned x, y;
  for (y = y0; y < y0 + h; y++) for (x = x0; x < x0 + w; x++) { double v = im->y[y * im->stride + x]; s += v; q += v * v; }
  s /= n;
  if (mean) *mean = s;
  return sqrt(q / n - s * s);
}

/* Normalised horizontal autocorrelation of the luma at a lag, over a region. */
static double autocorr(const struct dv_image *im, unsigned x0, unsigned y0, unsigned w, unsigned h, unsigned lag) {
  double mean, sd = sd_rect(im, x0, y0, w, h, &mean), s = 0;
  unsigned x, y;
  for (y = y0; y < y0 + h; y++) for (x = x0; x + lag < x0 + w; x++)
    s += (im->y[y * im->stride + x] - mean) * (im->y[y * im->stride + x + lag] - mean);
  return s / ((double)(w - lag) * h) / (sd * sd);
}

/* Grain size: the lag (interpolated) where the autocorrelation falls to 0.5. */
static double grain_size(const struct dv_image *im, unsigned x0, unsigned y0, unsigned w, unsigned h) {
  double prev = 1.0;
  unsigned lag;
  for (lag = 1; lag < 40; lag++) {
    double c = autocorr(im, x0, y0, w, h, lag);
    if (c < 0.5) return lag - 1 + (prev - 0.5) / (prev - c);
    prev = c;
  }
  return 40;
}

static void test_textures(void) {
  unsigned i, k, sum;
  for (i = 0; i < 4; i++) {
    for (sum = 0, k = 0; k < R[i].taps; k++) sum += R[i].tap[k];
    CHECK(sum == 4096 && (R[i].taps & 1u), "texture %u : noyau de %u coefficients, somme %u", i, R[i].taps, sum);
  }
  {
    const s8 *tex[4] = { T.fine, T.coarse, T.cb, T.cr };
    for (i = 0; i < 4; i++) {
      unsigned n = R[i].n, j;
      double s = 0, q = 0;
      for (j = 0; j < n * n; j++) { s += tex[i][j]; q += (double)tex[i][j] * tex[i][j]; }
      s /= (double)n * n;
      q = sqrt(q / ((double)n * n) - s * s);
      CHECK(fabs(q - DV_TEX_SD) < DV_TEX_SD * 0.05 && fabs(s) < 1.0, "texture %u : écart-type %.2f (cible %d), moyenne %.3f", i, q, DV_TEX_SD, s);
    }
  }
}

static void test_determinism(void) {
  struct host_image a, b;
  host_image_new(&a, 600, 400, 118, 120, 140); host_image_new(&b, 600, 400, 118, 120, 140);
  grain_on(&a, ARCH_NEG400, DV_INTENSITY_PROFILE, DV_SIZE_PROFILE, 23, 7, 0, 0);
  grain_on(&b, ARCH_NEG400, DV_INTENSITY_PROFILE, DV_SIZE_PROFILE, 23, 7, 0, 0);
  CHECK(!memcmp(a.buf, b.buf, 600 * 400 * 2), "déterminisme : deux développements de la même vue identiques au bit près");
  host_image_free(&b); host_image_new(&b, 600, 400, 118, 120, 140);
  grain_on(&b, ARCH_NEG400, DV_INTENSITY_PROFILE, DV_SIZE_PROFILE, 23, 8, 0, 0);
  CHECK(memcmp(a.buf, b.buf, 600 * 400) != 0, "graine : la vue 8 a un grain différent de la vue 7");
  CHECK(dv_frame_seed(23, 7) == 0x0u + dv_frame_seed(23, 7) && dv_frame_seed(23, 7) != dv_frame_seed(24, 7), "graine : stable, différente d'un rouleau à l'autre");
  host_image_free(&a); host_image_free(&b);
}

static void test_neutral(void) {
  struct host_image a, b;
  int arch;
  for (arch = 0; arch < ARCH_COUNT; arch++) {
    host_image_new(&a, 320, 200, 100, 90, 160); host_image_new(&b, 320, 200, 100, 90, 160);
    grain_on(&a, arch, DV_INTENSITY_OFF, DV_SIZE_PROFILE, 1, 1, 0, 0);
    CHECK(!memcmp(a.buf, b.buf, 320 * 200 * 2), "neutralité : intensité Off ne change rien (%s)", host_arch_name(arch));
    host_image_free(&a); host_image_free(&b);
  }
}

static void test_bands(void) {
  struct host_image whole, part;
  unsigned W = 640, H = 480, y0, x0;
  host_image_new(&whole, W, H, 128, 100, 150); host_image_new(&part, W, H, 128, 100, 150);
  grain_on(&whole, ARCH_CINE500T, DV_INTENSITY_HIGH, DV_SIZE_LARGE, 5, 12, 0, 0);
  for (y0 = 0; y0 < H; y0 += 16) {
    struct host_image band = part;
    band.im.y = part.im.y + y0 * W; band.im.c = part.im.c + y0 * W; band.im.height = 16;
    grain_on(&band, ARCH_CINE500T, DV_INTENSITY_HIGH, DV_SIZE_LARGE, 5, 12, 0, y0);
  }
  CHECK(!memcmp(whole.buf, part.buf, W * H * 2), "bandes de 16 lignes : identique à l'image entière");
  host_image_free(&part); host_image_new(&part, W, H, 128, 100, 150);
  for (x0 = 0; x0 < W; x0 += 160) {
    struct host_image win = part;
    win.im.y = part.im.y + x0; win.im.c = part.im.c + x0; win.im.width = 160;
    grain_on(&win, ARCH_CINE500T, DV_INTENSITY_HIGH, DV_SIZE_LARGE, 5, 12, x0, 0);
  }
  CHECK(!memcmp(whole.buf, part.buf, W * H * 2), "fenêtres de 160 colonnes : identique à l'image entière");
  host_image_free(&whole); host_image_free(&part);
}

static void test_tone(void) {
  int arch;
  for (arch = 0; arch < ARCH_COUNT; arch++) {
    struct dv_grain_profile p;
    struct dv_grain g;
    double ratio[17], ref = 0;
    int i, ok = 1, used = 0;
    host_profile(&p, arch);
    dv_grain_setup(&g, &T, &p, DV_INTENSITY_PROFILE, DV_SIZE_PROFILE, dv_frame_seed(1, 1));
    for (i = 1; i < 16; i++) {
      struct host_image h;
      unsigned level = (unsigned)i * 16u;
      host_image_new(&h, 512, 512, (unsigned char)level, 128, 128);
      dv_grain_apply(&g, &h.im, 0, 0);
      {
        /* Rounding to whole levels adds about 1/12 to the variance; the grain is measured without it,
         * where it is at least a level (below, rounding dominates). */
        double sd = sd_rect(&h.im, 0, 0, 512, 512, 0), v = sd * sd - 1.0 / 12;
        ratio[i] = g.lut[level] >= 40 && sd >= 1.0 ? sqrt(v) / g.lut[level] : -1;
        if (getenv("DV_VERBOSE")) printf("       palier %3u : poids %3u, écart-type %.3f\n", level, g.lut[level], sd);
      }
      host_image_free(&h);
    }
    for (i = 1; i < 16; i++) if (ratio[i] > 0 && (ref == 0 || ratio[i] > ref)) ref = ratio[i];
    for (i = 1; i < 16; i++) if (ratio[i] > 0) { used++; if (fabs(ratio[i] / ref - 1) > 0.10) ok = 0; }
    CHECK(ok && used >= 4, "courbe tonale (%s) : écart-type par palier proportionnel à la courbe à ±10 %% (%d paliers)", host_arch_name(arch), used);
  }
}

static void test_highlights(void) {
  int arch;
  for (arch = 0; arch < ARCH_COUNT; arch++) {
    struct host_image h;
    unsigned i, min = 255;
    if (arch == ARCH_BW400 || arch == ARCH_BW100) continue;
    host_image_new(&h, 512, 256, 255, 128, 128);
    grain_on(&h, arch, DV_INTENSITY_HIGH, DV_SIZE_PROFILE, 3, 3, 0, 0);
    for (i = 0; i < 512 * 256; i++) if (h.im.y[i] < min) min = h.im.y[i];
    CHECK(min >= 250, "hautes lumières (%s, intensité Fort) : 255 ne descend pas sous %u", host_arch_name(arch), min);
    host_image_free(&h);
  }
}

static void test_repeat(void) {
  struct host_image h;
  unsigned lag, worst_lag = 0;
  double worst = 0;
  host_image_new(&h, 2048, 512, 128, 128, 128);
  grain_on(&h, ARCH_NEG400, DV_INTENSITY_HIGH, DV_SIZE_PROFILE, 9, 9, 0, 0);
  for (lag = 20; lag < 1500; lag++) {
    double c = autocorr(&h.im, 0, 0, 2048, 512, lag);
    if (fabs(c) > worst) { worst = fabs(c); worst_lag = lag; }
  }
  CHECK(worst < 0.05, "non-répétition : ciel uni, autocorrélation maximale %.3f (décalage %u) entre 20 et 1500 pixels", worst, worst_lag);
  host_image_free(&h);
}

/* The tiles' seams must not show: the grain is as strong across a seam as inside a tile, and the
 * vertical direction does not repeat either. */
static void test_seams(void) {
  struct host_image h;
  double seam = 0, inside = 0, worst = 0;
  unsigned x, y, ns = 0, ni = 0, lag, worst_lag = 0;
  host_image_new(&h, 2048, 1536, 128, 128, 128);
  grain_on(&h, ARCH_NEG400, DV_INTENSITY_HIGH, DV_SIZE_PROFILE, 6, 6, 0, 0);
  for (x = 0; x < 2048; x++) {
    unsigned t = x & 127u;
    double sd = 0, m = 0, q = 0;
    for (y = 0; y < 1536; y++) { double v = h.im.y[y * 2048 + x]; m += v; q += v * v; }
    m /= 1536; sd = sqrt(q / 1536 - m * m);
    if (t < 4 || t >= 124) { seam += sd; ns++; } else if (t >= 48 && t < 80) { inside += sd; ni++; }
  }
  seam /= ns; inside /= ni;
  CHECK(fabs(seam / inside - 1) < 0.05, "coutures entre cases : écart-type %.3f sur les coutures, %.3f au centre des cases", seam, inside);
  for (lag = 20; lag < 1200; lag++) {
    double mean, sd = sd_rect(&h.im, 0, 0, 2048, 1536, &mean), s = 0, c;
    if (lag % 7) continue;  /* sampled: one lag in seven */
    for (y = 0; y + lag < 1536; y++) for (x = 0; x < 2048; x += 2) s += (h.im.y[y * 2048 + x] - mean) * (h.im.y[(y + lag) * 2048 + x] - mean);
    c = s / ((double)(1536 - lag) * 1024) / (sd * sd);
    if (fabs(c) > worst) { worst = fabs(c); worst_lag = lag; }
  }
  CHECK(worst < 0.05, "non-répétition verticale : autocorrélation maximale %.3f (décalage %u)", worst, worst_lag);
  host_image_free(&h);
}

static void test_crop(void) {
  struct host_image h;
  double full, crop, half, half2;
  host_image_new(&h, 6000, 1000, 128, 128, 128);
  grain_on(&h, ARCH_BW400, DV_INTENSITY_PROFILE, DV_SIZE_PROFILE, 4, 4, 0, 0);
  full = grain_size(&h.im, 0, 0, 6000, 1000);
  crop = grain_size(&h.im, 600, 200, 4800, 600);    /* the 35 mm crop's width */
  half = grain_size(&h.im, 0, 0, 3000, 1000);       /* a half-frame view */
  half2 = grain_size(&h.im, 3000, 0, 3000, 1000);
  CHECK(fabs(crop / full - 1) < 0.05 && fabs(half / full - 1) < 0.05 && fabs(half2 / full - 1) < 0.05,
        "crop et demi-format : taille du grain %.3f px (plein), %.3f (crop), %.3f / %.3f (demi-vues)", full, crop, half, half2);
  host_image_free(&h);
}

static void test_sizes(void) {
  double s[3];
  unsigned k;
  for (k = 0; k < 3; k++) {
    struct host_image h;
    host_image_new(&h, 1024, 512, 128, 128, 128);
    grain_on(&h, ARCH_NEG400, DV_INTENSITY_PROFILE, k, 2, 2, 0, 0);
    s[k] = grain_size(&h.im, 0, 0, 1024, 512);
    host_image_free(&h);
  }
  CHECK(s[0] < s[1] && s[1] < s[2], "réglage Taille : Petit %.2f < Profil %.2f < Gros %.2f px", s[0], s[1], s[2]);
  {
    struct host_image a, b;
    double ga, gb;
    host_image_new(&a, 1024, 512, 128, 128, 128); host_image_new(&b, 1024, 512, 128, 128, 128);
    grain_on(&a, ARCH_BW400, DV_INTENSITY_PROFILE, DV_SIZE_PROFILE, 2, 2, 0, 0);
    grain_on(&b, ARCH_BW100, DV_INTENSITY_PROFILE, DV_SIZE_PROFILE, 2, 2, 0, 0);
    ga = grain_size(&a.im, 0, 0, 1024, 512); gb = grain_size(&b.im, 0, 0, 1024, 512);
    CHECK(ga > gb * 1.3, "taille liée au film : N&B 400 %.2f px > N&B 100 %.2f px", ga, gb);
    host_image_free(&a); host_image_free(&b);
  }
}

static void test_bw(void) {
  int arch;
  for (arch = 0; arch < ARCH_COUNT; arch++) {
    struct host_image a, b;
    if (arch != ARCH_BW400 && arch != ARCH_BW100) continue;
    host_image_new(&a, 320, 200, 128, 110, 150); host_image_new(&b, 320, 200, 128, 110, 150);
    grain_on(&a, arch, DV_INTENSITY_HIGH, DV_SIZE_PROFILE, 1, 2, 0, 0);
    CHECK(!memcmp(a.im.c, b.im.c, 320 * 200) && memcmp(a.im.y, b.im.y, 320 * 200), "noir et blanc (%s) : Cb et Cr inchangés, Y avec grain", host_arch_name(arch));
    host_image_free(&a); host_image_free(&b);
  }
}

/* ------------------------------------------------------------------ images to look at */

static int read_ppm(const char *path, struct host_image *h) {
  FILE *f = fopen(path, "rb");
  unsigned w, hh, mx, x, y;
  unsigned char *rgb;
  if (!f || fscanf(f, "P6 %u %u %u", &w, &hh, &mx) != 3 || mx != 255) { if (f) fclose(f); return -1; }
  fgetc(f);
  w &= ~1u;
  rgb = malloc((size_t)w * hh * 3);
  for (y = 0; y < hh; y++) if (fread(rgb + (size_t)y * w * 3, 3, w, f) != w) { fclose(f); free(rgb); return -1; }
  fclose(f);
  host_image_new(h, w, hh, 0, 128, 128);
  for (y = 0; y < hh; y++)
    for (x = 0; x < w; x += 2) {
      double cb = 0, cr = 0;
      unsigned k;
      for (k = 0; k < 2; k++) {
        const unsigned char *p = rgb + ((size_t)y * w + x + k) * 3;
        double Y = 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
        h->im.y[y * w + x + k] = (unsigned char)lround(Y);
        cb += -0.168736 * p[0] - 0.331264 * p[1] + 0.5 * p[2];
        cr += 0.5 * p[0] - 0.418688 * p[1] - 0.081312 * p[2];
      }
      h->im.c[y * w + x] = (unsigned char)lround(128 + cb / 2); h->im.c[y * w + x + 1] = (unsigned char)lround(128 + cr / 2);
    }
  free(rgb);
  return 0;
}

static void images(const char *dir, const char *photo) {
  char path[512];
  int arch;
  for (arch = 0; arch < ARCH_COUNT; arch++) {
    struct host_image h;
    unsigned x, y;
    /* A ramp from black to white with a colour band, at 100 %. */
    host_image_new(&h, 1024, 384, 0, 128, 128);
    for (y = 0; y < 384; y++) for (x = 0; x < 1024; x++) h.im.y[y * 1024 + x] = (unsigned char)((x * 255) / 1023);
    for (y = 256; y < 384; y++) for (x = 0; x < 1024; x += 2) { h.im.c[y * 1024 + x] = 100; h.im.c[y * 1024 + x + 1] = 170; }
    grain_on(&h, arch, DV_INTENSITY_PROFILE, DV_SIZE_PROFILE, 1, 1, 0, 0);
    snprintf(path, sizeof path, "%s/rampe-%d.ppm", dir, arch);
    host_write_ppm(path, &h.im);
    host_image_free(&h);
    if (photo) {
      if (!read_ppm(photo, &h)) {
        grain_on(&h, arch, DV_INTENSITY_PROFILE, DV_SIZE_PROFILE, 1, 1, 0, 0);
        snprintf(path, sizeof path, "%s/photo-%d.ppm", dir, arch);
        host_write_ppm(path, &h.im);
        host_image_free(&h);
      }
    }
  }
  {
    FILE *f;
    snprintf(path, sizeof path, "%s/archetypes.txt", dir);
    f = fopen(path, "w");
    for (arch = 0; arch < ARCH_COUNT; arch++) fprintf(f, "%d %s\n", arch, host_arch_name(arch));
    fclose(f);
  }
}

int main(int argc, char **argv) {
  host_recipes(R);
  host_textures(&T, R);
  test_textures();
  test_determinism();
  test_neutral();
  test_bands();
  test_tone();
  test_highlights();
  test_repeat();
  test_seams();
  test_crop();
  test_sizes();
  test_bw();
  if (argc > 1) images(argv[1], argc > 2 ? argv[2] : 0);
  printf("%s : %d échec(s)\n", failures ? "ÉCHEC" : "TOUT EST BON", failures);
  return failures != 0;
}
