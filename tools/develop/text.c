/* SPDX-License-Identifier: GPL-2.0-only
 *
 * GR Mod Film, development library: seven- and fourteen-segment text (digits, marks, capitals),
 * taken from tools/datestamp/datestamp.c (GR Mod 0.8.4) unchanged but for the picture type: the
 * date at printing and the contact sheet's frame numbers and film name are drawn as the date
 * imprint is. Letters come in as glyph codes made by GR Mod (core/src/fw/aspect/datestamp.ts,
 * LETTER_SEGMENTS), not from a table here.
 */
#include "develop.h"
#include "text.h"

/* Glyph codes besides the digits 0..15. */

/* How the picture is shown, from the camera's direction as the shooting record keeps it (what the
 * EXIF writer at 0x537FEBC4 turns into the Orientation tag: 1 -> 8, 2 -> 3, 3 -> 6, else -> 1). */

/* The stored pixel of shown pixel (x, y), for a stored picture of W x H. */
static void stored_at(u32 o, s32 W, s32 H, s32 x, s32 y, s32 *sx, s32 *sy) {
  if (o == O_NONE) { *sx = x; *sy = y; }
  else if (o == O_HALF) { *sx = W - 1 - x; *sy = H - 1 - y; }
  else if (o == O_RIGHT) { *sx = y; *sy = H - 1 - x; }
  else { *sx = W - 1 - y; *sy = x; }
}

/* Glyph codes are 16 bits: the digits 0..15 and G_* above (seven-segment digits and marks), or
 * (0.8.4) a letter of the look's name: G_LETTER | its fourteen segments (see `letter_segs`). */

static int narrow(u32 g) { return g == G_APOSTROPHE || g == G_DOT || g == G_COLON; }
static int punct(u32 g) { return g == G_DOT || g == G_COLON; }

/* Left edge and width of each glyph at digit height H, starting at 0; returns the advance of the
 * whole run (without a gap after the last glyph). The marks ' . : are T wide; . and : sit closer to
 * their neighbours (half the gap). A space advances H/2. A letter is 13/16 H wide (a digit 9/16 H:
 * the diagonals need the room), with the digits' gap. */
static s32 layout(const glyph *glyphs, u32 count, s32 H, s32 *left, s32 *width) {
  s32 W = (H * 9) >> 4, WL = (H * 13) >> 4, T = (H * 9) >> 6, gap = (H * 5) >> 4, x = 0, end = 0;
  u32 i;
  if (T < 2) T = 2;
  for (i = 0; i < count; i++) {
    u32 g = glyphs[i];
    if (i > 0 && (punct(g) || punct(glyphs[i - 1]))) x -= gap >> 1;
    left[i] = x;
    width[i] = g == G_SPACE ? 0 : narrow(g) ? T : is_letter(g) ? WL : W;
    end = x + width[i];
    x += (g == G_SPACE ? (H >> 1) : width[i]) + gap;
  }
  return end;
}

/* Segments a..g as bits 0..6. */
static u32 segments(u32 digit) {
  switch (digit) {
  case 0: return 0x3f; case 1: return 0x06; case 2: return 0x5b; case 3: return 0x4f; case 4: return 0x66;
  case 5: return 0x6d; case 6: return 0x7d; case 7: return 0x07; case 8: return 0x7f; case 9: return 0x6f;
  case 10: return 0x77; case 11: return 0x7c; case 12: return 0x39; case 13: return 0x5e; case 14: return 0x79; default: return 0x71;
  }
}

static s32 abs32(s32 v) { return v < 0 ? -v : v; }
static s32 min32(s32 a, s32 b) { return a < b ? a : b; }

/* Inside a bar from (x0,y0) to (x1,y1) (horizontal or vertical) of half thickness t, with pointed
 * ends. Coordinates in 1/4 pixel. */
