// LOKYX ring codes, the first design: an address drawn as four rings of arcs. New codes are suns
// (sun.ts); these are still read so rings people already saved or printed keep working.
//
// Layout, with the outer circle's radius as 1:
//   - an outer circle (radius 1) that the reader uses to find the ring and its tilt
//   - four data rings at radii 0.90, 0.78, 0.66, 0.54, each 64 slots; a slot is an arc (1) or a gap (0)
//   - the middle (radius < 0.42) is free for a picture
// Ring 0 slots 0-3 are always arcs and slots 4 and 63 always gaps: the start mark, which tells the
// reader which way up the ring is. The other 250 slots carry 31 bytes, XORed with a fixed pattern
// so that even an all-zero address draws a lively ring:
//   type (1 = address) | 20-byte address | 10 Reed-Solomon check bytes (repairs any 5 bad bytes)

import * as rs from './rs.ts';
import { decodeSun } from './sun.ts';

export const SLOTS = 64;
export const RADII = [0.9, 0.78, 0.66, 0.54];
export const STROKE = 0.045;
export const FRAME_STROKE = 0.03;
export const HOLE = 0.42;
const NSYM = 10;
export const TYPE_ADDRESS = 1;
/** A time capsule's contract address: scanning it opens the capsule instead of paying. */
export const TYPE_CAPSULE = 2;

const reserved = (ring: number, slot: number) => ring === 0 && (slot <= 4 || slot === 63);
const mark = (ring: number, slot: number) => (ring === 0 && slot <= 3 ? 1 : 0);

/** Data slot positions, in order. */
const POSITIONS: [number, number][] = [];
for (let r = 0; r < 4; r++) for (let s = 0; s < SLOTS; s++) if (!reserved(r, s)) POSITIONS.push([r, s]);

const MASK: number[] = (() => {
  let x = 0x2f6b;
  return POSITIONS.map(() => {
    x = (x * 1103515245 + 12345) >>> 0;
    return (x >>> 16) & 1;
  });
})();

/** The slots for a 20-byte address: bits[ring][slot]. */
export function ringBits(address: Uint8Array, type = TYPE_ADDRESS): number[][] {
  if (address.length !== 20) throw new Error('address must be 20 bytes');
  const payload = new Uint8Array(21);
  payload[0] = type;
  payload.set(address, 1);
  const code = rs.encode(payload, NSYM);
  const bits: number[][] = [0, 1, 2, 3].map((r) => Array.from({ length: SLOTS }, (_, s) => mark(r, s)));
  POSITIONS.forEach(([r, s], i) => {
    const byte = code[i >> 3];
    const b = i < code.length * 8 ? (byte >> (7 - (i & 7))) & 1 : 0;
    bits[r][s] = b ^ MASK[i];
  });
  return bits;
}

/** How a ring is drawn. "spikes" (the default) draws every set slot as a short spoke pointing
 *  out from the centre, like the address signet; "arcs" joins neighbouring slots into strokes.
 *  The reader handles both: it only looks at the middle of each slot. */
export type RingStyle = 'spikes' | 'arcs';

/** SVG path data for each ring, drawn in a box of `size` with the ring centred. Draw them with
 *  round caps at `stroke` width, and the outer circle at `frameStroke`. */
