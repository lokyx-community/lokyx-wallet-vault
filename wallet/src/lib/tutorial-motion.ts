// Pure motion helpers for the tutorial scenes: easing, keyframe lookup, and sampling a motion into a fixed grid of
// times so the screen can play it with a plain interpolate. No React here.

/** Seconds each step's picture plays before it loops. */
export const STEP = 3.6;
const SAMPLES = 73;

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Fast start, soft landing. 0..1 in, 0..1 out. */
export const eo = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
/** Soft start, soft landing. */
export const eio = (t: number) => {
  const c = clamp(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};

/** Piecewise-linear lookup: where `x` falls along `xs`, the matching value along `ys`. Clamped at both ends. */
export function ip(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const p = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + (ys[i] - ys[i - 1]) * p;
    }
  }
  return ys[ys.length - 1];
}

/** The times 0..STEP the motions are sampled at (strictly increasing, first 0, last STEP). */
export const GRID: number[] = Array.from({ length: SAMPLES }, (_, i) => (i * STEP) / (SAMPLES - 1));

/** A motion written as a function of time, turned into values on GRID. */
export const sampled = (fn: (u: number) => number): number[] => GRID.map((u) => fn(u));

export type Fn = (u: number) => number;
/** A number that stays put, or a motion. */
export type V = number | Fn;
export const asFn = (v: V | undefined, fallback: number): Fn => (typeof v === 'function' ? v : () => (v === undefined ? fallback : v));

/** A trail behind a moving thing: the same motion a little earlier, fainter and smaller the further back. */
export const trail = (g: number) => ({ delay: g * 0.045, fade: Math.max(0, 0.4 - g * 0.09), shrink: 1 - g * 0.1 });
