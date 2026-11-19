// Draws rings in a real browser canvas with rotation, tilt, blur, noise and both colourways,
// then reads them back with decodeGray. usage: node --experimental-strip-types tools/ring-check.mts
import { createRequire } from 'node:module';
import { ringBits, ringPaths, decodeGray } from '../src/lib/ring.ts';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SIZE = 256;
type Case = { rot: number; tiltX: number; tiltY: number; blur: number; noise: number; light: boolean; scale: number; shiftX: number; mirror: boolean; cover: number };
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent('<canvas id="c" width="256" height="256"></canvas>');
let ok = 0, fail = 0;
const fails: string[] = [];
for (let n = 0; n < 160; n++) {
  const addr = Uint8Array.from({ length: 20 }, () => Math.floor(Math.random() * 256));
  const bits = ringBits(addr);
  const art = ringPaths(bits, 200);
  const c: Case = {
    rot: Math.random() * 360,
    tiltX: 1 - Math.random() * 0.25,
    tiltY: 1 - Math.random() * 0.12,
    blur: Math.random() * 1.6,
    noise: Math.random() * 40,
    light: n % 2 === 0,
    scale: 0.82 + Math.random() * 0.14,
    shiftX: (Math.random() - 0.5) * 14,
    mirror: n % 7 === 3,
    cover: n % 5 === 0 ? 1 : 0,
  };
  const gray: number[] = await p.evaluate(({ art, c, SIZE }) => {
    const cv = document.getElementById('c') as HTMLCanvasElement;
    const x = cv.getContext('2d')!;
    const fg = c.light ? '#f2f2f2' : '#111', bg = c.light ? '#0a0a0a' : '#f4f4f4';
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.filter = 'none';
    x.fillStyle = bg;
    x.fillRect(0, 0, SIZE, SIZE);
    x.filter = `blur(${c.blur}px)`;
    x.translate(SIZE / 2 + c.shiftX, SIZE / 2);
    x.rotate((c.rot * Math.PI) / 180);
    x.scale(c.tiltX * c.scale * (SIZE / 200) * (c.mirror ? -1 : 1), c.tiltY * c.scale * (SIZE / 200));
    x.translate(-100, -100);
    x.strokeStyle = fg;
    x.lineCap = 'round';
    x.lineWidth = art.frameStroke;
    x.beginPath();
    x.arc(100, 100, art.frame, 0, Math.PI * 2);
    x.stroke();
    art.rings.forEach((d, i) => {
      x.lineWidth = art.strokes[i];
      x.stroke(new Path2D(d));
    });
    x.fillStyle = fg;
    x.beginPath();
    x.arc(100, 100, art.frame * 0.36, 0, Math.PI * 2);
    x.fill();
    if (c.cover) { x.fillStyle = bg; x.fillRect(150, 20, 22, 30); }
    const d = x.getImageData(0, 0, SIZE, SIZE).data;
    const g: number[] = [];
    for (let i = 0; i < d.length; i += 4) {
      const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] + (Math.random() - 0.5) * c.noise;
      g.push(Math.max(0, Math.min(255, Math.round(v))));
    }
    return g;
  }, { art, c, SIZE });
  const got = decodeGray(Uint8Array.from(gray), SIZE, SIZE);
  if (got && got[0] === 1 && got.slice(1).every((v, i) => v === addr[i])) ok++;
  else { fail++; fails.push(JSON.stringify({ ...c, rot: Math.round(c.rot), got: got ? 'WRONG' : null })); }
}
await b.close();
console.log(`read ${ok}/${ok + fail}`);
for (const f of fails.slice(0, 12)) console.log(f);
