/* SPDX-License-Identifier: GPL-2.0-only
 *
 * GR Mod Film, development library: text in segments (text.c, from tools/datestamp/datestamp.c).
 */
#ifndef GRMOD_DEVELOP_TEXT_H
#define GRMOD_DEVELOP_TEXT_H
#include "develop.h"

/* Glyph codes: the digits 0..15, the marks below, or G_LETTER | fourteen segments (a capital,
 * made by GR Mod: core/src/fw/aspect/datestamp.ts, LETTER_SEGMENTS). */
typedef u16 glyph;
#define G_APOSTROPHE 16
#define G_SPACE 17
#define G_DOT 18
#define G_COLON 19
#define G_LETTER 0x4000u
#define is_letter(g) (((g) & G_LETTER) != 0)

/* How a picture is shown (EXIF orientation 1, 8, 3, 6). */
#define O_NONE 0u
#define O_LEFT 1u
#define O_HALF 2u
#define O_RIGHT 3u

struct colour { u8 y, cb, cr; };

/* Draw `count` glyphs (at most 64) with their top left corner at (x0, y0) of the picture as it is
 * shown (orientation `o`), digit height H, blended at 2 x 2 samples per pixel. `bg`: fill the box
 * behind with black first (O_NONE only). The caller checks the box is inside the picture. */
void dv_text_at(struct dv_image *p, const glyph *glyphs, u32 count, s32 x0, s32 y0, s32 H, struct colour col, int bg, u32 o);
/* Width of a run of glyphs at digit height H. */
s32 dv_text_width(const glyph *glyphs, u32 count, s32 H);
#endif
