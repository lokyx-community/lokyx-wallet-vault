import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useChain, useWallet } from '../state';
import { Ago, Copy, Icon, Modal, NodeError, Spinner } from '../ui';
import { BlockGlyph, Signet } from '../visuals';
import {
  formatLyx, isAddress, isMnemonic, minTransferFee, newMnemonic, parseLyx, signTransfer, shortHash, bytesToHex,
} from '../lib/lokyx';
import { createVault, markBackedUp, unlockVault, type Unlocked } from '../lib/vault';
import { connectSnap, hasMetaMask, signWithSnap } from '../lib/snap';
import { rpc, usePoll, type Account, type History, type TxInfo } from '../lib/rpc';

export default function Wallet() {
  const { stored, unlocked, snap } = useWallet();
  const [mode, setMode] = useState<'start' | 'create' | 'restore'>('start');
  // Creation owns the screen until the phrase is backed up, even though the encrypted wallet
  // is already saved by then; otherwise the user would be bounced to "unlock" mid-way.
  if (mode === 'create') return <Create onBack={() => setMode('start')} onDone={() => setMode('start')} />;
  if (snap) return <Open />;
  if (unlocked) return <Open />;
  if (stored) return <Unlock />;
  if (mode === 'restore') return <Restore onBack={() => setMode('start')} />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Wallet</h1>
          <p>Your keys stay on this device, encrypted with your password.</p>
        </div>
      </div>
      <div className="inline">
        <button className="btn primary lg" onClick={() => setMode('create')}>Create a wallet</button>
        <button className="btn lg" onClick={() => setMode('restore')}>I have a recovery phrase</button>
      </div>
      <ConnectMetaMask />
      <p className="hint" style={{ marginTop: 32, maxWidth: '40em' }}>
        LOKYX is in testing and hasn't been audited. Test coins have no value, and you shouldn't reuse a recovery phrase that protects real funds.
      </p>
    </>
  );
}

// ---------- MetaMask ----------

function ConnectMetaMask() {
  const { setSnap } = useWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const available = hasMetaMask();
  const go = async () => {
    setErr('');
    setBusy(true);
    try {
      setSnap(await connectSnap());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ marginTop: 48, maxWidth: 560, gap: 12 }}>
      <h3>Or use MetaMask</h3>
      <p className="muted">
        MetaMask keeps your key and shows every transfer for approval. Your recovery phrase gives the same lyx1 address in MetaMask as here.
      </p>
      {available ? (
        <div><button className="btn lg" disabled={busy} onClick={go}>{busy ? <><Spinner />Waiting for MetaMask</> : 'Connect MetaMask'}</button></div>
      ) : (
        <p className="hint">MetaMask isn't installed in this browser.</p>
      )}
      {err && <p className="error-text">{err}</p>}
      <p className="hint">Needs the LOKYX Snap, which MetaMask installs when you connect. Until the Snap is approved for MetaMask's directory, this works with MetaMask Flask.</p>
    </div>
  );
}

// ---------- create ----------

const BECH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/** The address settles left to right out of random Bech32 characters once the keys exist. */
function AddressReveal({ address }: { address: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? address.length : 4);
  const [noise, setNoise] = useState('');
  useEffect(() => {
    if (reduce) return;
    let i = 4;
    const t = setInterval(() => {
      i += 1;
      setShown(i);
      setNoise(Array.from({ length: address.length }, () => BECH[Math.floor(Math.random() * 32)]).join(''));
      if (i >= address.length) clearInterval(t);
    }, 32);
    return () => clearInterval(t);
  }, [address, reduce]);
  return (
    <p className="mono reveal" aria-label={address}>
      <span>{address.slice(0, shown)}</span>
      <span className="faint">{noise.slice(shown)}</span>
    </p>
  );
}

let pendingUnlock: Unlocked | null = null;

