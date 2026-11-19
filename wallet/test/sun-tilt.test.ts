import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSun, sunLevels, sunPaths, FRAME_STROKE } from '../src/lib/sun.ts';

// Draw a sun as a camera would see it when the phone is held at a slant: a small ray-by-ray rasteriser behind a
// perspective turn, so the reader's slant correction is tested without a camera.
function photo(address: Uint8Array, tiltDeg: number, spinDeg: number, N = 320): Uint8Array {
  return photoOf(sunLevels(address), tiltDeg, spinDeg, N);
}

function photoOf(levels: number[], tiltDeg: number, spinDeg: number, N = 320): Uint8Array {
  const S = 640; // the drawing's own size
  const paths = sunPaths(levels, S);
  const R = S / 2 / (1 + FRAME_STROKE);
  const segs = paths.each.filter(Boolean).map((d) => d.match(/-?[\d.]+/g)!.map(Number) as [number, number, number, number]);
  const half = paths.stroke / 2;
  const th = (tiltDeg * Math.PI) / 180;
  const sp = (spinDeg * Math.PI) / 180;
  const f = 2 * S;
  const fit = 1 / (1.08 + 0.22 * (tiltDeg / 10));
  const out = new Uint8Array(N * N);
  for (let py = 0; py < N; py++)
    for (let px = 0; px < N; px++) {
      // image pixel -> centred, un-zoomed drawing coordinates, undoing a turn of the page about an axis through its middle
      const x = ((px + 0.5) / N - 0.5) * S / fit,
        y = ((py + 0.5) / N - 0.5) * S / fit;
      const ax = 0.8 * th, ay = 0.6 * th; // rotation vector, as in the simulator
      const ang = Math.hypot(ax, ay) || 1e-9, kx = ax / ang, ky = ay / ang;
      const c = Math.cos(ang), s = Math.sin(ang);
      // Rodrigues rotation matrix R (page -> camera); we need the page point whose camera ray hits (x, y)
      const r = [
        [c + kx * kx * (1 - c), kx * ky * (1 - c), ky * s],
        [kx * ky * (1 - c), c + ky * ky * (1 - c), -kx * s],
        [-ky * s, kx * s, c],
      ];
      // camera ray d = (x, y, f); page plane z = f in page coordinates after rotation: solve R^T-based intersection
      const d = [x, y, f];
      const Rt = [
        [r[0][0], r[1][0], r[2][0]],
        [r[0][1], r[1][1], r[2][1]],
        [r[0][2], r[1][2], r[2][2]],
      ];
      const dd = [Rt[0][0] * d[0] + Rt[0][1] * d[1] + Rt[0][2] * d[2], Rt[1][0] * d[0] + Rt[1][1] * d[1] + Rt[1][2] * d[2], Rt[2][0] * d[0] + Rt[2][1] * d[1] + Rt[2][2] * d[2]];
      // the page is the plane through (0, 0, f) turned by R: solve lambda * d = R q + (0, 0, f) for q with q_z = 0
      const t = (f * r[2][2]) / dd[2];
      let qx = dd[0] * t - f * r[2][0], qy = dd[1] * t - f * r[2][1];
      // spin the page, then back to the drawing's pixel coordinates
      const cs = Math.cos(-sp), sn = Math.sin(-sp);
      [qx, qy] = [cs * qx - sn * qy, sn * qx + cs * qy];
      qx += S / 2;
      qy += S / 2;
      let ink = false;
      const dist = Math.hypot(qx - S / 2, qy - S / 2);
      if (Math.abs(dist - R) < paths.frameStroke / 2) ink = true;
      for (let i = 0; i < segs.length && !ink; i++) {
        const [x0, y0, x1, y1] = segs[i];
        const vx = x1 - x0, vy = y1 - y0;
        const u = Math.max(0, Math.min(1, ((qx - x0) * vx + (qy - y0) * vy) / (vx * vx + vy * vy)));
        if (Math.hypot(qx - (x0 + u * vx), qy - (y0 + u * vy)) < half) ink = true;
      }
      out[py * N + px] = ink ? 200 : 25;
    }
  return out;
}

const ADDRS = [3, 77, 140].map((k) => Uint8Array.from({ length: 20 }, (_, i) => (k * 31 + i * 17 + (i * i) % 251) & 255));

test('a sun held flat is read', () => {
  for (const a of ADDRS) assert.deepEqual(decodeSun(photo(a, 0, 40), 320, 320)?.slice(1), a);
});

test('a sun held at a slant of 10, 20 and 30 degrees is still read', () => {
  for (const deg of [10, 20, 30]) for (const a of ADDRS) assert.deepEqual(decodeSun(photo(a, deg, deg * 7), 320, 320)?.slice(1), a, `${deg} degrees`);
});

const SOLS = [5, 91, 200].map((k) => Uint8Array.from({ length: 32 }, (_, i) => (k * 29 + i * 23 + (i * i * 7) % 253) & 255));

test('a tron sun (type 6) is read, and so is a sun the size the scanner uses', () => {
  for (const a of ADDRS) {
    const m = decodeSun(photoOf(sunLevels(a, 6), 15, 100), 320, 320);
    assert.equal(m?.[0], 6);
    assert.deepEqual(m?.slice(1), a);
  }
});

test('a wide sun for a 32-byte Solana key is read flat and at a slant', () => {
  for (const a of SOLS) {
    assert.deepEqual(decodeSun(photoOf(sunLevels(a, 7), 0, 40, 320), 320, 320)?.slice(1), a, 'flat');
    for (const deg of [10, 20, 30]) assert.deepEqual(decodeSun(photoOf(sunLevels(a, 7), deg, deg * 7, 320), 320, 320)?.slice(1), a, `${deg} degrees`);
  }
});
