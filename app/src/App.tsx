import { useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ChainProvider, useChain, useWallet, WalletProvider } from './state';
import { Icon, duration } from './ui';
import { GlobalDefs, LogoMark, Signet } from './visuals';
import { formatLyx, shortHash } from './lib/lokyx';
import { contractsOn, usePoll, type Account } from './lib/rpc';
import Overview from './pages/Overview';
import Wallet from './pages/Wallet';
import Mining from './pages/Mining';
import Network from './pages/Network';
import Explorer, { BlockPage, TxPage, AddressPage, SupplyPage } from './pages/Explorer';
import Swap from './pages/Swap';
import VaultPage from './pages/Vault';
import PhoneApp from './pages/PhoneApp';
import Faucet from './pages/Faucet';
import Developers from './pages/Developers';
import Contracts from './pages/Contracts';
import Download from './pages/Download';
import Security from './pages/Security';
import Settings from './pages/Settings';

type Item = { to: string; label: string; icon: ComponentType; tab?: boolean; contracts?: boolean };

const GROUPS: Item[][] = [
  [
    { to: '/', label: 'Overview', icon: Icon.overview, tab: true },
    { to: '/wallet', label: 'Wallet', icon: Icon.wallet, tab: true },
    { to: '/swap', label: 'Swap', icon: Icon.swap, tab: true },
    { to: '/vault', label: 'Vault', icon: Icon.vault },
    { to: '/mining', label: 'Mining', icon: Icon.mining },
    { to: '/download', label: 'Download', icon: Icon.download },
    { to: '/phone', label: 'Phone app', icon: Icon.phone },
    { to: '/faucet', label: 'Faucet', icon: Icon.faucet },
  ],
  [
    { to: '/explorer', label: 'Explorer', icon: Icon.explorer, tab: true },
    { to: '/network', label: 'Network', icon: Icon.network },
    { to: '/supply', label: 'Supply', icon: Icon.supply },
  ],
  [
    { to: '/contracts', label: 'Contracts', icon: Icon.contracts, contracts: true },
    { to: '/developers', label: 'Developers', icon: Icon.developers },
  ],
  [
    { to: '/security', label: 'Security', icon: Icon.security },
    { to: '/settings', label: 'Settings', icon: Icon.settings },
  ],
];
/** The pages this network has: contract pages only where contracts are switched on. */
function useGroups(): Item[][] {
  const { info } = useChain();
  const on = contractsOn(info);
  return GROUPS.map((g) => g.filter((n) => on || !n.contracts)).filter((g) => g.length > 0);
}

function Header() {
  const { info, error } = useChain();
  const { stored, unlocked, snap } = useWallet();
  const active = snap ?? stored?.address;
  const net = info ? info.network[0].toUpperCase() + info.network.slice(1) : null;
  return (
    <header className="header">
      <Link to="/" className="brand" aria-label="LOKYX home">
        <LogoMark size={22} />
        LOKYX
      </Link>
      <span className="net-pill" title={error ? error.message : undefined}>
        <span className={'live-dot ' + (error ? 'off' : info ? 'on' : '')} />
        {error ? 'Offline' : net ?? 'Connecting'}
        {info && !error && <span className="desktop-only faint num">&nbsp;{info.height.toLocaleString()}</span>}
      </span>
      {active ? (
        <Link to="/wallet" className="wallet-chip" aria-label="Open wallet">
          <span className="desktop-only mono">{shortHash(active, 8, 4)}</span>
          <span className="mobile-only">{snap ? 'MetaMask' : unlocked ? 'Wallet' : 'Locked'}</span>
          <Signet of={active} size={26} />
        </Link>
      ) : (
        <Link to="/wallet" className="wallet-chip empty"><span className="desktop-only">Create wallet</span><span className="mobile-only">Wallet</span></Link>
      )}
    </header>
  );
}