function Create({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { setUnlocked, reload } = useWallet();
  const phrase = useMemo(newMnemonic, []);
  const [step, setStep] = useState<'password' | 'deriving' | 'reveal' | 'phrase' | 'verify'>('password');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [address, setAddress] = useState('');

  const create = async () => {
    setErr('');
    if (pw.length < 8) return setErr('Use at least 8 characters.');
    if (pw !== pw2) return setErr("The passwords don't match.");
    setStep('deriving');
    try {
      const u = await createVault(phrase, pw);
      pendingUnlock = u;
      setAddress(u.address);
      setStep('reveal');
      reload();
    } catch (e) {
      setErr((e as Error).message);
      setStep('password');
    }
  };

  const finish = () => {
    markBackedUp();
    reload();
    if (pendingUnlock) setUnlocked(pendingUnlock);
    pendingUnlock = null;
    onDone();
  };

  const copy: Record<typeof step, [string, string]> = {
    password: ['Choose a password', "It locks the wallet on this device. You'll need it whenever you send."],
    deriving: ['Creating your keys', 'One moment.'],
    reveal: ['This is your address', 'Each address gets its own ring pattern, so you can tell them apart quickly.'],
    phrase: ['Your recovery phrase', 'Write these 24 words on paper, in order. They are the only way to get this wallet back.'],
    verify: ['Check your copy', 'Type the words asked for below.'],
  };

  return (
    <>
      <div className="page-head">
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <h1>{copy[step][0]}</h1>
            <p>{copy[step][1]}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {step === 'password' && (
        <div className="stack" style={{ maxWidth: 440 }}>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pw2">Confirm password</label>
            <input id="pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
          </div>
          {err && <p className="error-text">{err}</p>}
          <div className="inline">
            <button className="btn primary lg" onClick={create}>Continue</button>
            <button className="btn quiet" onClick={onBack}>Cancel</button>
          </div>
        </div>
      )}

      {step === 'deriving' && (
        <div className="identity">
          <div className="skeleton" style={{ width: 120, height: 120, borderRadius: '50%' }} />
        </div>
      )}

      {(step === 'reveal' || step === 'phrase' || step === 'verify') && address && (
        <motion.div className="identity" layout transition={{ type: 'spring', stiffness: 200, damping: 28 }}>
          <motion.div layout>
            <Signet of={address} size={step === 'reveal' ? 140 : 64} assemble />
          </motion.div>
          <AddressReveal address={address} />
        </motion.div>
      )}

      {step === 'reveal' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8 }} style={{ marginTop: 40 }}>
          <button className="btn primary lg" onClick={() => setStep('phrase')}>Show recovery phrase</button>
        </motion.div>
      )}

      {step === 'phrase' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="stack" style={{ marginTop: 48, gap: 28 }}>
          <ol className="words">
            {phrase.split(' ').map((w, i) => (
              <motion.li key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.025 }}>
                <span className="n num">{i + 1}</span>{w}
              </motion.li>
            ))}
          </ol>
          <div className="notice">
            <Icon.security />
            <p><strong>Anyone with these words controls the wallet.</strong> Don't photograph them or type them into anything online. Nobody from LOKYX will ever ask for them.</p>
          </div>
          <div><button className="btn primary lg" onClick={() => setStep('verify')}>I've written them down</button></div>
        </motion.div>
      )}

      {step === 'verify' && <VerifyWords phrase={phrase} onDone={finish} onBack={() => setStep('phrase')} />}
    </>
  );
}

function VerifyWords({ phrase, onDone, onBack }: { phrase: string; onDone: () => void; onBack: () => void }) {
  const words = phrase.split(' ');
  const picks = useMemo(() => {
    const s = new Set<number>();
    while (s.size < 3) s.add(Math.floor(Math.random() * 24));
    return [...s].sort((a, b) => a - b);
  }, []);
  const [vals, setVals] = useState(['', '', '']);
  const ok = picks.every((p, i) => vals[i].trim().toLowerCase() === words[p]);
  return (
    <div className="stack" style={{ maxWidth: 440, marginTop: 48 }}>
      {picks.map((p, i) => (
        <div className="field" key={p}>
          <label htmlFor={'w' + p}>Word {p + 1}</label>
          <input id={'w' + p} className="input mono" autoComplete="off" spellCheck={false} value={vals[i]}
            onChange={(e) => setVals((v) => v.map((x, j) => (j === i ? e.target.value : x)))} />
        </div>
      ))}
      <div className="inline">
        <button className="btn primary lg" disabled={!ok} onClick={onDone}>Open wallet</button>
        <button className="btn quiet" onClick={onBack}>See the words again</button>
      </div>
    </div>
  );
}

