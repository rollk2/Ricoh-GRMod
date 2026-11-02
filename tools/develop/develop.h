/* SPDX-License-Identifier: GPL-2.0-only
 *
 * GR Mod Film: the development library (docs/SPEC-developpement-diptyque-grain.md, step 2;
 * docs/ARCHITECTURE.md). Grain, diptych, date at printing and contact sheet layout, on YCbCr 4:2:2
 * pictures as the camera's JPEG encoder gets them (tools/datestamp/datestamp.c, struct picture).
 *
 * The same sources build for the PC (tests, reference images) and for the camera, under the
 * camera modules' rules (tools/datestamp/gen.py): no global or constant data (every table comes in
 * through the arguments, made by GR Mod on the PC), no division, no floating point, no library.
 * Everything is integer and deterministic: the same inputs give the same bytes on both.
 */
#ifndef GRMOD_DEVELOP_H
#define GRMOD_DEVELOP_H

typedef unsigned char u8;
typedef signed char s8;
typedef unsigned short u16;
typedef short s16;
typedef unsigned int u32;
typedef int s32;

/* A YCbCr 4:2:2 picture, or a window into one: a Y plane and a CbCr plane with Cb at even and Cr
 * at odd bytes (one pair for two pixels), both `stride` bytes per row, as many rows. Full range
 * (JFIF): black is Y 0, neutral chroma 128. `width` is even. */
struct dv_image {
  u8 *y;
  u8 *c;
  u32 width, height, stride;
};

/* ------------------------------------------------------------------ grain */

/* Texture sizes: the two luma octaves have prime-to-each-other sizes (no visible period), and so
 * have the two chroma textures. Total 650 770 bytes. */
#define DV_FINE_N 512u
#define DV_COARSE_N 509u
#define DV_CB_N 256u
#define DV_CR_N 251u
#define DV_TAPS_MAX 15u

/* How one texture is made (computed on the PC by tools/develop/recipes.c, passed in by the camera):
 * white noise from `seed` (sum of four uniform bytes), a separable Gaussian blur of `taps`
 * coefficients (sum 4096, centred, odd count) wrapped around the edges, then times `scale_q16`
 * >> 16 to a fixed standard deviation (DV_TEX_SD), clipped to -127..127. */
struct dv_tex_recipe {
  u32 seed;
  u32 scale_q16;
  u16 n;
  u16 taps;
  u16 tap[DV_TAPS_MAX];
};
#define DV_TEX_SD 32

struct dv_textures {
  s8 *fine;   /* DV_FINE_N * DV_FINE_N */
  s8 *coarse; /* DV_COARSE_N * DV_COARSE_N */
  s8 *cb;     /* DV_CB_N * DV_CB_N */
  s8 *cr;     /* DV_CR_N * DV_CR_N */
};

/* A film's grain profile (stored with the film's tables in the firmware). `step_q16[i]` is the
 * texture step per pixel for the user's size setting i (Small, Profile, Large: size 0.75, 1.0,
 * 1.4 times the profile's), 65536 / effective size, computed on the PC (no division here). */
struct dv_grain_profile {
  u8 amount;      /* 0..100: luma grain strength */
  u8 octave_mix;  /* 0..100: share of the coarse octave */
  u8 chroma;      /* 0..100: chroma grain (0 for black and white) */
  u8 tone[17];    /* 0..255: weight by luma at 0, 16, ..., 240, 255 */
  u32 step_q16[3];
};

/* User settings, fixed when the roll is loaded. */
#define DV_INTENSITY_OFF 0u
#define DV_INTENSITY_LOW 1u
#define DV_INTENSITY_PROFILE 2u
#define DV_INTENSITY_HIGH 3u
#define DV_SIZE_SMALL 0u
#define DV_SIZE_PROFILE 1u
#define DV_SIZE_LARGE 2u

/* Everything the per-pixel loop needs for one frame. */
struct dv_grain {
  const struct dv_textures *tex;
  u32 amount;     /* effective luma amount, 0..150 */
  u32 chroma;     /* effective chroma amount, 0..150 */
  u32 mix;        /* octave_mix */
  u32 step_q16;   /* texture step per pixel */
  u32 offx[4];    /* start offsets (Q16) in each texture: fine, coarse, cb, cr */
  u32 offy[4];
  u32 orient[4];  /* 0..7: bit 0 mirror the texture's x, bit 1 its y, bit 2 swap x and y */
  u32 salt[4];    /* the tiles' offsets (see grain.c, tiles) */
  u8 lut[256];    /* tone weight by luma */
};

