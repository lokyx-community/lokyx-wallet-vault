import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { addressesFrom, domainsFrom, fromB64, has, hostChain, normAddress, normDomain, pack, siteInList, toB64 } from '../src/lib/risk-lists-core.ts';
// @ts-ignore plain JS worker
import { handle } from '../risk-relay/worker.mjs';
// @ts-ignore plain JS
import { SOURCES, refresh } from '../risk-relay/build-core.mjs';
// @ts-ignore plain JS
import { fileStore, upload } from '../risk-relay/build-lists.mjs';

const sha = (s: string) => new Uint8Array(createHash('sha256').update(s).digest());

test('names are cleaned the same way every time', () => {
  assert.equal(normDomain('HTTPS://Evil-Swap.COM/path?x=1'), 'evil-swap.com');
  assert.equal(normDomain('*.evil.com'), 'evil.com');
  assert.equal(normDomain('https://good.com@evil.com/'), 'evil.com');
  assert.equal(normDomain('evil.com:8443'), 'evil.com');
  for (const bad of ['', 'localhost', 'a b.com', 'not a domain', 'x.', '-a.com', 42, null]) assert.equal(normDomain(bad as never), null);
  assert.equal(normAddress('0xABCDEFabcdef0123456789abcdef0123456789AB'), '0xabcdefabcdef0123456789abcdef0123456789ab');
  assert.equal(normAddress('0x12'), null);
});

test('a site and its parents are looked up, the bare ending is not', () => {
  assert.deepEqual(hostChain('a.b.evil.com'), ['a.b.evil.com', 'b.evil.com', 'evil.com']);
  assert.deepEqual(hostChain('com'), []);
});

test('a packed list finds what is in it and nothing else', () => {
  const blob = pack(sha, 'd', ['evil.com', 'phish.xyz', 'evil.com', 'scam.io']);
  assert.equal(blob.length, 3 * 6);
  assert.ok(has(blob, sha, 'd', 'phish.xyz'));
  assert.ok(!has(blob, sha, 'd', 'uniswap.org'));
  assert.ok(!has(blob, sha, 'a', 'evil.com'), 'a domain fingerprint is not an address fingerprint');
  assert.ok(siteInList(blob, sha, 'https://login.evil.com/connect'));
  assert.ok(siteInList(blob, sha, 'EVIL.com'));
  assert.ok(!siteInList(blob, sha, 'https://notevil.com'));
  assert.ok(!has(new Uint8Array(5), sha, 'd', 'x.com'), 'a damaged list matches nothing');
});

test('a bigger list still works and keeps its size', () => {
  const names = Array.from({ length: 5000 }, (_, i) => `scam${i}.example`);
  const blob = pack(sha, 'd', names);
  assert.equal(blob.length, 5000 * 6);
  assert.ok(names.every((n, i) => i % 97 || has(blob, sha, 'd', n)));
  assert.ok(!has(blob, sha, 'd', 'scam5000.example'));
});

test('lists in different shapes are read', () => {
  assert.deepEqual(domainsFrom({ blocklist: ['a.com', 'junk', 'B.org'], allowlist: ['good.com'] }, ['blocklist', 'blacklist']), ['a.com', 'b.org']);
  assert.deepEqual(domainsFrom(['x.io', { domain: 'y.io' }, { id: 'z.io', name: 'Fake thing.' }], []), ['x.io', 'y.io', 'z.io']);
  assert.deepEqual(addressesFrom([{ address: '0x' + 'ab'.repeat(20), comment: 'x' }, '0x' + 'CD'.repeat(20), 'nope'], []), ['0x' + 'ab'.repeat(20), '0x' + 'cd'.repeat(20)]);
  assert.deepEqual(domainsFrom({ other: 1 }, ['blocklist']), []);
});

test('base64 round trip', () => {
  for (const n of [0, 1, 2, 3, 4, 17, 300]) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
    assert.deepEqual(fromB64(toB64(b)), b);
  }
});

// ---- the worker ----
const kv = () => {
  const m = new Map<string, string | ArrayBuffer>();
  return {
    m,
    async get(k: string, t?: string) {
      const v = m.get(k);
      if (v === undefined) return null;
      if (t === 'json') return JSON.parse(v as string);
      if (t === 'arrayBuffer') return v instanceof ArrayBuffer ? v : (v as never);
      return v;
    },
    async put(k: string, v: string | Uint8Array) { m.set(k, v instanceof Uint8Array ? v.slice().buffer : v); },
  };
};
const feed = (map: Record<string, unknown>) => async (u: string) => (u in map ? new Response(JSON.stringify(map[u])) : new Response('no', { status: 404 }));
const url = (name: string) => SOURCES.find((s: { name: string }) => s.name === name).url;

