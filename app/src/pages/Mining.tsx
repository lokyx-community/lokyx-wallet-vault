import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useActiveAddress } from '../state';
import { Icon, KV, NodeError, Spinner, duration, hashrate } from '../ui';
import { HashRing, Signet } from '../visuals';
import { isAddress } from '../lib/lokyx';
import { isLocalUrl, rpcAt, useNodeUrl, RpcError, type MiningInfo } from '../lib/rpc';

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div style={{ height: 40 }} />;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 200},${38 - (v / max) * 34}`).join(' ');
  return (
    <svg viewBox="0 0 200 40" preserveAspectRatio="none" style={{ width: '100%', maxWidth: 360, height: 40, display: 'block' }} aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--text-2)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Where a node on the visitor's own computer answers (the testnet RPC port). */
const OWN_NODE = 'http://127.0.0.1:28701';

/** Polls one node's mining info. */
function useMiningInfo(url: string) {
  const [data, setData] = useState<MiningInfo>();
  const [error, setError] = useState<RpcError>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const run = () =>
      rpcAt<MiningInfo>(url, 'lyx_getMiningInfo')
        .then((d) => live && (setData(d), setError(undefined)))
        .catch((e) => live && (setData(undefined), setError(e as RpcError)));
    run();
    const t = setInterval(run, 1000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [url, tick]);
  return { data, error, refresh: () => setTick((t) => t + 1) };
}

function MineHere() {
  return (
    <div className="stack" style={{ gap: 28, maxWidth: 660 }}>
      <div className="notice">
        <Icon.mining />
        <p><strong>No miner running on this computer.</strong> Mining happens in the LOKYX program on your own computer, not in the browser. Once it's running, this page connects to it by itself and shows your hash rate and blocks.</p>
      </div>
      <ol className="steps-list">
        <li><Link to="/download" className="link">Download LOKYX</Link> for Windows, Mac or Linux and unpack it.</li>
        <li>Double-click <span className="mono">mine.bat</span> on Windows, or run <span className="mono">./mine.sh</span> on Mac and Linux. The first time it makes you a wallet.</li>
        <li>Come back to this page. If your browser asks whether this site may connect to devices on your network, allow it: that's how the page talks to the miner on your computer.</li>
      </ol>
      <div><Link to="/download" className="btn primary lg">Download LOKYX</Link></div>
    </div>
  );
}

export default function Mining() {
  const active = useActiveAddress();
  const nodeUrl = useNodeUrl();
  // On the public site, show the visitor's own miner, never the website's.
  const url = isLocalUrl(nodeUrl) ? nodeUrl : OWN_NODE;
  const m = useMiningInfo(url);
  const [history, setHistory] = useState<number[]>([]);
  const [coinbase, setCoinbase] = useState('');
  const [threads, setThreads] = useState(1);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (m.data) setHistory((h) => [...h.slice(-119), m.data!.hashrate]);
  }, [m.data]);

  useEffect(() => {
    if (!m.data) return;
    if (!coinbase) setCoinbase(m.data.coinbase ?? active ?? '');
    if (m.data.enabled) setThreads(m.data.threads);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.data?.coinbase, m.data?.enabled, active]);

  const apply = async (enabled: boolean) => {
    setErr('');
    if (enabled && !isAddress(coinbase)) return setErr('Enter the lyx1 address that should receive rewards.');
    setBusy(true);
    try {
      await rpcAt(url, 'lyx_setMining', enabled ? { enabled, threads, coinbase: coinbase.trim() } : { enabled });
      m.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const d = m.data;
  const [hr, unit] = hashrate(d?.hashrate ?? 0);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mining</h1>
          <p>Mine LYX with your computer's processor and watch it here. On Android you can also <Link to="/phone" className="link">mine with your phone</Link>.</p>
        </div>
      </div>

      {m.error && (isLocalUrl(nodeUrl) ? <NodeError error={m.error} /> : <MineHere />)}

      {d && (
        <>
          <div className="mine-stage">
            <div className="stack" style={{ gap: 32 }}>
              {!isLocalUrl(nodeUrl) && <span className="tag" style={{ alignSelf: 'flex-start' }}>The miner on this computer</span>}
              <AnimatePresence mode="wait">
                <motion.p key={!d.enabled ? 'off' : d.waiting ? 'wait' : 'on'} className="muted" style={{ fontSize: 18 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {!d.enabled ? 'Not mining' : d.waiting ? `Waiting out the block spacing · mining resumes in ${Math.max(0, (d.nextBlockDue ?? 0) - (d.now ?? 0))} s` : `Mining on ${d.threads} of ${d.maxThreads} threads`}
                </motion.p>
              </AnimatePresence>
              <div>
                <p className="big-num">{hr}<span style={{ fontSize: '0.32em', marginLeft: 12, letterSpacing: 0, fontWeight: 500 }} className="faint">{unit}</span></p>
                <div style={{ marginTop: 20 }}><Sparkline values={history} /></div>
              </div>

              <div className="stack" style={{ gap: 20, maxWidth: 520 }}>
                <div className="field">
                  <label htmlFor="cb">Rewards go to</label>
                  <div className="input-adorn">
                    <input id="cb" className="input mono" placeholder="lyx1…" spellCheck={false} value={coinbase} onChange={(e) => setCoinbase(e.target.value)} style={{ paddingRight: 56, fontSize: 14 }} />
                    {isAddress(coinbase) && <span className="adorn"><Signet of={coinbase.trim().toLowerCase()} size={30} /></span>}
                  </div>
                  {!active && <p className="hint">No wallet yet? <Link to="/wallet" className="link">Create one</Link> and its address goes here automatically.</p>}
                </div>
                <div className="field">
                  <label>Threads</label>
                  <div className="segmented">
                    {Array.from({ length: d.maxThreads }, (_, i) => i + 1).map((n) => (
                      <button key={n} className={n === threads ? 'on' : ''} onClick={() => setThreads(n)}>
                        {n === threads && <motion.span layoutId="threads" className="seg-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                        <span>{n}</span>
                      </button>
                    ))}
                  </div>
                  <p className="hint">Leave a thread free if you're using the computer.</p>
                </div>
                {err && <p className="error-text">{err}</p>}
                <div className="inline">
                  {!d.enabled ? (
                    <button className="btn primary lg" disabled={busy} onClick={() => apply(true)}>{busy ? <><Spinner />Starting</> : 'Start mining'}</button>
                  ) : (
                    <>
                      <button className="btn lg" disabled={busy} onClick={() => apply(false)}>Stop</button>
                      {threads !== d.threads && <button className="btn primary lg" disabled={busy} onClick={() => apply(true)}>Use {threads} threads</button>}
                    </>
                  )}
                </div>
              </div>
            </div>

            <HashRing
              total={d.hashesTotal}
              running={d.enabled && !d.waiting}
              wait={d.enabled && d.waiting && d.nextBlockDue && d.minBlockSpacing ? { from: d.nextBlockDue - d.minBlockSpacing, until: d.nextBlockDue } : null}
            >
              <div>
                <p className="num" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.04em' }}>{d.hashesTotal.toLocaleString()}</p>
                <p className="faint" style={{ fontSize: 14, marginTop: 4 }}>hashes computed</p>
              </div>
            </HashRing>
          </div>
          <p className="hint" style={{ marginTop: 16 }}>
            One dot per hash. For the first {d.minBlockSpacing ?? 50} seconds after a block nobody can mine the next one, so the ring shows a countdown then.
          </p>

          <div className="split section">
            <section>
              <h2 style={{ marginBottom: 20 }}>Results</h2>
              <KV
                items={[
                  ['Blocks found', <span className="num">{d.blocksFound}</span>],
                  ['Accepted', <span className="num">{d.blocksAcceptedLocally}</span>],
                  ['Lost to a faster block', <span className="num">{d.blocksStale}</span>],
                  ['Rejected', <span className="num">{d.blocksRejected}</span>],
                  ['Last accepted', d.lastAcceptedBlock ? <Link to={`/block/${d.lastAcceptedBlock.height}`} className="link num">Block {d.lastAcceptedBlock.height.toLocaleString()}</Link> : 'None yet'],
                ]}
              />
            </section>
            <section>
              <h2 style={{ marginBottom: 20 }}>Network</h2>
              <KV
                items={[
                  ['Difficulty', <span className="num">{Number(d.networkDifficulty).toLocaleString()}</span>],
                  ['Network hashrate (estimate)', d.networkHashrateEstimate > 0 ? hashrate(d.networkHashrateEstimate).join(' ') : '–'],
                  ['Your share', d.enabled && d.networkHashrateEstimate > 0 ? `${Math.min(100, (d.hashrate / d.networkHashrateEstimate) * 100).toFixed(1)}%` : '–'],
                  ['Average time to find a block', d.expectedSecondsPerBlockAtThisHashrate ? duration(d.expectedSecondsPerBlockAtThisHashrate) : '–'],
                  ['Reward per block', `${d.nextBlockRewardLyx} LYX`],
                ]}
              />
            </section>
          </div>

        </>
      )}
    </>
  );
}
