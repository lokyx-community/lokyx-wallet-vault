import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { useChain, useWallet } from '../state';
import { AddressLink, Icon, KV, Spinner, duration } from '../ui';
import {
  addressFromPrivateKey, bytesToHex, deriveKey, formatLyx, hexToBytes, isAddress, isMnemonic, newShortMnemonic,
  normalizeMnemonic, parseLyx, shortHash, signVault, type VaultOp, type VaultSettings,
} from '../lib/lokyx';
import { rpc, usePoll, type Account, type ChainInfo, type PendingInfo, type VaultInfo, type VaultSettingsInfo } from '../lib/rpc';
import { UnlockInline } from './Swap';

const DELAYS: [string, number][] = [['1 hour', 3600], ['1 day', 86400], ['3 days', 3 * 86400], ['1 week', 7 * 86400]];
const HEIR_WAITS: [string, number][] = [['6 months', 182 * 86400], ['1 year', 365 * 86400]];

const blocksFor = (secs: number, info: ChainInfo) => BigInt(Math.ceil(secs / info.targetBlockTime));
const inTime = (blocks: number, info: ChainInfo) => duration(Math.max(0, blocks) * info.targetBlockTime);

async function send(op: VaultOp, sk: Uint8Array, info: ChainInfo): Promise<string> {
  const me = addressFromPrivateKey(sk);
  const acct = await rpc<{ pendingNonce: number }>('lyx_getAccount', { address: me });
  const t = signVault(op, BigInt(info.chainId), BigInt(acct.pendingNonce), sk);
  return rpc<string>('lyx_sendRawTransaction', { tx: bytesToHex(t.bytes) });
}

/** The recovery phrase gives two addresses: index 0 is the safe address (restore the phrase as a
 *  normal wallet to spend from it), index 1 signs cancels and sweeps. */
function recoveryKeys(phrase: string) {
  const safeKey = deriveKey(phrase, 0);
  const recKey = deriveKey(phrase, 1);
  return { safe: addressFromPrivateKey(safeKey), recovery: addressFromPrivateKey(recKey), recKey };
}

export default function VaultPage() {
  const { info } = useChain();
  const { stored, unlocked } = useWallet();
  const [recoveryMode, setRecoveryMode] = useState(false);
  const acct = usePoll<Account>('lyx_getAccount', unlocked ? { address: unlocked.address } : null, 5000, info?.height);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Vault</h1>
          <p>Coins in a vault leave slowly. Someone who steals your wallet gets at most one day's allowance, and you can stop the rest.</p>
        </div>
      </div>

      {recoveryMode ? (
        info && <RecoveryMode info={info} back={() => setRecoveryMode(false)} />
      ) : (
        <div className="stack" style={{ gap: 56 }}>
          {!stored ? (
            <div className="notice" style={{ maxWidth: 620 }}>
              <Icon.wallet />
              <p><strong>Vaults use the wallet in this browser.</strong> <Link to="/wallet" className="link">Create or restore one</Link> first.</p>
            </div>
          ) : !unlocked ? (
            <UnlockInline text="Unlock your wallet to see your vault." />
          ) : !info || !acct.data ? (
            <Spinner />
          ) : acct.data.vault ? (
            <Manage info={info} acct={acct.data} vault={acct.data.vault} sk={unlocked.secretKey} />
          ) : (
            <Setup info={info} acct={acct.data} sk={unlocked.secretKey} />
          )}

          {unlocked && acct.data && acct.data.heirOf.length > 0 && info && (
            <Heir info={info} vaults={acct.data.heirOf} sk={unlocked.secretKey} />
          )}

          <section className="stack" style={{ maxWidth: 620, gap: 12 }}>
            <h2>Lost your wallet, or someone else has it?</h2>
            <p className="muted">With the vault's 12-word recovery phrase you can cancel withdrawals and move everything to your safe address. This works on any device, without the wallet.</p>
            <div><button className="btn" onClick={() => setRecoveryMode(true)}>Use a recovery phrase</button></div>
          </section>
        </div>
      )}
    </>
  );
}

