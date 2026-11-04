/* SPDX-License-Identifier: GPL-2.0-only
 *
 * PC reference of the JPEG grain module (jpeg_grain.c), for tools/develop/jpeg_grain_probe.py:
 *   grain_ref RECIPES PROFILES LEVEL SIZE MONO SEED WIDEST then, per picture, W H IN OUT
 * The textures from the recipes, the frame set up with the profile (0 colour, 1 black and white),
 * then each picture (Y plane then CbCr plane, stride = W) with the step scaled as the module does.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "host.h"

static unsigned char *slurp(const char *path, size_t n) {
  FILE *f = fopen(path, "rb"); unsigned char *b = malloc(n);
  if (!f || fread(b, 1, n, f) != n) { fprintf(stderr, "read %s\n", path); exit(2); }
  fclose(f); return b;
}

int main(int argc, char **argv) {
  struct dv_tex_recipe r[4]; struct dv_grain_profile p[2]; struct dv_textures t; struct dv_grain g;
  unsigned level, size, mono, seed, widest, step; int a;
  if (argc < 8 || (argc - 8) % 4) return 1;
  unsigned char *rb = slurp(argv[1], sizeof r), *pb = slurp(argv[2], sizeof p);
  memcpy(r, rb, sizeof r); memcpy(p, pb, sizeof p);
  level = atoi(argv[3]); size = atoi(argv[4]); mono = atoi(argv[5]); seed = strtoul(argv[6], 0, 0); widest = atoi(argv[7]);
  host_textures(&t, r);
  dv_grain_setup(&g, &t, &p[mono ? 1 : 0], level, size, seed);
  step = g.step_q16;
  for (a = 8; a < argc; a += 4) {
    unsigned w = atoi(argv[a]), h = atoi(argv[a + 1]);
    unsigned char *b = slurp(argv[a + 2], (size_t)w * h * 2);
    struct dv_image im = { b, b + (size_t)w * h, w & ~1u, h, w };
    FILE *f;
    g.step_q16 = w == widest ? step : (step * widest) / w;   /* u32, as the module's udiv */
    dv_grain_apply(&g, &im, 0, 0);
    f = fopen(argv[a + 3], "wb"); fwrite(b, 1, (size_t)w * h * 2, f); fclose(f); free(b);
  }
  return 0;
}
