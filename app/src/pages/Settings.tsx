import { useState } from 'react';
import { motion } from 'motion/react';
import { applyTheme, savedTheme, useChain, type Theme } from '../state';
import { NODE_PRESETS, setNodeUrl, useNodeUrl, rpc, type ChainInfo } from '../lib/rpc';
import { Spinner } from '../ui';

export default function Settings() {
  const current = useNodeUrl();
  const { info } = useChain();
  const [url, setUrl] = useState(current);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<Theme>(savedTheme);

  const connect = async (target = url) => {
    setBusy(true);
    setStatus(null);
    const before = current;
    setNodeUrl(target);
    setUrl(target);
    try {
      const i = await rpc<ChainInfo>('lyx_chainInfo');
      setStatus({ ok: true, text: `Connected to ${i.network} at block ${i.height.toLocaleString()}.` });
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
      setNodeUrl(before);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head"><div><h1>Settings</h1></div></div>
      <div className="stack" style={{ maxWidth: 620, gap: 72 }}>
        <section className="stack">
          <h2>Node</h2>
          <p className="muted">The app reads everything from this node and sends your signed transactions through it. Use one you run yourself or trust.</p>
          <div className="field">
            <label htmlFor="node">Node address</label>
            <input id="node" className="input mono" value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && connect()} />
          </div>
          <div className="inline">
            <button className="btn primary" disabled={busy} onClick={() => connect()}>{busy ? <><Spinner />Connecting</> : 'Connect'}</button>
            {NODE_PRESETS.filter((p) => p.url !== url).map((p) => (
              <button key={p.url} className="btn quiet" onClick={() => connect(p.url)}>{p.label}</button>
            ))}
          </div>
          {status && <p className={status.ok ? 'hint' : 'error-text'}>{status.text}</p>}
          {info && <p className="hint">Chain ID {info.chainId}, {info.version}.</p>}
        </section>

        <section className="stack">
          <h2>Appearance</h2>
          <div className="segmented">
            {(['system', 'dark', 'light'] as Theme[]).map((t) => (
              <button key={t} className={theme === t ? 'on' : ''} onClick={() => { setTheme(t); applyTheme(t); }}>
                {theme === t && <motion.span layoutId="theme" className="seg-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <span>{t === 'system' ? 'Automatic' : t === 'dark' ? 'Dark' : 'Light'}</span>
              </button>
            ))}
          </div>
          <p className="hint">Motion follows your device's reduced-motion setting.</p>
        </section>
      </div>
    </>
  );
}
