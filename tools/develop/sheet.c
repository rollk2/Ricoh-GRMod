/* SPDX-License-Identifier: GPL-2.0-only
 *
 * GR Mod Film, development library: the contact sheet's layout (spec, "Sorties"): every view of
 * the roll in strips of six on black, as a real contact sheet of cut negatives, each frame's number
 * under it and the film's name on the strip's upper edge, as on a real film's rebate. The views
 * come in as small pictures (the camera's own screennail or thumbnail, or a view made smaller by
 * dv_thumb_box). Writing the sheet as a JPEG is the development step's business (step 6).
 */
#include "develop.h"
#include "text.h"

/* a / b by shifting and subtracting (the camera has no divide instruction and the library calls
 * nothing outside itself). */
static u32 udiv(u32 a, u32 b) {
  u32 q = 0, r = 0;
  s32 i;
  if (!b) return 0;
  for (i = 31; i >= 0; i--) {
    r = (r << 1) | ((a >> i) & 1u);
    if (r >= b) { r -= b; q |= 1u << i; }
  }
  return q;
}

void dv_sheet_geometry(struct dv_sheet *s, u32 frames, u32 tw, u32 th) {
  u32 rows = 0, n = frames;
  while (n) { rows++; n = n > DV_SHEET_COLUMNS ? n - DV_SHEET_COLUMNS : 0; }
  s->frames = frames; s->tw = tw & ~1u; s->th = th; s->rows = rows;
  s->gap = ((tw >> 4) + 1) & ~1u;             /* between frames of a strip: 1/16 of a frame */
  s->rebate = (th * 43u) >> 8;                /* film edge above and below: 1/6 of a frame */
  s->margin = ((th >> 3) + 1) & ~1u;          /* around the sheet and between strips */
  s->width = 2 * s->margin + DV_SHEET_COLUMNS * s->tw + (DV_SHEET_COLUMNS - 1) * s->gap;
  s->strip = 2 * s->rebate + th;
  s->height = rows ? 2 * s->margin + rows * s->strip + (rows - 1) * s->margin : 2 * s->margin;
}

void dv_sheet_slot(const struct dv_sheet *s, u32 index, u32 *x, u32 *y) {
  u32 row = 0, col = index;
  while (col >= DV_SHEET_COLUMNS) { col -= DV_SHEET_COLUMNS; row++; }
  *x = s->margin + col * (s->tw + s->gap);
  *y = s->margin + row * (s->strip + s->margin) + s->rebate;
}

void dv_sheet_clear(struct dv_image *sheet) {
  u32 x, y;
  for (y = 0; y < sheet->height; y++) {
    u8 *Y = sheet->y + y * sheet->stride, *C = sheet->c + y * sheet->stride;
    for (x = 0; x < sheet->width; x++) { Y[x] = 0; C[x] = 128; }
  }
}

static u32 number_glyphs(u32 v, glyph *g) {
  u32 h = 0, t = 0, n = 0;
  while (v >= 100) { v -= 100; h++; }
  while (v >= 10) { v -= 10; t++; }
  if (h) g[n++] = (glyph)h;
  if (h || t) g[n++] = (glyph)t;
  g[n++] = (glyph)v;
  return n;
}

void dv_sheet_place(struct dv_image *sheet, const struct dv_sheet *s, u32 index, const struct dv_image *thumb,
                    u32 number, const u16 *name, u32 name_len) {
  u32 x0, y0, x, y, w = thumb->width < s->tw ? thumb->width & ~1u : s->tw, h = thumb->height < s->th ? thumb->height : s->th;
  struct colour edge;
  glyph g[4];
  s32 H = (s32)((s->rebate * 192u) >> 8), n;   /* digits 3/4 of the edge's height */
  if (index >= s->frames) return;
  dv_sheet_slot(s, index, &x0, &y0);
  /* A smaller view is centred in its frame. */
  x0 += ((s->tw - w) >> 1) & ~1u; y0 += (s->th - h) >> 1;
  for (y = 0; y < h; y++) {
    const u8 *sy = thumb->y + y * thumb->stride, *sc = thumb->c + y * thumb->stride;
    u8 *dy = sheet->y + (y0 + y) * sheet->stride + x0, *dc = sheet->c + (y0 + y) * sheet->stride + x0;
    for (x = 0; x < w; x++) { dy[x] = sy[x]; dc[x] = sc[x]; }
  }
  /* The edge printing, amber like a film's: the number under the frame, the film's name above
   * the strip's first frame. */
  edge.y = 190; edge.cb = 92; edge.cr = 168;
  if (H < 7) return;
  dv_sheet_slot(s, index, &x0, &y0);
  n = (s32)number_glyphs(number, g);
  dv_text_at(sheet, g, (u32)n, (s32)x0 + (s32)((s->tw - (u32)dv_text_width(g, (u32)n, H)) >> 1),
             (s32)(y0 + s->th) + (s32)((s->rebate - (u32)H) >> 1), H, edge, 0, 0);
  if (name && name_len && name_len <= 32) {
    u32 col = index;
    while (col >= DV_SHEET_COLUMNS) col -= DV_SHEET_COLUMNS;
    if (!col) dv_text_at(sheet, name, name_len, (s32)x0, (s32)(y0 - s->rebate) + (s32)((s->rebate - (u32)H) >> 1), H, edge, 0, 0);
  }
}

void dv_thumb_box(struct dv_image *dst, const struct dv_image *src, u32 f) {
  u32 X, Y, i, j, rec = udiv(1u << 23, f * f);
  for (Y = 0; Y < dst->height; Y++) {
    u8 *dy = dst->y + Y * dst->stride, *dc = dst->c + Y * dst->stride;
    for (X = 0; X < (dst->width & ~1u); X += 2) {
      u32 sy0 = 0, sy1 = 0, cb = 0, cr = 0;
      for (j = 0; j < f; j++) {
        const u8 *ry = src->y + (Y * f + j) * src->stride, *rc = src->c + (Y * f + j) * src->stride;
        for (i = 0; i < f; i++) { sy0 += ry[X * f + i]; sy1 += ry[(X + 1) * f + i]; }
        /* The 2f source pixels of the pair hold f CbCr pairs. */
        for (i = 0; i < 2 * f; i += 2) { cb += rc[X * f + i]; cr += rc[X * f + i + 1]; }
      }
      /* Average: sum times 2^23 / f^2 (at most 255 * 2^23, within 32 bits). */
      dy[X] = (u8)((sy0 * rec + (1u << 22)) >> 23);
      dy[X + 1] = (u8)((sy1 * rec + (1u << 22)) >> 23);
      dc[X] = (u8)((cb * rec + (1u << 22)) >> 23);
      dc[X + 1] = (u8)((cr * rec + (1u << 22)) >> 23);
    }
  }
}
