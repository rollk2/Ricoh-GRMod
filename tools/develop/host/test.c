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

/* ------------------------------------------------------------------ diptych */

static void test_pairs(void) {
  struct dv_pair p[80];
  unsigned n, i, ok;
  n = dv_diptych_pairs(72, 0, 1, p);
  for (ok = n == 36, i = 0; i < n; i++) ok &= p[i].left == 2 * i + 1 && p[i].right == 2 * i + 2;
  CHECK(ok, "appariement 1-2 / 3-4 : 72 vues, %u diptyques", n);
  n = dv_diptych_pairs(71, 0, 1, p);
  CHECK(n == 36 && p[35].left == 71 && p[35].right == DV_BLACK, "vue impaire avec une vue noire : 71 vues, %u tirages, dernier 71 + noire", n);
  n = dv_diptych_pairs(71, 0, 0, p);
  CHECK(n == 36 && p[35].left == 71 && p[35].right == DV_ALONE, "vue impaire seule : dernier tirage 71 seule");
  n = dv_diptych_pairs(72, 1, 1, p);
  CHECK(n == 37 && p[0].left == DV_BLACK && p[0].right == 1 && p[1].left == 2 && p[1].right == 3 && p[36].left == 72 && p[36].right == DV_BLACK,
        "appariement décalé 2-3 / 4-5 : %u tirages, 1 après une vue noire, 72 avec une vue noire", n);
}

static void fill_pattern(struct host_image *h, unsigned seed) {
  unsigned i, n = h->im.width * h->im.height;
  for (i = 0; i < n; i++) { seed = seed * 1103515245u + 12345u; h->im.y[i] = (unsigned char)(seed >> 24); h->im.c[i] = (unsigned char)(seed >> 16); }
}

static void test_diptych(void) {
  struct host_image l, r, d, b;
  unsigned W = 3000, H = 4000, sep = 120, y, ok = 1, y0;
  host_image_new(&l, W, H, 0, 128, 128); host_image_new(&r, W, H, 0, 128, 128);
  fill_pattern(&l, 1); fill_pattern(&r, 2);
  host_image_new(&d, 2 * W + sep, H, 7, 7, 7);
  dv_diptych_rows(&d.im, &l.im, &r.im, W, sep, 0);
  for (y = 0; y < H && ok; y += 37) {
    const unsigned char *row = d.im.y + y * d.im.stride, *crow = d.im.c + y * d.im.stride;
    unsigned x;
    ok &= !memcmp(row, l.im.y + y * W, W) && !memcmp(row + W + sep, r.im.y + y * W, W);
    ok &= !memcmp(crow, l.im.c + y * W, W) && !memcmp(crow + W + sep, r.im.c + y * W, W);
    for (x = W; x < W + sep; x++) ok &= row[x] == 0 && crow[x] == 128;
  }
  CHECK(ok && d.im.width == 6120, "diptyque 3000 x 4000 + 3000 x 4000 : %u x %u, vues intactes, séparateur noir de %u px", d.im.width, d.im.height, sep);
  host_image_new(&b, 2 * W + sep, H, 7, 7, 7);
  for (y0 = 0; y0 < H; y0 += 16) {
    struct dv_image ob = b.im, lb = l.im, rb = r.im;
    ob.y += y0 * ob.stride; ob.c += y0 * ob.stride; ob.height = 16;
    lb.y += y0 * W; lb.c += y0 * W; rb.y += y0 * W; rb.c += y0 * W;
    dv_diptych_rows(&ob, &lb, &rb, W, sep, 0);
  }
  CHECK(!memcmp(d.buf, b.buf, (size_t)(2 * W + sep) * H * 2), "diptyque par bandes de 16 lignes : identique");
  dv_diptych_rows(&b.im, &l.im, 0, W, sep, 1);
  CHECK(b.im.y[W + sep + 5] == 0 && b.im.y[W + 3] == 255, "vue noire non exposée à droite, séparateur blanc");
  host_image_free(&l); host_image_free(&r); host_image_free(&d); host_image_free(&b);
}

/* ------------------------------------------------------------------ date */

/* The bounding box of the pixels a draw changed. */
static void changed_box(const struct dv_image *a, const unsigned char *before, unsigned *x0, unsigned *y0, unsigned *x1, unsigned *y1) {
  unsigned x, y;
  *x0 = *y0 = ~0u; *x1 = *y1 = 0;
  for (y = 0; y < a->height; y++) for (x = 0; x < a->width; x++)
    if (a->y[y * a->stride + x] != before[y * a->width + x]) {
      if (x < *x0) *x0 = x;
      if (y < *y0) *y0 = y;
      if (x > *x1) *x1 = x;
      if (y > *y1) *y1 = y;
    }
}

