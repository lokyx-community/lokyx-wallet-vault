// What websites in the wallet's browser see as `window.lokyx`.
//
//   const [address] = await lokyx.request({ method: 'lyx_requestAccounts' });
//   const hash = await lokyx.request({ method: 'lyx_sendTransaction', params: { to, value } });
//   const hash = await lokyx.request({ method: 'lyx_callContract', params: { to, method: 'transfer', args: [...], value } });
//   const sig = await lokyx.request({ method: 'lyx_signMessage', params: { message } });
//
// Read methods (lyx_call, lyx_getAccount, lyx_chainInfo, …) go straight to the node.
// Values are in base units (1 LYX = 10^18), as strings.

export const PROVIDER_JS = `(function () {
  if (window.lokyx) return;
  var waiting = {}, n = 0, listeners = {};
  function send(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++n;
      waiting[id] = { resolve: resolve, reject: reject };
      window.ReactNativeWebView.postMessage(JSON.stringify({ lokyx: 1, id: id, method: method, params: params || {} }));
    });
  }
  window.__lokyxReply = function (id, result, error) {
    var w = waiting[id];
    if (!w) return;
    delete waiting[id];
    if (error) { var e = new Error(error.message); e.code = error.code; w.reject(e); } else w.resolve(result);
  };
  window.__lokyxEmit = function (name, data) {
    (listeners[name] || []).forEach(function (f) { try { f(data); } catch (e) {} });
  };
  window.lokyx = {
    isLokyx: true,
    request: function (a) { return send(a && a.method, a && a.params); },
    on: function (name, f) { (listeners[name] = listeners[name] || []).push(f); },
    off: function (name, f) { listeners[name] = (listeners[name] || []).filter(function (x) { return x !== f; }); }
  };
  window.dispatchEvent(new Event('lokyx#initialized'));
})(); true;`;

export const READ_METHODS = new Set([
  'lyx_chainInfo',
  'lyx_getAccount',
  'lyx_getBalance',
  'lyx_call',
  'lyx_estimateGas',
  'lyx_estimateFee',
  'lyx_encodeCall',
  'lyx_encodeDeploy',
  'lyx_getContract',
  'lyx_getStorage',
  'lyx_getTransaction',
  'lyx_getBlock',
  'lyx_getBlocks',
  'lyx_getAddressHistory',
  'lyx_validateAddress',
  'lyx_search',
]);

export const reply = (id: number, result: unknown, error?: { code: number; message: string }) =>
  `window.__lokyxReply(${id}, ${JSON.stringify(result ?? null)}, ${error ? JSON.stringify(error) : 'null'}); true;`;

export const REJECTED = { code: 4001, message: 'The user said no' };
export const NOT_CONNECTED = { code: 4100, message: 'Ask with lyx_requestAccounts first' };

/** Something typed in the address bar, as a URL: a site, or a search. */
export function toUrl(text: string) {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t)) return `https://${t}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}