function Restore({ onBack }: { onBack: () => void }) {
  const { setUnlocked, reload } = useWallet();
  const [phrase, setPhrase] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setErr('');
    if (!isMnemonic(phrase)) return setErr("That isn't a valid recovery phrase. Check the spelling and the order of the words.");
    if (pw.length < 8) return setErr('Choose a password of at least 8 characters.');
    setBusy(true);
    try {
      const u = await createVault(phrase, pw);
      markBackedUp();
      reload();
      setUnlocked(u);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-head"><div><h1>Restore a wallet</h1><p>Enter your 12 or 24 words, in order, separated by spaces.</p></div></div>
      <div className="stack" style={{ maxWidth: 560 }}>
        <div className="field">
          <label htmlFor="phrase">Recovery phrase</label>
          <textarea id="phrase" className="input mono" rows={4} spellCheck={false} autoComplete="off" value={phrase} onChange={(e) => setPhrase(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rpw">New password for this device</label>
          <input id="rpw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        {err && <p className="error-text">{err}</p>}
        <div className="inline">
          <button className="btn primary lg" disabled={busy} onClick={go}>{busy ? <><Spinner />Restoring</> : 'Restore wallet'}</button>
          <button className="btn quiet" onClick={onBack}>Cancel</button>
        </div>
      </div>
    </>
  );
}

function Unlock() {
  const { stored, setUnlocked } = useWallet();
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
    <div style={{ maxWidth: 520 }}>
      <div className="identity" style={{ marginBottom: 40 }}>
        <Signet of={stored!.address} size={72} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 32 }}>Welcome back</h1>
          <p className="mono faint" style={{ marginTop: 8, wordBreak: 'break-all' }}>{stored!.address}</p>
        </div>
      </div>
      <div className="stack">
        <div className="field">
          <label htmlFor="upw">Password</label>
          <input id="upw" className="input" type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        </div>
        {err && <p className="error-text">{err}</p>}
        <div><button className="btn primary lg" disabled={busy || !pw} onClick={go}>{busy ? <><Spinner />Unlocking</> : 'Unlock'}</button></div>
        <p className="hint">Forgot your password? Remove the wallet in <Link to="/security" className="link">Security</Link> and restore it from your recovery phrase.</p>
      </div>
      <div>
        <ConnectMetaMask />
      </div>
    </div>
  );
}

// ---------- open wallet ----------

