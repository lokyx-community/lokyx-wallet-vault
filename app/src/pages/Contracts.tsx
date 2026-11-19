import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useChain, useWallet } from '../state';
import { AddressLink, Icon, KV, Spinner } from '../ui';
import { addressFromPrivateKey, bytesToHex, isAddress, parseLyx, shortHash, signContract, type ContractOp } from '../lib/lokyx';
import { rpc, type AbiMethod, type AbiParam, type ChainInfo, type ContractInfo, type ContractLog, type GasEstimate, type RunResult, type TxInfo } from '../lib/rpc';
import { UnlockInline } from './Swap';

/** What someone typed into an argument box, as the JSON the node's ABI encoder takes. */
function argValue(type: string, raw: string): unknown {
  const s = raw.trim();
  if (type.startsWith('option<') && s === '') return null;
  if (type.startsWith('list<')) {
    try {
      return JSON.parse(s || '[]');
    } catch {
      throw new Error(`${type} needs a list, like ["a", "b"]`);
    }
  }
  if (type === 'bool') return s === 'true';
  return s;
}

function placeholder(type: string) {
  if (type === 'address') return 'lyx1…';
  if (type === 'amount') return 'LYX, e.g. 1.5';
  if (type === 'bytes') return '0x…';
  if (type.startsWith('list<')) return '["…", "…"]';
  return type;
}

function ArgFields({ params, values, set }: { params: AbiParam[]; values: string[]; set: (v: string[]) => void }) {
  return (
    <>
      {params.map(([name, type], i) => (
        <div className="field" key={name + i}>
          <label>{name} <span className="faint">{type}</span></label>
          {type === 'bool' ? (
            <select className="input" value={values[i] ?? 'false'} onChange={(e) => set(values.map((v, k) => (k === i ? e.target.value : v)))}>
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          ) : (
            <input
              className={'input' + (['address', 'bytes'].includes(type) ? ' mono' : '')}
              placeholder={placeholder(type)}
              autoComplete="off"
              spellCheck={false}
              value={values[i] ?? ''}
              onChange={(e) => set(values.map((v, k) => (k === i ? e.target.value : v)))}
            />
          )}
        </div>
      ))}
    </>
  );
}

function Events({ logs }: { logs: ContractLog[] }) {
  if (!logs.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {logs.map((l, i) => (
        <p key={i} className="mono" style={{ margin: 0, fontSize: 14, overflowWrap: 'anywhere' }}>
          <strong>{l.event}</strong> {l.fields ? JSON.stringify(l.fields) : l.data}
        </p>
      ))}
    </div>
  );
}

/** Waits for a sent transaction and shows what it did. */
function Sent({ hash }: { hash: string }) {
  const { info } = useChain();
  const [tx, setTx] = useState<TxInfo | null>(null);
  useEffect(() => {
    let live = true;
    rpc<TxInfo>('lyx_getTransaction', { hash }).then((t) => live && setTx(t)).catch(() => {});
    return () => {
      live = false;
    };
  }, [hash, info?.height]);
  const r = tx?.receipt;
  return (
    <div className="notice">
      <Icon.explorer />
      <div className="stack" style={{ gap: 8, minWidth: 0 }}>
        {!r ? (
          <p>Sent. Waiting for a block… <Link className="link mono" to={`/tx/${hash}`}>{shortHash(hash, 10, 6)}</Link></p>
        ) : r.ok ? (
          <>
            <p><strong>It worked.</strong> Gas used {r.gasUsed.toLocaleString()}, fee {r.feeLyx} LYX. <Link className="link" to={`/tx/${hash}`}>Details</Link></p>
            {r.contract && <p>Your contract is at <AddressLink address={r.contract} short={false} /></p>}
            {r.result !== null && r.result !== undefined && <p className="mono">Returned {JSON.stringify(r.result)}</p>}
            <Events logs={r.logs} />
          </>
        ) : (
          <p><strong>It failed:</strong> {r.error}. Nothing changed except the {r.feeLyx} LYX fee for the gas it used. <Link className="link" to={`/tx/${hash}`}>Details</Link></p>
        )}
      </div>
    </div>
  );
}

async function sendOp(op: ContractOp, to: string, value: bigint, sk: Uint8Array, info: ChainInfo): Promise<string> {
  const me = addressFromPrivateKey(sk);
  const acct = await rpc<{ pendingNonce: number }>('lyx_getAccount', { address: me });
  const t = signContract(op, to, BigInt(info.chainId), BigInt(acct.pendingNonce), sk, value);
  return rpc<string>('lyx_sendRawTransaction', { tx: bytesToHex(t.bytes) });
}

