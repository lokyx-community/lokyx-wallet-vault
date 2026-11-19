// Gift cards on the phone: the list of cards you made (addresses only, in plain storage), their keys
// (in the secure store), balances, claiming one into your wallet, and taking one back.

import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { getItem, setItem } from './kv';
import { secrets } from './secrets';
import { store, useStore } from './store';
import { rpc, type Account } from './rpc';
import { currentAddress, sendOp } from './wallet';
import { activeNets, btcBalance, ensureAddresses, ethBalance, sweepBtc, sweepEth } from './multichain';
import { formatBtc, formatUnits } from './multichain-core';
import { formatLyx, minTransferFee } from './lokyx';
import { giftAddress, newGiftKey, type GiftCoin } from './gift-core';

export interface Gift {
  coin: GiftCoin;
  address: string;
  /** what you meant to put on it, for the label */
  amount: string;
  note: string;
  made: number;
  /** set once you took it back or saw it claimed */
  closed?: boolean;
  /** the 0.2% fee for making it, in the card's own coin, while it is still to be paid */
  fee?: { amount: string; text: string; to: string };
}

export const gifts = store<Gift[]>([]);
export const useGifts = () => useStore(gifts);

export async function loadGifts() {
  try {
    gifts.set(JSON.parse((await getItem('w.gifts')) ?? '[]'));
  } catch {}
}
async function save(list: Gift[]) {
  gifts.set(list);
  await setItem('w.gifts', JSON.stringify(list));
}
const keyName = (address: string) => `gift.${address}`;

/** Make a new card: a fresh key, kept in the secure store so you can take it back. Fund it with an ordinary send. */
export async function makeGift(coin: GiftCoin, amount: string, note: string, fee?: Gift['fee']): Promise<{ gift: Gift; sk: Uint8Array }> {
  const sk = newGiftKey();
  const address = giftAddress(coin, sk, activeNets().btc);
  await secrets.set(keyName(address), bytesToHex(sk));
  const gift: Gift = { coin, address, amount, note: note.trim(), made: Date.now(), ...(fee ? { fee } : {}) };
  await save([gift, ...gifts.get()]);
  return { gift, sk };
}

export async function giftKey(g: Gift): Promise<Uint8Array> {
  const h = await secrets.get(keyName(g.address));
  if (!h) throw new Error("This phone doesn't have that card's key any more");
  return hexToBytes(h);
}

/** What the card holds now, in words like "0.0021 tBTC". */
export async function giftBalance(coin: GiftCoin, address: string): Promise<{ raw: bigint; text: string }> {
  const nets = activeNets();
  if (coin === 'lyx') {
    const a = await rpc<Account>('lyx_getAccount', { address });
    return { raw: BigInt(a.balance), text: `${formatLyx(BigInt(a.balance), 4)} LYX` };
  }
  if (coin === 'btc') {
    const b = await btcBalance(nets.btc, address);
    const v = b.confirmed + b.pending;
    return { raw: v, text: `${formatBtc(v)} BTC` };
  }
  const v = await ethBalance(nets.eth, address);
  return { raw: v, text: `${formatUnits(v, 18, 6)} ETH` };
}

/** Move everything on a card into this wallet. Used to claim a card someone gave you, and to take back one you made. */
export async function sweepGift(coin: GiftCoin, sk: Uint8Array, onStep?: (s: string) => void): Promise<string> {
  const nets = activeNets();
  const from = giftAddress(coin, sk, nets.btc);
  if (coin === 'lyx') {
    const a = await rpc<Account>('lyx_getAccount', { address: from });
    const fee = minTransferFee();
    const bal = BigInt(a.balance);
    if (bal <= fee) throw new Error(bal === 0n ? 'This gift is empty' : 'Too little is left to cover the network fee');
    return sendOp({ kind: 'transfer', to: currentAddress(), value: bal - fee }, { sk });
  }
  onStep?.('Finding your address…');
  const mine = await ensureAddresses();
  if (coin === 'btc') return sweepBtc(nets.btc, sk, from, mine.btc[nets.btc]);
  return sweepEth(nets.eth, sk, from, mine.eth, onStep);
}

export async function closeGift(address: string) {
  await save(gifts.get().map((g) => (g.address === address ? { ...g, closed: true } : g)));
}

/** The fee has been sent (or the person chose to skip it), so stop asking. */
export async function feeSettled(address: string) {
  await save(gifts.get().map((g) => (g.address === address ? { ...g, fee: undefined } : g)));
}
