// Draws sun codes in a real browser canvas with rotation, tilt, blur, noise, mirroring, a covered
// patch and both colourways, then reads them back. usage: node --experimental-strip-types tools/sun-check.mts
import { createRequire } from 'node:module';
import { sunLevels, sunPaths, decodeSun } from '../src/lib/sun.ts';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SIZE = 256;
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent('<canvas id="c" width="256" height="256"></canvas>');
let ok = 0, fail = 0;
const fails: string[] = [];
const runs = Number(process.argv[2] ?? 160);
for (let n = 0; n < runs; n++) {
  const addr = Uint8Array.from({ length: 20 }, () => Math.floor(Math.random() * 256));
  const art = sunPaths(sunLevels(addr), 200);
  const c = {
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
  const g: number[] = await p.evaluate(({ art, c, SIZE }) => {
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
    x.lineWidth = art.stroke;
    x.stroke(new Path2D(art.rays));
    // the signet in the middle
    x.fillStyle = fg;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(100 + Math.cos(a) * 6, 100 + Math.sin(a) * 6);
      x.lineTo(100 + Math.cos(a) * (14 + (i * 7) % 18), 100 + Math.sin(a) * (14 + (i * 7) % 18));
      x.stroke();
    }
    x.beginPath();
    x.arc(100, 100, 5, 0, Math.PI * 2);
    x.fill();
    if (c.cover) { x.fillStyle = bg; x.fillRect(150, 20, 22, 30); }
    const d = x.getImageData(0, 0, SIZE, SIZE).data;
    const out: number[] = [];
    for (let i = 0; i < d.length; i += 4) {
      const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] + (Math.random() - 0.5) * c.noise;
      out.push(Math.max(0, Math.min(255, Math.round(v))));
    }
    return out;
  }, { art, c, SIZE });
  const tr = { marks: 0, best: [] as number[] };
  const want = sunLevels(addr);
  const got = decodeSun(Uint8Array.from(g), SIZE, SIZE, tr);
  if (got && got[0] === 1 && got.slice(1).every((v, i) => v === addr[i])) ok++;
  else { fail++; fails.push(JSON.stringify({ ...c, rot: Math.round(c.rot), got: got ? 'WRONG' : null, marks: tr.marks, wrongRays: tr.best.length ? tr.best.filter((v, i) => v !== want[i]).length : -1, diffs: tr.best.map((v, i) => v - want[i]).filter((d) => d).join(',') })); }
}
await b.close();
console.log(`read ${ok}/${ok + fail}`);
for (const f of fails.slice(0, 12)) console.log(f);
