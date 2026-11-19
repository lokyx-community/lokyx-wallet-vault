import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { shortHash } from './lib/lokyx';
import { getNodeUrl, type RpcError } from './lib/rpc';
import { Signet } from './visuals';

export function Copy({ text, display, mono = true }: { text: string; display?: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={'copy' + (mono ? ' mono' : '')}
      title={done ? 'Copied' : 'Copy'}
      aria-label={done ? 'Copied' : `Copy ${display ?? text}`}
      onClick={(e) => {
        e.preventDefault();
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      <span>{display ?? text}</span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={done ? 'y' : 'n'} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.15 }} style={{ display: 'inline-flex' }}>
          {done ? <Icon.check /> : <Icon.copy />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

export function AddressLink({ address, short = true, mark = false }: { address: string; short?: boolean; mark?: boolean }) {
  return (
    <Link to={`/address/${address}`} className="inline" style={{ gap: 10, flexWrap: 'nowrap', minWidth: 0 }}>
      {mark && <Signet of={address} size={22} />}
      <span className="mono link" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {short ? shortHash(address, 10, 6) : address}
      </span>
    </Link>
  );
}

export function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round(now - ts));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  if (s < 120) return '1 minute ago';
  if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
  if (s < 7200) return '1 hour ago';
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

export function agoShort(ts: number, now: number) {
  const s = Math.max(0, Math.round(now - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function Ago({ ts, short = false }: { ts: number; short?: boolean }) {
  const now = useNow();
  return <span className="num">{short ? agoShort(ts, now) : ago(ts, now)}</span>;
}

export function hashrate(h: number): [string, string] {
  if (!h) return ['0', 'H/s'];
  if (h < 1000) return [h.toFixed(1), 'H/s'];
  if (h < 1e6) return [(h / 1000).toFixed(2), 'kH/s'];
  return [(h / 1e6).toFixed(2), 'MH/s'];
}

export const hashrateText = (h: number) => hashrate(h).join(' ');

export function duration(sec: number) {
  if (sec < 90) return `${Math.round(sec)} seconds`;
  if (sec < 5400) return `${Math.round(sec / 60)} minutes`;
  if (sec < 172800) return `${(sec / 3600).toFixed(1).replace(/\.0$/, '')} hours`;
  return `${Math.round(sec / 86400)} days`;
}

export function NodeError({ error }: { error: RpcError }) {
  if (!error.unreachable)
    return (
      <div className="notice">
        <Icon.alert />
        <p>{error.message}</p>
      </div>
    );
  return (
    <div className="notice">
      <Icon.plug />
      <div className="stack" style={{ gap: 10 }}>
        <p>
          <strong>Not connected to a node.</strong> Nothing on this page can be shown until one is reachable at{' '}
          <span className="mono">{getNodeUrl()}</span>.
        </p>
        <p>
          Start one with <span className="mono">lokyxd --rpc-cors {location.origin}</span>, or pick another node in{' '}
          <Link to="/settings" className="link">Settings</Link>.
        </p>
      </div>
    </div>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ w = '100%', h = 18 }: { w?: number | string; h?: number }) {
  return <span className="skeleton" style={{ display: 'block', width: w, height: h }} />;
}

export function Spinner() {
  return <span className="spin" aria-hidden />;
}

/** Centered dialog with a soft scale-in. */
export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <div className="modal-wrap">
            <motion.div
              className="modal"
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            >
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

const s = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

// icons, 24px grid
export const Icon = {
  overview: () => (<svg {...s}><path d="M3.5 12 12 4l8.5 8" /><path d="M6 10v9.5h12V10" /><path d="M10 19.5v-5h4v5" /></svg>),
  wallet: () => (<svg {...s}><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2" /><path d="M6 6V5.5A1.5 1.5 0 0 1 7.9 4l9 2" /></svg>),
  mining: () => (<svg {...s}><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></svg>),
  explorer: () => (<svg {...s}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></svg>),
  network: () => (<svg {...s}><circle cx="12" cy="12" r="2.5" /><circle cx="12" cy="12" r="8.5" strokeDasharray="1.5 3" /><circle cx="18" cy="6" r="1.5" /><circle cx="5" cy="15" r="1.5" /></svg>),
  supply: () => (<svg {...s}><ellipse cx="12" cy="6.5" rx="7" ry="2.5" /><path d="M5 6.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5M5 11.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5" /></svg>),
  swap: () => (<svg {...s}><path d="M5 8.5h13.5M15 5l3.5 3.5L15 12M19 15.5H5.5M9 12l-3.5 3.5L9 19" /></svg>),
  faucet: () => (<svg {...s}><path d="M12 4c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z" /></svg>),
  download: () => (<svg {...s}><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19.5h14" /></svg>),
  contracts: () => (<svg {...s}><path d="M7 3.5h7.5L19 8v12.5H7z" /><path d="M14.5 3.5V8H19" /><path d="m10.5 12.5-1.5 1.75 1.5 1.75M14.5 12.5l1.5 1.75-1.5 1.75" /></svg>),
  developers: () => (<svg {...s}><path d="m8 8-4 4 4 4M16 8l4 4-4 4" /></svg>),
  phone: () => (<svg {...s}><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 17.5h2" /></svg>),
  vault: () => (<svg {...s}><rect x="4" y="5" width="16" height="14" rx="3" /><circle cx="12" cy="12" r="3" /><path d="M12 9v-.5M12 15.5v-.5M15 12h.5M8.5 12H9M4 9.5H2.8M4 14.5H2.8" /></svg>),
  security: () => (<svg {...s}><path d="M12 3.5 5 6.2v5.6c0 4.3 3 7.6 7 8.7 4-1.1 7-4.4 7-8.7V6.2z" /><path d="m9.2 12 2 2 3.6-3.8" /></svg>),
  settings: () => (<svg {...s}><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></svg>),
  more: () => (<svg {...s}><circle cx="6" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="18" cy="12" r="1" fill="currentColor" /></svg>),
  copy: () => (<svg {...s} width={15} height={15}><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></svg>),
  check: () => (<svg {...s} width={15} height={15}><path d="m5 12.5 4.5 4.5L19 7" /></svg>),
  plug: () => (<svg {...s}><path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0zM12 16v4.5" /></svg>),
  alert: () => (<svg {...s}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5.5M12 16.2v.3" /></svg>),
  up: () => (<svg {...s} width={18} height={18}><path d="M12 19V5M6 11l6-6 6 6" /></svg>),
  down: () => (<svg {...s} width={18} height={18}><path d="M12 5v14M6 13l6 6 6-6" /></svg>),
  cube: () => (<svg {...s} width={18} height={18}><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></svg>),
};
