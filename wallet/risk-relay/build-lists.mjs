// Runs on your own server (not on Cloudflare): downloads the public scam lists, packs them, and uploads the three finished files
// to the relay's storage. Run it by hand or from cron (see README.md). It needs three settings, given as environment variables:
//   CLOUDFLARE_API_TOKEN   a token that may edit Workers KV Storage
//   CLOUDFLARE_ACCOUNT_ID  your account id
//   KV_NAMESPACE_ID        the id of the LISTS storage (the one in wrangler.toml)
// Each source's last good copy is kept in a small folder on this server, so one bad day upstream never empties the list.

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { refresh } from './build-core.mjs';

const STATE = process.env.LOKYX_RISK_STATE || join(homedir(), '.lokyx-risk-state');

/** A tiny stand-in for the relay's storage: one file per key. */
export function fileStore(dir) {
  mkdirSync(dir, { recursive: true });
  const path = (k) => join(dir, encodeURIComponent(k));
  const written = new Map();
  return {
    written,
    async get(k, type) {
      if (!existsSync(path(k))) return null;
      const raw = readFileSync(path(k));
      if (type === 'json') return JSON.parse(raw.toString('utf8'));
      if (type === 'arrayBuffer') return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      return raw.toString('utf8');
    },
    async put(k, v) {
      const buf = typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v);
      writeFileSync(path(k), buf);
      written.set(k, buf);
    },
  };
}

/** Send the finished files to Cloudflare KV in one request. The summary goes last, so phones never see it ahead of the lists. */
export async function upload(files, { token, account, namespace }, fetchFn = fetch) {
  const body = ['domains.bin', 'addresses.bin', 'meta'].map((key) => ({
    key,
    value: Buffer.from(files.get(key)).toString('base64'),
    base64: true,
  }));
  const r = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace}/bulk`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`upload failed: HTTP ${r.status} ${JSON.stringify(j.errors ?? '').slice(0, 200)}`);
}

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const namespace = process.env.KV_NAMESPACE_ID;
  if (!token || !account || !namespace) {
    console.error('Missing CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID or KV_NAMESPACE_ID.');
    process.exit(2);
  }
  const store = fileStore(STATE);
  const meta = await refresh({ LISTS: store });
  for (const [name, s] of Object.entries(meta.sources ?? {})) console.log(`${s.ok ? 'ok   ' : 'FAILED'} ${name}: ${s.count} entries${s.ok ? '' : ` (${s.error})`}`);
  console.log(`domains: ${meta.domains}, addresses: ${meta.addresses}`);
  if (meta.kept || !store.written.has('meta')) {
    console.log('Nothing new to publish; the relay keeps what it has.');
    return;
  }
  await upload(store.written, { token, account, namespace });
  console.log('Uploaded. Check https://lokyx-risk.lokyx.workers.dev/lists/meta');
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