static int in_bar(s32 px, s32 py, s32 x0, s32 y0, s32 x1, s32 y1, s32 t) {
  s32 along, across, len;
  if (y0 == y1) { along = px - x0; len = x1 - x0; across = abs32(py - y0); }
  else { along = py - y0; len = y1 - y0; across = abs32(px - x0); }
  if (along < 0 || along > len) return 0;
  return across <= min32(t, min32(along, len - along));
}

/* A glyph is drawn as a few shapes, each with the box (1/4 px, inclusive) outside of which it has
 * no ink: a bar (in_bar), a slanted bar (a strip of half thickness t around the line through
 * (x0,y0)-(x1,y1), of length len, cut by the box) or a box. The shapes of a glyph do not overlap. */
#define S_BAR 0
#define S_SLANT 1
#define S_BOX 2
struct shape { s32 kind, x0, y0, x1, y1, t, len, bx0, by0, bx1, by1; };

static s32 isqrt(u32 v) {
  u32 r = 0, bit = 1u << 30;
  while (bit > v) bit >>= 2;
  while (bit) {
    if (v >= r + bit) { v -= r + bit; r = (r >> 1) + bit; } else r >>= 1;
    bit >>= 2;
  }
  return (s32)r;
}

static void bar(struct shape *s, s32 x0, s32 y0, s32 x1, s32 y1, s32 t) {
  s->kind = S_BAR; s->x0 = x0; s->y0 = y0; s->x1 = x1; s->y1 = y1; s->t = t;
  if (y0 == y1) { s->bx0 = x0; s->bx1 = x1; s->by0 = y0 - t; s->by1 = y0 + t; }
  else { s->bx0 = x0 - t; s->bx1 = x0 + t; s->by0 = y0; s->by1 = y1; }
}

static void box(struct shape *s, s32 bx0, s32 by0, s32 bx1, s32 by1) {
  s->kind = S_BOX; s->bx0 = bx0; s->by0 = by0; s->bx1 = bx1; s->by1 = by1;
}

/* The slanted bar from corner (x0,y0) towards the centre (x1,y1), within the box. */
static void slant(struct shape *s, s32 x0, s32 y0, s32 x1, s32 y1, s32 t, s32 bx0, s32 by0, s32 bx1, s32 by1) {
  s32 dx = x1 - x0, dy = y1 - y0;
  s->kind = S_SLANT; s->x0 = x0; s->y0 = y0; s->x1 = x1; s->y1 = y1; s->t = t;
  s->len = isqrt((u32)(dx * dx + dy * dy));
  s->bx0 = bx0; s->by0 = by0; s->bx1 = bx1; s->by1 = by1;
}

static int shape_hit(const struct shape *s, s32 qx, s32 qy) {
  if (qx < s->bx0 || qx > s->bx1 || qy < s->by0 || qy > s->by1) return 0;
  if (s->kind == S_BOX) return 1;
  if (s->kind == S_BAR) return in_bar(qx, qy, s->x0, s->y0, s->x1, s->y1, s->t);
  return abs32((qx - s->x0) * (s->y1 - s->y0) - (qy - s->y0) * (s->x1 - s->x0)) <= s->t * s->len;
}

/* The shapes of glyph g in a cell of w x h (1/4 px), bar half thickness t; returns their number.
 * Digits and marks exactly as up to 0.8.3 (seven segments with gaps at the joints). Letters
 * (0.8.4): the same bars for a..f, the middle bar split in two (g1, g2), a short bar up and one
 * down from the middle, and four slanted bars between them, a little thinner. */
