// SPDX-License-Identifier: GPL-2.0-only
/**
 * T21-TAB1: the film mode's icons, drawn as 40 x 40 RGBA (the camera's icon format).
 *  - the Film Mode tab (a film strip) in the three states of a menu tab, as the camera's own tab
 *    icons are: white with a black edge on transparent (page title, + 0xa of a tab descriptor),
 *    black on the full yellow tile (active tab, + 0xc), grey on transparent (inactive tab, + 0xe);
 *  - Film Advance's Fn icon (a 135 cartridge), white on the Fn lists' tile (border 128, inside 53).
 * Shapes are drawn at 8 x 8 samples per pixel; coverage is the share of samples inside.
 */
import { composeIcon } from '../icons';

const W = 40, H = 40, SS = 8;
type Shape = (x: number, y: number) => boolean;
const rect = (x0: number, y0: number, x1: number, y1: number): Shape => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
const rounded = (x0: number, y0: number, x1: number, y1: number, r: number): Shape => (x, y) => {
  if (!(x >= x0 && x < x1 && y >= y0 && y < y1)) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const polygon = (pts: readonly (readonly [number, number])[]): Shape => (x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Coverage (0..1, row-major) of the union of `fill` minus the union of `cut`. */
function coverage(fill: readonly Shape[], cut: readonly Shape[]): Float32Array {
  const out = new Float32Array(W * H);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    let n = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = px + (sx + 0.5) / SS, y = py + (sy + 0.5) / SS;
      if (fill.some(s => s(x, y)) && !cut.some(s => s(x, y))) n++;
    }
    out[py * W + px] = n / (SS * SS);
  }
  return out;
}

/** A film strip: two frames between two rows of sprocket holes. */
export function filmStripCoverage(): Float32Array {
  const holes: Shape[] = [];
  for (let x = 6; x < 35; x += 6) holes.push(rect(x, 12, x + 3, 14), rect(x, 26, x + 3, 28));
  return coverage([rect(4, 10, 36, 30)], [...holes, rect(8, 16, 19, 24), rect(21, 16, 32, 24)]);
}

/** A 135 cartridge seen from the side: its spool knob, its body with two lips, the leader out of it. */
export function cartridgeCoverage(): Float32Array {
  return coverage(
    [rounded(8, 10, 20, 32, 2), rect(12, 6, 16, 10), rect(9, 32, 19, 34),
      polygon([[20, 15], [33, 15], [33, 19], [30, 21], [33, 23], [33, 27], [20, 27]])],
    [rect(8, 13, 20, 14), rect(8, 28, 20, 29), rect(22, 16, 24, 17.5), rect(26, 16, 28, 17.5), rect(22, 24.5, 24, 26), rect(26, 24.5, 28, 26)]);
}

/** The edge of a shape: coverage spread by `r` pixels (a square neighbourhood). */
function spread(c: Float32Array, r: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < W && yy >= 0 && yy < H) m = Math.max(m, c[yy * W + xx]);
    }
    out[y * W + x] = m;
  }
  return out;
}

/** The tab's three icons: [white (page title), yellow (active), grey (inactive)]. */
export function filmTabIcons(): [Uint8Array, Uint8Array, Uint8Array] {
  const c = filmStripCoverage(), edge = spread(c, 2);
  const white = new Uint8Array(W * H * 4), yellow = new Uint8Array(W * H * 4), grey = new Uint8Array(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const i = p * 4, t = c[p];
    // Yellow: the tile (255, 225, 0) everywhere, the drawing black.
    yellow[i] = Math.round(255 * (1 - t)); yellow[i + 1] = Math.round(225 * (1 - t)); yellow[i + 2] = 0; yellow[i + 3] = 255;
    // Grey: (80, 80, 80), alpha the coverage.
    grey[i] = 80; grey[i + 1] = 80; grey[i + 2] = 80; grey[i + 3] = Math.round(255 * t);
    // White: the drawing white over a black edge; transparent outside (FF FF FF 00).
    if (t > 0.5) { white[i] = 255; white[i + 1] = 255; white[i + 2] = 255; white[i + 3] = 255; }
    else if (edge[p] > 0) { white[i] = 0; white[i + 1] = 0; white[i + 2] = 0; white[i + 3] = Math.round(255 * edge[p]); }
    else { white[i] = 255; white[i + 1] = 255; white[i + 2] = 255; white[i + 3] = 0; }
    if (t === 0) { grey[i] = 255; grey[i + 1] = 255; grey[i + 2] = 255; }
  }
  return [white, yellow, grey];
}

/** Film Advance's Fn icon on `tile` (a Fn list tile: the camera's own tile, its inside cleared). */
export function filmAdvanceIcon(tile: Uint8Array): Uint8Array {
  return composeIcon(tile, cartridgeCoverage());
}

/** A Fn list tile with the alpha layout of one of the camera's Fn icons: its opaque area's outer ring
 * (128, 128, 128), inside (53, 53, 54), transparent pixels FF FF FF 00. */
export function fnTile(icon: Uint8Array): Uint8Array {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (icon[(y * W + x) * 4 + 3]) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const t = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (!icon[i + 3]) { t[i] = 255; t[i + 1] = 255; t[i + 2] = 255; t[i + 3] = 0; continue; }
    const ring = x === x0 || x === x1 || y === y0 || y === y1;
    t[i] = ring ? 128 : 53; t[i + 1] = ring ? 128 : 53; t[i + 2] = ring ? 128 : 54; t[i + 3] = 255;
  }
  return t;
}