export function ringPaths(bits: number[][], size: number, style: RingStyle = 'spikes'): { frame: number; rings: string[]; stroke: number; strokes: number[]; frameStroke: number } {
  const R = size / 2 / (1 + FRAME_STROKE);
  const c = size / 2;
  const f = (n: number) => n.toFixed(2);
  if (style === 'spikes') {
    // each spoke is 64% of its slot wide, so outer spokes are wider, like rays of a sun
    const strokes = RADII.map((rr) => ((2 * Math.PI * rr) / SLOTS) * 0.64 * R);
    const stroke = strokes[3];
    const half = 0.038 * R; // half the spoke length, either side of the ring's radius
    const rings = bits.map((row, r) => {
      const rad = RADII[r] * R;
      let d = '';
      for (let s = 0; s < SLOTS; s++) {
        if (!row[s]) continue;
        const t = (((s + 0.5) / SLOTS) * 360 - 90) * (Math.PI / 180);
        const [cx, cy] = [Math.cos(t), Math.sin(t)];
        // the start mark on the outer ring stays one joined arc, so it reads as "this way up"
        if (r === 0 && s <= 3) continue;
        d += `M${f(c + cx * (rad - half))} ${f(c + cy * (rad - half))}L${f(c + cx * (rad + half))} ${f(c + cy * (rad + half))}`;
      }
      if (r === 0) {
        const a0 = ((0.18 / SLOTS) * 360 - 90) * (Math.PI / 180);
        const a1 = ((3.82 / SLOTS) * 360 - 90) * (Math.PI / 180);
        d += `M${f(c + rad * Math.cos(a0))} ${f(c + rad * Math.sin(a0))}A${f(rad)} ${f(rad)} 0 0 1 ${f(c + rad * Math.cos(a1))} ${f(c + rad * Math.sin(a1))}`;
      }
      return d;
    });
    return { frame: R, rings, stroke, strokes, frameStroke: FRAME_STROKE * R };
  }
  const stroke = STROKE * R;
  const rings = bits.map((row, r) => {
    const rad = RADII[r] * R;
    const cap = (stroke / 2 / rad) * (180 / Math.PI) + 0.45; // keep round ends inside the slot
    let d = '';
    let s = 0;
    while (s < SLOTS) {
      if (!row[s]) {
        s++;
        continue;
      }
      let e = s;
      while (e + 1 < SLOTS && row[e + 1]) e++;
      let a0 = (s / SLOTS) * 360 + cap;
      let a1 = ((e + 1) / SLOTS) * 360 - cap;
      if (a1 <= a0) a0 = a1 = ((s + e + 1) / 2 / SLOTS) * 360; // a single slot: a dot
      const p = (a: number) => {
        const t = ((a - 90) * Math.PI) / 180;
        return [c + rad * Math.cos(t), c + rad * Math.sin(t)];
      };
      const [x0, y0] = p(a0);
      const [x1, y1] = p(a1);
      const large = a1 - a0 > 180 ? 1 : 0;
      d += a1 === a0 ? `M${f(x0)} ${f(y0)}l0.01 0` : `M${f(x0)} ${f(y0)}A${f(rad)} ${f(rad)} 0 ${large} 1 ${f(x1)} ${f(y1)}`;
      s = e + 1;
    }
    return d;
  });
  return { frame: R, rings, stroke, strokes: RADII.map(() => stroke), frameStroke: FRAME_STROKE * R };
}

function unpack(bits: number[][]): Uint8Array | null {
  const code = new Uint8Array(31);
  for (let i = 0; i < code.length * 8; i++) {
    const [r, s] = POSITIONS[i];
    const b = bits[r][s] ^ MASK[i];
    if (b) code[i >> 3] |= 1 << (7 - (i & 7));
  }
  const msg = rs.decode(code, NSYM);
  if (!msg || (msg[0] !== TYPE_ADDRESS && msg[0] !== TYPE_CAPSULE)) return null;
  return msg;
}

// ---------- reading a ring from pixels ----------

function otsu(g: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0,
    wB = 0,
    best = 0,
    t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = g.length - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB,
      mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) {
      best = v;
      t = i;
    }
  }
  return t;
}

const RAYS = 180;

/**
 * Read a sun or ring code from a grayscale image (one byte per pixel, row by row). The ring should be
 * roughly in the middle and fill most of the picture, as it does inside the scanner's circle. It
 * can be rotated any way, tilted a little, and either light on dark or dark on light. Returns the
 * type byte followed by the 20-byte address, or null.
 */
export function decodeGray(gray: Uint8Array, w: number, h: number): Uint8Array | null {
  return decodeSun(gray, w, h) ?? decodeRings(gray, w, h);
}

/** The old four-ring codes only. */
export function decodeRings(gray: Uint8Array, w: number, h: number): Uint8Array | null {
  const t = otsu(gray);
  for (const light of [true, false]) {
    const on = (x: number, y: number) => {
      const xi = Math.round(x),
        yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
      const v = gray[yi * w + xi];
      return light ? (v > t ? 1 : 0) : v < t ? 1 : 0;
    };
    const res = readWith(on, w, h);
    if (res) return res;
  }
  return null;
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

/** Least-squares ellipse through points, as centre, semi-axes and rotation. */
function fitEllipse(pts: [number, number][], ox: number, oy: number) {
  // A x^2 + B xy + C y^2 + D x + E y = 1, in coordinates centred on (ox, oy)
  const M = Array.from({ length: 5 }, () => new Array(6).fill(0));
  for (const [px, py] of pts) {
    const x = px - ox,
      y = py - oy;
    const row = [x * x, x * y, y * y, x, y];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) M[i][j] += row[i] * row[j];
      M[i][5] += row[i];
    }
  }
  for (let c = 0; c < 5; c++) {
    let piv = c;
    for (let r = c + 1; r < 5; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < 5; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 6; k++) M[r][k] -= f * M[c][k];
    }
  }
  const [A, B, C, D, E] = M.map((r, i) => r[5] / r[i]);
  const det = 4 * A * C - B * B;
  if (det <= 0) return null;
  const x0 = (B * E - 2 * C * D) / det,
    y0 = (B * D - 2 * A * E) / det;
  const F0 = A * x0 * x0 + B * x0 * y0 + C * y0 * y0 + D * x0 + E * y0 - 1;
  const phi = 0.5 * Math.atan2(B, A - C);
  const c = Math.cos(phi),
    s = Math.sin(phi);
  const l1 = A * c * c + B * c * s + C * s * s,
    l2 = A * s * s - B * c * s + C * c * c;
  if (-F0 / l1 <= 0 || -F0 / l2 <= 0) return null;
  return { cx: x0 + ox, cy: y0 + oy, a: Math.sqrt(-F0 / l1), b: Math.sqrt(-F0 / l2), phi };
}