static void test_date(void) {
  struct dv_date d = { 2026, 11, 2, 17, 34 }, bad = { 2026, 13, 2, 0, 0 };
  u16 g[24];
  unsigned o;
  CHECK(dv_date_glyphs(&d, DV_DATE_SHORT, g) == 9 && g[0] == 16 && g[1] == 2 && g[2] == 6 && g[4] == 1 && g[5] == 1 && g[7] == 0 && g[8] == 2,
        "date courte : '26 11 02");
  CHECK(dv_date_glyphs(&d, DV_DATE_LONG, g) == 16 && g[13] == 19 && g[11] == 1 && g[12] == 7, "date longue : 2026.11.02 17:34");
  CHECK(dv_date_glyphs(&bad, DV_DATE_SHORT, g) == 0, "date invalide refusée");
  for (o = 0; o < 4; o++) {
    struct host_image h;
    unsigned char *before;
    unsigned x0, y0, x1, y1, W = 3000, H = 4000;
    int where;
    host_image_new(&h, W, H, 60, 128, 128);
    before = malloc((size_t)W * H);
    memcpy(before, h.im.y, (size_t)W * H);
    dv_date_draw(&h.im, &d, DV_DATE_SHORT, o, 0);
    changed_box(&h.im, before, &x0, &y0, &x1, &y1);
    /* Bottom right as shown: as stored, that is bottom right (0), bottom left (1, shown turned a
     * quarter anticlockwise), top left (2), top right (3). */
    where = o == 0 ? x0 > W / 2 && y0 > H / 2 : o == 1 ? x1 < W / 2 && y0 > H / 2 : o == 2 ? x1 < W / 2 && y1 < H / 2 : x0 > W / 2 && y1 < H / 2;
    CHECK(x0 != ~0u && where, "date au tirage, orientation %u : dessinée dans le coin attendu (%u,%u)-(%u,%u)", o, x0, y0, x1, y1);
    free(before); host_image_free(&h);
  }
  {
    struct host_image a, b;
    host_image_new(&a, 3000, 4000, 60, 128, 128); host_image_new(&b, 3000, 4000, 60, 128, 128);
    dv_date_draw(&a.im, &d, DV_DATE_LONG, 0, 1);
    CHECK(!memcmp(a.im.c, b.im.c, 3000 * 4000) && memcmp(a.im.y, b.im.y, 3000 * 4000), "date en noir et blanc : en lumière seule (Cb et Cr inchangés)");
    host_image_free(&a); host_image_free(&b);
  }
}

/* ------------------------------------------------------------------ contact sheet */

/* A film's name as glyphs, as GR Mod makes them (core/src/fw/aspect/datestamp.ts, LETTER_SEGMENTS):
 * capitals, digits, spaces. */
static unsigned name_glyphs(const char *s, u16 *out) {
  enum { A = 1, B = 2, C = 4, D = 8, E = 16, F = 32, G1 = 64, G2 = 128, UL = 256, UM = 512, UR = 1024, LL = 2048, LM = 4096, LR = 8192 };
  static const unsigned seg[26] = {
    A | B | C | E | F | G1 | G2, A | B | C | D | G2 | UM | LM, A | D | E | F, A | B | C | D | UM | LM, A | D | E | F | G1 | G2,
    A | E | F | G1 | G2, A | C | D | E | F | G2, B | C | E | F | G1 | G2, A | D | UM | LM, B | C | D | E, E | F | G1 | UR | LR,
    D | E | F, B | C | E | F | UL | UR, B | C | E | F | UL | LR, A | B | C | D | E | F, A | B | E | F | G1 | G2,
    A | B | C | D | E | F | LR, A | B | E | F | G1 | G2 | LR, A | C | D | F | G1 | G2, A | UM | LM, B | C | D | E | F,
    E | F | LL | UR, B | C | E | F | LL | LR, UL | UR | LL | LR, UL | UR | LM, A | D | UR | LL };
  unsigned n = 0;
  for (; *s; s++) out[n++] = *s >= 'A' && *s <= 'Z' ? (u16)(0x4000u | seg[*s - 'A']) : *s >= '0' && *s <= '9' ? (u16)(*s - '0') : 17;
  return n;
}

