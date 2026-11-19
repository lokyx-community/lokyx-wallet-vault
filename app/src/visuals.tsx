// block cubes, address rings, mining ring, peer orbit. all driven by node data via props

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

const bytesOf = (s: string) => keccak_256(utf8ToBytes(s.toLowerCase()));

/** Shared gradients and masks, rendered once. */
export function GlobalDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <linearGradient id="cubeTop" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--cube-top-a)" />
          <stop offset="1" stopColor="var(--cube-top-b)" />
        </linearGradient>
        <linearGradient id="cubeLeft" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--cube-left-a)" />
          <stop offset="1" stopColor="var(--cube-left-b)" />
        </linearGradient>
        <linearGradient id="cubeRight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--cube-right-a)" />
          <stop offset="1" stopColor="var(--cube-right-b)" />
        </linearGradient>
        <linearGradient id="glint" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="floorFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.26" />
          <stop offset="0.3" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="reflectMask" maskContentUnits="objectBoundingBox">
          <rect width="1" height="1" fill="url(#floorFade)" />
        </mask>
        <radialGradient id="scanGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--text)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--text)" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

// ---------- cube geometry ----------

function geo(a: number) {
  const c = 0.866 * a;
  const h = 0.5 * a;
  return {
    c,
    h,
    w: 2 * c,
    top: `M0,0 L${c},${h} L0,${a} L${-c},${h}Z`,
    left: `M${-c},${h} L0,${a} L0,${2 * a} L${-c},${a + h}Z`,
    right: `M0,${a} L${c},${h} L${c},${a + h} L0,${2 * a}Z`,
    outline: `M0,0 L${c},${h} L${c},${a + h} L0,${2 * a} L${-c},${a + h} L${-c},${h}Z`,
    pt: (u: number, v: number) => [c * u - c * v, h * u + h * v] as const,
  };
}

/** Hash-derived engraving on the cube's top face: a 4x4 field of inset tiles of two depths. */
function etch(hash: string, a: number) {
  const g = geo(a);
  const b = bytesOf(hash);
  const m = 0.05;
  const out: { d: string; o: number }[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const v = b[i * 4 + j];
      if (v < 96) continue;
      const o = v > 200 ? 0.75 : 0.32;
      const [u0, u1, v0, v1] = [i / 4 + m, (i + 1) / 4 - m, j / 4 + m, (j + 1) / 4 - m];
      const p = [g.pt(u0, v0), g.pt(u1, v0), g.pt(u1, v1), g.pt(u0, v1)];
      out.push({ d: `M${p.map((q) => q.join(',')).join(' L')}Z`, o });
    }
  }
  // A groove count on the right face (0-3) for extra variety from the side.
  const grooves = b[20] % 4;
  return { tiles: out, grooves };
}

export function Cube({ hash, a, glint = false }: { hash: string; a: number; glint?: boolean }) {
  const g = useMemo(() => geo(a), [a]);
  const e = useMemo(() => etch(hash, a), [hash, a]);
  const id = useId().replace(/:/g, '');
  const reduce = useReducedMotion();
  return (
    <g>
      <path d={g.left} fill="url(#cubeLeft)" stroke="var(--cube-edge)" strokeWidth={0.75} />
      <path d={g.right} fill="url(#cubeRight)" stroke="var(--cube-edge)" strokeWidth={0.75} />
      <path d={g.top} fill="url(#cubeTop)" stroke="var(--cube-edge)" strokeWidth={0.75} />
      {e.tiles.map((t, i) => (
        <path key={i} d={t.d} fill="var(--cube-etch)" opacity={t.o} />
      ))}
      {Array.from({ length: e.grooves }, (_, i) => {
        const t = 0.32 + i * 0.18;
        const p = (s: number) => [s * g.c, a + s * (g.h - a) + t * a].join(',');
        return <path key={i} d={`M${p(0.14)} L${p(0.86)}`} stroke="var(--cube-left-a)" strokeOpacity={0.4} strokeWidth={1} />;
      })}
      {glint && !reduce && (
        <>
          <clipPath id={`c${id}`}>
            <path d={g.outline} />
          </clipPath>
          <g clipPath={`url(#c${id})`}>
            <motion.rect
              y={-4}
              width={g.w * 0.7}
              height={2 * a + 8}
              fill="url(#glint)"
              initial={{ x: -g.c - g.w * 0.7 }}
              animate={{ x: g.c }}
              transition={{ delay: 0.35, duration: 1.1, ease: [0.4, 0, 0.2, 1] }}
            />
          </g>
        </>
      )}
    </g>
  );
}