static u32 glyph_shapes(u32 g, s32 w, s32 h, s32 t, s32 T, struct shape *s) {
  s32 gp = t / 2 + 1; /* gap at the joints (t is a small positive number, /2 is a shift) */
  s32 l = t, r = w - t, top = t, mid = h >> 1, bot = h - t, cx = w >> 1;
  u32 n = 0, seg;
  if (g == G_SPACE) return 0;
  if (g == G_APOSTROPHE) { /* short bar at the top: qy < 5/16 h */
    box(&s[n++], T * 2 - t, -(1 << 20), T * 2 + t, ((h * 5) >> 4) - 1); return n;
  }
  if (g == G_DOT) { /* square on the baseline */
    box(&s[n++], T * 2 - t, h - 2 * t, T * 2 + t, 1 << 20); return n;
  }
  if (g == G_COLON) { /* two squares, at 5/16 and 11/16 of the height */
    box(&s[n++], T * 2 - t, ((h * 5) >> 4) - t, T * 2 + t, ((h * 5) >> 4) + t);
    box(&s[n++], T * 2 - t, ((h * 11) >> 4) - t, T * 2 + t, ((h * 11) >> 4) + t);
    return n;
  }
  seg = is_letter(g) ? g & 0x3fffu : segments(g);
  if (seg & 0x01) bar(&s[n++], l + gp, top, r - gp, top, t);
  if (seg & 0x02) bar(&s[n++], r, top + gp, r, mid - gp, t);
  if (seg & 0x04) bar(&s[n++], r, mid + gp, r, bot - gp, t);
  if (seg & 0x08) bar(&s[n++], l + gp, bot, r - gp, bot, t);
  if (seg & 0x10) bar(&s[n++], l, mid + gp, l, bot - gp, t);
  if (seg & 0x20) bar(&s[n++], l, top + gp, l, mid - gp, t);
  if (!is_letter(g)) {
    if (seg & 0x40) bar(&s[n++], l + gp, mid, r - gp, mid, t);
    return n;
  }
  if (seg & 0x40) bar(&s[n++], l + gp, mid, cx - gp, mid, t);
  if (seg & 0x80) bar(&s[n++], cx + gp, mid, r - gp, mid, t);
  if (seg & 0x200) bar(&s[n++], cx, top + gp, cx, mid - gp, t);
  if (seg & 0x1000) bar(&s[n++], cx, mid + gp, cx, bot - gp, t);
  {
    /* The slanted bars run from a corner towards the centre, cut to the room between the bars. */
    s32 d = (t * 3) >> 2, x1 = l + t + (gp >> 1), x2 = cx - t - (gp >> 1), x3 = cx + t + (gp >> 1), x4 = r - t - (gp >> 1);
    s32 y1 = top + t + (gp >> 1), y2 = mid - t - (gp >> 1), y3 = mid + t + (gp >> 1), y4 = bot - t - (gp >> 1);
    if (seg & 0x100) slant(&s[n++], l, top, cx, mid, d, x1, y1, x2, y2);
    if (seg & 0x400) slant(&s[n++], r, top, cx, mid, d, x3, y1, x4, y2);
    if (seg & 0x800) slant(&s[n++], l, bot, cx, mid, d, x1, y3, x2, y4);
    if (seg & 0x2000) slant(&s[n++], r, bot, cx, mid, d, x3, y3, x4, y4);
  }
  return n;
}

#define MAXGLYPH 64
#define MAXSHAPES 16

/* Draw `count` glyphs with their top left corner at (x0, y0) of the picture as it is shown
 * (orientation `o`), digit height H. With `bg` (test builds only, always O_NONE), the box behind
 * them is filled with black first. The caller has checked that the box lies inside the picture and
 * handles the cache.
 *
 * Each pixel is sampled at 2 x 2 points and blended by the share of them inside the glyph. Only
 * the pixels of each row that are inside a shape's box are looked at (0.8.4; the result is the
 * same as sampling every pixel of the cell, as up to 0.8.3, at a fraction of the cost). */