// ---------- setting one up ----------

function Setup({ info, acct, sk }: { info: ChainInfo; acct: Account; sk: Uint8Array }) {
  const [step, setStep] = useState<'intro' | 'phrase' | 'check' | 'settings' | 'done'>('intro');
  const phrase = useMemo(() => newShortMnemonic(), []);
  const keys = useMemo(() => recoveryKeys(phrase), [phrase]);
  const ask = useMemo(() => [2, 8].map((i) => i + Math.floor(Math.random() * 3)), []);
  const [answers, setAnswers] = useState(['', '']);
  const words = phrase.split(' ');
  const checked = ask.every((i, k) => answers[k].trim().toLowerCase() === words[i]);

  if (step === 'done') {
    return <p className="muted">Sent. Your account becomes a vault in the next block.</p>;
  }
  return (
    <div className="stack" style={{ maxWidth: 660, gap: 28 }}>
      {step === 'intro' && (
        <>
          <ol className="steps-list">
            <li><strong>A daily allowance.</strong> Normal spending works as it does now, up to a limit you choose.</li>
            <li><strong>Bigger amounts wait.</strong> Anything above it arrives after a delay, and you see it coming.</li>
            <li><strong>A recovery phrase.</strong> 12 words on paper that can cancel a withdrawal or move everything to safety.</li>
          </ol>
          {BigInt(acct.balance) === 0n && <p className="hint">You'll need a little LYX for the fee.</p>}
          <div><button className="btn primary lg" onClick={() => setStep('phrase')}>Set up a vault</button></div>
        </>
      )}
      {step === 'phrase' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="stack" style={{ gap: 24 }}>
          <h2>Your recovery phrase</h2>
          <p className="muted">Write these 12 words on paper and keep them somewhere other than your phone or computer. This app doesn't store them.</p>
          <ol className="words">
            {words.map((w, i) => <li key={i}><span className="n num">{i + 1}</span>{w}</li>)}
          </ol>
          <div className="notice">
            <Icon.security />
            <p><strong>Treat this like cash.</strong> The recovery phrase can move everything in the vault to your safe address, and the safe address is controlled by the same 12 words.</p>
          </div>
          <div><button className="btn primary lg" onClick={() => setStep('check')}>I've written them down</button></div>
        </motion.div>
      )}
      {step === 'check' && (
        <div className="stack" style={{ gap: 20 }}>
          <h2>Check your copy</h2>
          {ask.map((i, k) => (
            <div className="field" key={i}>
              <label htmlFor={'w' + k}>Word {i + 1}</label>
              <input id={'w' + k} className="input mono" autoComplete="off" spellCheck={false} value={answers[k]}
                onChange={(e) => setAnswers(answers.map((a, j) => (j === k ? e.target.value : a)))} />
            </div>
          ))}
          <div className="inline">
            <button className="btn primary lg" disabled={!checked} onClick={() => setStep('settings')}>Continue</button>
            <button className="link" onClick={() => setStep('phrase')}>Show the words again</button>
          </div>
        </div>
      )}
      {step === 'settings' && (
        <SettingsForm info={info} recovery={keys.recovery} defaultSafe={keys.safe} submitLabel="Create vault"
          onSubmit={async (s) => { await send({ kind: 'create', settings: s }, sk, info); setStep('done'); }} />
      )}
    </div>
  );
}

