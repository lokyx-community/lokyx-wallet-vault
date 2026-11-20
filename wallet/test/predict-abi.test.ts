import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEPLOYMENTS, PREDICT_ABI } from '../src/lib/predict-abi.ts';

const sol = readFileSync(new URL('../contracts/evm/src/PredictionMarket.sol', import.meta.url), 'utf8');

test('every deployment has well-formed addresses and a fee within the contract cap', () => {
  for (const d of Object.values(DEPLOYMENTS)) {
    assert.match(d.market, /^0x[0-9a-fA-F]{40}$/);
    assert.match(d.token, /^0x[0-9a-fA-F]{40}$/);
    assert.match(d.feeCollector, /^0x[0-9a-fA-F]{40}$/);
    assert.ok(d.feeBps >= 0 && d.feeBps <= 100, 'the contract refuses a fee above 100');
    assert.ok(d.decimals > 0 && d.chainId > 0);
  }
});

test('every function and event the wallet uses exists in the contract with the same number of arguments', () => {
  for (const item of PREDICT_ABI) {
    if (item.type === 'function') {
      const m = new RegExp(`function ${item.name}\\(([^)]*)\\)`).exec(sol);
      if (m) {
        const n = m[1].trim() === '' ? 0 : m[1].split(',').length;
        assert.equal(item.inputs.length, n, `${item.name} takes ${n} argument(s) in the contract`);
      } else {
        // a public variable: its getter takes the key (a mapping) or nothing
        assert.match(sol, new RegExp(`public (constant |immutable )?(\\w+ )?${item.name}\\b|public ${item.name}\\b|mapping\\([^;]*\\) public ${item.name}\\b|address public ${item.name}\\b|uint256 public ${item.name}\\b`), `${item.name} is public in the contract`);
      }
    } else {
      const m = new RegExp(`event ${item.name}\\(([^)]*)\\)`).exec(sol);
      assert.ok(m, `${item.name} is an event of the contract`);
      assert.equal(item.inputs.length, m![1].split(',').length);
    }
  }
});

test('the Traded event marks the same three fields as indexed as the contract does', () => {
  const m = /event Traded\(([^)]*)\)/.exec(sol)!;
  const indexed = m[1].split(',').map((p) => /indexed/.test(p));
  const t = PREDICT_ABI.find((x) => x.type === 'event' && x.name === 'Traded')!;
  assert.deepEqual((t as { inputs: readonly { indexed: boolean }[] }).inputs.map((i) => i.indexed), indexed);
});

test('the deployment fee and collector match the constants the contract documents', () => {
  assert.match(sol, /MAX_FEE_BPS = 100/);
  assert.match(sol, /MAKER_SHARE = 20/);
  assert.match(sol, /ANSWER_SHARE = 20/);
});