function Open() {
  const { unlocked, setUnlocked, stored, snap, setSnap } = useWallet();
  const { info } = useChain();
  const viaMetaMask = !!snap;
  const addr = snap ?? unlocked!.address;
  const acct = usePoll<Account>('lyx_getAccount', { address: addr }, 4000, info?.height);
  const hist = usePoll<History>('lyx_getAddressHistory', { address: addr, limit: 20 }, 0, info?.height);
  const [tab, setTab] = useState<'activity' | 'send' | 'receive'>('activity');

  return (
    <>
      <div className="page-head" style={{ alignItems: 'center' }}>
        <div className="identity">
          <Signet of={addr} size={56} />
          <div style={{ minWidth: 0 }}>
            <Copy text={addr} display={shortHash(addr, 14, 8)} />
            <p className="hint" style={{ marginTop: 4 }}>
              {viaMetaMask ? 'MetaMask' : info ? `${info.network[0].toUpperCase()}${info.network.slice(1)} wallet` : 'Not connected'}
            </p>
          </div>
        </div>
        {viaMetaMask ? (
          <button className="btn quiet" onClick={() => setSnap(null)}>Disconnect MetaMask</button>
        ) : (
          <button className="btn quiet" onClick={() => setUnlocked(null)}>Lock</button>
        )}
      </div>

      {acct.error && <NodeError error={acct.error} />}
      {!viaMetaMask && stored && !stored.backedUp && (
        <div className="notice" style={{ marginBottom: 32 }}>
          <Icon.alert />
          <p><strong>Back up your recovery phrase.</strong> Without it, losing this device means losing the wallet. <Link to="/security" className="link">Back it up now</Link></p>
        </div>
      )}

      <div>
        <p className="muted" style={{ fontSize: 18, marginBottom: 12 }}>Balance</p>
        <p className="big-num">
          {acct.data ? formatLyx(acct.data.balance, 4) : '–'}
          <span style={{ fontSize: '0.32em', fontWeight: 500, marginLeft: 12, letterSpacing: 0 }} className="faint">LYX</span>
        </p>
        <div className="inline" style={{ marginTop: 16, gap: 24 }}>
          {acct.data && BigInt(acct.data.locked) > 0n && (
            <p className="muted">{formatLyx(acct.data.locked, 4)} LYX from mining unlocks after {info?.coinbaseMaturity ?? '–'} blocks</p>
          )}
          {acct.data?.vault && (
            <Link to="/vault" className="link">Vault · {formatLyx(acct.data.vault.allowanceLeft, 4)} LYX can leave today</Link>
          )}
          {acct.data && acct.data.pendingNonce > acct.data.nonce && (
            <p className="muted">{acct.data.pendingNonce - acct.data.nonce} outgoing transaction waiting for a block</p>
          )}
        </div>
      </div>

      <div className="wallet-actions mobile-only">
        <button className="btn primary lg" onClick={() => setTab('send')}>Send</button>
        <button className="btn lg" onClick={() => setTab('receive')}>Receive</button>
      </div>

      <div className="tabs" role="tablist">
        <div className="segmented">
          {(['activity', 'send', 'receive'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {tab === t && <motion.span layoutId="wallet-tab" className="seg-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <span>{t === 'activity' ? 'Activity' : t === 'send' ? 'Send' : 'Receive'}</span>
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          {tab === 'activity' && <Activity hist={hist.data} me={addr} />}
          {tab === 'send' && acct.data && <Send account={acct.data} address={addr} viaMetaMask={viaMetaMask} />}
          {tab === 'receive' && (
            <div className="stack" style={{ maxWidth: 620 }}>
              <div className="receive">
                <Signet of={addr} size={96} />
                <p className="mono grouped">{addr.match(/.{1,4}/g)!.join(' ')}</p>
              </div>
              <div className="inline"><Copy text={addr} display="Copy address" mono={false} /></div>
              <p className="muted">Ask the sender to compare the ring in their wallet with yours before they send. On testnet you can also <Link to="/faucet" className="link">use the faucet</Link>.</p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

function Activity({ hist, me }: { hist?: History; me: string }) {
  if (!hist) return null;
  if (hist.items.length === 0)
    return (
      <div className="empty">
        <p>Nothing here yet. Get test LYX from the faucet, or mine some.</p>
        <div className="inline">
          <Link to="/faucet" className="btn primary">Open faucet</Link>
          <Link to="/mining" className="btn">Start mining</Link>
        </div>
      </div>
    );
  return (
    <div className="table">
      {hist.items.map((h, i) => {
        const incoming = h.kind !== 'sent';
        return (
          <Link key={i} to={h.txHash ? `/tx/${h.txHash}` : `/block/${h.height}`} className="tr" style={{ gridTemplateColumns: '40px minmax(0,1fr) auto' }}>
            <span className={'kind' + (incoming ? ' in' : '')}>{h.kind === 'mined' ? <Icon.cube /> : incoming ? <Icon.down /> : <Icon.up />}</span>
            <span className="cell-main">
              <span className="t">{h.kind === 'mined' ? `Mined block ${h.height.toLocaleString()}` : h.kind === 'sent' ? 'Sent' : h.kind === 'self' ? 'Sent to yourself' : 'Received'}</span>
              <span className="s">
                {h.kind === 'sent' && <>To <span className="mono">{shortHash(h.to!, 10, 6)}</span>, </>}
                {h.kind === 'received' && h.from !== me && <>From <span className="mono">{shortHash(h.from!, 10, 6)}</span>, </>}
                <Ago ts={h.timestamp} />
              </span>
            </span>
            <span className="num" style={{ fontWeight: 500, color: incoming ? 'var(--text)' : 'var(--text-2)' }}>
              {incoming ? '+' : '−'}{h.amountLyx} LYX
            </span>
          </Link>
        );
      })}
    </div>
  );
}

// ---------- send ----------

export type Stage = 'preparing' | 'signing' | 'broadcasting' | 'confirming' | 'completed' | 'failed';
const ORDER: Stage[] = ['preparing', 'signing', 'broadcasting', 'confirming', 'completed'];
const LABEL: Record<string, string> = { preparing: 'Preparing', signing: 'Signing', broadcasting: 'Broadcasting', confirming: 'Confirming', completed: 'Completed' };
export const TARGET_CONFIRMATIONS = 3;

function Send({ account, address, viaMetaMask }: { account: Account; address: string; viaMetaMask: boolean }) {
  const { unlocked } = useWallet();
  const { info } = useChain();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [failedAt, setFailedAt] = useState<Stage>('broadcasting');
  const [hash, setHash] = useState('');
  const [err, setErr] = useState('');
  const [tx, setTx] = useState<TxInfo>();
  const fee = minTransferFee();
  const balance = BigInt(account.balance);

  let value: bigint | null = null;
  let amountErr = '';
  try {
    if (amount) value = parseLyx(amount);
  } catch (e) {
    amountErr = (e as Error).message;
  }
  const target = to.trim().toLowerCase();
  const toErr = to && !isAddress(to) ? "That isn't a valid lyx1 address." : '';
  const over = value !== null && value + fee > balance;
  const ready = !!(value !== null && value > 0n && !toErr && to && !over && info);

  const send = async () => {
    if (!ready || !info || (!viaMetaMask && !unlocked)) return;
    setReview(false);
    setErr('');
    const fail = (at: Stage, e: unknown) => {
      setFailedAt(at);
      setErr((e as Error).message);
      setStage('failed');
    };
    // Preparing: ask the node for the next nonce so the transaction can't collide with a pending one.
    setStage('preparing');
    let nonce: number;
    try {
      nonce = (await rpc<Account>('lyx_getAccount', { address })).pendingNonce;
    } catch (e) {
      return fail('preparing', e);
    }
    setStage('signing');
    let rawTx: string;
    try {
      if (viaMetaMask) {
        // MetaMask shows its own confirmation; this step waits until the user approves or cancels.
        const s = await signWithSnap({ chainId: info.chainId, nonce, to: target, value: value!, fee });
        if (s.from !== address) throw new Error('MetaMask signed with a different account. Reconnect MetaMask and try again.');
        rawTx = s.tx;
        setHash(s.hash);
      } else {
        const signed = signTransfer({ chainId: BigInt(info.chainId), nonce: BigInt(nonce), to: target, value: value!, fee }, unlocked!.secretKey);
        rawTx = bytesToHex(signed.bytes);
        setHash(signed.hash);
      }
    } catch (e) {
      const code = (e as { code?: number }).code;
      return fail('signing', code === 4001 ? new Error('You cancelled it in MetaMask. Nothing was sent.') : e);
    }
    setStage('broadcasting');
    try {
      setHash(await rpc<string>('lyx_sendRawTransaction', { tx: rawTx }));
      setStage('confirming');
    } catch (e) {
      fail('broadcasting', e);
    }
  };

  // Confirming → Completed, driven only by what the node reports.
  useEffect(() => {
    if (stage !== 'confirming') return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const r = await rpc<TxInfo>('lyx_getTransaction', { hash });
        if (!alive) return;
        setTx(r);
        if (r.status === 'confirmed' && (r.confirmations ?? 0) >= TARGET_CONFIRMATIONS) setStage('completed');
      } catch {
        /* briefly unknown during a reorg; keep polling */
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [stage, hash]);

  if (stage)
    return (
      <div className="stack" style={{ maxWidth: 760, gap: 36 }}>
        <TxTrack stage={stage} failedAt={failedAt} tx={tx} />
        {stage === 'signing' && viaMetaMask && (
          <motion.div className="notice" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <Icon.wallet />
            <p><strong>Approve it in MetaMask.</strong> Check the recipient and amount it shows match what you entered here.</p>
          </motion.div>
        )}
        {stage === 'failed' && (
          <div className="notice"><Icon.alert /><p><strong>{LABEL[failedAt]} failed.</strong> {err}</p></div>
        )}
        {stage === 'completed' && tx?.blockHeight !== undefined && (
          <motion.div className="identity" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 180, damping: 22 }}>
            {tx.blockHash && <BlockGlyph hash={tx.blockHash} size={64} />}
            <div>
              <p style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em' }}>{formatLyx(value ?? 0n)} LYX sent</p>
              <p className="muted">In block <Link to={`/block/${tx.blockHeight}`} className="link num">{tx.blockHeight.toLocaleString()}</Link>, now {tx.confirmations} blocks deep.</p>
            </div>
          </motion.div>
        )}
        {hash && stage !== 'failed' && (
          <p className="muted">Transaction <Link to={`/tx/${hash}`} className="mono link">{shortHash(hash, 10, 8)}</Link></p>
        )}
        {(stage === 'completed' || stage === 'failed') && (
          <div><button className="btn" onClick={() => { setStage(null); setAmount(''); setTo(''); setTx(undefined); setErr(''); setHash(''); }}>{stage === 'failed' ? 'Try again' : 'Send more'}</button></div>
        )}
      </div>
    );

  return (
    <div className="stack" style={{ maxWidth: 560, gap: 24 }}>
      <div className="field">
        <label htmlFor="to">Recipient</label>
        <div className="input-adorn">
          <input id="to" className="input mono" placeholder="lyx1…" spellCheck={false} autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} style={{ paddingRight: 56 }} />
          <AnimatePresence>
            {isAddress(to) && (
              <motion.span className="adorn" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}>
                <Signet of={target} size={30} />
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {toErr && <p className="error-text">{toErr}</p>}
      </div>
      <div className="field">
        <label htmlFor="amt">Amount</label>
        <div className="input-adorn">
          <input id="amt" className="input num" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ paddingRight: 96, fontSize: 20 }} />
          <button className="adorn btn quiet" style={{ height: 34, padding: '0 14px' }} onClick={() => setAmount(balance > fee ? formatLyx(balance - fee).replace(/,/g, '') : '0')}>Max</button>
        </div>
        {amountErr && <p className="error-text">{amountErr}</p>}
        {over && <p className="error-text">That's more than you have after the network fee.</p>}
      </div>
      <p className="hint">Network fee {formatLyx(fee)} LYX, paid to whoever mines the block. Available {formatLyx(balance, 4)} LYX.</p>
      <div><button className="btn primary lg" disabled={!ready} onClick={() => setReview(true)}>Review</button></div>

      <Modal open={review} onClose={() => setReview(false)}>
        <h2>Send {value !== null ? formatLyx(value) : ''} LYX?</h2>
        <div className="identity" style={{ marginBottom: 24 }}>
          {isAddress(to) && <Signet of={target} size={48} />}
          <p className="mono" style={{ wordBreak: 'break-all', fontSize: 14 }}>{target}</p>
        </div>
        <dl className="kv" style={{ marginBottom: 28 }}>
          <div><dt>Amount</dt><dd className="num">{value !== null ? formatLyx(value) : ''} LYX</dd></div>
          <div><dt>Network fee</dt><dd className="num">{formatLyx(fee)} LYX</dd></div>
          <div><dt>Total</dt><dd className="num" style={{ fontWeight: 600 }}>{value !== null ? formatLyx(value + fee) : ''} LYX</dd></div>
        </dl>
        <p className="hint" style={{ marginBottom: 24 }}>Check the ring matches the one the recipient sees. Transactions can't be reversed.</p>
        <div className="inline">
          <button className="btn primary lg" onClick={send}>{viaMetaMask ? 'Continue in MetaMask' : 'Sign and send'}</button>
          <button className="btn quiet" onClick={() => setReview(false)}>Cancel</button>
        </div>
      </Modal>
    </div>
  );
}

/** Five-step lifecycle. The bar only fills as far as the node has confirmed. */
export function TxTrack({ stage, failedAt = 'broadcasting', tx }: { stage: Stage; failedAt?: Stage; tx?: TxInfo }) {
  const reduce = useReducedMotion();
  const at = stage === 'failed' ? ORDER.indexOf(failedAt) : ORDER.indexOf(stage);
  const conf = tx?.confirmations ?? 0;
  // Within "confirming", advance smoothly with real confirmations.
  const partial = stage === 'confirming' ? Math.min(conf, TARGET_CONFIRMATIONS) / TARGET_CONFIRMATIONS : 0;
  const progress = stage === 'completed' ? 1 : (Math.max(0, at) + partial) / (ORDER.length - 1);
  return (
    <div className="track" role="list" aria-label="Transaction progress">
      <div className="track-line">
        <motion.div className="track-fill" initial={false} animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
        {!reduce && stage !== 'completed' && stage !== 'failed' && (
          <motion.div className="track-glint" animate={{ left: ['-10%', `${progress * 100}%`] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} />
        )}
      </div>
      {ORDER.map((s, i) => {
        const done = i < at || stage === 'completed';
        const now = i === at && stage !== 'completed' && stage !== 'failed';
        const failed = stage === 'failed' && i === at;
        return (
          <div role="listitem" key={s} className={'track-step' + (done ? ' done' : now ? ' now' : failed ? ' failed' : '')}>
            <span className="track-node">
              <AnimatePresence>
                {done && (
                  <motion.svg width={12} height={12} viewBox="0 0 24 24" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 26 }}>
                    <path d="m5 12.5 4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                  </motion.svg>
                )}
              </AnimatePresence>
            </span>
            <span>
              {LABEL[s]}
              {s === 'confirming' && (now || done) && <span className="faint num" style={{ display: 'block' }}>{Math.min(conf, TARGET_CONFIRMATIONS)} of {TARGET_CONFIRMATIONS}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
