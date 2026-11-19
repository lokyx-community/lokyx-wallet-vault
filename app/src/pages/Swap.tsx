import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useChain, useWallet } from '../state';
import { Copy, Icon, KV, Spinner, duration } from '../ui';
import { ChainIcon, type ChainKey } from '../chains';
import { formatLyx, hexToBytes, parseLyx, shortHash, signSwap, bytesToHex } from '../lib/lokyx';
import { rpc, type ChainInfo } from '../lib/rpc';
import { unlockVault } from '../lib/vault';
import * as btc from '../lib/btc';
import * as eth from '../lib/eth';
import * as sw from '../lib/swap';

// ---------- settings ----------

interface Settings {
  net: btc.BtcNet;
  api: string;
  feeRate: number;
  evm: { chainId: number; rpc: string; contract: string };
}

function defaults(network?: string): Settings {
  const net: btc.BtcNet = network === 'devnet' ? 'regtest' : 'testnet4';
  const e = network === 'devnet' ? eth.EVM_NETS[1] : eth.EVM_NETS[0];
  return { net, api: btc.DEFAULT_BTC_API[net], feeRate: 2, evm: { chainId: e.chainId, rpc: e.rpc, contract: e.contract } };
}

function useSettings(network?: string): [Settings, (s: Settings) => void] {
  // nothing saved = follow the LOKYX network (devnet -> local test chains, testnet -> public test chains)
  const [saved, setSaved] = useState<Settings | null>(() => {
    try {
      const raw = localStorage.getItem('lokyx.swapSettings');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const save = (v: Settings) => {
    setSaved(v);
    try {
      localStorage.setItem('lokyx.swapSettings', JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };
  const d = defaults(network);
  return [saved ? { ...d, ...saved, evm: { ...d.evm, ...saved.evm } } : d, save];
}

function evmNet(s: Settings, chainId?: number): eth.EvmNet {
  const id = chainId ?? s.evm.chainId;
  const known = eth.EVM_NETS.find((n) => n.chainId === id);
  const base = known ?? { chainId: id, name: `Chain ${id}`, rpc: s.evm.rpc, contract: '', symbol: 'ETH' };
  return id === s.evm.chainId ? { ...base, rpc: s.evm.rpc, contract: s.evm.contract || base.contract } : base;
}

const fmtBtc = (sats: number) => (sats / 1e8).toFixed(8).replace(/\.?0+$/, '');
function parseBtc(s: string): number {
  const t = s.trim();
  if (!/^\d*(\.\d{0,8})?$/.test(t) || t === '' || t === '.') throw new Error('Enter a bitcoin amount like 0.001');
  const [w, f = ''] = t.split('.');
  return Number(w || '0') * 1e8 + Number((f + '00000000').slice(0, 8));
}
const fmtEth = (wei: bigint | string) => formatLyx(wei, 8).replace(/,/g, '');

/** "0.001 BTC" / "0.05 ETH" for an offer's other side. */
function otherText(o: sw.Offer) {
  return sw.assetOf(o) === 'btc' ? `${fmtBtc(o.sats!)} BTC` : `${fmtEth(o.eth!.wei)} ETH`;
}

// ---------- page ----------

type View = { v: 'list' } | { v: 'new' } | { v: 'accept' } | { v: 'swap'; salt: string; role: sw.Role };

export default function Swap() {
  const { info } = useChain();
  const { stored, unlocked } = useWallet();
  const [view, setView] = useState<View>({ v: 'list' });
  const [swaps, setSwaps] = useState(sw.loadSwaps);
  const [settings, setSettings] = useSettings(info?.network);
  const reload = () => setSwaps(sw.loadSwaps());

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Swap</h1>
          <p>
            Trade LYX for BTC or ETH with someone directly. Either both sides get paid or both get their coins back.
          </p>
        </div>
      </div>

      {!stored ? (
        <div className="notice" style={{ maxWidth: 620 }}>
          <Icon.wallet />
          <p><strong>Swaps use the wallet in this browser.</strong> <Link to="/wallet" className="link">Create or restore one</Link> first.</p>
        </div>
      ) : !unlocked ? (
        <UnlockInline />
      ) : !info ? null : (
        <AnimatePresence mode="wait">
          <motion.div key={view.v + ('salt' in view ? view.salt : '')} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {view.v === 'list' && <List swaps={swaps} open={(r) => setView({ v: 'swap', salt: r.offer.salt, role: r.role })} onNew={() => setView({ v: 'new' })} onAccept={() => setView({ v: 'accept' })} settings={settings} setSettings={setSettings} />}
            {view.v === 'new' && <NewOffer info={info} settings={settings} done={(r) => { reload(); setView({ v: 'swap', salt: r.offer.salt, role: r.role }); }} back={() => setView({ v: 'list' })} />}
            {view.v === 'accept' && <AcceptOffer info={info} settings={settings} done={(r) => { reload(); setView({ v: 'swap', salt: r.offer.salt, role: r.role }); }} back={() => setView({ v: 'list' })} />}
            {view.v === 'swap' && (() => {
              const r = swaps.find((x) => x.offer.salt === view.salt && x.role === view.role);
              return r ? <SwapView key={r.offer.salt} record={r} info={info} settings={settings} saved={reload} back={() => { reload(); setView({ v: 'list' }); }} /> : null;
            })()}
          </motion.div>
        </AnimatePresence>
      )}
    </>
  );
}

export function UnlockInline({ text = 'Unlock your wallet to see your swaps.' }: { text?: string }) {
  const { setUnlocked } = useWallet();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      setUnlocked(await unlockVault(pw));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ maxWidth: 420 }}>
      <p className="muted">{text}</p>
      <div className="field">
        <label htmlFor="spw">Password</label>
        <input id="spw" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      </div>
      {err && <p className="error-text">{err}</p>}
      <div><button className="btn primary" disabled={!pw || busy} onClick={go}>{busy ? <><Spinner />Unlocking</> : 'Unlock'}</button></div>
    </div>
  );
}

// ---------- list + settings ----------

function List({ swaps, open, onNew, onAccept, settings, setSettings }: {
  swaps: sw.SwapRecord[]; open: (r: sw.SwapRecord) => void; onNew: () => void; onAccept: () => void;
  settings: Settings; setSettings: (s: Settings) => void;
}) {
  const [showSettings, setShowSettings] = useState(false);
  return (
    <div className="stack" style={{ gap: 40 }}>
      <div className="inline">
        <button className="btn primary lg" onClick={onNew}>Start a swap</button>
        <button className="btn lg" onClick={onAccept}>I have an offer code</button>
      </div>

      <div className="swap-assets">
        {(['btc', 'eth'] as ChainKey[]).map((c) => (
          <div key={c} className="swap-asset">
            <span className="chain-pair"><ChainIcon chain="lyx" size={28} /><ChainIcon chain={c} size={28} /></span>
            <span>LYX ↔ {c === 'btc' ? 'Bitcoin' : 'Ethereum'}</span>
            <span className="faint">{c === 'btc' ? settings.net : evmNet(settings).name}</span>
          </div>
        ))}
      </div>

      {swaps.length > 0 && (
        <section>
          <h2 style={{ marginBottom: 16 }}>Your swaps</h2>
          <div className="swap-list">
            {swaps.map((r) => {
              const iGiveLyx = sw.locksLyx(r);
              const other: ChainKey = sw.assetOf(r.offer);
              return (
                <button key={r.offer.salt + r.role} className="swap-row" onClick={() => open(r)}>
                  <span className="inline" style={{ gap: 12 }}>
                    <span className="chain-pair"><ChainIcon chain={iGiveLyx ? 'lyx' : other} /><ChainIcon chain={iGiveLyx ? other : 'lyx'} /></span>
                    <span className="num">{iGiveLyx ? `${formatLyx(r.offer.lyx, 6)} LYX → ${otherText(r.offer)}` : `${otherText(r.offer)} → ${formatLyx(r.offer.lyx, 6)} LYX`}</span>
                  </span>
                  <span className="faint">{r.accept ? 'In progress' : r.role === 'initiator' ? 'Waiting for acceptance' : 'Accepted'} · {new Date(r.offer.created * 1000).toLocaleDateString()}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="section" style={{ maxWidth: '44em' }}>
        <h2 style={{ marginBottom: 16 }}>How it works</h2>
        <ol className="how">
          <li>One person makes an offer and sends the code. The other accepts and sends a code back.</li>
          <li>The first person locks their coins. The other checks the lock on-chain, then locks theirs.</li>
          <li>The first person claims, which puts the secret on-chain. The second uses it to claim theirs.</li>
          <li>If someone disappears halfway, the locks expire and the coins go back: after 4 to 12 hours on the fast setting, 24 to 48 on standard.</li>
        </ol>
        <p className="hint" style={{ marginTop: 16 }}>Keep the page open, or come back before the locks expire. ETH swaps need MetaMask.</p>
      </section>

      <section>
        <button className="link" onClick={() => setShowSettings(!showSettings)}>Swap settings</button>
        {showSettings && <SettingsForm settings={settings} setSettings={setSettings} />}
      </section>
    </div>
  );
}

function SettingsForm({ settings, setSettings }: { settings: Settings; setSettings: (s: Settings) => void }) {
  const [deploying, setDeploying] = useState(false);
  const [status, setStatus] = useState('');
  const net = evmNet(settings);
  useEffect(() => {
    let alive = true;
    setStatus('');
    if (!settings.evm.contract) return;
    eth.verifyContract(net, settings.evm.contract)
      .then((ok) => alive && setStatus(ok ? 'verified' : 'mismatch'))
      .catch(() => alive && setStatus('unreachable'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.evm.contract, settings.evm.rpc, settings.evm.chainId]);
  const deploy = async () => {
    setDeploying(true);
    try {
      const a = await eth.deploySwapContract(net);
      setSettings({ ...settings, evm: { ...settings.evm, contract: a } });
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setDeploying(false);
    }
  };
  return (
    <div className="stack" style={{ maxWidth: 560, marginTop: 20, gap: 28 }}>
      <div className="stack" style={{ gap: 16 }}>
        <h3 className="inline" style={{ gap: 10, fontSize: 18 }}><ChainIcon chain="btc" />Bitcoin</h3>
        <div className="field">
          <label>Network</label>
          <div className="segmented">
            {(['testnet4', 'regtest', 'mainnet'] as btc.BtcNet[]).map((n) => (
              <button key={n} className={settings.net === n ? 'on' : ''} disabled={n === 'mainnet'} onClick={() => setSettings({ ...settings, net: n, api: btc.DEFAULT_BTC_API[n] })}>
                <span>{n === 'testnet4' ? 'Testnet4' : n === 'regtest' ? 'Regtest' : 'Mainnet (off)'}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="api">Esplora API</label>
          <input id="api" className="input mono" value={settings.api} onChange={(e) => setSettings({ ...settings, api: e.target.value.trim().replace(/\/$/, '') })} />
        </div>
        <div className="field">
          <label htmlFor="fr">Fee rate (sat/vB)</label>
          <input id="fr" className="input" inputMode="decimal" value={settings.feeRate} onChange={(e) => setSettings({ ...settings, feeRate: Math.max(1, Number(e.target.value) || 1) })} />
        </div>
      </div>
      <div className="stack" style={{ gap: 16 }}>
        <h3 className="inline" style={{ gap: 10, fontSize: 18 }}><ChainIcon chain="eth" />Ethereum</h3>
        <div className="field">
          <label>Network</label>
          <div className="segmented">
            {eth.EVM_NETS.map((n) => (
              <button key={n.chainId} className={settings.evm.chainId === n.chainId ? 'on' : ''} onClick={() => setSettings({ ...settings, evm: { chainId: n.chainId, rpc: n.rpc, contract: n.contract } })}>
                <span>{n.name}</span>
              </button>
            ))}
          </div>
          <p className="hint">Mainnet stays off until LOKYX has a mainnet and swaps have been audited.</p>
        </div>
        <div className="field">
          <label htmlFor="erpc">RPC</label>
          <input id="erpc" className="input mono" value={settings.evm.rpc} onChange={(e) => setSettings({ ...settings, evm: { ...settings.evm, rpc: e.target.value.trim() } })} />
        </div>
        <div className="field">
          <label htmlFor="ec">Swap contract</label>
          <input id="ec" className="input mono" placeholder="0x…" value={settings.evm.contract} onChange={(e) => setSettings({ ...settings, evm: { ...settings.evm, contract: e.target.value.trim() } })} />
          <p className="hint">
            {status === 'verified' ? 'Verified. This is the LOKYX swap contract.'
              : status === 'mismatch' ? 'This address does not hold the LOKYX swap contract. Do not use it.'
              : status === 'unreachable' ? 'Couldn\'t reach the RPC to check it.'
              : status || 'Offers are checked against this contract before anyone locks anything.'}
          </p>
          {!settings.evm.contract && eth.hasWallet() && (
            <div><button className="btn" disabled={deploying} onClick={deploy}>{deploying ? <><Spinner />Deploying</> : `Deploy it on ${net.name} with MetaMask`}</button></div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- create / accept ----------

function AssetPicker({ asset, set }: { asset: sw.Asset; set: (a: sw.Asset) => void }) {
  return (
    <div className="segmented">
      {([['btc', 'Bitcoin'], ['eth', 'Ethereum']] as [sw.Asset, string][]).map(([a, t]) => (
        <button key={a} className={asset === a ? 'on' : ''} onClick={() => set(a)}>
          {asset === a && <motion.span layoutId="asset" className="seg-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
          <span className="inline" style={{ gap: 8 }}><ChainIcon chain={a} size={18} />{t}</span>
        </button>
      ))}
    </div>
  );
}

function NewOffer({ info, settings, done, back }: { info: ChainInfo; settings: Settings; done: (r: sw.SwapRecord) => void; back: () => void }) {
  const { unlocked } = useWallet();
  const [asset, setAsset] = useState<sw.Asset>('btc');
  const [dir, setDir] = useState<sw.Direction>('sell-lyx');
  const [speed, setSpeed] = useState<sw.Speed>('fast');
  const [lyx, setLyx] = useState('');
  const [other, setOther] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const sym = asset === 'btc' ? 'BTC' : 'ETH';

  const create = async () => {
    setErr('');
    setBusy(true);
    try {
      const amount = parseLyx(lyx);
      if (amount <= 0n) throw new Error('Enter how much LYX');
      const blocks = sw.defaultBlocks(dir, info.targetBlockTime, speed);
      if (dir === 'sell-lyx') {
        const acct = await rpc<{ balance: string }>('lyx_getAccount', { address: unlocked!.address });
        if (BigInt(acct.balance) < amount) throw new Error(`You have ${formatLyx(acct.balance)} LYX available`);
      }
      let offer: sw.Offer;
      let ethFromBlock: number | undefined;
      if (asset === 'btc') {
        const sats = parseBtc(other);
        if (sats <= btc.DUST * 3) throw new Error('The bitcoin amount is too small to cover fees');
        const btcTip = dir === 'buy-lyx' ? await btc.tipHeight(settings.api) : undefined;
        offer = sw.makeOffer(unlocked!.secretKey, { chainId: info.chainId, asset, dir, lyx: amount, lyxBlocks: blocks.lyxBlocks, btcNet: settings.net, sats, btcBlocks: blocks.btcBlocks, btcTip });
      } else {
        const wei = parseLyx(other);
        if (wei <= 0n) throw new Error('Enter how much ETH');
        const net = evmNet(settings);
        if (!net.contract) throw new Error('Set the swap contract for this network in Swap settings first');
        if (!(await eth.verifyContract(net, net.contract))) throw new Error('The swap contract address in settings is not the LOKYX swap contract');
        const me = await eth.connectWallet();
        const head = await eth.latest(net);
        ethFromBlock = Math.max(0, head.number - 5);
        offer = sw.makeOffer(unlocked!.secretKey, {
          chainId: info.chainId, asset, dir, lyx: amount, lyxBlocks: blocks.lyxBlocks,
          eth: { chainId: net.chainId, contract: net.contract, wei, hours: blocks.otherHours }, myEth: me, ethNow: head.timestamp,
        });
      }
      const r: sw.SwapRecord = { offer, role: 'initiator', ethFromBlock, updated: Date.now() };
      sw.saveSwap(r);
      done(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 560, gap: 24 }}>
      <button className="link" onClick={back}>← Back</button>
      <div className="field">
        <label>Swap LYX with</label>
        <AssetPicker asset={asset} set={setAsset} />
      </div>
      <div className="field">
        <label>I want to</label>
        <div className="segmented">
          {([['sell-lyx', `Sell LYX for ${sym}`], ['buy-lyx', `Buy LYX with ${sym}`]] as [sw.Direction, string][]).map(([d, t]) => (
            <button key={d} className={dir === d ? 'on' : ''} onClick={() => setDir(d)}>
              {dir === d && <motion.span layoutId="dir" className="seg-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <span>{t}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="ly">{dir === 'sell-lyx' ? 'LYX you give' : 'LYX you get'}</label>
        <input id="ly" className="input num" inputMode="decimal" placeholder="0.0" value={lyx} onChange={(e) => setLyx(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="bt">{dir === 'sell-lyx' ? `${sym} you get` : `${sym} you give`} ({asset === 'btc' ? settings.net : evmNet(settings).name})</label>
        <input id="bt" className="input num" inputMode="decimal" placeholder="0.0" value={other} onChange={(e) => setOther(e.target.value)} />
      </div>
      <div className="field">
        <label>If the other person disappears</label>
        <div className="segmented">
          {(['fast', 'standard'] as sw.Speed[]).map((s) => (
            <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
              {speed === s && <motion.span layoutId="speed" className="seg-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <span>Refund in {sw.LOCK_HOURS[s].first} h</span>
            </button>
          ))}
        </div>
      </div>
      <p className="hint">
        A swap usually takes {asset === 'btc' ? 'under an hour' : 'a few minutes'}. If the other person stops halfway,
        your {dir === 'sell-lyx' ? 'LYX' : sym} comes back after {sw.LOCK_HOURS[speed].first} hours.
        {speed === 'standard' && ' Pick this if either of you might be away for a while.'}
        {asset === 'eth' && ' MetaMask will ask for your Ethereum address.'}
      </p>
      {err && <p className="error-text">{err}</p>}
      <div><button className="btn primary lg" disabled={busy || !lyx || !other} onClick={create}>{busy ? <><Spinner />Creating</> : 'Create offer'}</button></div>
    </div>
  );
}

function AcceptOffer({ info, settings, done, back }: { info: ChainInfo; settings: Settings; done: (r: sw.SwapRecord) => void; back: () => void }) {
  const { unlocked } = useWallet();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const offer = useMemo(() => {
    try {
      return code.trim() ? sw.parseOffer(code) : null;
    } catch (e) {
      return e as Error;
    }
  }, [code]);
  const o = offer && !(offer instanceof Error) ? offer : null;
  const asset = o ? sw.assetOf(o) : 'btc';
  const problem =
    offer instanceof Error ? offer.message
    : o && o.chainId !== info.chainId ? `This offer is for chain ${o.chainId}, but you're connected to ${info.network}`
    : o && asset === 'btc' && o.btcNet !== settings.net ? `This offer uses bitcoin ${o.btcNet}; switch it in Swap settings first`
    : o && asset === 'eth' && o.eth!.chainId !== settings.evm.chainId ? `This offer uses EVM chain ${o.eth!.chainId}; switch it in Swap settings first`
    : o && o.initLyx === unlocked?.address ? 'This is your own offer'
    : '';

  const accept = async () => {
    setErr('');
    setBusy(true);
    try {
      if (o!.dir === 'buy-lyx') {
        const acct = await rpc<{ balance: string }>('lyx_getAccount', { address: unlocked!.address });
        if (BigInt(acct.balance) < BigInt(o!.lyx)) throw new Error(`You have ${formatLyx(acct.balance)} LYX available, the offer needs ${formatLyx(o!.lyx)}`);
      }
      let a: sw.Accept;
      let ethFromBlock: number | undefined;
      if (asset === 'btc') {
        const tip = await btc.tipHeight(settings.api);
        if (o!.dir === 'buy-lyx' && (o!.btcLocktime! - tip) / 6 < (o!.lyxBlocks * info.targetBlockTime) / 3600 + sw.MARGIN_HOURS + 1) throw new Error('This offer is too old. Ask for a new one.');
        a = sw.makeAccept(unlocked!.secretKey, o!, tip);
      } else {
        const net = evmNet(settings, o!.eth!.chainId);
        // the offer names a contract; make sure it really is the swap contract, not something that keeps the funds
        if (!(await eth.verifyContract(net, o!.eth!.contract))) {
          throw new Error('The contract in this offer is NOT the LOKYX swap contract. Do not accept it.');
        }
        const head = await eth.latest(net);
        if (o!.dir === 'buy-lyx' && (o!.ethRefundTime! - head.timestamp) / 3600 < (o!.lyxBlocks * info.targetBlockTime) / 3600 + sw.MARGIN_HOURS + 1) throw new Error('This offer is too old. Ask for a new one.');
        const me = await eth.connectWallet();
        ethFromBlock = Math.max(0, head.number - 5);
        a = sw.makeAccept(unlocked!.secretKey, o!, head.timestamp, me);
      }
      const r: sw.SwapRecord = { offer: o!, accept: a, role: 'responder', ethFromBlock, updated: Date.now() };
      sw.saveSwap(r);
      done(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const otherLock = asset === 'btc' ? `after ~${Math.round((o?.btcBlocks ?? 0) / 6)} hours` : `after ${o?.eth?.hours ?? 0} hours`;
  const lyxLock = o ? `after ${duration(o.lyxBlocks * info.targetBlockTime)}` : '';
  return (
    <div className="stack" style={{ maxWidth: 620, gap: 24 }}>
      <button className="link" onClick={back}>← Back</button>
      <div className="field">
        <label htmlFor="oc">Offer code</label>
        <textarea id="oc" className="input mono" rows={4} placeholder="lokyx-swap-offer:…" value={code} onChange={(e) => setCode(e.target.value)} style={{ fontSize: 13 }} />
      </div>
      {problem && <p className="error-text">{problem}</p>}
      {o && !problem && (
        <>
          <KV
            items={[
              ['You give', <span className="inline" style={{ gap: 8 }}><ChainIcon chain={o.dir === 'sell-lyx' ? asset : 'lyx'} size={18} />{o.dir === 'sell-lyx' ? otherText(o) : `${formatLyx(o.lyx)} LYX`}</span>],
              ['You get', <span className="inline" style={{ gap: 8 }}><ChainIcon chain={o.dir === 'sell-lyx' ? 'lyx' : asset} size={18} />{o.dir === 'sell-lyx' ? `${formatLyx(o.lyx)} LYX` : otherText(o)}</span>],
              ['If it fails, you get yours back', o.dir === 'sell-lyx' ? otherLock : lyxLock],
              ['From', <span className="mono">{shortHash(o.initLyx, 10, 6)}</span>],
              ...(asset === 'eth' ? [['Swap contract', <span className="mono">{shortHash(o.eth!.contract, 8, 6)}</span>] as [string, React.ReactNode]] : []),
            ]}
          />
          <p className="hint">They lock first. Your app checks their lock on-chain before it asks you to lock anything.{asset === 'eth' && ' The swap contract is checked against the real one before you accept.'}</p>
          {err && <p className="error-text">{err}</p>}
          <div><button className="btn primary lg" disabled={busy} onClick={accept}>{busy ? <><Spinner />Checking</> : 'Accept'}</button></div>
        </>
      )}
    </div>
  );
}

// ---------- a running swap ----------

const STAGES = ['Agree', 'First lock', 'Second lock', 'Claim', 'Done'];

function stageOf(step: sw.Step, r: sw.SwapRecord): number {
  const lyxFirst = r.offer.dir === 'sell-lyx';
  switch (step.kind) {
    case 'wait-accept':
    case 'share-accept':
      return 0;
    case 'lock-lyx':
    case 'wait-lyx-lock':
      return lyxFirst ? 1 : 2;
    case 'fund-other':
    case 'wait-other-fund':
      return lyxFirst ? 2 : 1;
    case 'claim-other':
    case 'claim-lyx':
    case 'wait-claim':
    case 'confirming':
      return 3;
    case 'done':
    case 'refunded':
      return 4;
    default:
      return -1;
  }
}

function SwapView({ record, info, settings, saved, back }: { record: sw.SwapRecord; info: ChainInfo; settings: Settings; saved: () => void; back: () => void }) {
  const { unlocked } = useWallet();
  const [r, setR] = useState(record);
  const [live, setLive] = useState<sw.Live | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [btcTo, setBtcTo] = useState('');
  const [acceptCode, setAcceptCode] = useState('');

  const update = useCallback((patch: Partial<sw.SwapRecord>) => {
    setR((x) => {
      const n = { ...x, ...patch };
      sw.saveSwap(n);
      return n;
    });
    saved();
  }, [saved]);

  const asset = sw.assetOf(r.offer);
  const sym = asset === 'btc' ? 'BTC' : 'ETH';
  const htlc = sw.htlcOf(r);
  const btcAddress = htlc ? btc.htlcAddress(htlc, r.offer.btcNet!) : undefined;
  const ethLock = sw.ethLockOf(r);
  const net = asset === 'eth' ? evmNet(settings, r.offer.eth!.chainId) : null;

  const refresh = useCallback(async () => {
    try {
      let lyx: sw.LyxSwapView | undefined;
      let id = r.lyxLockId;
      if (!id && r.accept) {
        const ids = await rpc<string[]>('lyx_findSwaps', { hashlock: r.offer.hashlock });
        id = ids[0];
        if (id) update({ lyxLockId: id });
      }
      if (id) lyx = await rpc<sw.LyxSwapView>('lyx_getSwap', { id }).catch(() => undefined);
      const base = { lyxHeight: info.height, lyxBlockTime: info.targetBlockTime, lyx };
      if (!r.accept) {
        setLive({ ...base, leg: { hoursLeft: 99, expired: false, funded: false, anyFunding: false, claimedSecret: null, refunded: false, closeConfirmed: false, received: 0n } });
      } else if (asset === 'btc') {
        const b = await btc.watchHtlc(settings.api, btcAddress!, hexToBytes(r.offer.hashlock));
        setLive({ ...base, btc: b, btcAddress, leg: sw.btcLeg(r, b) });
      } else {
        const e = await eth.watchLock(net!, r.offer.eth!.contract, ethLock!.id, r.ethFromBlock ?? 0);
        setLive({ ...base, eth: e, leg: sw.ethLeg(r, e) });
      }
      setLoadErr('');
    } catch (e) {
      setLoadErr((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.lyxLockId, r.accept, r.offer.hashlock, btcAddress, settings.api, info.height, info.targetBlockTime, update, asset, ethLock?.id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const step = live ? sw.nextStep(r, live) : null;
  const sk = unlocked!.secretKey;
  const chainId = BigInt(info.chainId);

  const act = async (f: () => Promise<void>) => {
    setErr('');
    setBusy(true);
    try {
      await f();
      await refresh();
    } catch (e) {
      const m = (e as { code?: number; message?: string });
      setErr(m.code === 4001 ? 'You cancelled it in MetaMask.' : m.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendLyx = async (op: Parameters<typeof signSwap>[0], amount = 0n) => {
    const acct = await rpc<{ pendingNonce: number }>('lyx_getAccount', { address: unlocked!.address });
    const t = signSwap(op, chainId, BigInt(acct.pendingNonce), sk, amount);
    return rpc<string>('lyx_sendRawTransaction', { tx: bytesToHex(t.bytes) });
  };

  const lockLyx = (refundHeight: number) => act(async () => {
    const p = sw.lyxParties(r)!;
    const id = await sendLyx({ kind: 'lock', hashlock: hexToBytes(r.offer.hashlock), recipient: p.recipient, refundHeight: BigInt(refundHeight) }, BigInt(r.offer.lyx));
    update({ lyxLockId: id });
  });
  const claimLyx = (lockId: string) => act(async () => {
    const secret = sw.knownSecret(r, live!, sk);
    if (!secret) throw new Error('The secret hasn\'t shown up yet');
    update({ lyxCloseTx: await sendLyx({ kind: 'claim', lock: hexToBytes(lockId), secret }) });
  });
  const refundLyx = (lockId: string) => act(async () => {
    update({ lyxCloseTx: await sendLyx({ kind: 'refund', lock: hexToBytes(lockId) }) });
  });

  const btcUtxo = (min: number) => live?.btc?.funding.filter((f) => !f.spent && f.confirmations >= min).sort((a, b) => b.value - a.value)[0];
  const fundOther = () => act(async () => {
    if (asset !== 'eth') return;
    // the lock id commits to the sender, so it has to come from the address in the deal
    const h = await eth.send(net!, ethLock!.sender, r.offer.eth!.contract, eth.encodeLock(r.offer.hashlock, ethLock!.recipient, ethLock!.refundTime), ethLock!.amount);
    update({ ethTx: h });
  });
  const claimOther = () => act(async () => {
    const secret = sw.knownSecret(r, live!, sk);
    if (!secret) throw new Error('The secret hasn\'t shown up yet');
    if (asset === 'btc') {
      if (!btc.isBtcAddress(btcTo, r.offer.btcNet!)) throw new Error('Enter your bitcoin address');
      const u = btcUtxo(0);
      if (!u) throw new Error('Nothing to claim');
      const t = btc.buildClaim(htlc!, u, secret, sw.myBtcKey(sk, r), btcTo, settings.feeRate, r.offer.btcNet!);
      await btc.broadcast(settings.api, t.hex);
      update({ btcClaimTx: t.txid });
    } else {
      // anyone may submit the claim; the ether always goes to the agreed recipient
      const from = await eth.connectWallet();
      update({ ethTx: await eth.send(net!, from, r.offer.eth!.contract, eth.encodeClaim(ethLock!.id, secret)) });
    }
  });
  const refundOther = () => act(async () => {
    if (asset === 'btc') {
      if (!btc.isBtcAddress(btcTo, r.offer.btcNet!)) throw new Error('Enter your bitcoin address');
      const u = btcUtxo(0);
      if (!u) throw new Error('Nothing to refund');
      const t = btc.buildRefund(htlc!, u, sw.myBtcKey(sk, r), btcTo, settings.feeRate, r.offer.btcNet!);
      await btc.broadcast(settings.api, t.hex);
      update({ btcRefundTx: t.txid });
    } else {
      const from = await eth.connectWallet();
      update({ ethTx: await eth.send(net!, from, r.offer.eth!.contract, eth.encodeRefund(ethLock!.id)) });
    }
  });
  const takeAccept = () => act(async () => {
    update({ accept: sw.parseAccept(acceptCode, r.offer) });
  });

  const iGiveLyx = sw.locksLyx(r);
  const stage = step ? stageOf(step, r) : 0;
  const lyxText = `${formatLyx(r.offer.lyx)} LYX`;
  const oText = otherText(r.offer);
  const chainName = asset === 'btc' ? 'bitcoin' : net?.name ?? 'ethereum';
  const btcAddrField = (
    <div className="field">
      <label htmlFor="bto">Your bitcoin address ({r.offer.btcNet})</label>
      <input id="bto" className="input mono" value={btcTo} onChange={(e) => setBtcTo(e.target.value)} placeholder={r.offer.btcNet === 'regtest' ? 'bcrt1…' : 'tb1…'} />
    </div>
  );
  const otherRefundAt = asset === 'btc'
    ? htlc ? `bitcoin block ${htlc.locktime.toLocaleString()}` : ''
    : ethLock ? new Date(ethLock.refundTime * 1000).toLocaleString() : '';

  return (
    <div className="stack" style={{ gap: 32, maxWidth: 760 }}>
      <button className="link" onClick={back}>← All swaps</button>
      <div className="inline" style={{ gap: 16 }}>
        <span className="chain-pair big"><ChainIcon chain={iGiveLyx ? 'lyx' : asset} size={40} /><ChainIcon chain={iGiveLyx ? asset : 'lyx'} size={40} /></span>
        <div>
          <h2 className="num" style={{ fontSize: 30, letterSpacing: '-0.03em' }}>{iGiveLyx ? `${lyxText} → ${oText}` : `${oText} → ${lyxText}`}</h2>
          <p className="faint" style={{ marginTop: 6 }}>{r.role === 'initiator' ? 'You started this swap' : 'You accepted this swap'} · id {r.offer.salt.slice(0, 8)}</p>
        </div>
      </div>

      <ol className="swap-track">
        {STAGES.map((s, i) => (
          <li key={s} className={i < stage ? 'past' : i === stage ? 'now' : ''}>
            <span className="dot">{i < stage ? <Icon.check /> : null}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>

      {loadErr && <p className="error-text">Can't read chain data: {loadErr}</p>}
      {!step && !loadErr && <Spinner />}

      {step && (
        <motion.section key={step.kind} className="swap-step" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {step.kind === 'wait-accept' && (
            <>
              <h3>Send this offer code to the other person</h3>
              <div className="code-box"><Copy text={sw.offerCode(r.offer)} display={sw.offerCode(r.offer).slice(0, 48) + '…'} /></div>
              <p className="muted">When they accept, they'll send you back an acceptance code. Paste it here.</p>
              <textarea className="input mono" rows={3} placeholder="lokyx-swap-accept:…" value={acceptCode} onChange={(e) => setAcceptCode(e.target.value)} style={{ fontSize: 13 }} />
              <div><button className="btn primary" disabled={!acceptCode || busy} onClick={takeAccept}>Continue</button></div>
            </>
          )}
          {r.role === 'responder' && stage <= 1 && step.kind !== 'unsafe' && (
            <div className="stack" style={{ gap: 12 }}>
              <h3>Send this acceptance code back</h3>
              <div className="code-box"><Copy text={sw.acceptCode(r.accept!)} display={sw.acceptCode(r.accept!).slice(0, 48) + '…'} /></div>
            </div>
          )}
          {step.kind === 'lock-lyx' && (
            <>
              <h3>Lock {lyxText}</h3>
              <p className="muted">
                Only {shortHash(sw.lyxParties(r)!.recipient, 10, 6)} can claim it, and only with the secret. If the swap doesn't finish,
                it comes back to you from block {step.refundHeight.toLocaleString()} (about {duration((step.refundHeight - info.height) * info.targetBlockTime)}).
              </p>
              <div><button className="btn primary lg" disabled={busy} onClick={() => lockLyx(step.refundHeight)}>{busy ? <><Spinner />Locking</> : `Lock ${lyxText}`}</button></div>
            </>
          )}
          {step.kind === 'wait-lyx-lock' && (
            <><h3>{step.mine ? 'Your LYX lock is being mined' : 'Waiting for their LYX lock'}</h3>
              <p className="muted">{step.mine ? 'It shows up in a block within a minute or two.' : `The app moves on once it has ${sw.LYX_CONFS} confirmations.`}</p></>
          )}
          {step.kind === 'fund-other' && asset === 'btc' && (
            <>
              <h3>Send exactly {oText} to this address</h3>
              <div className="code-box"><Copy text={btcAddress!} /></div>
              <p className="muted">
                Use any bitcoin wallet. This address is a lock, not a person: only they can claim it, and only with the secret. If they don't,
                it's yours again from {otherRefundAt}.
              </p>
              {(live?.leg.received ?? 0n) > 0n && <p className="hint">Seen so far: {fmtBtc(Number(live!.leg.received))} BTC (waiting for {sw.BTC_CONFS} confirmation).</p>}
            </>
          )}
          {step.kind === 'fund-other' && asset === 'eth' && (
            <>
              <h3>Lock {oText} on {net!.name}</h3>
              <p className="muted">
                MetaMask sends it to the swap contract. Only {shortHash(ethLock!.recipient, 8, 6)} can receive it, and only once the secret is revealed.
                If that doesn't happen, it can be sent back to you from {otherRefundAt}.
              </p>
              <div><button className="btn primary lg" disabled={busy} onClick={fundOther}>{busy ? <><Spinner />Confirm in MetaMask</> : `Lock ${oText} with MetaMask`}</button></div>
            </>
          )}
          {step.kind === 'wait-other-fund' && (
            <><h3>{iGiveLyx ? `Waiting for their ${sym}` : `Waiting for your ${sym} lock to confirm`}</h3>
              <p className="muted">
                {asset === 'btc' && iGiveLyx && <>They need to send {oText} to <span className="mono">{shortHash(btcAddress!, 12, 8)}</span>. </>}
                {(live?.leg.received ?? 0n) > 0n ? `Seen ${asset === 'btc' ? fmtBtc(Number(live!.leg.received)) : fmtEth(live!.leg.received)} ${sym} so far.` : ''}
              </p></>
          )}
          {step.kind === 'claim-other' && (
            <>
              <h3>Claim {oText}</h3>
              {asset === 'btc' ? (
                <>
                  {btcAddrField}
                  <p className="hint">The network fee ({settings.feeRate} sat/vB) comes out of the amount.</p>
                  <div><button className="btn primary lg" disabled={busy || !btcTo} onClick={claimOther}>{busy ? <><Spinner />Claiming</> : 'Claim bitcoin'}</button></div>
                </>
              ) : (
                <>
                  <p className="muted">It goes to {shortHash(ethLock!.recipient, 8, 6)}. Any MetaMask account can send the claim; it only pays the gas.</p>
                  <div><button className="btn primary lg" disabled={busy} onClick={claimOther}>{busy ? <><Spinner />Confirm in MetaMask</> : 'Claim ether with MetaMask'}</button></div>
                </>
              )}
            </>
          )}
          {step.kind === 'claim-lyx' && (
            <>
              <h3>Claim {lyxText}</h3>
              <p className="muted">{r.role === 'initiator' ? `Their LYX is locked and confirmed. Claiming it reveals the secret so they can take the ${sym}.` : `They took the ${sym}, which revealed the secret. Use it to take your LYX now.`}</p>
              <div><button className="btn primary lg" disabled={busy} onClick={() => claimLyx(step.lockId)}>{busy ? <><Spinner />Claiming</> : `Claim ${lyxText}`}</button></div>
            </>
          )}
          {step.kind === 'wait-claim' && (
            <><h3>Waiting for them to claim</h3>
              <p className="muted">{step.leg === 'other' ? `Once they claim the ${sym}, the secret becomes public and your app can claim your LYX with it.` : `Once they claim the LYX, the secret becomes public and you can take the ${sym}.`}</p></>
          )}
          {step.kind === 'wait-refund' && (
            <><h3>The swap stopped</h3>
              <p className="muted">{step.leg === 'other' ? `Your ${sym} can be refunded from ${otherRefundAt}.` : `Your LYX unlocks at LOKYX block ${live?.lyx?.refundHeight.toLocaleString()}.`} Come back then to take it back.</p></>
          )}
          {step.kind === 'refund-lyx' && (
            <><h3>Take your LYX back</h3>
              <p className="muted">The lock expired without being claimed.</p>
              <div><button className="btn primary lg" disabled={busy} onClick={() => refundLyx(step.lockId)}>{busy ? <><Spinner />Refunding</> : 'Refund LYX'}</button></div></>
          )}
          {step.kind === 'refund-other' && (
            <><h3>Take your {sym} back</h3>
              <p className="muted">The lock expired without being claimed.</p>
              {asset === 'btc' && btcAddrField}
              <div><button className="btn primary lg" disabled={busy || (asset === 'btc' && !btcTo)} onClick={refundOther}>{busy ? <><Spinner />Refunding</> : `Refund ${sym}`}</button></div></>
          )}
          {step.kind === 'confirming' && (
            <><h3>Claimed, waiting for a block</h3><p className="muted">Your claim for {step.got === 'other' ? oText : lyxText} is on its way into the next {step.got === 'other' ? chainName : 'LOKYX'} block.</p></>
          )}
          {step.kind === 'done' && (
            <><h3>Swap complete</h3><p className="muted">You received {step.got === 'other' ? oText : lyxText}.</p></>
          )}
          {step.kind === 'refunded' && (
            <><h3>Refunded</h3><p className="muted">The swap didn't finish and the {step.leg === 'other' ? sym : 'LYX'} went back to whoever locked it.</p></>
          )}
          {step.kind === 'unsafe' && (
            <div className="notice"><Icon.alert /><p><strong>Stop here.</strong> {step.reason}</p></div>
          )}
          {err && <p className="error-text">{err}</p>}
        </motion.section>
      )}

      {live && r.accept && (
        <KV
          items={[
            ['LYX lock', live.lyx ? <Link className="link mono" to={`/tx/${live.lyx.id}`}>{shortHash(live.lyx.id, 10, 6)} · {live.lyx.status}</Link> : 'not yet'],
            ['LYX refund from', live.lyx ? `block ${live.lyx.refundHeight.toLocaleString()} (now ${info.height.toLocaleString()})` : '–'],
            [`${sym} lock`, asset === 'btc' ? <Copy text={btcAddress!} display={shortHash(btcAddress!, 12, 8)} /> : <Copy text={ethLock!.id} display={shortHash(ethLock!.id, 10, 6)} />],
            [`${sym} refund from`, otherRefundAt],
            [`${sym} locked`, asset === 'btc' ? `${fmtBtc(Number(live.leg.received))} BTC` : `${fmtEth(live.leg.received)} ETH`],
            ['Secret', live.leg.claimedSecret || live.lyx?.secret ? 'revealed' : 'still private'],
          ]}
        />
      )}
      {confirmRemove(step) && (
        <button className="link faint" onClick={() => { sw.removeSwap(r.offer.salt, r.role); back(); }}>Remove from this list</button>
      )}
    </div>
  );
}

function confirmRemove(step: sw.Step | null) {
  return !step || step.kind === 'done' || step.kind === 'refunded' || step.kind === 'wait-accept' || step.kind === 'share-accept';
}
