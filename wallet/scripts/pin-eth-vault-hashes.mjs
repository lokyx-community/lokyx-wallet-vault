// Prints keccak256 of the runtime code of each vault contract as deployed on a network, to be pinned in
// src/lib/ethvault-core.ts (CONTRACTS[...].codeHash). Run it against Base or Arbitrum MAINNET (where the audited
// deployments live), compare with the Safe and Zodiac release notes, then paste the values:
//   node scripts/pin-eth-vault-hashes.mjs https://mainnet.base.org
import { createPublicClient, http, keccak256 } from 'viem';
import { readFileSync } from 'node:fs';

const rpc = process.argv[2];
if (!rpc) { console.error('usage: node scripts/pin-eth-vault-hashes.mjs <rpc url>'); process.exit(1); }
const src = readFileSync(new URL('../src/lib/ethvault-core.ts', import.meta.url), 'utf8');
const rows = [...src.matchAll(/^\s+(\w+): \{ address: '(0x[0-9a-fA-F]{40})'/gm)];
const c = createPublicClient({ transport: http(rpc) });
for (const [, name, address] of rows) {
  const code = await c.getCode({ address });
  console.log(`${name.padEnd(20)} ${address} ${code && code !== '0x' ? keccak256(code) : 'NOT DEPLOYED'}`);
}
