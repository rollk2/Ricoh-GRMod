/* SPDX-License-Identifier: GPL-2.0-only
 *
 * GR Mod Film, development library: the half-frame diptych (spec, "Diptyque"). In half-frame
 * (GR Mod's 3:4, 3000 x 4000, 72 frames, film-roll.ts) the views are printed two by two as they lie
 * on the negative, side by side, with a separator between them; nothing is turned. The grain then
 * goes over the whole print as one frame (dv_grain_apply with the band's position in it).
 */
#include "develop.h"

u32 dv_diptych_pairs(u32 frames, u32 shifted, u32 odd_black, struct dv_pair *out) {
  u32 n = 0, f = 1;
  if (!frames) return 0;
  if (shifted) {
    /* 2-3, 4-5, ...: frame 1 comes alone (or after a black view). */
    out[n].left = odd_black ? DV_BLACK : 1; out[n].right = odd_black ? 1 : DV_ALONE; n++;
    f = 2;
  }
  for (; f + 1 <= frames; f += 2) { out[n].left = (u16)f; out[n].right = (u16)(f + 1); n++; }
  if (f == frames) { out[n].left = (u16)f; out[n].right = odd_black ? DV_BLACK : DV_ALONE; n++; }
  return n;
}

static void fill(u8 *y, u8 *c, u32 w, u8 luma) {
  u32 x;
  for (x = 0; x < w; x++) y[x] = luma;
  for (x = 0; x < w; x++) c[x] = 128;
}

static void copy(u8 *dy, u8 *dc, const u8 *sy, const u8 *sc, u32 w) {
  u32 x;
  for (x = 0; x < w; x++) { dy[x] = sy[x]; dc[x] = sc[x]; }
}

void dv_diptych_rows(struct dv_image *out, const struct dv_image *left, const struct dv_image *right, u32 view_w, u32 sep, u32 white) {
  u32 y, x_sep = view_w, x_right = view_w + sep;
  for (y = 0; y < out->height; y++) {
    u8 *oy = out->y + y * out->stride, *oc = out->c + y * out->stride;
    if (left) copy(oy, oc, left->y + y * left->stride, left->c + y * left->stride, view_w);
    else fill(oy, oc, view_w, 0);
    fill(oy + x_sep, oc + x_sep, sep, white ? 255 : 0);
    if (right) copy(oy + x_right, oc + x_right, right->y + y * right->stride, right->c + y * right->stride, view_w);
    else fill(oy + x_right, oc + x_right, view_w, 0);
  }
}
