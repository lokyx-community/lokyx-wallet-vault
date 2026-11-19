import { installSnap, assertIsConfirmationDialog } from '@metamask/snaps-jest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Vectors produced by the Rust node (`cargo run --example vectors`). The Snap must derive the
// same addresses from the same recovery phrase and produce byte-identical signed transactions.
const v = JSON.parse(readFileSync(join(__dirname, '../../testdata/vectors.json'), 'utf8'));
const options = { secretRecoveryPhrase: v.mnemonic };

describe('LOKYX snap', () => {
  it('derives the same lyx1 addresses as the LOKYX wallets', async () => {
    const { request } = await installSnap({ options });
    for (const k of v.keys) {
      const res = await request({ origin: 'https://lokyx.test', method: 'lyx_getAddress', params: { index: k.index } });
      expect(res).toRespondWith({ address: k.address });
    }
  });

  it('shows a confirmation and signs exactly what the node expects', async () => {
    const { request } = await installSnap({ options });
    const plain = v.cases.filter((c: any) => c.tx.op.kind === 'transfer' && c.key === 0);
    expect(plain.length).toBeGreaterThanOrEqual(2); // one plain, one with a memo, and an expiry
    for (const c of plain) {
      const t = { ...c.tx, ...c.tx.op, signed: c.signed, hash: c.hash };
      const extra: Record<string, string> = {};
      if (t.expires) extra.expires = String(t.expires);
      if (t.memo) extra.memo = t.memo;
      const pending = request({
        origin: 'https://lokyx.test',
        method: 'lyx_signTransfer',
        params: { chainId: String(t.chainId), nonce: String(t.nonce), to: t.to, value: t.value, fee: t.fee, ...extra },
      });
      const ui = await pending.getInterface();
      assertIsConfirmationDialog(ui);
      await ui.ok();
      expect(await pending).toRespondWith({ from: v.keys[0].address, tx: t.signed, hash: t.hash });
    }
  });

  it('signs nothing when the user cancels', async () => {
    const { request } = await installSnap({ options });
    const t = { ...v.cases[0].tx, ...v.cases[0].tx.op };
    const pending = request({
      origin: 'https://lokyx.test',
      method: 'lyx_signTransfer',
      params: { chainId: String(t.chainId), nonce: '0', to: t.to, value: t.value, fee: t.fee },
    });
    const ui = await pending.getInterface();
    assertIsConfirmationDialog(ui);
    await ui.cancel();
    expect(await pending).toRespondWithError(expect.objectContaining({ code: 4001 }));
  });

  it('rejects bad input before asking the user', async () => {
    const { request } = await installSnap({ options });
    const bad = [
      { chainId: '1', nonce: '0', to: v.cases[0].tx.op.to, value: '1', fee: '169000000000000' },
      { chainId: '77703', nonce: '0', to: '0x' + '00'.repeat(20), value: '1', fee: '169000000000000' },
      { chainId: '77703', nonce: '0', to: v.cases[0].tx.op.to, value: '1', fee: '1' },
      { chainId: '77703', nonce: '-1', to: v.cases[0].tx.op.to, value: '1', fee: '169000000000000' },
    ];
    for (const params of bad) {
      const res = await request({ origin: 'https://lokyx.test', method: 'lyx_signTransfer', params });
      expect(res).toRespondWithError(expect.objectContaining({ code: -32602 }));
    }
  });

  it('refuses unknown methods', async () => {
    const { request } = await installSnap({ options });
    expect(await request({ method: 'eth_sign' })).toRespondWithError(expect.objectContaining({ code: -32601 }));
  });
});
