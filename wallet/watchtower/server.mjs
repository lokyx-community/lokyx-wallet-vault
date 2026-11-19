// A LOKYX watchtower: alerts, plus the relay that lets the people of a shared account pass sealed messages to each other.
// Run: NODE_RPC=https://your-node/rpc node watchtower/server.mjs      (NODE_RPC is only needed for the alerts part)
// Nothing here holds a key. The alerts part watches the vaults it is told about and POSTs to the places each person gave.
// The relay part stores sealed blobs under a hashed topic for a week. It cannot read them, and a phone checks every payment itself.
// Needs Node 22.6+ (it imports the wallet's TypeScript logic directly) and no packages. Put HTTPS in front of it (docs/RELAY.md).

import http from 'node:http';
import fs from 'node:fs';
import { checkRegistration, tick } from '../src/lib/tower-core.ts';
import { RelayStore, checkNotify, checkPut, checkTopic } from '../src/lib/relay-store.ts';

const RPC = process.env.NODE_RPC;
const PORT = Number(process.env.PORT ?? 8787);
const EVERY = Number(process.env.EVERY_SECS ?? 30) * 1000;
const MAX = Number(process.env.MAX_ACCOUNTS ?? 5000);
const RELAY_FILE = process.env.RELAY_FILE; // optional: keeps messages across a restart

const regs = new Map(); // account -> { account, notify }
const told = new Set();
const hits = new Map(); // ip -> [timestamps], a plain rate limit

let relay = new RelayStore();
if (RELAY_FILE && fs.existsSync(RELAY_FILE)) {
  try { relay = RelayStore.from(JSON.parse(fs.readFileSync(RELAY_FILE, 'utf8'))); } catch (e) { console.error('could not read', RELAY_FILE, e.message); }
}
const saveRelay = () => {
  if (!RELAY_FILE) return;
  try { fs.writeFileSync(RELAY_FILE + '.tmp', JSON.stringify(relay)); fs.renameSync(RELAY_FILE + '.tmp', RELAY_FILE); } catch (e) { console.error('could not save', e.message); }
};

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

const limited = (ip, max = 20) => {
  const now = Date.now();
  const h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  h.push(now);
  hits.set(ip, h);
  return h.length > max;
};

const readBody = async (req, res, out) => {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 20_000) { out(413, { error: 'too big' }); return null; } }
  try { return JSON.parse(raw); } catch { out(400, { error: 'not json' }); return null; }
};

const server = http.createServer(async (req, res) => {
  const out = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const url = new URL(req.url ?? '/', 'http://x');
  const ip = req.socket.remoteAddress ?? '';
  if (req.method === 'GET' && url.pathname === '/health') return out(200, { ok: true, watching: regs.size, relay: relay.size });

  // ---- relay
  if (req.method === 'GET' && url.pathname === '/relay/get') {
    if (limited(ip + 'g', 120)) return out(429, { error: 'slow down' });
    const topic = checkTopic(url.searchParams.get('topic'));
    const after = Number(url.searchParams.get('after') ?? 0);
    if (!topic || !Number.isFinite(after)) return out(400, { error: 'bad topic' });
    return out(200, { items: relay.list(topic, after, Date.now()) });
  }
  if (req.method === 'POST' && url.pathname === '/relay/put') {
    if (limited(ip + 'p', 30)) return out(429, { error: 'slow down' });
    const body = await readBody(req, res, out); if (!body) return;
    const m = checkPut(body);
    if (typeof m === 'string') return out(400, { error: m });
    const seq = relay.put(m.topic, m.blob, Date.now());
    if (typeof seq === 'string') return out(503, { error: seq });
    for (const u of relay.pingsFor(m.topic)) send(u, 'LOKYX', 'A payment is waiting').catch((e) => console.error('ping failed', e.message));
    return out(200, { ok: true, seq });
  }
  if (req.method === 'POST' && url.pathname === '/relay/notify') {
    if (limited(ip + 'n', 10)) return out(429, { error: 'slow down' });
    const body = await readBody(req, res, out); if (!body) return;
    const m = checkNotify(body);
    if (typeof m === 'string') return out(400, { error: m });
    relay.watch(m.topic, m.notify);
    return out(200, { ok: true });
  }

  // ---- alerts
  if (req.method !== 'POST' || !['/watch', '/unwatch'].includes(url.pathname)) return out(404, { error: 'not found' });
  if (!RPC) return out(503, { error: 'alerts are not switched on here' });
  if (limited(ip)) return out(429, { error: 'slow down' });
  const body = await readBody(req, res, out); if (!body) return;
  const r = checkRegistration(body);
  if (typeof r === 'string') return out(400, { error: r });
  if (url.pathname === '/unwatch') { regs.delete(r.account); return out(200, { ok: true }); }
  if (!regs.has(r.account) && regs.size >= MAX) return out(503, { error: 'full' });
  regs.set(r.account, r);
  out(200, { ok: true });
});

if (RPC) {
  setInterval(() => {
    tick(regs.values(), { getAccount: (a) => rpc('lyx_getAccount', { address: a }), send, told }).catch((e) => console.error('tick failed', e.message));
  }, EVERY);
}
setInterval(() => { relay.prune(Date.now()); saveRelay(); }, 60_000);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { saveRelay(); process.exit(0); });

server.listen(PORT, () => console.log(`watchtower on :${PORT}${RPC ? `, node ${RPC}` : ', relay only'}`));
