/* SPDX-License-Identifier: GPL-2.0-only
 *
 * GR Mod Film, development library: PC side (tests, reference tool). What the camera gets ready
 * made from GR Mod (texture recipes, grain profiles) is computed here, with floating point.
 */
#ifndef GRMOD_DEVELOP_HOST_H
#define GRMOD_DEVELOP_HOST_H
#include "../develop.h"

/* The four texture recipes (fine sigma 0.6 px, coarse 1.8 px, chroma 1.2 px), with the scale that
 * brings each texture to DV_TEX_SD (measured by making it). */
void host_recipes(struct dv_tex_recipe r[4]);

/* Textures made from the recipes (allocated). */
void host_textures(struct dv_textures *t, const struct dv_tex_recipe r[4]);

/* The spec's archetypes ("Profils indicatifs, à calibrer à l'œil"). */
enum { ARCH_BW400, ARCH_BW100, ARCH_NEG400, ARCH_NEG160, ARCH_SLIDE100, ARCH_CINE500T, ARCH_COUNT };
const char *host_arch_name(int a);
void host_profile(struct dv_grain_profile *p, int archetype);
/* A profile from its numbers: size in pixels (the steps for Small, Profile, Large), tone points. */
void host_profile_make(struct dv_grain_profile *p, int amount, double size, int mix, int chroma, const double tone[17]);

/* A picture in memory (YCbCr 4:2:2, stride = width). */
struct host_image { struct dv_image im; unsigned char *buf; };
void host_image_new(struct host_image *h, unsigned w, unsigned hgt, unsigned char y, unsigned char cb, unsigned char cr);
void host_image_free(struct host_image *h);
/* Write as PGM (Y only) or PPM (RGB through JFIF's matrix). */
int host_write_pgm(const char *path, const struct dv_image *im);
int host_write_ppm(const char *path, const struct dv_image *im);
#endif
