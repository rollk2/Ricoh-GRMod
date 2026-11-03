/* SPDX-License-Identifier: GPL-2.0-only
 *
 * GR Mod Film, development library: the date at printing (spec, "Options de tirage" and
 * "Interaction avec les autres traitements"). Drawn as the date imprint draws it
 * (tools/datestamp/datestamp.c: same digits, colour, size and place, bottom right of the picture
 * as it is shown), but from the date it is given: the frame's shooting date, not the clock's time
 * at printing. Each view of a diptych gets its own, before the views are put together, and the
 * grain comes after, over it.
 */
#include "develop.h"
#include "text.h"

static u32 two_digits(u32 v, glyph *out) {
  u32 t = 0;
  while (v >= 100) v -= 100;
  while (v >= 10) { v -= 10; t++; }
  out[0] = (glyph)t; out[1] = (glyph)v;
  return 2;
}

u32 dv_date_glyphs(const struct dv_date *d, u32 style, u16 *out) {
  glyph *g = out;
  u32 n = 0;
  if (d->year < 2000 || d->year > 2099 || d->month < 1 || d->month > 12 || d->day < 1 || d->day > 31) return 0;
  if (style == DV_DATE_LONG) {        /* 2026.10.08 17:34 */
    if (d->hour > 23 || d->minute > 59) return 0;
    g[n++] = 2; g[n++] = 0;
    n += two_digits(d->year, g + n); g[n++] = G_DOT;
    n += two_digits(d->month, g + n); g[n++] = G_DOT;
    n += two_digits(d->day, g + n); g[n++] = G_SPACE;
    n += two_digits(d->hour, g + n); g[n++] = G_COLON;
    n += two_digits(d->minute, g + n);
  } else {                            /* '26 10 08 */
    g[n++] = G_APOSTROPHE;
    n += two_digits(d->year, g + n); g[n++] = G_SPACE;
    n += two_digits(d->month, g + n); g[n++] = G_SPACE;
    n += two_digits(d->day, g + n);
  }
  return n;
}

int dv_date_draw(struct dv_image *im, const struct dv_date *d, u32 style, u32 orient, u32 mono) {
  glyph glyphs[24];
  struct colour col;
  s32 W = (s32)im->width, PH = (s32)im->height, vw, vh, H, margin, tw, x0, y0;
  u32 n = dv_date_glyphs(d, style, glyphs);
  if (!n || orient > O_RIGHT) return 0;
  /* As shown: a quarter turn swaps the sides. Digit height about 1/26 of the shorter side. */
  if (orient == O_LEFT || orient == O_RIGHT) { vw = PH; vh = W; } else { vw = W; vh = PH; }
  H = (s32)(((u32)(vw < vh ? vw : vh) * 2521u) >> 16);
  if (H < 7) H = 7;
  margin = (H * 3) >> 1;
  tw = dv_text_width(glyphs, n, H);
  x0 = vw - margin - tw;
  y0 = vh - margin - H;
  if (x0 < 2 || y0 < 2) return 0;
  col.y = 150; col.cb = 56; col.cr = 204;          /* the orange of a film camera's date back */
  if (mono) { col.cb = 128; col.cr = 128; }       /* light only, like on black-and-white film */
  dv_text_at(im, glyphs, n, x0, y0, H, col, 0, orient);
  return 1;
}