function SettingsForm({ info, recovery, defaultSafe, current, submitLabel, onSubmit }: {
  info: ChainInfo; recovery: string; defaultSafe: string; current?: VaultSettingsInfo; submitLabel: string;
  onSubmit: (s: VaultSettings) => Promise<void>;
}) {
  const curDelay = current ? DELAYS.find(([, s]) => Number(blocksFor(s, info)) === current.delayBlocks)?.[1] : undefined;
  const [delay, setDelay] = useState(curDelay ?? 86400);
  const [allowance, setAllowance] = useState(current ? current.allowanceLyx.replace(/,/g, '') : '50');
  const [advanced, setAdvanced] = useState(false);
  const [safe, setSafe] = useState(current?.safe ?? defaultSafe);
  const [heir, setHeir] = useState(current?.heir?.address ?? '');
  const [heirWait, setHeirWait] = useState(
    current?.heir ? HEIR_WAITS.find(([, s]) => Number(blocksFor(s, info)) === current.heir!.inactiveBlocks)?.[1] ?? HEIR_WAITS[1][1] : HEIR_WAITS[1][1],
  );
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setErr('');
    try {
      const a = parseLyx(allowance);
      if (!isAddress(safe)) throw new Error('The safe address is not a valid lyx1 address');
      if (heir && !isAddress(heir)) throw new Error("The heir's address is not a valid lyx1 address");
      setBusy(true);
      await onSubmit({
        recovery, safe, delay: blocksFor(delay, info), allowance: a,
        heir: heir ? { address: heir, inactiveBlocks: blocksFor(heirWait, info) } : null,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="field">
        <label htmlFor="al">Daily allowance (LYX)</label>
        <input id="al" className="input num" inputMode="decimal" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
        <p className="hint">Can be spent any day without waiting. Keep it to what you'd carry in a wallet.</p>
      </div>
      <div className="field">
        <label>Bigger withdrawals wait</label>
        <div className="segmented">
          {DELAYS.map(([t, s]) => (
            <button key={s} className={delay === s ? 'on' : ''} onClick={() => setDelay(s)}>
              {delay === s && <motion.span layoutId="delay" className="seg-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <span>{t}</span>
            </button>
          ))}
        </div>
        <p className="hint">That's how long you have to notice and cancel one you didn't make.</p>
      </div>
      <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced(!advanced)}>{advanced ? 'Hide' : 'More options'}</button>
      {advanced && (
        <div className="stack" style={{ gap: 24 }}>
          <div className="field">
            <label htmlFor="sf">Safe address</label>
            <input id="sf" className="input mono" spellCheck={false} value={safe} onChange={(e) => setSafe(e.target.value.trim())} />
            <p className="hint">Where the recovery phrase moves everything. By default it belongs to the recovery phrase. Use an address from a separate wallet and the recovery phrase alone can't spend anything.</p>
          </div>
          <div className="field">
            <label htmlFor="hr">Heir (optional)</label>
            <input id="hr" className="input mono" spellCheck={false} placeholder="lyx1…" value={heir} onChange={(e) => setHeir(e.target.value.trim())} />
          </div>
          {heir && (
            <div className="field">
              <label>Heir can claim after no activity for</label>
              <div className="segmented">
                {HEIR_WAITS.map(([t, s]) => (
                  <button key={s} className={heirWait === s ? 'on' : ''} onClick={() => setHeirWait(s)}>
                    {heirWait === s && <motion.span layoutId="heirwait" className="seg-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                    <span>{t}</span>
                  </button>
                ))}
              </div>
              <p className="hint">Their claim still waits out the delay, so you can cancel it if you're around.</p>
            </div>
          )}
        </div>
      )}
      {err && <p className="error-text">{err}</p>}
      <div><button className="btn primary lg" disabled={busy} onClick={go}>{busy ? <><Spinner />Sending</> : submitLabel}</button></div>
    </div>
  );
}

// ---------- an existing vault ----------

function Manage({ info, acct, vault, sk }: { info: ChainInfo; acct: Account; vault: VaultInfo; sk: Uint8Array }) {
  const [view, setView] = useState<'main' | 'withdraw' | 'settings'>('main');
  const s = vault.settings;
  const next = info.height + 1;
  const left = BigInt(vault.allowanceLeft);

  if (view === 'withdraw') return <Withdraw info={info} acct={acct} vault={vault} sk={sk} back={() => setView('main')} />;
  if (view === 'settings') {
    return (
      <div className="stack" style={{ maxWidth: 660, gap: 24 }}>
        <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setView('main')}>← Back</button>
        <p className="muted">Changes take effect after {inTime(s.delayBlocks, info)}. The recovery key stays the same.</p>
        <SettingsForm info={info} recovery={s.recovery} defaultSafe={s.safe} current={s} submitLabel="Save changes"
          onSubmit={async (n) => { await send({ kind: 'update', settings: n }, sk, info); setView('main'); }} />
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 48 }}>
      <div>
        <p className="muted" style={{ fontSize: 18, marginBottom: 12 }}>Can leave today</p>
        <p className="big-num">
          {formatLyx(left, 4)}
          <span style={{ fontSize: '0.32em', fontWeight: 500, marginLeft: 12, letterSpacing: 0 }} className="faint">of {s.allowanceLyx} LYX</span>
        </p>
        <p className="muted" style={{ marginTop: 12 }}>
          Balance {formatLyx(acct.balance, 4)} LYX. Resets in about {inTime(vault.dayResetsAt - next, info)}.
        </p>
      </div>
      <div className="inline">
        <button className="btn primary lg" onClick={() => setView('withdraw')}>Withdraw more</button>
        <button className="btn lg" onClick={() => setView('settings')}>Change settings</button>
      </div>

      <section className="stack" style={{ gap: 16 }}>
        <h2>Waiting</h2>
        {vault.pending.length === 0 ? (
          <p className="muted">Nothing. Withdrawals and changes show up here until they go through.</p>
        ) : (
          vault.pending.map((x) => <PendingRow key={x.id} x={x} info={info} cancel={() => send({ kind: 'cancel', id: hexToBytes(x.id) }, sk, info)} />)
        )}
        <p className="hint">If you see something here you didn't do, cancel it, then use your recovery phrase.</p>
      </section>

      <section className="stack" style={{ gap: 16, maxWidth: 760 }}>
        <h2>Settings</h2>
        <SettingsKV s={s} info={info} />
        <CloseVault info={info} sk={sk} delayBlocks={s.delayBlocks} />
      </section>
    </div>
  );
}

function SettingsKV({ s, info }: { s: VaultSettingsInfo; info: ChainInfo }) {
  return (
    <KV
      items={[
        ['Daily allowance', `${s.allowanceLyx} LYX`],
        ['Bigger withdrawals wait', inTime(s.delayBlocks, info)],
        ['Recovery key', <AddressLink address={s.recovery} mark />],
        ['Safe address', <AddressLink address={s.safe} mark />],
        ['Heir', s.heir ? <span><AddressLink address={s.heir.address} mark /> <span className="faint">after {inTime(s.heir.inactiveBlocks, info)} inactive</span></span> : 'None'],
      ]}
    />
  );
}

function PendingRow({ x, info, cancel, label = 'Cancel' }: { x: PendingInfo; info: ChainInfo; cancel?: () => Promise<string>; label?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [err, setErr] = useState('');
  const what =
    x.kind === 'withdraw' ? <>{x.amountLyx} LYX to <AddressLink address={x.to!} mark /></>
    : x.kind === 'update' ? 'Settings change'
    : 'Closing the vault';
  return (
    <div className="pending-row">
      <div className="stack" style={{ gap: 4 }}>
        <span>{what}{x.byHeir && <span className="tag" style={{ marginLeft: 8 }}>started by the heir</span>}</span>
        <span className="faint" style={{ fontSize: 14 }}>
          Goes through in about {inTime(x.releaseHeight - info.height, info)} (block {x.releaseHeight.toLocaleString()}) · <Link to={`/tx/${x.id}`} className="link mono">{shortHash(x.id, 6, 4)}</Link>
        </span>
        {err && <span className="error-text">{err}</span>}
      </div>
      {cancel && (
        state === 'sent' ? <span className="muted">Cancelling</span> : (
          <button className="btn" disabled={state === 'busy'} onClick={async () => {
            setState('busy');
            setErr('');
            try { await cancel(); setState('sent'); } catch (e) { setErr((e as Error).message); setState('idle'); }
          }}>{state === 'busy' ? <Spinner /> : label}</button>
        )
      )}
    </div>
  );
}

function Withdraw({ info, acct, vault, sk, back }: { info: ChainInfo; acct: Account; vault: VaultInfo; sk: Uint8Array; back: () => void }) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setErr('');
    try {
      if (!isAddress(to)) throw new Error('Enter a valid lyx1 address');
      const a = parseLyx(amount);
      if (a <= 0n) throw new Error('Enter an amount');
      if (a > BigInt(acct.balance)) throw new Error(`You have ${formatLyx(acct.balance)} LYX`);
      setBusy(true);
      await send({ kind: 'withdraw', to, amount: a }, sk, info);
      back();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ maxWidth: 560, gap: 24 }}>
      <button className="link" style={{ alignSelf: 'flex-start' }} onClick={back}>← Back</button>
      <div className="field">
        <label htmlFor="wt">To</label>
        <input id="wt" className="input mono" spellCheck={false} placeholder="lyx1…" value={to} onChange={(e) => setTo(e.target.value.trim())} />
      </div>
      <div className="field">
        <label htmlFor="wa">Amount (LYX)</label>
        <input id="wa" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <p className="hint">It arrives in about {inTime(vault.settings.delayBlocks, info)}. Until then you can cancel it here, or with your recovery phrase.</p>
      {err && <p className="error-text">{err}</p>}
      <div><button className="btn primary lg" disabled={busy || !to || !amount} onClick={go}>{busy ? <><Spinner />Sending</> : 'Start withdrawal'}</button></div>
    </div>
  );
}

