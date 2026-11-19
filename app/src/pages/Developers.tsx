import { useState } from 'react';
import { Link } from 'react-router-dom';
import { contractsOn, useNodeUrl, rpc } from '../lib/rpc';
import { useChain } from '../state';
import { Copy } from '../ui';

const METHODS: { name: string; params: string; does: string }[] = [
  { name: 'lyx_chainInfo', params: '{}', does: 'Height, best block, difficulty, supply, peers' },
  { name: 'lyx_getBlock', params: '{"height": 1, "fullTransactions": true}', does: 'One block, by height or hash' },
  { name: 'lyx_getBlocks', params: '{"count": 10}', does: 'Newest blocks first, up to 100' },
  { name: 'lyx_getTransaction', params: '{"hash": "…"}', does: 'Pending or confirmed, with confirmations' },
  { name: 'lyx_getAccount', params: '{"address": "lyx1…"}', does: 'Balance, nonce and next nonce' },
  { name: 'lyx_getAddressHistory', params: '{"address": "lyx1…", "limit": 25}', does: 'Transfers and mined blocks, newest first' },
  { name: 'lyx_sendRawTransaction', params: '{"tx": "<hex>"}', does: 'Submit a signed transaction' },
  { name: 'lyx_getMempool', params: '{}', does: 'Transactions waiting for a block' },
  { name: 'lyx_getPeers', params: '{}', does: "The node's current connections" },
  { name: 'lyx_getSupply', params: '{}', does: 'Supply totals' },
  { name: 'lyx_getEmissionSchedule', params: '{}', does: 'Reward eras' },
  { name: 'lyx_getMiningInfo', params: '{}', does: 'Hashrate and blocks found' },
  { name: 'lyx_setMining', params: '{"enabled": true, "threads": 1, "coinbase": "lyx1…"}', does: 'Start or stop mining (localhost only)' },
  { name: 'lyx_search', params: '{"q": "42"}', does: 'Find a block, tx or address' },
  { name: 'lyx_validateAddress', params: '{"address": "lyx1…"}', does: 'Check an address' },
  { name: 'lyx_estimateFee', params: '{}', does: 'Minimum fee for a transfer' },
  { name: 'lyx_getSwap', params: '{"id": "…"}', does: 'A swap lock: status, and the secret once revealed' },
  { name: 'lyx_findSwaps', params: '{"hashlock": "…"}', does: 'Open or pending swap locks with a hashlock' },
  { name: 'lyx_getWork', params: '{"address": "lyx1…"}', does: 'A block template to mine without running a node' },
  { name: 'lyx_submitWork', params: '{"id": "…", "timestamp": 0, "nonce": "…"}', does: 'Send back a solved template' },
  { name: 'lyx_getVault', params: '{"address": "lyx1…"}', does: 'Vault settings, allowance left and pending withdrawals' },
  { name: 'lyx_call', params: '{"to": "lyx1…", "method": "balance_of", "args": ["lyx1…"]}', does: 'Read a contract without sending anything' },
  { name: 'lyx_estimateGas', params: '{"from": "lyx1…", "to": "lyx1…", "method": "transfer", "args": ["lyx1…", "1"]}', does: 'Gas a call or deploy will need' },
  { name: 'lyx_getContract', params: '{"address": "lyx1…"}', does: 'Who deployed a contract, its size and ABI' },
  { name: 'lyx_encodeCall', params: '{"to": "lyx1…", "method": "transfer", "args": ["lyx1…", "1"]}', does: "Input bytes for a call, from the contract's ABI" },
];

const CONTRACT_METHODS = ['lyx_call', 'lyx_estimateGas', 'lyx_getContract', 'lyx_encodeCall'];

export default function Developers() {
  const url = useNodeUrl();
  const { info } = useChain();
  const methods = contractsOn(info) ? METHODS : METHODS.filter((m) => !CONTRACT_METHODS.includes(m.name));
  const [method, setMethod] = useState('lyx_chainInfo');
  const [params, setParams] = useState('{}');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const p = params.trim() ? JSON.parse(params) : {};
      setOut(JSON.stringify(await rpc(method, p), null, 2));
    } catch (e) {
      setOut('Error: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const curl = `curl -s -H 'Content-Type: application/json' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"${method}","params":${params.replace(/\s+/g, ' ')}}' \\\n  ${url}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Developers</h1>
          <p>Every node speaks JSON-RPC 2.0 over HTTP. No API key. Use any node, preferably your own.</p>
        </div>
      </div>

      <div className="split">
        <section className="stack">
          <h2>Try it against your node</h2>
          <div className="field">
            <label htmlFor="m">Method</label>
            <select id="m" className="input" value={method} onChange={(e) => { setMethod(e.target.value); setParams(methods.find((x) => x.name === e.target.value)!.params); setOut(''); }}>
              {methods.map((m) => <option key={m.name}>{m.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="p">Params (JSON object)</label>
            <textarea id="p" className="input mono" rows={3} spellCheck={false} value={params} onChange={(e) => setParams(e.target.value)} />
          </div>
          <div><button className="btn primary" disabled={busy} onClick={run}>Run</button></div>
          {out && <pre className="code">{out}</pre>}
          <h3 style={{ marginTop: 16 }}>Same call with curl</h3>
          <pre className="code">{curl}</pre>
        </section>

        <section>
          <h2 style={{ marginBottom: 12 }}>Methods</h2>
          <div className="table">
            {methods.map((m) => (
              <button key={m.name} className="tr" style={{ gridTemplateColumns: '1fr', textAlign: 'left', background: method === m.name ? 'var(--hover)' : 'none', border: 0, cursor: 'pointer', width: 'calc(100% + 32px)' }}
                onClick={() => { setMethod(m.name); setParams(m.params); setOut(''); }}>
                <span className="cell-main">
                  <span className="t mono" style={{ fontWeight: 400 }}>{m.name}</span>
                  <span className="s">{m.does}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 12 }}>Amounts are strings in base units (1 LYX = 10<sup>18</sup>), with a matching …Lyx field for display.</p>
        </section>
      </div>

      <section className="section stack">
        <h2>Run a node</h2>
        <p className="muted">Get the node and wallet for your computer from the <Link className="link" to="/download">download page</Link>, then:</p>
        <pre className="code">{`lokyx-wallet --network testnet new
lokyxd --network testnet --mine --coinbase <your lyx1 address> --rpc-cors ${location.origin}`}</pre>
        <p className="muted">
          RPC listens on 127.0.0.1 only. To let this app talk to it from the browser, start the node with <span className="mono">--rpc-cors</span> and this app's exact origin.
        </p>
        <div className="inline">
          <span className="muted">Node address in use:</span>
          <Copy text={url} />
        </div>
      </section>
    </>
  );
}
