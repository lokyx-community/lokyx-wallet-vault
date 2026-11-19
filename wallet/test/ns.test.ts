import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nsKey } from '../src/lib/ns.ts';

test('the decoy reads and writes its own copy of every wallet key', () => {
  for (const k of ['w.phrase', 'w.key.0', 'w.accounts', 'w.current', 'w.contacts', 'w.pending', 'w.addrs', 'w.capsules']) {
    assert.equal(nsKey(k, false), k);
    assert.equal(nsKey(k, true), `d.${k.slice(2)}`);
  }
});

test('the passcodes, settings and network choice are never redirected', () => {
  for (const k of ['w.pin', 'w.decoy', 'w.settings', 'w.secmode', 'w.node', 'w.nodes', 'w.chains']) assert.equal(nsKey(k, true), k);
  assert.equal(nsKey('browser.bookmarks', true), 'browser.bookmarks');
  assert.equal(nsKey('d.accounts', true), 'd.accounts');
});