function Nav() {
  const groups = useGroups();
  return (
    <nav className="nav" aria-label="Main">
      {groups.map((g, i) => (
        <div className="nav-group" key={i}>
          {g.map(({ to, label, icon: I }) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="nav-bg" className="nav-bg" transition={{ type: 'spring', stiffness: 520, damping: 42 }} />}
                  <I />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function TabBar() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const all = useGroups().flat();
  const extra = all.filter((n) => !n.tab);
  const inExtra = extra.some((n) => loc.pathname.startsWith(n.to));
  return (
    <>
      <nav className="tabbar" aria-label="Main">
        {all.filter((n) => n.tab).map(({ to, label, icon: I }) => (
          <NavLink key={to} to={to} end={to === '/'}>
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="tab-bg" className="tab-bg" transition={{ type: 'spring', stiffness: 520, damping: 42 }} />}
                <I />
                {label}
              </>
            )}
          </NavLink>
        ))}
        <button className={inExtra ? 'active' : ''} onClick={() => setOpen(true)} aria-haspopup="dialog">
          {inExtra && <motion.span layoutId="tab-bg" className="tab-bg" />}
          <Icon.more />
          More
        </button>
      </nav>
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.div
              className="sheet"
              role="dialog"
              aria-label="More pages"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, i) => i.offset.y > 80 && setOpen(false)}
            >
              <div className="grip" />
              {extra.map(({ to, label, icon: I }) => (
                <NavLink key={to} to={to} onClick={() => setOpen(false)}>
                  <I />
                  {label}
                </NavLink>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function Pages() {
  const loc = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.main
        key={loc.pathname}
        className="main"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <HaltBanner />
        {loc.pathname !== '/vault' && <VaultBanner />}
        <Routes location={loc}>
          <Route path="/" element={<Overview />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/mining" element={<Mining />} />
          <Route path="/phone" element={<PhoneApp />} />
          <Route path="/swap" element={<Swap />} />
          <Route path="/vault" element={<VaultPage />} />
          <Route path="/faucet" element={<Faucet />} />
          <Route path="/network" element={<Network />} />
          <Route path="/explorer" element={<Explorer />} />
          <Route path="/block/:id" element={<BlockPage />} />
          <Route path="/tx/:hash" element={<TxPage />} />
          <Route path="/address/:addr" element={<AddressPage />} />
          <Route path="/supply" element={<SupplyPage />} />
          <Route path="/contracts" element={<ContractsGate />} />
          <Route path="/download" element={<Download />} />
          <Route path="/developers" element={<Developers />} />
          <Route path="/security" element={<Security />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<div className="empty"><h1>Nothing here</h1><p>This page doesn't exist.</p><Link to="/" className="btn">Go to Overview</Link></div>} />
        </Routes>
      </motion.main>
    </AnimatePresence>
  );
}

function ContractsGate() {
  const { info } = useChain();
  if (contractsOn(info)) return <Contracts />;
  return (
    <div className="empty">
      <h1>No contracts here</h1>
      <p>Contracts aren't switched on for this network{info?.contractsFrom != null ? ` until block ${info.contractsFrom.toLocaleString()}` : ''}.</p>
      <Link to="/" className="btn">Go to Overview</Link>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <GlobalDefs />
      <ChainProvider>
        <WalletProvider>
          <Header />
          <div className="frame">
            <Nav />
            <Pages />
          </div>
          <TabBar />
        </WalletProvider>
      </ChainProvider>
    </HashRouter>
  );
}

/**
 * The node has stopped applying blocks because its own supply check failed. Nothing it shows
 * can be trusted to be current after that, so it says so on every page.
 */
function HaltBanner() {
  const { info } = useChain();
  if (!info?.halted) return null;
  return (
    <div className="notice">
      <Icon.alert />
      <div className="stack" style={{ gap: 10 }}>
        <p>
          <strong>This node has stopped at block {info.height.toLocaleString()}.</strong> Its own check that all
          LYX adds up failed, so it stopped rather than carry on with figures it can't account for. Nothing newer
          than this block is shown, and it isn't mining.
        </p>
        <p className="mono" style={{ fontSize: 14 }}>{info.halted}</p>
        <p>That's a bug in LOKYX, not a bad block. Please report it with the node's log.</p>
      </div>
    </div>
  );
}

/** Shows on every page while something is waiting to leave the wallet's vault. */
function VaultBanner() {
  const { stored, snap } = useWallet();
  const { info } = useChain();
  const address = snap ?? stored?.address;
  const acct = usePoll<Account>('lyx_getAccount', address ? { address } : null, 30000, info?.height);
  const pending = acct.data?.vault?.pending ?? [];
  if (!info || pending.length === 0) return null;
  const x = pending[0];
  const left = duration(Math.max(0, x.releaseHeight - info.height) * info.targetBlockTime);
  const what =
    x.byHeir ? 'Your heir started a claim on your vault'
    : x.kind === 'withdraw' ? `A withdrawal of ${formatLyx(x.amount ?? '0', 4)} LYX from your vault`
    : x.kind === 'update' ? 'A change to your vault settings'
    : 'Closing your vault';
  return (
    <div className="notice vault-banner">
      <Icon.vault />
      <p>
        <strong>{what} goes through in about {left}.</strong>{' '}
        {pending.length > 1 && `${pending.length - 1} more waiting. `}
        Not you? <Link to="/vault" className="link">Cancel it</Link>.
      </p>
    </div>
  );
}
