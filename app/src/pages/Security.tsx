import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useChain, useWallet } from '../state';
import { Copy, Icon, Spinner } from '../ui';
import { Signet } from '../visuals';
import { bytesToHex, shortHash, signCancelRotate, signPqCommit } from '../lib/lokyx';
import { rpc, usePoll, type Account } from '../lib/rpc';
import { deleteVault, markBackedUp, unlockVault } from '../lib/vault';

type Secret = { kind: 'phrase'; value: string } | { kind: 'key'; value: string };

/** Asks for the password, then shows one secret until hidden. Nothing is kept after hiding. */
function Reveal({ kind, label, onShown }: { kind: Secret['kind']; label: string; onShown?: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [secret, setSecret] = useState<Secret | null>(null);

  const go = async () => {
    setErr('');
    setBusy(true);
    try {
      const u = await unlockVault(pw);
      setSecret(kind === 'phrase' ? { kind, value: u.phrase } : { kind, value: bytesToHex(u.secretKey) });
      u.secretKey.fill(0);
      setPw('');
      onShown?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {!secret ? (
        <motion.div key="ask" className="stack" style={{ maxWidth: 440 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="field">
            <label htmlFor={`pw-${kind}`}>Password</label>
            <input id={`pw-${kind}`} className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pw && go()} />
          </div>
          {err && <p className="error-text">{err}</p>}
          <div><button className="btn primary" disabled={!pw || busy} onClick={go}>{busy ? <><Spinner />Checking</> : label}</button></div>
        </motion.div>
      ) : (
        <motion.div key="show" className="stack" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          {secret.kind === 'phrase' ? (
            <ol className="words">
              {secret.value.split(' ').map((w, i) => <li key={i}><span className="n num">{i + 1}</span>{w}</li>)}
            </ol>
          ) : (
            <div className="notice" style={{ wordBreak: 'break-all' }}>
              <Copy text={secret.value} />
            </div>
          )}
          <div><button className="btn" onClick={() => setSecret(null)}>Hide</button></div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function Security() {
  const { stored, unlocked, setUnlocked, reload } = useWallet();
  const [confirmDelete, setConfirmDelete] = useState('');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Security and backup</h1>
          <p>Your wallet lives in this browser, locked with your password. If you clear the browser's storage or lose the device, the recovery phrase is the only way back.</p>
        </div>
      </div>

      {!stored ? (
        <div className="empty">
          <p>There's no wallet on this device.</p>
          <Link className="btn primary" to="/wallet">Create or restore a wallet</Link>
        </div>
      ) : (
        <div className="split">
          <section className="stack" style={{ gap: 28 }}>
            <div className="identity">
              <Signet of={stored.address} size={56} />
              <div style={{ minWidth: 0 }}>
                <p className="mono" style={{ wordBreak: 'break-all' }}>{stored.address}</p>
                <p className="hint">Created {new Date(stored.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
            <dl className="kv">
              <div><dt>Recovery phrase</dt><dd>{stored.backedUp ? <span className="tag solid">Backed up</span> : <span className="tag">Not backed up</span>}</dd></div>
              <div><dt>Wallet</dt><dd>{unlocked ? 'Unlocked, locks after 15 minutes idle' : 'Locked'}</dd></div>
              <div><dt>Encryption</dt><dd>XChaCha20-Poly1305, Argon2id key</dd></div>
            </dl>
            {unlocked && <div><button className="btn" onClick={() => setUnlocked(null)}>Lock now</button></div>}

            <div className="stack" style={{ marginTop: 24 }}>
              <h2>Recovery phrase</h2>
              <p className="muted">The 24 words that rebuild this wallet anywhere. Make sure nobody can see your screen.</p>
              <Reveal kind="phrase" label="Show phrase" onShown={() => { if (!stored.backedUp) { markBackedUp(); reload(); } }} />
            </div>

            <div className="stack" style={{ marginTop: 24 }}>
              <h2>Private key</h2>
              <p className="muted">
                The key for this one address, worked out from your phrase. Only needed for importing this address somewhere else.
              </p>
              <Reveal kind="key" label="Show private key" />
            </div>
          </section>

          <section className="stack" style={{ gap: 28 }}>
            <QuantumKey address={stored.address} />

            <KeyRotation address={stored.address} />

            <div className="stack">
              <h2>Good habits</h2>
              <ul className="plain-list">
                <li>Keep the recovery phrase on paper, somewhere only you can get to. The private key needs the same care.</li>
                <li>Nobody from LOKYX will ever ask for either. Anyone who does is trying to take your coins.</li>
                <li>Before sending, compare the ring next to the address with the one the recipient sees.</li>
                <li>LOKYX is in testing and hasn't been audited. Don't reuse a phrase that protects real money.</li>
              </ul>
            </div>

            <div className="stack" style={{ marginTop: 24 }}>
              <h2>Remove from this device</h2>
              <p className="muted">Deletes the locked wallet from this browser. Your coins stay on the chain, and you can restore them later with the recovery phrase.</p>
              <div className="field" style={{ maxWidth: 440 }}>
                <label htmlFor="del">Type remove to confirm</label>
                <input id="del" className="input" value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} />
              </div>
              <div>
                <button className="btn" disabled={confirmDelete.trim().toLowerCase() !== 'remove'}
                  onClick={() => { setUnlocked(null); deleteVault(); reload(); setConfirmDelete(''); }}>
                  <Icon.alert />Remove wallet
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

/** What to say to anyone thinking about rotating a key. */
export const KEY_THEFT_NOTICE = "Key stolen? Rotation won't save your funds. Sweep your vault or move your funds now.";

function KeyRotation({ address }: { address: string }) {
  const { unlocked } = useWallet();
  const { info } = useChain();
  const acct = usePoll<Account>('lyx_getAccount', { address }, 15000, info?.height);
  const [state, setState] = useState<'idle' | 'working' | 'sent'>('idle');
  const [err, setErr] = useState('');
  const pending = acct.data?.pendingRotation;
  const rotated = acct.data?.controller && acct.data.controller !== address;
  const cancel = async () => {
    if (!unlocked || !info) return;
    setErr('');
    setState('working');
    try {
      const a = await rpc<{ pendingNonce: number }>('lyx_getAccount', { address });
      const t = signCancelRotate(address, { chainId: BigInt(info.chainId), nonce: BigInt(a.pendingNonce) }, unlocked.secretKey);
      await rpc('lyx_sendRawTransaction', { tx: bytesToHex(t.bytes) });
      setState('sent');
    } catch (e) {
      setErr((e as Error).message);
      setState('idle');
    }
  };
  return (
    <div className="stack">
      <h2>Key rotation</h2>
      <p className="muted">
        An account can be handed to a new key after a delay, and the old key can cancel until then. Rotation is for planned key
        changes and lost devices.
      </p>
      <p className="hint"><strong>{KEY_THEFT_NOTICE}</strong></p>
      {rotated ? (
        <p className="muted">This account is controlled by another key now: <span className="mono">{shortHash(acct.data!.controller!, 10, 6)}</span>.</p>
      ) : pending ? (
        <>
          <p className="muted">
            A rotation to <span className="mono">{shortHash(pending.newKey, 10, 6)}</span> takes effect at block {pending.releaseHeight}.
          </p>
          {state === 'sent' ? (
            <p className="muted">Cancel sent. It's final once the next block is mined.</p>
          ) : !unlocked ? (
            <p className="hint">Unlock your wallet to cancel it.</p>
          ) : (
            <div><button className="btn" disabled={state === 'working'} onClick={cancel}>{state === 'working' ? <><Spinner />Sending</> : 'Cancel the rotation'}</button></div>
          )}
          {err && <p className="error-text">{err}</p>}
        </>
      ) : (
        <p className="hint">To rotate, use the command-line wallet: <span className="mono">lokyx-wallet rotate --new-key &lt;address&gt;</span>.</p>
      )}
    </div>
  );
}

function QuantumKey({ address }: { address: string }) {
  const { unlocked } = useWallet();
  const { info } = useChain();
  const acct = usePoll<Account>('lyx_getAccount', { address }, 15000, info?.height);
  const [state, setState] = useState<'idle' | 'working' | 'sent'>('idle');
  const [err, setErr] = useState('');
  const commit = acct.data?.pqCommit;
  const turnOn = async () => {
    if (!unlocked || !info) return;
    setErr('');
    setState('working');
    try {
      // let the button repaint before the key generation (a second or two) blocks the page
      await new Promise((r) => setTimeout(r, 50));
      const { pqCommitment } = await import('../lib/pq');
      const hash = pqCommitment(unlocked.phrase);
      const a = await rpc<{ pendingNonce: number }>('lyx_getAccount', { address });
      const t = signPqCommit(hash, BigInt(info.chainId), BigInt(a.pendingNonce), unlocked.secretKey);
      await rpc('lyx_sendRawTransaction', { tx: bytesToHex(t.bytes) });
      setState('sent');
    } catch (e) {
      setErr((e as Error).message);
      setState('idle');
    }
  };
  return (
    <div className="stack">
      <h2>Quantum backup key</h2>
      <p className="muted">
        If quantum computers ever break the signatures every blockchain uses today, accounts with a backup key can move over to it.
        The key comes from your recovery phrase, so there's nothing new to write down, and only a fingerprint of it goes on the chain.
      </p>
      {commit ? (
        <p><span className="tag solid">On</span> <span className="mono faint" style={{ marginLeft: 8 }}>{shortHash(commit, 10, 6)}</span></p>
      ) : state === 'sent' ? (
        <p className="muted">Sent. It's on once the next block is mined.</p>
      ) : (
        <>
          <p className="hint">Costs one normal fee. It can't be changed afterwards, so someone who steals your wallet can't replace it.</p>
          {!unlocked ? (
            <p className="hint">Unlock your wallet to turn it on.</p>
          ) : acct.data && BigInt(acct.data.balance) === 0n ? (
            <p className="hint">You need a little LYX for the fee first.</p>
          ) : (
            <div><button className="btn" disabled={state === 'working'} onClick={turnOn}>{state === 'working' ? <><Spinner />Making the key</> : 'Turn it on'}</button></div>
          )}
          {err && <p className="error-text">{err}</p>}
        </>
      )}
    </div>
  );
}
