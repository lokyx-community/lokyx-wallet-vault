// LOKYX sun codes (ring design C): an address drawn as one sun of long and short rays, with the
// address signet in the middle, and read back from camera pixels.
//
// Layout, with the outer circle's radius as 1:
//   - a thin outer circle (radius 1) that the reader uses to find the sun and its tilt
//   - 88 rays starting at radius 0.44. Each ray has one of 8 lengths, so it carries 3 bits
//   - ray 0 runs all the way out to the circle and two rays either side of it are left out: the start mark,
//     the "this way up" that tells the reader where to begin and which way round to go
//   - the middle (radius < 0.38) holds the signet
// The other 83 rays carry 31 bytes (249 bits, the last one unused), Gray-coded so that misreading a
// ray by one step costs one bit, and XORed with a fixed pattern so even an all-zero address draws
// a lively sun:
//   type (1 = address, 2 = time capsule) | 20-byte address | 10 Reed-Solomon check bytes

import * as rs from './rs.ts';

/** How one kind of sun is built. The standard sun carries a 20-byte address; the wide one has more, finer rays and
 *  carries a 32-byte one (Solana). The reader tries the standard sun first, then the wide. */
export interface Profile {
  rays: number;
  inner: number;
  base: number;
  step: number;
  rayStroke: number;
  nsym: number;
  /** bytes in the code: type, address and check bytes */
  bytes: number;
  addr: number;
  /** the type bytes this sun may carry */
  types: number[];
  gaps: number[];
  data: number[];
  pattern: number[];
  seed: number;
}

function profile(c: Omit<Profile, 'gaps' | 'data' | 'pattern'>): Profile {
  const gaps = [1, 2, c.rays - 2, c.rays - 1];
  const data = Array.from({ length: c.rays }, (_, i) => i).filter((i) => i !== 0 && !gaps.includes(i));
  let x = c.seed;
  const pattern = data.map(() => {
    x = (x * 1103515245 + 12345) >>> 0;
    return (x >>> 16) & 7;
  });
  return { ...c, gaps, data, pattern };
}

export const STANDARD = profile({ rays: 88, inner: 0.44, base: 0.1, step: 0.052, rayStroke: 0.021, nsym: 10, bytes: 31, addr: 20, types: [1, 2, 3, 4, 5, 6], seed: 0x51a3 });
export const WIDE = profile({ rays: 128, inner: 0.5, base: 0.075, step: 0.055, rayStroke: 0.0155, nsym: 12, bytes: 45, addr: 32, types: [7], seed: 0x3c71 });

export const RAYS = STANDARD.rays;
export const INNER = STANDARD.inner;
export const BASE = STANDARD.base; // the shortest ray
export const STEP = STANDARD.step; // each length level adds this
export const LEVELS = 8;
export const RAY_STROKE = STANDARD.rayStroke;
export const FRAME_STROKE = 0.028;
export const HOLE = 0.38;

const gray = (v: number) => v ^ (v >> 1);
const ungray = (g: number) => {
  let v = g;
  for (let s = g >> 1; s; s >>= 1) v ^= s;
  return v;
};

/** Length level (0-7) of every ray. Ray 0 is the start mark (-2: to the rim), the two rays either
 *  side of it are gaps (-1). */
export function sunLevels(address: Uint8Array, type = 1, p: Profile = address.length === WIDE.addr ? WIDE : STANDARD): number[] {
  if (address.length !== p.addr) throw new Error(`address must be ${p.addr} bytes`);
  const { rays: RAYS, data: DATA, pattern: PATTERN, nsym: NSYM, bytes: BYTES } = p;
  const GAP = (i: number) => p.gaps.includes(i);
  const payload = new Uint8Array(p.addr + 1);
  payload[0] = type;
  payload.set(address, 1);
  const code = rs.encode(payload, NSYM);
  const bit = (i: number) => (i < BYTES * 8 ? (code[i >> 3] >> (7 - (i & 7))) & 1 : 0);
  const out = new Array(RAYS).fill(0);
  for (let i = 0; i < RAYS; i++) if (GAP(i)) out[i] = -1;
  out[0] = -2;
  DATA.forEach((ray, k) => {
    const v = (bit(k * 3) << 2) | (bit(k * 3 + 1) << 1) | bit(k * 3 + 2);
    out[ray] = ungray(v ^ PATTERN[k]);
  });
  return out;
}

