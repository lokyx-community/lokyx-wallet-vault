import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { rpc, useNodeUrl, type BlockInfo, type ChainInfo, type RpcError } from './lib/rpc';
import { loadVault, type StoredVault, type Unlocked } from './lib/vault';
import { connectedAddress } from './lib/snap';

// ---------- chain ----------

interface ChainState {
  info?: ChainInfo;
  error?: RpcError;
  /** Most recent main-chain blocks, newest last. Only refetched when the tip moves. */
  recent: BlockInfo[];
  /** Hash of the newest block this session has watched arrive (drives the arrival highlight). */
  arrived?: string;
}

const ChainCtx = createContext<ChainState>({ recent: [] });
export const useChain = () => useContext(ChainCtx);

export function ChainProvider({ children }: { children: ReactNode }) {
  const url = useNodeUrl();
  const [state, setState] = useState<ChainState>({ recent: [] });
  const lastTip = useRef<string>('');

  useEffect(() => {
    let alive = true;
    lastTip.current = '';
    setState({ recent: [] });
    const tick = async () => {
      try {
        const info = await rpc<ChainInfo>('lyx_chainInfo');
        if (!alive) return;
        if (info.bestHash !== lastTip.current) {
          const first = lastTip.current === '';
          lastTip.current = info.bestHash;
          const blocks = await rpc<BlockInfo[]>('lyx_getBlocks', { count: 32 });
          if (!alive) return;
          setState({ info, recent: blocks.reverse(), arrived: first ? undefined : info.bestHash });
        } else {
          setState((s) => ({ ...s, info, error: undefined }));
        }
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: e as RpcError }));
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [url]);

  return <ChainCtx.Provider value={state}>{children}</ChainCtx.Provider>;
}

// ---------- wallet ----------

interface WalletState {
  stored: StoredVault | null;
  unlocked: Unlocked | null;
  setUnlocked: (u: Unlocked | null) => void;
  reload: () => void;
  /** lyx1 address held by MetaMask through the LOKYX Snap, when connected. */
  snap: string | null;
  setSnap: (address: string | null) => void;
}

const WalletCtx = createContext<WalletState>({
  stored: null,
  unlocked: null,
  setUnlocked: () => {},
  reload: () => {},
  snap: null,
  setSnap: () => {},
});
export const useWallet = () => useContext(WalletCtx);

/** The address the user is acting as right now: MetaMask if connected, else this browser's wallet. */
export function useActiveAddress(): string | null {
  const { snap, stored } = useWallet();
  return snap ?? stored?.address ?? null;
}

const SNAP_KEY = 'lokyx.snap';

const AUTO_LOCK_MS = 15 * 60 * 1000;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState(loadVault);
  const [unlocked, setUnlockedRaw] = useState<Unlocked | null>(null);

  const setUnlocked = useCallback((u: Unlocked | null) => {
    setUnlockedRaw((prev) => {
      if (prev && prev !== u) prev.secretKey.fill(0);
      return u;
    });
  }, []);

  // Lock after 15 minutes without interaction; the key only ever lives in memory.
  useEffect(() => {
    if (!unlocked) return;
    let t = setTimeout(() => setUnlocked(null), AUTO_LOCK_MS);
    const bump = () => {
      clearTimeout(t);
      t = setTimeout(() => setUnlocked(null), AUTO_LOCK_MS);
    };
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
    };
  }, [unlocked, setUnlocked]);

  // MetaMask: remember the choice across reloads, but only trust it once MetaMask confirms the Snap
  // is still installed and still controls that address.
  const [snap, setSnapRaw] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SNAP_KEY);
    } catch {
      return null;
    }
  });
  const setSnap = useCallback((a: string | null) => {
    setSnapRaw(a);
    try {
      if (a) localStorage.setItem(SNAP_KEY, a);
      else localStorage.removeItem(SNAP_KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    if (!snap) return;
    let alive = true;
    connectedAddress().then((a) => alive && setSnap(a));
    return () => {
      alive = false;
    };
    // Verify once on load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = useCallback(() => setStored(loadVault()), []);
  return <WalletCtx.Provider value={{ stored, unlocked, setUnlocked, reload, snap, setSnap }}>{children}</WalletCtx.Provider>;
}

// ---------- theme ----------

export type Theme = 'system' | 'dark' | 'light';

export function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try {
    localStorage.setItem('lokyx.theme', t);
  } catch {
    /* ignore */
  }
}

export function savedTheme(): Theme {
  try {
    return (localStorage.getItem('lokyx.theme') as Theme) || 'system';
  } catch {
    return 'system';
  }
}