function readWith(on: (x: number, y: number) => number, w: number, h: number): Uint8Array | null {
  let cx = w / 2,
    cy = h / 2;
  const maxR = Math.min(w, h) / 2;
  let ell: ReturnType<typeof fitEllipse> = null;
  // Find the outer circle: along each ray, the outermost marked pixels. Then fit an ellipse to
  // those points (a tilted ring is an ellipse) and look again from its centre.
  for (let pass = 0; pass < 3; pass++) {
    const edge: number[] = [];
    for (let k = 0; k < RAYS; k++) {
      const a = (k / RAYS) * Math.PI * 2;
      const dx = Math.cos(a),
        dy = Math.sin(a);
      let found = 0;
      for (let r = maxR * 0.99; r > maxR * 0.25; r -= 0.5) {
        if (on(cx + dx * r, cy + dy * r) && on(cx + dx * (r - 1), cy + dy * (r - 1))) {
          found = r;
          break;
        }
      }
      edge.push(found);
    }
    const m = median(edge.filter((x) => x > 0));
    if (!m) return null;
    const pts: [number, number][] = [];
    edge.forEach((r, k) => {
      if (r > 0 && Math.abs(r - m) < m * 0.2) {
        const a = (k / RAYS) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    });
    if (pts.length < RAYS / 3) return null;
    ell = fitEllipse(pts, cx, cy);
    if (!ell) return null;
    cx = ell.cx;
    cy = ell.cy;
  }
  if (!ell) return null;
  const E = ell;
  const outer = 1 + FRAME_STROKE / 2;
  const cphi = Math.cos(E.phi),
    sphi = Math.sin(E.phi);
  // a point at radius rho (outer circle = 1) and angle t on the ring, in the picture
  const at = (rho: number, t: number): [number, number] => {
    const u = (E.a * rho * Math.cos(t)) / outer,
      v = (E.b * rho * Math.sin(t)) / outer;
    return [E.cx + cphi * u - sphi * v, E.cy + sphi * u + cphi * v];
  };

  // Profile each ring at fine steps, across the middle of its stroke.
  const N = 1024;
  const prof = RADII.map((rr) => {
    const out = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const t = (k / N) * Math.PI * 2;
      let s = 0;
      for (const dr of [-0.25, 0, 0.25]) {
        const [x, y] = at(rr + dr * STROKE, t);
        s += on(x, y);
      }
      out[k] = s / 3;
    }
    return out;
  });
  const per = N / SLOTS;
  const slotValue = (ring: number, off: number, slot: number, dir: number) => {
    // average over the middle half of the slot
    let s = 0,
      n = 0;
    for (let q = -0.22; q <= 0.22; q += 0.11) {
      const pos = off + dir * (slot + 0.5 + q) * per;
      const k = (((Math.round(pos) % N) + N) % N) as number;
      s += prof[ring][k];
      n++;
    }
    return s / n;
  };

  // Try every rotation (in steps of a quarter slot) and both directions (a mirrored camera).
  for (const dir of [1, -1]) {
    for (let step = 0; step < SLOTS * 4; step++) {
      const off = (step / 4) * per;
      let ok = true;
      for (let sl = 0; sl <= 3 && ok; sl++) if (slotValue(0, off, sl, dir) < 0.5) ok = false;
      if (!ok) continue;
      if (slotValue(0, off, 4, dir) >= 0.5 || slotValue(0, off, 63, dir) >= 0.5) continue;
      const bits = [0, 1, 2, 3].map((r) => Array.from({ length: SLOTS }, (_, s) => (slotValue(r, off, s, dir) >= 0.5 ? 1 : 0)));
      const addr = unpack(bits);
      if (addr) return addr;
    }
  }
  return null;
}