function CloseVault({ info, sk, delayBlocks }: { info: ChainInfo; sk: Uint8Array; delayBlocks: number }) {
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="stack" style={{ gap: 8, marginTop: 8 }}>
      {!sure ? (
        <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setSure(true)}>Close the vault</button>
      ) : (
        <>
          <p className="muted">Your account goes back to normal after {inTime(delayBlocks, info)}. You can cancel that until then.</p>
          <div className="inline">
            <button className="btn" onClick={async () => { try { await send({ kind: 'close' }, sk, info); setSure(false); } catch (e) { setErr((e as Error).message); } }}>Close it</button>
            <button className="link" onClick={() => setSure(false)}>Keep it</button>
          </div>
        </>
      )}
      {err && <p className="error-text">{err}</p>}
    </div>
  );
}

// ---------- recovery phrase ----------

function RecoveryMode({ info, back }: { info: ChainInfo; back: () => void }) {
  const [words, setWords] = useState('');
  const keys = useMemo(() => {
    const p = normalizeMnemonic(words);
    return p.split(' ').length === 12 && isMnemonic(p) ? recoveryKeys(p) : null;
  }, [words]);
  const rec = usePoll<Account>('lyx_getAccount', keys ? { address: keys.recovery } : null, 5000, info.height);

  return (
    <div className="stack" style={{ gap: 32, maxWidth: 760 }}>
      <button className="link" style={{ alignSelf: 'flex-start' }} onClick={back}>← Back</button>
      <div className="field" style={{ maxWidth: 620 }}>
        <label htmlFor="rp">Recovery phrase</label>
        <textarea id="rp" className="input mono" rows={3} autoComplete="off" spellCheck={false} placeholder="12 words" value={words} onChange={(e) => setWords(e.target.value)} />
        <p className="hint">Only used on this page, never stored.</p>
      </div>
      {words && !keys && <p className="muted">Waiting for 12 valid words.</p>}
      {keys && rec.data && rec.data.recoveryFor.length === 0 && (
        <p className="muted">This phrase isn't the recovery key for any vault.</p>
      )}
      {keys && rec.data?.recoveryFor.map((v) => <Rescue key={v} vault={v} info={info} recKey={keys.recKey} />)}
    </div>
  );
}