const tipOf = (level: number, p: Profile) => (level === -2 ? 1 - FRAME_STROKE / 2 : p.inner + p.base + level * p.step);

/** SVG path data for the rays, in a box of `size` with the sun centred. Draw `rays` with round caps
 *  at `stroke`, and the outer circle at `frameStroke`. `each` has every ray on its own, for
 *  drawing them in one at a time. */
export function sunPaths(levels: number[], size: number, p: Profile = levels.length === WIDE.rays ? WIDE : STANDARD) {
  const { rays: RAYS, inner: INNER, rayStroke: RAY_STROKE } = p;
  const R = size / 2 / (1 + FRAME_STROKE);
  const c = size / 2;
  const f = (n: number) => n.toFixed(2);
  const stroke = RAY_STROKE * R;
  const each = levels.map((lv, i) => {
    if (lv === -1) return '';
    const t = ((i / RAYS) * 360 - 90) * (Math.PI / 180);
    const r0 = INNER * R + stroke / 2;
    const r1 = tipOf(lv, p) * R - (lv === -2 ? 0 : stroke / 2);
    return `M${f(c + Math.cos(t) * r0)} ${f(c + Math.sin(t) * r0)}L${f(c + Math.cos(t) * r1)} ${f(c + Math.sin(t) * r1)}`;
  });
  return { frame: R, frameStroke: FRAME_STROKE * R, stroke, rays: each.join(''), each };
}

function unpack(levels: number[], p: Profile): Uint8Array | null {
  const { data: DATA, pattern: PATTERN, nsym: NSYM, bytes: BYTES } = p;
  const code = new Uint8Array(BYTES);
  DATA.forEach((ray, k) => {
    const v = gray(levels[ray]) ^ PATTERN[k];
    for (let j = 0; j < 3; j++) {
      const i = k * 3 + j;
      if (i >= BYTES * 8) return;
      if ((v >> (2 - j)) & 1) code[i >> 3] |= 1 << (7 - (i & 7));
    }
  });
  const msg = rs.decode(code, NSYM);
  if (!msg || !p.types.includes(msg[0])) return null; // 1 LYX, 2 capsule, 3-6 Bitcoin, Ethereum and Tron, 7 Solana (chain-sun.ts)
  return msg;
}