function Method({ contract, m, sk, info }: { contract: string; m: AbiMethod; sk: Uint8Array | null; info: ChainInfo }) {
  const [values, setValues] = useState<string[]>(m.args.map(() => ''));
  const [lyx, setLyx] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [read, setRead] = useState<RunResult | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const args = () => m.args.map(([, t], i) => argValue(t, values[i] ?? ''));
  const go = async (send: boolean) => {
    setBusy(true);
    setErr(null);
    setRead(null);
    setSent(null);
    try {
      if (!send) {
        setRead(await rpc<RunResult>('lyx_call', { to: contract, method: m.name, args: args() }));
        return;
      }
      if (!sk) throw new Error('Unlock your wallet first');
      const value = m.payable && lyx.trim() ? parseLyx(lyx) : 0n;
      const input = await rpc<string>('lyx_encodeCall', { to: contract, method: m.name, args: args() });
      const est = await rpc<GasEstimate>('lyx_estimateGas', { from: addressFromPrivateKey(sk), to: contract, input, value: value.toString() });
      if (!est.ok) throw new Error(`It would fail: ${est.error}`);
      const op: ContractOp = { kind: 'call', input: hexToBytesLoose(input), gas: BigInt(est.gasLimit) };
      setSent(await sendOp(op, contract, value, sk, info));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <h3 className="mono" style={{ margin: 0 }}>{m.name}</h3>
        <span className="tag">{m.view ? 'read' : m.payable ? 'takes LYX' : 'changes state'}</span>
      </div>
      <ArgFields params={m.args} values={values} set={setValues} />
      {m.payable && (
        <div className="field">
          <label>LYX to send with it</label>
          <input className="input" inputMode="decimal" placeholder="0" value={lyx} onChange={(e) => setLyx(e.target.value)} />
        </div>
      )}
      <div className="row" style={{ gap: 10 }}>
        {m.view ? (
          <button className="btn primary" disabled={busy} onClick={() => go(false)}>{busy ? <Spinner /> : 'Read'}</button>
        ) : (
          <>
            <button className="btn primary" disabled={busy || !sk} onClick={() => go(true)}>{busy ? <Spinner /> : 'Send'}</button>
            <button className="btn" disabled={busy} onClick={() => go(false)}>Try it first</button>
          </>
        )}
      </div>
      {err && <p className="error-text">{err}</p>}
      {read && (read.ok
        ? <div className="stack" style={{ gap: 6 }}><p className="mono" style={{ margin: 0, overflowWrap: 'anywhere' }}>{read.result !== null ? JSON.stringify(read.result) : 'Done (no return value)'}</p><Events logs={read.logs} /></div>
        : <p className="error-text">Fails with: {read.error}</p>)}
      {sent && <Sent hash={sent} />}
    </div>
  );
}

function hexToBytesLoose(h: string): Uint8Array {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function UseContract({ sk, info }: { sk: Uint8Array | null; info: ChainInfo }) {
  const [params, setParams] = useSearchParams();
  const [addr, setAddr] = useState(params.get('address') ?? '');
  const [c, setC] = useState<ContractInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const target = params.get('address');

  useEffect(() => {
    setC(null);
    setErr(null);
    if (!target) return;
    rpc<ContractInfo>('lyx_getContract', { address: target }).then(setC).catch((e) => setErr((e as Error).message));
  }, [target]);

  return (
    <section className="stack" style={{ gap: 20 }}>
      <h2>Use a contract</h2>
      <div className="row" style={{ gap: 10, maxWidth: 660 }}>
        <input className="input mono" style={{ flex: 1, minWidth: 0 }} placeholder="Contract address, lyx1…" value={addr} onChange={(e) => setAddr(e.target.value.trim())} />
        <button className="btn" disabled={!isAddress(addr)} onClick={() => setParams({ address: addr })}>Open</button>
      </div>
      {err && <p className="error-text">{err}</p>}
      {c && (
        <div className="stack" style={{ gap: 20 }}>
          <KV
            items={[
              ['Contract', c.abi?.name ?? 'No name'],
              ['Made by', <AddressLink address={c.creator} mark />],
              ['Deployed in block', <Link className="link num" to={`/block/${c.height}`}>{c.height.toLocaleString()}</Link>],
              ['Code', `${c.codeBytes.toLocaleString()} bytes`],
            ]}
          />
          {!c.abi ? (
            <p className="muted">This contract came without an ABI, so there's nothing to show here. It can still be called with raw input from the command line wallet.</p>
          ) : (
            <div className="grid-2">
              {c.abi.methods.map((m) => <Method key={m.name} contract={c.address} m={m} sk={sk} info={info} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Deploy({ sk, info }: { sk: Uint8Array; info: ChainInfo }) {
  const [code, setCode] = useState<Uint8Array | null>(null);
  const [codeName, setCodeName] = useState('');
  const [abiText, setAbiText] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  let abi: { deploy?: AbiParam[] } | null = null;
  let abiErr: string | null = null;
  if (abiText) {
    try {
      abi = JSON.parse(abiText);
    } catch {
      abiErr = "That ABI file isn't valid JSON.";
    }
  }
  const deployArgs = abi?.deploy ?? [];

  const go = async () => {
    if (!code) return;
    setBusy(true);
    setErr(null);
    setSent(null);
    try {
      const args = deployArgs.map(([, t], i) => argValue(t, values[i] ?? ''));
      const input = deployArgs.length ? await rpc<string>('lyx_encodeDeploy', { abi: abiText, args }) : '';
      const est = await rpc<GasEstimate>('lyx_estimateGas', { from: addressFromPrivateKey(sk), code: bytesToHex(code), abi: abiText, input });
      if (!est.ok) throw new Error(`The deploy would fail: ${est.error}`);
      const op: ContractOp = { kind: 'deploy', code, abi: abiText, input: hexToBytesLoose(input), gas: BigInt(est.gasLimit) };
      setSent(await sendOp(op, '', 0n, sk, info));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack" style={{ gap: 20, maxWidth: 660 }}>
      <h2>Deploy a contract</h2>
      <p className="muted">Pick the .wasm file you built and its abi.json. The ABI isn't needed to run the contract, but without it wallets and this page can't show its methods.</p>
      <div className="field">
        <label>Contract (.wasm)</label>
        <input className="input" type="file" accept=".wasm,application/wasm" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setCodeName(f.name);
          setCode(new Uint8Array(await f.arrayBuffer()));
        }} />
      </div>
      <div className="field">
        <label>ABI (abi.json)</label>
        <input className="input" type="file" accept=".json,application/json" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const t = await f.text();
          setAbiText(t);
          try {
            setValues((JSON.parse(t).deploy ?? []).map(() => ''));
          } catch {
            setValues([]);
          }
        }} />
      </div>
      {abiErr && <p className="error-text">{abiErr}</p>}
      {deployArgs.length > 0 && <ArgFields params={deployArgs} values={values} set={setValues} />}
      <div>
        <button className="btn primary lg" disabled={!code || busy || !!abiErr} onClick={go}>
          {busy ? <Spinner /> : code ? `Deploy ${codeName}` : 'Deploy'}
        </button>
      </div>
      {err && <p className="error-text">{err}</p>}
      {sent && <Sent hash={sent} />}
    </section>
  );
}

export default function Contracts() {
  const { info } = useChain();
  const { stored, unlocked, snap } = useWallet();
  const sk = unlocked?.secretKey ?? null;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Contracts</h1>
          <p>Programs that live on LOKYX. They're written in Rust and every node runs them the same way, so nobody has to trust whoever wrote or deployed them.</p>
        </div>
      </div>
      {!info ? (
        <Spinner />
      ) : (
        <div className="stack" style={{ gap: 56 }}>
          {snap && !unlocked && (
            <div className="notice" style={{ maxWidth: 660 }}>
              <Icon.wallet />
              <p>MetaMask can't sign contract transactions yet. Reading contracts works; to send, use the wallet in this browser.</p>
            </div>
          )}
          <UseContract sk={sk} info={info} />
          {!stored ? (
            <div className="notice" style={{ maxWidth: 660 }}>
              <Icon.wallet />
              <p>To deploy or send to a contract you need the wallet in this browser. <Link to="/wallet" className="link">Create or restore one</Link>.</p>
            </div>
          ) : !sk ? (
            <UnlockInline text="Unlock your wallet to deploy or send to contracts." />
          ) : (
            <Deploy sk={sk} info={info} />
          )}
          <section className="stack" style={{ gap: 12, maxWidth: 660 }}>
            <h2>Writing one</h2>
            <p className="muted">
              Contracts are plain Rust with the LOKYX SDK. Start from the examples in <span className="mono">contracts/examples</span> (a counter, a token and a savings jar), build with <span className="mono">cargo build --release</span>, and deploy the .wasm here or with <span className="mono">lokyx-wallet deploy</span>. The <Link className="link" to="/developers">developer page</Link> has the details.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