static void test_sheet(void) {
  struct dv_sheet s;
  unsigned i, ok = 1;
  dv_sheet_geometry(&s, 36, 240, 160);
  for (i = 0; i < 36; i++) {
    unsigned x, y, x2, y2;
    dv_sheet_slot(&s, i, &x, &y);
    ok &= x + s.tw <= s.width && y + s.th <= s.height;
    if (i % 6) { dv_sheet_slot(&s, i - 1, &x2, &y2); ok &= y2 == y && x2 + s.tw < x; }
    else if (i) { dv_sheet_slot(&s, i - 6, &x2, &y2); ok &= x2 == x && y2 + s.th < y; }
  }
  CHECK(ok && s.rows == 6, "planche contact 36 vues : 6 bandes de 6, dans l'ordre, sans chevauchement (%u x %u)", s.width, s.height);
  dv_sheet_geometry(&s, 72, 120, 160);
  CHECK(s.rows == 12, "planche contact demi-format 72 vues : 12 bandes");
  dv_sheet_geometry(&s, 13, 240, 160);
  {
    struct host_image sheet, th;
    u16 name[16];
    unsigned nn = name_glyphs("PORTRA 400", name), x, y, numbers = 1, all = 1;
    host_image_new(&sheet, s.width, s.height, 99, 99, 99);
    dv_sheet_clear(&sheet.im);
    for (i = 0; i < 13; i++) {
      host_image_new(&th, 240, 160, (unsigned char)(10 + i), 128, 128);
      dv_sheet_place(&sheet.im, &s, i, &th.im, i + 1, name, nn);
      host_image_free(&th);
    }
    for (i = 0; i < 13; i++) {
      unsigned changed = 0;
      dv_sheet_slot(&s, i, &x, &y);
      all &= sheet.im.y[(y + 80) * sheet.im.stride + x + 120] == 10 + i;
      {
        unsigned yy, xx, top = y + s.th;   /* the edge under the frame, and nothing else */
        for (yy = top; yy < top + s.rebate; yy++)
          for (xx = x; xx < x + s.tw; xx++) changed += sheet.im.y[yy * sheet.im.stride + xx] != 0;
      }
      numbers &= changed > 0;
    }
    CHECK(all && numbers, "planche contact : 13 vues présentes dans l'ordre, chacune avec son numéro");
    host_image_free(&sheet);
  }
  {
    struct host_image src, dst;
    unsigned ok2 = 1;
    host_image_new(&src, 64, 32, 0, 128, 128);
    for (i = 0; i < 64 * 32; i++) src.im.y[i] = (unsigned char)((i % 64) * 4);
    for (i = 0; i < 64 * 32; i += 2) { src.im.c[i] = 100; src.im.c[i + 1] = 150; }
    host_image_new(&dst, 16, 8, 0, 0, 0);
    dv_thumb_box(&dst.im, &src.im, 4);
    for (i = 0; i < 16; i++) ok2 &= dst.im.y[i] == (unsigned char)((i * 4 * 4 + 6) & 0xff) && dst.im.c[i & ~1u] == 100 && dst.im.c[i | 1u] == 150;
    CHECK(ok2, "réduction par 4 : moyenne exacte de chaque bloc, chrominance comprise");
    host_image_free(&src); host_image_free(&dst);
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
  if (photo) {
    /* A diptych: two 3:4 views cut from the photo, each with its date, then the grain over the print. */
    struct host_image src, a, b, d;
    if (!read_ppm(photo, &src)) {
      unsigned vw = (src.im.height * 3 / 4) & ~1u, vh = src.im.height, sep = ((2 * vw * 2 / 100) + 1) & ~1u, y;
      struct dv_date d1 = { 2026, 11, 2, 10, 5 }, d2 = { 2026, 11, 2, 10, 7 };
      struct dv_grain_profile p;
      struct dv_grain g;
      host_image_new(&a, vw, vh, 0, 128, 128); host_image_new(&b, vw, vh, 0, 128, 128);
      for (y = 0; y < vh; y++) {
        memcpy(a.im.y + y * vw, src.im.y + y * src.im.stride, vw); memcpy(a.im.c + y * vw, src.im.c + y * src.im.stride, vw);
        memcpy(b.im.y + y * vw, src.im.y + y * src.im.stride + (src.im.width - vw), vw);
        memcpy(b.im.c + y * vw, src.im.c + y * src.im.stride + (src.im.width - vw), vw);
      }
      dv_date_draw(&a.im, &d1, DV_DATE_SHORT, 0, 0); dv_date_draw(&b.im, &d2, DV_DATE_SHORT, 0, 0);
      host_image_new(&d, 2 * vw + sep, vh, 0, 128, 128);
      dv_diptych_rows(&d.im, &a.im, &b.im, vw, sep, 0);
      host_profile(&p, ARCH_NEG400);
      dv_grain_setup(&g, &T, &p, DV_INTENSITY_PROFILE, DV_SIZE_PROFILE, dv_frame_seed(23, 7));
      dv_grain_apply(&g, &d.im, 0, 0);
      snprintf(path, sizeof path, "%s/diptyque.ppm", dir);
      host_write_ppm(path, &d.im);
      host_image_free(&a); host_image_free(&b); host_image_free(&d); host_image_free(&src);
    }
  }
  if (photo) {
    /* A contact sheet of 36 views cut from the photo (3:2, made 4 times smaller). */
    struct host_image src, view, th, sheet;
    struct dv_sheet s;
    u16 name[16];
    unsigned nn = name_glyphs("PORTRA 400", name), i, vw = 640, vh = 428, y;
    if (!read_ppm(photo, &src)) {
      dv_sheet_geometry(&s, 36, vw / 4, vh / 4);
      host_image_new(&sheet, s.width, s.height, 0, 128, 128);
      dv_sheet_clear(&sheet.im);
      for (i = 0; i < 36; i++) {
        unsigned ox = ((i * 151u) % (src.im.width - vw)) & ~1u, oy = (i * 97u) % (src.im.height - vh);
        host_image_new(&view, vw, vh, 0, 128, 128);
        for (y = 0; y < vh; y++) {
          memcpy(view.im.y + y * vw, src.im.y + (oy + y) * src.im.stride + ox, vw);
          memcpy(view.im.c + y * vw, src.im.c + (oy + y) * src.im.stride + ox, vw);
        }
        host_image_new(&th, vw / 4, vh / 4, 0, 128, 128);
        dv_thumb_box(&th.im, &view.im, 4);
        dv_sheet_place(&sheet.im, &s, i, &th.im, i + 1, name, nn);
        host_image_free(&th); host_image_free(&view);
      }
      snprintf(path, sizeof path, "%s/planche-contact.ppm", dir);
      host_write_ppm(path, &sheet.im);
      host_image_free(&sheet); host_image_free(&src);
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

/* Inputs and outputs for the camera build's check in the emulator (build.py): the recipes, a
 * profile, a band of 2048 x 128 (a tile's height: as many rows on seams as in a frame) at row 1000
 * of a frame before and after the grain, the textures. */
static int dump(const char *dir) {
  char path[512];
  FILE *f;
  struct dv_grain_profile p;
  struct dv_grain g;
  struct host_image h;
  unsigned i;
  host_profile(&p, ARCH_NEG400);
  host_image_new(&h, 2048, 128, 0, 128, 128);
  for (i = 0; i < 2048u * 128; i++) { h.im.y[i] = (unsigned char)((i * 7u) % 251u); h.im.c[i] = (unsigned char)(100 + (i % 57u)); }
#define OUT(name, ptr, size) do { snprintf(path, sizeof path, "%s/" name, dir); f = fopen(path, "wb"); if (!f) return 1; fwrite(ptr, 1, size, f); fclose(f); } while (0)
  OUT("recipes.bin", R, sizeof(struct dv_tex_recipe) * 4);
  OUT("profile.bin", &p, sizeof p);
  OUT("band_in.bin", h.buf, 2048u * 128 * 2);
  OUT("fine.bin", T.fine, DV_FINE_N * DV_FINE_N); OUT("coarse.bin", T.coarse, DV_COARSE_N * DV_COARSE_N);
  OUT("cb.bin", T.cb, DV_CB_N * DV_CB_N); OUT("cr.bin", T.cr, DV_CR_N * DV_CR_N);
  dv_grain_setup(&g, &T, &p, DV_INTENSITY_HIGH, DV_SIZE_PROFILE, dv_frame_seed(23, 7));
  dv_grain_apply(&g, &h.im, 0, 1000);
  OUT("band_out.bin", h.buf, 2048u * 128 * 2);
  host_image_free(&h);
  printf("dump : %u octets de recette, %u de profil\n", (unsigned)(sizeof(struct dv_tex_recipe) * 4), (unsigned)sizeof p);
  return 0;
}

int main(int argc, char **argv) {
  host_recipes(R);
  host_textures(&T, R);
  if (argc > 2 && !strcmp(argv[1], "--dump")) return dump(argv[2]);
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
  test_pairs();
  test_diptych();
  test_date();
  test_sheet();
  if (argc > 1) images(argv[1], argc > 2 ? argv[2] : 0);
  printf("%s : %d échec(s)\n", failures ? "ÉCHEC" : "TOUT EST BON", failures);
  return failures != 0;
}
