// Gift cards: a fresh key that holds the coins. Whoever has the card (a link or QR with the key) can move
// them into their own wallet, and the person who made it can take them back until then. Pure, so it is tested
// (test/gift.test.ts); gifts.ts does the network side.

import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base58 } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { privateKeyToAccount } from 'viem/accounts';
import { addressFromPrivateKey } from './lokyx.ts';
import { BTC_NETS, type BtcNet } from './multichain-core.ts';
import { tronAddressFromPub } from './tron-core.ts';

export type GiftCoin = 'lyx' | 'btc' | 'eth' | 'sol' | 'trx';
export const PREFIX = 'lokyx-gift';

/** A fresh key. Solana's is a plain ed25519 seed; the others are secp256k1 keys. */
export const newGiftKey = (coin: GiftCoin = 'lyx'): Uint8Array => (coin === 'sol' ? ed25519.utils.randomSecretKey() : secp256k1.utils.randomSecretKey());

/** The address that holds the gift's coins. */
export function giftAddress(coin: GiftCoin, sk: Uint8Array, net: BtcNet = 'testnet4'): string {
  if (coin === 'lyx') return addressFromPrivateKey(sk);
  if (coin === 'eth') return privateKeyToAccount(`0x${bytesToHex(sk)}`).address;
  if (coin === 'sol') return base58.encode(ed25519.getPublicKey(sk));
  if (coin === 'trx') return tronAddressFromPub(secp256k1.getPublicKey(sk, false));
  return btc.p2wpkh(secp256k1.getPublicKey(sk, true), BTC_NETS[net].net).address!;
}

/** What the card carries: lokyx-gift:<coin>:<64 hex>. Anyone holding this can take the coins. */
export const encodeGift = (coin: GiftCoin, sk: Uint8Array) => `${PREFIX}:${coin}:${bytesToHex(sk)}`;

export function parseGift(text: string): { coin: GiftCoin; sk: Uint8Array } | null {
  const m = text.trim().match(/lokyx-gift:(lyx|btc|eth|sol|trx):([0-9a-f]{64})/i);
  if (!m) return null;
  const sk = hexToBytes(m[2].toLowerCase());
  const coin = m[1].toLowerCase() as GiftCoin;
  if (coin !== 'sol' && !secp256k1.utils.isValidSecretKey(sk)) return null;
  if (coin === 'sol' && sk.every((b) => b === 0)) return null;
  return { coin, sk };
}

/** Bitcoin: everything the gift holds, less the fee, to one output (P2WPKH sizes: 10.5 + 68 per input + 31). */
export function btcSweepAmount(total: bigint, inputs: number, rate: number): { amount: bigint; fee: bigint } {
  const fee = BigInt(Math.ceil((10.5 + 68 * inputs + 31) * rate));
  return { amount: total - fee, fee };
}