test('the worker builds both lists and answers phones', async () => {
  const env = { LISTS: kv() };
  const meta = await refresh(env, feed({
    [url('metamask-phishing')]: { blocklist: ['evil.com', 'phish.xyz'], allowlist: ['uniswap.org'] },
    [url('mew-addresses')]: [{ address: '0x' + '11'.repeat(20) }],
  }), 1000);
  assert.equal(meta.domains, 2);
  assert.equal(meta.addresses, 1);
  assert.equal(meta.sources['metamask-phishing'].ok, true);
  assert.equal(meta.sources['scamsniffer-domains'].ok, false);
  const m = await (await handle(new Request('https://r/lists/meta'), env)).json();
  assert.equal(m.v, 1000);
  const bin = new Uint8Array(await (await handle(new Request('https://r/lists/domains.bin'), env)).arrayBuffer());
  assert.ok(has(bin, sha, 'd', 'evil.com'));
  assert.ok(!has(bin, sha, 'd', 'uniswap.org'));
  assert.equal((await handle(new Request('https://r/nope'), env)).status, 404);
  assert.equal((await handle(new Request('https://r/lists/meta', { method: 'POST' }), env)).status, 405);
});

test('before the first build the worker says so', async () => {
  assert.equal((await handle(new Request('https://r/lists/meta'), { LISTS: kv() })).status, 503);
});

test('a broken source keeps its last good copy; a collapsed one is not believed', async () => {
  const env = { LISTS: kv() };
  const big = Array.from({ length: 400 }, (_, i) => `bad${i}.com`);
  await refresh(env, feed({ [url('metamask-phishing')]: { blocklist: big } }), 1);
  const down = await refresh(env, feed({}), 2);
  assert.equal(down.sources['metamask-phishing'].ok, false);
  assert.equal(down.domains, 400, 'the old copy is still served');
  const bin1 = new Uint8Array(await (await handle(new Request('https://r/lists/domains.bin'), env)).arrayBuffer());
  assert.ok(has(bin1, sha, 'd', 'bad7.com'));
  const shrunk = await refresh(env, feed({ [url('metamask-phishing')]: { blocklist: ['one.com'] } }), 3);
  assert.equal(shrunk.sources['metamask-phishing'].ok, false);
  assert.match(shrunk.sources['metamask-phishing'].error, /shrank/);
  assert.equal(shrunk.domains, 400);
});

test('the worker has no way to rebuild lists or be told to', async () => {
  const env = { LISTS: kv(), ADMIN_KEY: 'k' };
  assert.equal((await handle(new Request('https://r/admin/refresh', { method: 'POST', headers: { 'x-admin': 'k' } }), env, feed({}))).status, 405);
});

test('the server script keeps last-good copies in files and uploads meta last', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = join(mkdtempSync(join(tmpdir(), 'rl-')), 'state');
  const a = fileStore(dir);
  const big = Array.from({ length: 400 }, (_, i) => `bad${i}.com`);
  await refresh({ LISTS: a }, feed({ [url('metamask-phishing')]: { blocklist: big } }), 1);
  const b = fileStore(dir); // a later run, fresh process
  const meta = await refresh({ LISTS: b }, feed({}), 2);
  assert.equal(meta.domains, 400, 'last good copy survived on disk');
  let sent: { url: string; body: { key: string; value: string; base64: boolean }[]; auth: string } | null = null;
  await upload(b.written, { token: 'T', account: 'A', namespace: 'N' }, async (u: string, init: { body: string; headers: Record<string, string> }) => {
    sent = { url: u, body: JSON.parse(init.body), auth: init.headers.authorization };
    return new Response(JSON.stringify({ success: true }));
  });
  assert.match(sent!.url, /accounts\/A\/storage\/kv\/namespaces\/N\/bulk$/);
  assert.equal(sent!.auth, 'Bearer T');
  assert.deepEqual(sent!.body.map((x) => x.key), ['domains.bin', 'addresses.bin', 'meta']);
  assert.ok(sent!.body.every((x) => x.base64));
  await assert.rejects(upload(b.written, { token: 'T', account: 'A', namespace: 'N' }, async () => new Response('{"success":false}', { status: 403 })), /upload failed/);
});
