// Reed-Solomon over GF(256) (polynomial 0x11d, generator 2), the same field QR codes use.
// encode() appends `nsym` check bytes; decode() repairs up to nsym/2 wrong bytes or returns null.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const div = (a: number, b: number) => {
  if (b === 0) throw new Error('divide by zero');
  return a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255];
};
const pow = (a: number, n: number) => EXP[(LOG[a] * n) % 255];
const inv = (a: number) => EXP[255 - LOG[a]];

// polynomials are arrays of coefficients, highest degree first
function polyMul(p: number[], q: number[]) {
  const r = new Array(p.length + q.length - 1).fill(0);
  for (let j = 0; j < q.length; j++) for (let i = 0; i < p.length; i++) r[i + j] ^= mul(p[i], q[j]);
  return r;
}
function polyAdd(p: number[], q: number[]) {
  const r = new Array(Math.max(p.length, q.length)).fill(0);
  for (let i = 0; i < p.length; i++) r[i + r.length - p.length] = p[i];
  for (let i = 0; i < q.length; i++) r[i + r.length - q.length] ^= q[i];
  return r;
}
function polyScale(p: number[], x: number) {
  return p.map((c) => mul(c, x));
}
function polyEval(p: number[], x: number) {
  let y = p[0];
  for (let i = 1; i < p.length; i++) y = mul(y, x) ^ p[i];
  return y;
}

function generator(nsym: number) {
  let g = [1];
  for (let i = 0; i < nsym; i++) g = polyMul(g, [1, pow(2, i)]);
  return g;
}

export function encode(msg: Uint8Array, nsym: number): Uint8Array {
  const gen = generator(nsym);
  const res = new Array(msg.length + nsym).fill(0);
  for (let i = 0; i < msg.length; i++) res[i] = msg[i];
  for (let i = 0; i < msg.length; i++) {
    const coef = res[i];
    if (coef !== 0) for (let j = 1; j < gen.length; j++) res[i + j] ^= mul(gen[j], coef);
  }
  const out = new Uint8Array(msg.length + nsym);
  out.set(msg);
  out.set(res.slice(msg.length), msg.length);
  return out;
}

function syndromes(msg: Uint8Array, nsym: number) {
  const s = new Array(nsym);
  const m = Array.from(msg);
  for (let i = 0; i < nsym; i++) s[i] = polyEval(m, pow(2, i));
  return [0, ...s]; // padded so the math below lines up with the textbook form
}

function errorLocator(synd: number[], nsym: number) {
  let errLoc = [1];
  let oldLoc = [1];
  const off = synd.length - nsym;
  for (let i = 0; i < nsym; i++) {
    const k = i + off;
    let delta = synd[k];
    for (let j = 1; j < errLoc.length; j++) delta ^= mul(errLoc[errLoc.length - 1 - j], synd[k - j]);
    oldLoc = [...oldLoc, 0];
    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = polyScale(oldLoc, delta);
        oldLoc = polyScale(errLoc, inv(delta));
        errLoc = newLoc;
      }
      errLoc = polyAdd(errLoc, polyScale(oldLoc, delta));
    }
  }
  while (errLoc.length && errLoc[0] === 0) errLoc.shift();
  const errs = errLoc.length - 1;
  if (errs * 2 > nsym) return null;
  return errLoc;
}

function findErrors(errLoc: number[], n: number) {
  const errs = errLoc.length - 1;
  const rev = [...errLoc].reverse();
  const pos: number[] = [];
  for (let i = 0; i < n; i++) if (polyEval(rev, pow(2, i)) === 0) pos.push(n - 1 - i);
  return pos.length === errs ? pos : null;
}

function correct(msg: number[], synd: number[], pos: number[]) {
  const coefPos = pos.map((p) => msg.length - 1 - p);
  let loc = [1];
  for (const i of coefPos) loc = polyMul(loc, polyAdd([1], [pow(2, i), 0]));
  // error evaluator
  // remainder of (reversed syndromes x locator) / x^(len(loc)): its last len(loc) coefficients
  const sr = [...synd].reverse();
  let omega = polyMul(sr, loc);
  omega = omega.slice(omega.length - loc.length);
  const X = coefPos.map((i) => pow(2, i));
  for (let i = 0; i < X.length; i++) {
    const Xi = X[i];
    const XiInv = inv(Xi);
    let den = 1;
    for (let j = 0; j < X.length; j++) if (j !== i) den = mul(den, 1 ^ mul(XiInv, X[j]));
    const y = mul(polyEval(omega, XiInv), Xi);
    if (den === 0) return null;
    msg[pos[i]] ^= div(y, den);
  }
  return msg;
}

/** The message part with errors repaired, or null if there are more than nsym/2 errors. */
export function decode(data: Uint8Array, nsym: number): Uint8Array | null {
  const synd = syndromes(data, nsym);
  if (synd.slice(1).every((x) => x === 0)) return data.slice(0, data.length - nsym);
  const loc = errorLocator(synd, nsym);
  if (!loc) return null;
  const pos = findErrors(loc, data.length);
  if (!pos) return null;
  const fixed = correct(Array.from(data), synd, pos);
  if (!fixed) return null;
  const out = Uint8Array.from(fixed);
  if (!syndromes(out, nsym).slice(1).every((x) => x === 0)) return null;
  return out.slice(0, out.length - nsym);
}
