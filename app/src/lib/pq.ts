// Post-quantum backup key (see src/pqkey.rs). Derived from the recovery phrase, so nothing new to
// back up. Only its hash goes on chain for now; the key itself is only needed if ECDSA is ever
// broken and the network switches committed accounts over to it.
import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import { normalizeMnemonic } from './lokyx';

/** 48 bytes of SLH-DSA seed from the phrase, separate from every other key it makes. */
export function pqSeed(phrase: string, passphrase = ''): Uint8Array {
  const seed = mnemonicToSeedSync(normalizeMnemonic(phrase), passphrase);
  return hmac(sha512, utf8ToBytes('LOKYX/pq/v1'), seed).slice(0, 48);
}

/** The SLH-DSA-SHA2-128s public key for a phrase (takes a second or two). */
export function pqPublicKey(phrase: string): Uint8Array {
  return slh_dsa_sha2_128s.keygen(pqSeed(phrase)).publicKey;
}

/** What goes on chain: sha3-256 of the public key. */
export const pqCommitment = (phrase: string) => sha3_256(pqPublicKey(phrase));