// ---------- reading a sun from pixels ----------

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

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** Least-squares ellipse through points, as centre, semi-axes and rotation. */
function fitEllipse(pts: [number, number][], ox: number, oy: number) {
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
      const k = M[r][c] / M[c][c];
      for (let j = c; j < 6; j++) M[r][j] -= k * M[c][j];
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

const SCAN = 240;

/** Slant guesses, flat first, then outwards in rings: how far the sun is turned away from the camera (up to about 45 degrees). */
const TILTS: [number, number][] = (() => {
  const out: [number, number][] = [[0, 0]];
  for (const r of [0.12, 0.24, 0.36]) {
    const n = Math.round((r / 0.12) * 6);
    for (let k = 0; k < n; k++) out.push([r * Math.cos((k / n) * Math.PI * 2), r * Math.sin((k / n) * Math.PI * 2)]);
  }
  return out;
})();

/**
 * Read a sun code from a grayscale image (one byte per pixel, row by row). The sun should be
 * roughly in the middle and fill most of the picture. It can be turned any way, tilted a little,
 * mirrored, and light on dark or dark on light. Returns the type byte and the 20-byte address.
 */
export function decodeSun(grayImg: Uint8Array, w: number, h: number, trace?: { marks: number; best: number[] }): Uint8Array | null {
  return decodeWith(grayImg, w, h, STANDARD, trace) ?? decodeWith(grayImg, w, h, WIDE, trace);
}

function decodeWith(grayImg: Uint8Array, w: number, h: number, p: Profile, trace?: { marks: number; best: number[] }): Uint8Array | null {
  // `trace` is for tools/sun-check: how many start marks were found, and the first reading
  const t = otsu(grayImg);
  for (const light of [true, false]) {
    const on = (x: number, y: number) => {
      const xi = Math.round(x),
        yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
      const v = grayImg[yi * w + xi];
      return light ? (v > t ? 1 : 0) : v < t ? 1 : 0;
    };
    const res = readWith(on, w, h, p, trace);
    if (res) return res;
  }
  return null;
}

function readWith(on: (x: number, y: number) => number, w: number, h: number, p: Profile, trace?: { marks: number; best: number[] }): Uint8Array | null {
  const { rays: RAYS, inner: INNER, base: BASE, step: STEP, rayStroke: RAY_STROKE, data: DATA } = p;
  const GAP = (i: number) => p.gaps.includes(i);
  let cx = w / 2,
    cy = h / 2;
  const maxR = Math.min(w, h) / 2;
  let ell: ReturnType<typeof fitEllipse> = null;
  // the outer circle: the outermost marked pixels along each direction, fitted with an ellipse
  for (let pass = 0; pass < 3; pass++) {
    const edge: number[] = [];
    for (let k = 0; k < SCAN; k++) {
      const a = (k / SCAN) * Math.PI * 2;
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
        const a = (k / SCAN) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    });
    if (pts.length < SCAN / 3) return null;
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
  // Held at a slant, a circle still shows as an ellipse, but the rays are no longer evenly spread round it and
  // the inner rings are off-centre. The picture is the ellipse's own stretch plus one more unknown: a slide of
  // the unit disk along some direction (a Lorentz boost of the Klein disk, which maps the circle to itself).
  // That has two numbers, (bx, by). The error-correcting code says when they are right, so try them
  // from "flat on" outwards.
  const flat = (rho: number, a: number): [number, number] => {
    const u = E.a * (rho / outer) * Math.cos(a),
      v = E.b * (rho / outer) * Math.sin(a);
    return [E.cx + cphi * u - sphi * v, E.cy + sphi * u + cphi * v];
  };
  const attempt = (bx: number, by: number): Uint8Array | null => {
    const b2 = bx * bx + by * by;
    const beta = Math.sqrt(b2);
    const gam = 1 / Math.sqrt(1 - b2);
    const nx = beta ? bx / beta : 1,
      ny = beta ? by / beta : 0;
    const at = (rho: number, a: number): [number, number] => {
      let px = (rho / outer) * Math.cos(a),
        py = (rho / outer) * Math.sin(a);
      if (beta) {
        const par = px * nx + py * ny;
        const perp = -px * ny + py * nx;
        const z = gam * (1 + beta * par);
        const par2 = (gam * (par + beta)) / z;
        const perp2 = perp / z;
        px = par2 * nx - perp2 * ny;
        py = par2 * ny + perp2 * nx;
      }
      const u = E.a * px,
        v = E.b * py;
      return [E.cx + cphi * u - sphi * v, E.cy + sphi * u + cphi * v];
    };

    // How far out the ink goes along each direction, at fine angular steps. A ray is read as the
    // last radius where ink is still continuous from the inner start.
    const N = RAYS * 8;
    const STEPS = 140;
    const lo = INNER + 0.02;
    const hi = 0.985;
    const reach = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      let last = 0;
      let miss = 0;
      for (let i = 0; i <= STEPS; i++) {
        const rho = lo + ((hi - lo) * i) / STEPS;
        if (on(...at(rho, a))) {
          last = rho;
          miss = 0;
        } else if (++miss > 2) break;
      }
      reach[k] = last;
    }
    const per = N / RAYS;
    const ray = (off: number, i: number, dir: number) => {
      // the longest reach near the ray's centre line, so a slightly off angle still finds the tip
      let best = 0;
      for (let q = -1; q <= 1; q++) {
        const k = (((Math.round(off + dir * i * per) + q) % N) + N) % N;
        best = Math.max(best, reach[k]);
      }
      return { tip: best };
    };
    // how much ink there is in the middle of a gap, from the inner start out
    const gapInk = (pos: number) => {
      const a = (pos / N) * Math.PI * 2;
      let n = 0;
      for (let i = 0; i < 6; i++) n += on(...at(INNER + 0.03 + i * 0.03, a));
      return n / 6;
    };
    const exact = (tip: number) => Math.max(0, Math.min(LEVELS - 1, (tip + RAY_STROKE / 2 - INNER - BASE) / STEP));

    for (const dir of [1, -1]) {
      for (let step = 0; step < N; step++) {
        const m0 = ray(step, 0, dir);
        if (m0.tip < 0.94) continue;
        if (gapInk(step + dir * 1.5 * per) > 0.34 || gapInk(step - dir * 1.5 * per) > 0.34) continue;
        const raw = Array.from({ length: RAYS }, (_, i) => (i === 0 || GAP(i) ? 0 : exact(ray(step, i, dir).tip)));
        if (trace) trace.marks++;
        const levels = raw.map((v, i) => (i === 0 ? -2 : GAP(i) ? -1 : Math.round(v)));
        const msg = unpack(levels, p);
        if (msg) return msg;
        if (trace && !trace.best.length) trace.best = levels;
        // Not quite: the rays closest to halfway between two lengths are the likely mistakes, so try
        // moving them to the other length, one and then two at a time.
        const doubt = DATA.map((i) => ({ i, d: Math.abs((raw[i] % 1) - 0.5) }))
          .sort((a, b2) => a.d - b2.d)
          .slice(0, 8)
          .map(({ i }) => ({ i, alt: raw[i] - Math.round(raw[i]) >= 0 ? Math.min(LEVELS - 1, levels[i] + 1) : Math.max(0, levels[i] - 1) }));
        const tryWith = (picks: typeof doubt) => {
          const l = [...levels];
          for (const d of picks) l[d.i] = d.alt;
          return unpack(l, p);
        };
        for (let a = 0; a < doubt.length; a++) {
          const m1 = tryWith([doubt[a]]);
          if (m1) return m1;
        }
        for (let a = 0; a < doubt.length; a++)
          for (let c2 = a + 1; c2 < doubt.length; c2++) {
            const m2 = tryWith([doubt[a], doubt[c2]]);
            if (m2) return m2;
          }
      }
    }

    return null;
  };
  // Where is the tilt? The bases of the rays all sit on one circle, which a slant turns into an ellipse whose
  // middle is pushed off the outer circle's middle. How far and which way gives the slide directly.
  const guess = (): [number, number] | null => {
    const n = 144;
    const dr = 0.004;
    const raw: { a: number; rho: number }[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      for (let rho = 0.26; rho < 0.7; rho += dr) {
        if (on(...flat(rho * outer, a)) && on(...flat((rho + dr) * outer, a))) {
          raw.push({ a, rho });
          break;
        }
      }
    }
    if (raw.length < n * 0.6) return null;
    const med = median(raw.map((q) => q.rho));
    const pts = raw.filter((q) => Math.abs(q.rho - med) < 0.09).map((q): [number, number] => [q.rho * Math.cos(q.a), q.rho * Math.sin(q.a)]);
    if (pts.length < n * 0.5) return null;
    const e = fitEllipse(pts, 0, 0);
    if (!e) return null;
    const d = Math.hypot(e.cx, e.cy);
    if (d < 0.004 || d > 0.4) return [0, 0];
    const r0 = INNER / outer;
    const q = r0 * r0;
    const beta = (-(1 - q) + Math.sqrt((1 - q) * (1 - q) + 4 * d * d * q)) / (2 * d * q);
    return [(e.cx / d) * beta, (e.cy / d) * beta];
  };
  const tries: [number, number][] = [];
  const g = guess();
  if (g) {
    tries.push(g);
    for (const r of [0.012, 0.024]) for (let k = 0; k < 8; k++) tries.push([g[0] + r * Math.cos((k / 8) * Math.PI * 2), g[1] + r * Math.sin((k / 8) * Math.PI * 2)]);
  }
  tries.push(...TILTS);
  for (const [bx, by] of tries) {
    const m = attempt(bx, by);
    if (m) return m;
  }
  return null;
}