void dv_text_at(struct dv_image *p, const glyph *glyphs, u32 count, s32 x0, s32 y0, s32 H, struct colour col, int bg, u32 o) {
  s32 T, total;
  s32 left[MAXGLYPH], width[MAXGLYPH];
  u32 i;
  T = (H * 9) >> 6;
  if (T < 2) T = 2;
  if (count > MAXGLYPH) return;
  total = layout(glyphs, count, H, left, width);
  for (i = 0; i < count; i++) left[i] += x0;
  if (bg) {
    s32 py, px;
    for (py = -2; py < H + 2; py++) {
      u8 *yrow = p->y + (u32)(y0 + py) * p->stride;
      u8 *crow = p->c + (u32)(y0 + py) * p->stride;
      for (px = -2; px < total + 2; px++) { yrow[x0 + px] = 16; crow[(x0 + px) & ~1] = 128; crow[((x0 + px) & ~1) + 1] = 128; }
    }
  }
  for (i = 0; i < count; i++) {
    struct shape s[MAXSHAPES];
    u32 n, j;
    s32 qH = H * 4, qT = T * 2; /* half thickness in 1/4 px: T/2 * 4 */
    s32 py;
    n = glyph_shapes(glyphs[i], width[i] * 4, qH, qT, T, s);
    if (!n) continue;
    for (py = 0; py < H; py++) {
      s32 qa = py * 4 + 1, qb = py * 4 + 3;
      s32 sx0[MAXSHAPES], sx1[MAXSHAPES];
      u32 act[MAXSHAPES], na = 0, ns = 0, a, b;
      /* The shapes this row's sample points can be in, and their pixel spans. */
      for (j = 0; j < n; j++) {
        s32 p0, p1;
        if (s[j].by1 < qa || s[j].by0 > qb) continue;
        act[na++] = j;
        p0 = s[j].bx0 >> 2;       /* the first pixel whose sample points (4 px + 1, + 3) reach bx0 */
        p1 = (s[j].bx1 - 1) >> 2; /* the last whose first sample point is within bx1 */
        if (p0 < 0) p0 = 0;
        if (p1 > width[i] - 1) p1 = width[i] - 1;
        if (p0 > p1) continue;
        /* Insert in order of start, then merge overlapping or touching spans. */
        for (a = ns; a > 0 && sx0[a - 1] > p0; a--) { sx0[a] = sx0[a - 1]; sx1[a] = sx1[a - 1]; }
        sx0[a] = p0; sx1[a] = p1; ns++;
      }
      if (!ns) continue;
      for (a = 0, b = 1; b < ns; b++) {
        if (sx0[b] <= sx1[a] + 1) { if (sx1[b] > sx1[a]) sx1[a] = sx1[b]; }
        else { a++; sx0[a] = sx0[b]; sx1[a] = sx1[b]; }
      }
      ns = a + 1;
      for (a = 0; a < ns; a++) {
        s32 px;
        for (px = sx0[a]; px <= sx1[a]; px++) {
          u32 cov = 0, sx, sy, q;
          for (sy = 0; sy < 2; sy++) for (sx = 0; sx < 2; sx++) {
            s32 qx = px * 4 + 1 + (s32)sx * 2, qy = py * 4 + 1 + (s32)sy * 2;
            for (q = 0; q < na; q++) if (shape_hit(&s[act[q]], qx, qy)) { cov++; break; }
          }
          if (cov) {
            s32 X, Y;
            u8 *yp, *cp;
            stored_at(o, p->width, p->height, left[i] + px, y0 + py, &X, &Y);
            yp = p->y + (u32)Y * p->stride + (u32)X;
            cp = p->c + (u32)Y * p->stride + (u32)(X & ~1);
            *yp = (u8)(*yp + (((s32)col.y - *yp) * (s32)cov >> 2));
            cp[0] = (u8)(cp[0] + (((s32)col.cb - cp[0]) * (s32)cov >> 2));
            cp[1] = (u8)(cp[1] + (((s32)col.cr - cp[1]) * (s32)cov >> 2));
          }
        }
      }
    }
  }
}

/* Width of a run of glyphs drawn at height H (same arithmetic as text_at). */
s32 dv_text_width(const glyph *glyphs, u32 count, s32 H) {
  s32 left[MAXGLYPH], width[MAXGLYPH];
  if (count > MAXGLYPH) return 1 << 20;
  return layout(glyphs, count, H, left, width);
}