/* The grain's shift: amount 100, tone weight 255 and a texture at DV_TEX_SD give a standard
 * deviation of about 10 luma levels. */
#define DV_GRAIN_SHIFT 23

/* Make the four textures. `work` is DV_WORK_S16 s16 of scratch memory (513 KB). */
#define DV_WORK_S16 (DV_FINE_N * DV_FINE_N + DV_FINE_N)
void dv_textures_make(const struct dv_textures *t, const struct dv_tex_recipe recipe[4], s16 *work);
/* The blurred noise of one texture before its scale, in `work` (n * n values; for the PC's
 * measurement of the scale). */
void dv_tex_noise(const struct dv_tex_recipe *r, s16 *work);

/* A frame's seed from its roll and frame numbers (the same on every development). */
u32 dv_frame_seed(u32 roll, u32 frame);

/* Fill `g` for a frame. */
void dv_grain_setup(struct dv_grain *g, const struct dv_textures *t, const struct dv_grain_profile *p,
                    u32 intensity, u32 size, u32 seed);

/* Add the grain to a picture or a band of it: (x0, y0) is the band's top left in the whole frame
 * (a diptych is one frame), so that bands put together give the same bytes as the whole. */
void dv_grain_apply(const struct dv_grain *g, struct dv_image *img, u32 x0, u32 y0);

/* ------------------------------------------------------------------ diptych */

/* A print of the half-frame roll: two views (frame numbers from 1), or one view and a black
 * unexposed one (DV_BLACK), or one view alone (right = DV_ALONE). */
#define DV_BLACK 0u
#define DV_ALONE 0xffffu
struct dv_pair { u16 left, right; };

/* The prints of `frames` views: 1-2, 3-4, ... or, `shifted`, 2-3, 4-5, ... (frame 1 then comes
 * first, alone or after a black view); a view left over is alone or with a black view
 * (`odd_black`, the spec's default). Returns the number of prints (at most frames / 2 + 2). */
u32 dv_diptych_pairs(u32 frames, u32 shifted, u32 odd_black, struct dv_pair *out);

/* Put two views side by side: rows of `out` (2 * view_w + sep wide, as high as the views) from
 * the rows of `left` and `right` (NULL: a black view), with a separator of `sep` pixels (even,
 * computed by GR Mod: 0 to 3 % of the print's width, 2 % by default), black or `white`. Works on
 * bands as well: give the bands of the same rows. */
void dv_diptych_rows(struct dv_image *out, const struct dv_image *left, const struct dv_image *right, u32 view_w, u32 sep, u32 white);

/* ------------------------------------------------------------------ date at printing */

struct dv_date { u16 year; u8 month, day, hour, minute; };
#define DV_DATE_SHORT 0u  /* '26 10 08 */
#define DV_DATE_LONG 1u   /* 2026.10.08 17:34 */

/* The date's glyphs (text.h), at most 16; 0 when the date is not valid. */
u32 dv_date_glyphs(const struct dv_date *d, u32 style, u16 *out);
/* Draw the date bottom right of the picture as it is shown (orientation 0 as stored, 1 turned a
 * quarter anticlockwise, 2 upside down, 3 a quarter clockwise: EXIF 1, 8, 3, 6), as the date
 * imprint does; `mono`: in light only (black-and-white film). Returns 0 when nothing is drawn. */
int dv_date_draw(struct dv_image *im, const struct dv_date *d, u32 style, u32 orient, u32 mono);

/* ------------------------------------------------------------------ contact sheet */

#define DV_SHEET_COLUMNS 6u
struct dv_sheet {
  u32 frames, tw, th, rows;
  u32 gap, rebate, margin, strip;
  u32 width, height;   /* of the whole sheet */
};
/* The sheet for `frames` views of tw x th (the size of the small pictures put in it). */
void dv_sheet_geometry(struct dv_sheet *s, u32 frames, u32 tw, u32 th);
/* Top left of view `index` (from 0) in the sheet. */
void dv_sheet_slot(const struct dv_sheet *s, u32 index, u32 *x, u32 *y);
void dv_sheet_clear(struct dv_image *sheet);
/* Put view `index` in its frame with its number under it and, at the start of a strip, the film's
 * name above (glyphs made by GR Mod, at most 32; NULL for none). */
void dv_sheet_place(struct dv_image *sheet, const struct dv_sheet *s, u32 index, const struct dv_image *thumb,
                    u32 number, const u16 *name, u32 name_len);
/* A view made `f` times smaller (box average; dst is src / f in both directions, width even). */
void dv_thumb_box(struct dv_image *dst, const struct dv_image *src, u32 f);

#endif
