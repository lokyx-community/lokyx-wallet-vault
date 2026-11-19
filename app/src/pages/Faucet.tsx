import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useActiveAddress, useChain } from '../state';
import { Icon, Spinner } from '../ui';
import { Signet } from '../visuals';
import { isAddress, shortHash } from '../lib/lokyx';
import { FAUCET_URL } from '../lib/rpc';

interface Info {
  network: string;
  address: string;
  balanceLyx: string;
  amountLyx: string;
  cooldownHours: number;
}

export default function Faucet() {
  const { info } = useChain();
  const active = useActiveAddress();
  const [faucet, setFaucet] = useState<Info | null>(null);
  const [down, setDown] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<{ txHash: string; amountLyx: string } | null>(null);

  useEffect(() => {
    if (active && !to) setTo(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${FAUCET_URL}/info`)
        .then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          if (j.error) setDown(j.error);
          else {
            setFaucet(j);
            setDown('');
          }
        })
        .catch(() => alive && setDown("The faucet isn't reachable right now."));
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const claim = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await fetch(`${FAUCET_URL}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: to.trim() }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Faucet answered ${r.status}`);
      setSent(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (info && info.network !== 'testnet' && info.network !== 'devnet')
    return <div className="page-head"><div><h1>Faucet</h1><p>Faucets only exist on test networks.</p></div></div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Faucet</h1>
          <p>Free test LYX so you can try sending and receiving. {faucet ? `${faucet.amountLyx} LYX per address, once every ${faucet.cooldownHours} hours.` : ''} Test coins have no value.</p>
        </div>
      </div>

      {down && !faucet && (
        <div className="notice" style={{ maxWidth: 620 }}>
          <Icon.plug />
          <p><strong>{down}</strong> You can still get test LYX by <Link to="/mining" className="link">mining</Link>.</p>
        </div>
      )}

      <AnimatePresence mode="wait">
        {sent ? (
          <motion.div key="done" className="stack" style={{ maxWidth: 560, gap: 28 }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="identity">
              <Signet of={to.trim().toLowerCase()} size={72} />
              <div>
                <h2>{sent.amountLyx} LYX is on its way</h2>
                <p className="muted" style={{ marginTop: 8 }}>It will show up in the wallet once the next block is mined.</p>
              </div>
            </div>
            <div className="inline">
              <Link to={`/tx/${sent.txHash}`} className="btn primary">Follow the transaction</Link>
              {active && <Link to="/wallet" className="btn">Open wallet</Link>}
            </div>
            <p className="hint mono">{shortHash(sent.txHash, 14, 10)}</p>
          </motion.div>
        ) : (
          <motion.div key="form" className="stack" style={{ maxWidth: 560, gap: 24 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="field">
              <label htmlFor="fto">Send to</label>
              <div className="input-adorn">
                <input id="fto" className="input mono" placeholder="lyx1…" spellCheck={false} value={to} onChange={(e) => setTo(e.target.value)} style={{ paddingRight: 56, fontSize: 14 }} />
                {isAddress(to) && <span className="adorn"><Signet of={to.trim().toLowerCase()} size={30} /></span>}
              </div>
              {!active && <p className="hint">No wallet yet? <Link to="/wallet" className="link">Create one</Link> first.</p>}
            </div>
            {err && <p className="error-text">{err}</p>}
            <div>
              <button className="btn primary lg" disabled={!faucet || !isAddress(to) || busy} onClick={claim}>
                {busy ? <><Spinner />Sending</> : `Get ${faucet?.amountLyx ?? ''} test LYX`}
              </button>
            </div>
            {faucet && <p className="hint">The faucet holds {faucet.balanceLyx} LYX, all of it mined. Address <span className="mono">{shortHash(faucet.address, 10, 6)}</span>.</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