function Rescue({ vault, info, recKey }: { vault: string; info: ChainInfo; recKey: Uint8Array }) {
  const acct = usePoll<Account>('lyx_getAccount', { address: vault }, 5000, info.height);
  const [sure, setSure] = useState(false);
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [err, setErr] = useState('');
  const v = acct.data?.vault;
  if (!acct.data || !v) return null;
  const pendingOut = v.pending.reduce((s, x) => s + BigInt(x.amount ?? '0'), 0n);
  const total = BigInt(acct.data.balance) + pendingOut;
  return (
    <section className="stack" style={{ gap: 20 }}>
      <h2>Vault <span className="mono" style={{ fontWeight: 400 }}>{shortHash(vault, 10, 6)}</span></h2>
      <KV items={[['In the vault', `${formatLyx(acct.data.balance, 4)} LYX`], ['Waiting to leave', `${formatLyx(pendingOut, 4)} LYX`], ['Safe address', <AddressLink address={v.settings.safe} mark />]]} />
      {v.pending.map((x) => (
        <PendingRow key={x.id} x={x} info={info} cancel={() => send({ kind: 'cancel', id: hexToBytes(x.id) }, recKey, info)} />
      ))}
      {state === 'sent' ? (
        <p className="muted">Sent. Everything moves to the safe address in the next block.</p>
      ) : !sure ? (
        <div><button className="btn primary lg" disabled={total === 0n} onClick={() => setSure(true)}>Move everything to safety</button></div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <p>Move {formatLyx(total, 4)} LYX, including anything waiting to leave, to {shortHash(v.settings.safe, 10, 6)} now?</p>
          <div className="inline">
            <button className="btn primary lg" disabled={state === 'busy'} onClick={async () => {
              setState('busy');
              setErr('');
              try { await send({ kind: 'sweep', vault }, recKey, info); setState('sent'); } catch (e) { setErr((e as Error).message); setState('idle'); }
            }}>{state === 'busy' ? <><Spinner />Sending</> : 'Yes, move it'}</button>
            <button className="link" onClick={() => setSure(false)}>Not now</button>
          </div>
        </div>
      )}
      {err && <p className="error-text">{err}</p>}
      <p className="hint">To spend from the safe address, restore this recovery phrase as a wallet.</p>
    </section>
  );
}