/** Small standalone cube for lists and headings. */
export function BlockGlyph({ hash, size = 32 }: { hash: string; size?: number }) {
  const a = 10;
  const g = geo(a);
  return (
    <svg width={size} height={size} viewBox={`${-g.c - 1} -1 ${g.w + 2} ${2 * a + 2}`} aria-hidden style={{ flex: 'none' }}>
      <Cube hash={hash} a={a} />
    </svg>
  );
}

/** Wireframe cube with a light scanning through it: the block being mined right now. */
function PendingCube({ a }: { a: number }) {
  const g = geo(a);
  const id = useId().replace(/:/g, '');
  const reduce = useReducedMotion();
  return (
    <g>
      <clipPath id={`p${id}`}>
        <path d={g.outline} />
      </clipPath>
      <path d={g.outline} fill="none" stroke="var(--text-3)" strokeWidth={1} strokeDasharray="3 4" />
      <path d={`M${-g.c},${g.h} L0,${a} L${g.c},${g.h} M0,${a} L0,${2 * a}`} fill="none" stroke="var(--text-3)" strokeWidth={1} strokeDasharray="3 4" opacity={0.6} />
      {!reduce && (
        <g clipPath={`url(#p${id})`}>
          <motion.rect
            x={-g.c}
            width={g.w}
            height={6}
            fill="url(#scanGlow)"
            animate={{ y: [-6, 2 * a, -6] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        </g>
      )}
    </g>
  );
}

// ---------- chain scene ----------

export interface SceneBlock {
  hash: string;
  height: number;
  timestamp: number;
}

function useWide() {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200));
  useEffect(() => {
    const f = () => setW(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return w;
}

// recent blocks, newest on the right, then the one being mined
export function ChainScene({ blocks, arrived, nextHeight }: { blocks: SceneBlock[]; arrived?: string; nextHeight?: number }) {
  const nav = useNavigate();
  const vw = useWide();
  const count = vw < 640 ? 3 : vw < 1100 ? 5 : 7;
  const shown = blocks.slice(-count);
  const a = 58;
  const g = geo(a);
  const gap = 168;
  const W = (count + 1) * gap + 40;
  const top = 72;
  const floor = top + 2 * a;
  const H = floor + 2 * a * 0.62;
  const xOf = (i: number) => W - 20 - g.c - (shown.length - i) * gap;
  const [hover, setHover] = useState<string | null>(null);

  const cubes = (withLabels: boolean) => (
    <AnimatePresence initial={false}>
      {shown.map((b, i) => {
        const age = shown.length - 1 - i;
        const fade = Math.max(0.22, 1 - age * 0.13);
        const isNew = b.hash === arrived;
        return (
          <motion.g
            key={b.hash}
            initial={{ x: xOf(i), y: withLabels ? -90 : 90, opacity: 0 }}
            animate={{ x: xOf(i), y: withLabels && hover === b.hash ? -6 : 0, opacity: fade }}
            exit={{ opacity: 0, x: xOf(i) - gap * 0.6 }}
            transition={{ type: 'spring', stiffness: 120, damping: 20, mass: 1.1 }}
          >
            <g transform={`translate(0 ${top})`}>
              <Cube hash={b.hash} a={a} glint={withLabels && isNew} />
            </g>
            {withLabels && (
              <>
                <text x={0} y={top - 26} textAnchor="middle" className={'cube-label' + (age === 0 ? ' head' : '')}>
                  {b.height.toLocaleString()}
                </text>
                <path
                  className="cube-hit"
                  d={g.outline}
                  transform={`translate(0 ${top})`}
                  fill="transparent"
                  onMouseEnter={() => setHover(b.hash)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => nav(`/block/${b.height}`)}
                >
                  <title>{`Block ${b.height}`}</title>
                </path>
              </>
            )}
          </motion.g>
        );
      })}
    </AnimatePresence>
  );

  const links = shown.slice(1).map((_, i) => {
    const x1 = xOf(i) + g.c;
    const x2 = xOf(i + 1) - g.c;
    const y = top + a + g.h * 0.2;
    return <line key={shown[i + 1].hash} x1={x1 + 6} x2={x2 - 6} y1={y} y2={y} stroke="var(--line)" strokeWidth={1.25} />;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The ${shown.length} most recent blocks`}>
      <g>{links}</g>
      <line x1={20} x2={W - 20} y1={floor + 0.5} y2={floor + 0.5} stroke="var(--line)" strokeWidth={1} opacity={0.6} />
      {/* reflection */}
      <g transform={`translate(0 ${2 * floor}) scale(1 -1)`} mask="url(#reflectMask)" opacity={0.55}>
        {cubes(false)}
      </g>
      {cubes(true)}
      {nextHeight !== undefined && (
        <g transform={`translate(${W - 20 - g.c} 0)`}>
          <text x={0} y={top - 26} textAnchor="middle" className="cube-label">{nextHeight.toLocaleString()}</text>
          <g transform={`translate(0 ${top})`}>
            <PendingCube a={a} />
          </g>
        </g>
      )}
    </svg>
  );
}

// ---------- address signet ----------

/** Signet ring for an address: 24 radial ticks whose lengths come from the address hash. */
export function Signet({ of, size = 32, assemble = false }: { of: string; size?: number; assemble?: boolean }) {
  const reduce = useReducedMotion();
  const animated = assemble && !reduce;
  const b = useMemo(() => bytesOf(of), [of]);
  const n = 24;
  const rot = (b[31] / 255) * 360;
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" aria-hidden style={{ flex: 'none' }}>
      <circle r={48} fill="var(--raised)" stroke="var(--line)" strokeWidth={2} />
      <g transform={`rotate(${rot})`}>
        {Array.from({ length: n }, (_, i) => {
          const len = 8 + (b[i] / 255) * 22;
          const strong = b[i] > 170;
          return (
            <motion.line
              key={i}
              x1={0}
              y1={-40}
              x2={0}
              y2={-40 + len}
              stroke={strong ? 'var(--text)' : 'var(--text-3)'}
              strokeWidth={strong ? 4 : 3}
              strokeLinecap="round"
              transform={`rotate(${(i * 360) / n})`}
              initial={animated ? { pathLength: 0, opacity: 0 } : false}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ delay: 0.15 + i * 0.045, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            />
          );
        })}
        <motion.circle
          r={5 + (b[24] % 5)}
          fill="var(--text)"
          initial={animated ? { scale: 0 } : false}
          animate={{ scale: 1 }}
          transition={{ delay: 1.3, type: 'spring', stiffness: 300, damping: 18 }}
        />
      </g>
    </svg>
  );
}

// ---------- mining ring ----------

// one dot per hash from the node's counter
export function HashRing({ total, running, wait, children }: {
  total: number;
  running: boolean;
  /** While the miner sits out the block spacing: unix seconds it started and when it ends. */
  wait?: { from: number; until: number } | null;
  children?: React.ReactNode;
}) {
  const waitRef = useRef(wait);
  waitRef.current = wait;
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef<number | null>(null);
  const cursor = useRef(0);
  const N = 240;
  const glow = useRef(new Float32Array(N));
  const runningRef = useRef(running);
  runningRef.current = running;
  const reduce = useReducedMotion();

  useEffect(() => {
    if (last.current === null) {
      last.current = total;
      return;
    }
    const add = Math.min(N, Math.max(0, total - last.current));
    last.current = total;
    for (let i = 0; i < add; i++) {
      glow.current[cursor.current] = 1;
      cursor.current = (cursor.current + 1) % N;
    }
  }, [total]);

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    let angle = 0;
    let prev = performance.now();
    const draw = (t: number) => {
      const dt = (t - prev) / 1000;
      prev = t;
      const size = c.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(size * dpr)) {
        c.width = c.height = Math.round(size * dpr);
      }
      const css = getComputedStyle(document.documentElement);
      const fg = css.getPropertyValue('--text').trim();
      const dim = css.getPropertyValue('--line').trim();
      ctx.clearRect(0, 0, c.width, c.height);
      const cx = c.width / 2;
      const r = c.width * 0.42;
      if (runningRef.current && !reduce) angle += dt * 0.12;
      // spacing countdown: the dots fill in clockwise until the next block can be mined
      const w = waitRef.current;
      const progress = w ? Math.min(1, Math.max(0, (Date.now() / 1000 - w.from) / Math.max(1, w.until - w.from))) : 0;
      const filled = w ? Math.floor(progress * N) : -1;
      for (let i = 0; i < N; i++) {
        const k = glow.current[i];
        const th = angle + (i / N) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(th) * r;
        const y = cx + Math.sin(th) * r;
        const waiting = k <= 0.02 && i <= filled;
        ctx.globalAlpha = k > 0.02 ? 0.25 + 0.75 * k : waiting ? 0.45 : 1;
        ctx.fillStyle = k > 0.02 || waiting ? fg : dim;
        const s = (k > 0.02 ? 2.2 + 2.2 * k : waiting ? 1.8 : 1.6) * dpr;
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
        glow.current[i] = Math.max(0, k - dt * 0.35);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  return (
    <div style={{ position: 'relative' }}>
      <motion.canvas
        ref={ref}
        className="ring"
        animate={{ scale: running ? 1 : 0.94, opacity: running ? 1 : 0.6 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        aria-hidden
      />
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{children}</div>
    </div>
  );
}

// ---------- network orbit ----------

export interface OrbitPeer {
  id: string;
  label: string;
  height: number;
}

// this node in the middle, peers around it
export function Orbit({ peers }: { peers: OrbitPeer[] }) {
  const seen = useRef(new Map<string, number>());
  const [pulses, setPulses] = useState<{ k: number; id: string }[]>([]);
  const reduce = useReducedMotion();

  useEffect(() => {
    const fresh: { k: number; id: string }[] = [];
    for (const p of peers) {
      const before = seen.current.get(p.id);
      if (before !== undefined && p.height > before) fresh.push({ k: Math.random(), id: p.id });
      seen.current.set(p.id, p.height);
    }
    if (fresh.length) {
      setPulses((x) => [...x, ...fresh]);
      setTimeout(() => setPulses((x) => x.filter((y) => !fresh.includes(y))), 1800);
    }
  }, [peers]);

  const R = 170;
  const pos = (i: number) => {
    const t = (i / Math.max(1, peers.length)) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(t) * R, y: Math.sin(t) * R };
  };

  return (
    <svg viewBox="-260 -230 520 460" className="orbit" role="img" aria-label={`${peers.length} connected peers`}>
      <motion.circle
        r={R}
        fill="none"
        stroke="var(--line)"
        strokeDasharray="1 7"
        strokeLinecap="round"
        strokeWidth={2}
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ duration: 120, repeat: Infinity, ease: 'linear' }}
      />
      <circle r={R * 0.55} fill="none" stroke="var(--line)" strokeOpacity={0.5} />
      {peers.map((p, i) => {
        const { x, y } = pos(i);
        return (
          <g key={p.id}>
            <line x1={0} y1={0} x2={x} y2={y} stroke="var(--line)" strokeWidth={1} />
            <AnimatePresence>
              {pulses
                .filter((q) => q.id === p.id)
                .map((q) => (
                  <motion.circle
                    key={q.k}
                    r={4}
                    fill="var(--text)"
                    initial={{ cx: x, cy: y, opacity: 0 }}
                    animate={{ cx: 0, cy: 0, opacity: [0, 1, 1, 0] }}
                    transition={{ duration: 1.3, ease: [0.4, 0, 0.2, 1] }}
                  />
                ))}
            </AnimatePresence>
            <motion.g initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
              <circle cx={x} cy={y} r={14} fill="var(--bg)" stroke="var(--text-2)" strokeWidth={1.5} />
              <circle cx={x} cy={y} r={4} fill="var(--text-2)" />
              <text x={x} y={y + (y >= 0 ? 34 : -24)} textAnchor="middle" className="orbit-label">{p.label}</text>
            </motion.g>
          </g>
        );
      })}
      <circle r={30} fill="var(--text)" />
      <circle r={42} fill="none" stroke="var(--text)" strokeOpacity={0.35} />
      <text y={70} textAnchor="middle" className="orbit-label" style={{ fill: 'var(--text)' }}>This node</text>
    </svg>
  );
}

// ---------- verification seal ----------

export function Seal({ ok, size = 44 }: { ok: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden style={{ flex: 'none' }}>
      <motion.circle
        cx={22}
        cy={22}
        r={20}
        fill="none"
        stroke="var(--text)"
        strokeWidth={1.5}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      />
      {ok ? (
        <motion.path
          d="M13 22.5 L19.5 29 L31.5 16"
          fill="none"
          stroke="var(--text)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.6, duration: 0.5, ease: 'easeOut' }}
        />
      ) : (
        <motion.path
          d="M15 15 L29 29 M29 15 L15 29"
          fill="none"
          stroke="var(--text)"
          strokeWidth={2}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.6, duration: 0.5 }}
        />
      )}
    </svg>
  );
}

/** The LOKYX mark: a block with an open lock. Nobody holds the key. */
export function LogoMark({ size = 22 }: { size?: number }) {
  // the Ring: one stroke with a single point set into its opening. Heavier strokes when small.
  const w = size <= 18 ? 18 : size <= 24 ? 16 : 14;
  const r = size <= 18 ? 9 : size <= 24 ? 8.5 : 7.5;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden>
      <path d="M50 16A34 34 0 1 0 84 50" stroke="var(--text)" strokeWidth={w} strokeLinecap="round" />
      <circle cx="74" cy="26" r={r} fill="var(--text)" />
    </svg>
  );
}
