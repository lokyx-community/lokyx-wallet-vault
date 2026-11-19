// A LOKYX watchtower (alerts only). Run: NODE_RPC=https://your-node/rpc node watchtower/server.mjs
// Nothing here holds a key. It watches the vaults it is told about and POSTs a message to the places each person gave.
// Needs Node 22.6+ (it imports the wallet's TypeScript logic directly) and no packages.

import http from 'node:http';
import { checkRegistration, tick } from '../src/lib/tower-core.ts';

const RPC = process.env.NODE_RPC;
const PORT = Number(process.env.PORT ?? 8787);
const EVERY = Number(process.env.EVERY_SECS ?? 30) * 1000;
const MAX = Number(process.env.MAX_ACCOUNTS ?? 5000);
if (!RPC) throw new Error('Set NODE_RPC to a LOKYX node, for example https://node.example/rpc');

const regs = new Map(); // account -> { account, notify }
const told = new Set();
const hits = new Map(); // ip -> [timestamps], a plain rate limit

async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const send = async (url, title, text) => {
  const r = await fetch(url, { method: 'POST', headers: { Title: title, 'content-type': 'text/plain' }, body: text, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`webhook answered ${r.status}`);
};

const limited = (ip) => {
  const now = Date.now();
  const h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  h.push(now);
  hits.set(ip, h);
  return h.length > 20;
};

const server = http.createServer(async (req, res) => {
  const out = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && req.url === '/health') return out(200, { ok: true, watching: regs.size });
  if (req.method !== 'POST' || !['/watch', '/unwatch'].includes(req.url ?? '')) return out(404, { error: 'not found' });
  if (limited(req.socket.remoteAddress ?? '')) return out(429, { error: 'slow down' });
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 4000) return out(413, { error: 'too big' }); }
  let body;
  try { body = JSON.parse(raw); } catch { return out(400, { error: 'not json' }); }
  const r = checkRegistration(body);
  if (typeof r === 'string') return out(400, { error: r });
  if (req.url === '/unwatch') { regs.delete(r.account); return out(200, { ok: true }); }
  if (!regs.has(r.account) && regs.size >= MAX) return out(503, { error: 'full' });
  regs.set(r.account, r);
  out(200, { ok: true });
});

setInterval(() => {
  tick(regs.values(), { getAccount: (a) => rpc('lyx_getAccount', { address: a }), send, told }).catch((e) => console.error('tick failed', e.message));
}, EVERY);

server.listen(PORT, () => console.log(`watchtower on :${PORT}, node ${RPC}`));