// ---------- heirs ----------

function Heir({ info, vaults, sk }: { info: ChainInfo; vaults: string[]; sk: Uint8Array }) {
  return (
    <section className="stack" style={{ gap: 20, maxWidth: 760 }}>
      <h2>You're an heir</h2>
      {vaults.map((v) => <HeirRow key={v} vault={v} info={info} sk={sk} />)}
    </section>
  );
}

function HeirRow({ vault, info, sk }: { vault: string; info: ChainInfo; sk: Uint8Array }) {
  const v = usePoll<VaultInfo | null>('lyx_getVault', { address: vault }, 15000, info.height);
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [err, setErr] = useState('');
  if (!v.data || v.data.heirCanClaimFrom == null) return null;
  const from = v.data.heirCanClaimFrom;
  const ready = info.height + 1 >= from;
  return (
    <div className="pending-row">
      <div className="stack" style={{ gap: 4 }}>
        <AddressLink address={vault} mark />
        <span className="faint" style={{ fontSize: 14 }}>
          {ready ? 'The owner has been inactive long enough. A claim still waits out the vault\'s delay.' : `You can claim from block ${from.toLocaleString()}, about ${inTime(from - info.height, info)} from now, if the owner stays inactive.`}
        </span>
        {err && <span className="error-text">{err}</span>}
      </div>
      {ready && (state === 'sent' ? <span className="muted">Claim sent</span> : (
        <button className="btn" disabled={state === 'busy'} onClick={async () => {
          setState('busy');
          setErr('');
          try { await send({ kind: 'heirClaim', vault }, sk, info); setState('sent'); } catch (e) { setErr((e as Error).message); setState('idle'); }
        }}>{state === 'busy' ? <Spinner /> : 'Claim'}</button>
      ))}
    </div>
  );
}
