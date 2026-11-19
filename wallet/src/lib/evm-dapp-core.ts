// Ethereum websites in the wallet's browser: what the page can ask for (window.ethereum, EIP-1193) and how the
// wallet sorts each request. No native imports, so the rules are tested alone (test/evm-dapp.test.ts).

/** The page-side provider. It announces itself the modern way (EIP-6963) and as window.ethereum when nothing else has. */
export const EVM_PROVIDER_JS = `(function () {
  if (window.__lokyxEvm) return;
  window.__lokyxEvm = true;
  var waiting = {}, n = 1e6, listeners = {};
  var state = { chainId: null, accounts: [] };
  function send(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++n;
      waiting[id] = { resolve: resolve, reject: reject };
      window.ReactNativeWebView.postMessage(JSON.stringify({ lokyx: 1, evm: 1, id: id, method: method, params: params || [] }));
    });
  }
  var oldReply = window.__lokyxReply;
  window.__lokyxReply = function (id, result, error) {
    var w = waiting[id];
    if (!w) return oldReply && oldReply(id, result, error);
    delete waiting[id];
    if (error) { var e = new Error(error.message); e.code = error.code; w.reject(e); } else w.resolve(result);
  };
  function emit(name, data) { (listeners[name] || []).slice().forEach(function (f) { try { f(data); } catch (e) {} }); }
  var oldEmit = window.__lokyxEmit;
  window.__lokyxEmit = function (name, data) {
    if (name === 'evm:accountsChanged') { state.accounts = data || []; emit('accountsChanged', data || []); return; }
    if (name === 'evm:chainChanged') { state.chainId = data; provider.chainId = data; emit('chainChanged', data); return; }
    if (oldEmit) oldEmit(name, data);
  };
  var provider = {
    isLokyx: true,
    chainId: null,
    networkVersion: null,
    selectedAddress: null,
    request: function (a) {
      if (!a || typeof a.method !== 'string') return Promise.reject(Object.assign(new Error('Bad request'), { code: -32600 }));
      return send(a.method, a.params).then(function (r) {
        if (a.method === 'eth_requestAccounts' || a.method === 'eth_accounts') { state.accounts = r; provider.selectedAddress = r[0] || null; if (r.length) emit('connect', { chainId: provider.chainId }); }
        if (a.method === 'eth_chainId') { provider.chainId = r; state.chainId = r; }
        return r;
      });
    },
    enable: function () { return provider.request({ method: 'eth_requestAccounts' }); },
    isConnected: function () { return true; },
    send: function (m, p) { return typeof m === 'string' ? provider.request({ method: m, params: p }) : provider.request(m); },
    sendAsync: function (m, cb) { provider.request(m).then(function (r) { cb(null, { id: m.id, jsonrpc: '2.0', result: r }); }, function (e) { cb(e); }); },
    on: function (name, f) { (listeners[name] = listeners[name] || []).push(f); return provider; },
    addListener: function (name, f) { return provider.on(name, f); },
    removeListener: function (name, f) { listeners[name] = (listeners[name] || []).filter(function (x) { return x !== f; }); return provider; },
    off: function (name, f) { return provider.removeListener(name, f); },
    once: function (name, f) { var g = function (d) { provider.removeListener(name, g); f(d); }; return provider.on(name, g); }
  };
  send('eth_chainId').then(function (c) { provider.chainId = c; provider.networkVersion = String(parseInt(c, 16)); }).catch(function () {});
  var info = { uuid: '7c1c3b1e-5c0e-4f6c-9c5a-6a6f6c6f6b79', name: 'LOKYX', icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgcng9IjIyIiBmaWxsPSIjMDAwIi8+PHBhdGggZD0iTTUwIDE2QTM0IDM0IDAgMSAwIDg0IDUwIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMTQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgZmlsbD0ibm9uZSIvPjxjaXJjbGUgY3g9Ijc0IiBjeT0iMjYiIHI9IjcuNSIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==', rdns: 'xyz.lokyx' };
  function announce() { window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: info, provider: provider }) })); }
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
  if (!window.ethereum) { try { Object.defineProperty(window, 'ethereum', { value: provider, configurable: true, writable: true }); } catch (e) { window.ethereum = provider; } }
  window.dispatchEvent(new Event('ethereum#initialized'));
})(); true;`;

/** Reads the wallet passes straight to the network, as they are. */
export const EVM_READ = new Set([
  'eth_call', 'eth_blockNumber', 'eth_getBalance', 'eth_getCode', 'eth_getStorageAt', 'eth_getTransactionCount',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_estimateGas',
  'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getLogs', 'eth_syncing', 'eth_protocolVersion',
  'net_listening', 'web3_clientVersion',
]);

export type EvmKind = 'read' | 'accounts' | 'connect' | 'chainId' | 'netVersion' | 'switch' | 'add' | 'send' | 'sign' | 'typed' | 'permissions' | 'revoke' | 'no';

/** How the wallet treats a request. `no` is anything it will not do. */
export function evmKind(method: string): EvmKind | null {
  if (EVM_READ.has(method)) return 'read';
  switch (method) {
    case 'eth_accounts': return 'accounts';
    case 'eth_requestAccounts': return 'connect';
    case 'wallet_requestPermissions': return 'connect';
    case 'wallet_getPermissions': return 'permissions';
    case 'wallet_revokePermissions': return 'revoke';
    case 'eth_chainId': return 'chainId';
    case 'net_version': return 'netVersion';
    case 'wallet_switchEthereumChain': return 'switch';
    case 'wallet_addEthereumChain': return 'add';
    case 'eth_sendTransaction': return 'send';
    case 'personal_sign': return 'sign';
    case 'eth_signTypedData_v4':
    case 'eth_signTypedData_v3': return 'typed';
    default:
      return /^(eth|net|web3|wallet|personal)_/.test(method) ? 'no' : null;
  }
}

/** Is this one of ours (an Ethereum-style call), as opposed to the LOKYX-chain provider's? */
export const isEvmMethod = (method: string) => evmKind(method) !== null;

export const toChainId = (hex: unknown): number | null => {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(hex)) return null;
  const n = Number(BigInt(hex));
  return Number.isSafeInteger(n) ? n : null;
};

/** A personal_sign message as text when it is plain text, otherwise the hex itself. */
export function messageText(hex: string): { text: string; plain: boolean } {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) return { text: hex, plain: true }; // some sites send the text itself
  const bytes = hex.slice(2).match(/../g)?.map((h) => parseInt(h, 16)) ?? [];
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    // printable text only (tabs and line breaks allowed)
    if (/^[\t\n\r\x20-\x7e -￿]*$/.test(text)) return { text, plain: true };
  } catch {
    /* not text */
  }
  return { text: hex, plain: false };
}

const MAX = (1n << 256n) - 1n;

/** What a transaction's data does, in words, for the common dangerous one: letting a contract spend your tokens. */
export function describeData(data: string | undefined): { kind: 'none' | 'approve' | 'other'; spender?: string; amount?: bigint; unlimited?: boolean; bytes: number } {
  if (!data || data === '0x') return { kind: 'none', bytes: 0 };
  const bytes = Math.max(0, (data.length - 2) / 2);
  const m = /^0x095ea7b3([0-9a-fA-F]{64})([0-9a-fA-F]{64})$/.exec(data);
  if (m) {
    const amount = BigInt(`0x${m[2]}`);
    return { kind: 'approve', spender: `0x${m[1].slice(24)}`, amount, unlimited: amount >= MAX / 2n, bytes };
  }
  return { kind: 'other', bytes };
}

/** A hex quantity from a page, as a bigint (0 when missing). Null if it isn't one. */
export function quantity(v: unknown): bigint | null {
  if (v == null || v === '') return 0n;
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]*$/.test(v)) return null;
  return v === '0x' ? 0n : BigInt(v);
}
