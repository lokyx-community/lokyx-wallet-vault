// The keys, the accounts made from them, and whether the wallet is open.
//
// The 24 words and each account's private key live in the phone's secure storage (Keychain on
// iPhone, Keystore-backed storage on Android). Nothing leaves the phone. While the wallet is
// locked, keys stay in storage; they're read only to sign, after Face ID, a fingerprint or the
// passcode says it's you.

import { Platform } from 'react-native';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { allAddresses } from './multichain-core.ts';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes, randomBytes } from '@noble/hashes/utils.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { addressFromPrivateKey, deriveKey, normalizeMnemonic, signTransfer, signContract, signOp, signSwap, minTransferFee, minFee, type ContractOp, type Op, type SignedTx, type SwapOp } from './lokyx';
import { getItem, removeItem, setItem } from './kv';
import { secrets, initSecretMode, keysLost, upgradeMode, setFaceUnlock as moveToFace } from './secrets';
import { restoreVerified, retryRead, type RestoreResult, type RetryResult } from './recovery-core';
import { isMnemonic } from './lokyx';
import { markStarted, markRotationStarted } from './watch';
import { store, useStore } from './store';
import { rpc, type Account, type ChainInfo } from './rpc';
import { decoyOpen, reloadForSwitch } from './ns';
import { newMnemonic } from './lokyx';

export interface AccountRef {
  index: number;
  name: string;
  address: string;
  /** Added from a private key, not made from the 24 words: the words don't bring it back. */
}

export interface Settings {
  /** Face ID or fingerprint, when the phone has it. The passcode always works too. */
  biometrics: boolean;
  hideBalance: boolean;
  /** Lock again after this many seconds in the background. */
  autoLock: number;
  /** Ask before every payment, or only above this many LYX (empty = always). */
  askAbove: string;
  /** Sending more than this many LYX in a day also needs the passcode (empty = no limit). */
  dailyLimit: string;
  /** A notification for every payment that leaves the wallet, from this phone or anywhere else. */
  sendAlerts: boolean;
  /** Keep a small service running so vault withdrawals and payments are told within seconds, not every 15 minutes (Android). */
  liveAlerts: boolean;
}

const DEFAULTS: Settings = { biometrics: true, hideBalance: false, autoLock: 60, askAbove: '', dailyLimit: '', sendAlerts: true, liveAlerts: true };

interface State {
  ready: boolean;
  exists: boolean;
  locked: boolean;
  accounts: AccountRef[];
  current: number;
  settings: Settings;
}

export const wallet = store<State>({ ready: false, exists: false, locked: true, accounts: [], current: 0, settings: DEFAULTS });
export const useWallet = () => useStore(wallet);

export function useAccountRef(): AccountRef | undefined {
  const w = useWallet();
  return w.accounts.find((a) => a.index === w.current) ?? w.accounts[0];
}
export const currentAddress = () => {
  const w = wallet.get();
  return (w.accounts.find((a) => a.index === w.current) ?? w.accounts[0])?.address ?? '';
};

const K = { phrase: 'w.phrase', key: (i: number) => `w.key.${i}`, accounts: 'w.accounts', current: 'w.current', settings: 'w.settings', pin: 'w.pin' };

export async function load() {
  await initSecretMode();
  const [list, cur, set, pin] = await Promise.all([getItem(K.accounts), getItem(K.current), getItem(K.settings), getItem(K.pin)]);
  // No passcode means setup stopped half way; start it again.
  const accounts: AccountRef[] = list && pin ? JSON.parse(list) : [];
  wallet.set({
    ready: true,
    exists: accounts.length > 0,
    locked: accounts.length > 0,
    accounts,
    current: cur ? Number(cur) : 0,
    settings: { ...DEFAULTS, ...(set ? JSON.parse(set) : {}) },
  });
}

/** Lets the screen paint before the slow key math starts. */
const later = <T>(f: () => T) => new Promise<T>((res, rej) => setTimeout(() => {
  try {
    res(f());
  } catch (e) {
    rej(e);
  }
}, 30));

/** Save a new or restored wallet. The first account is made straight away. */
export async function createFromPhrase(phrase: string) {
  const words = normalizeMnemonic(phrase);
  const sk = await later(() => deriveKey(words, 0));
  const first: AccountRef = { index: 0, name: 'Main', address: addressFromPrivateKey(sk) };
  // a restore after lost biometrics: clear what can't be read before writing fresh
  await secrets.del(K.phrase).catch(() => {});
  await secrets.del(K.key(0)).catch(() => {});
  keysLost.set(false);
  await removeItem('w.addrs');
  reset();
  await secrets.set(K.phrase, words);
  await secrets.set(K.key(0), bytesToHex(sk));
  sk.fill(0);
  // Bitcoin and Ethereum addresses are made now, while the words are in hand, so they never wait on a prompt later.
  const chains = await later(() => allAddresses(words));
  await setItem('w.addrs', JSON.stringify(chains));
  await setItem(K.accounts, JSON.stringify([first]));
  await setItem(K.current, '0');
  // Not marked as existing until the passcode is set, so a half-finished setup starts over.
  wallet.set((w) => ({ ...w, accounts: [first], current: 0 }));
}

export async function addAccount(name: string) {
  const phrase = await secrets.get(K.phrase);
  if (!phrase) throw new Error('No recovery words on this phone');
  const w = wallet.get();
  const index = Math.max(-1, ...w.accounts.map((a) => a.index)) + 1;
  const sk = await later(() => deriveKey(phrase, index));
  const a: AccountRef = { index, name: name.trim() || `Account ${index + 1}`, address: addressFromPrivateKey(sk) };
  await secrets.set(K.key(index), bytesToHex(sk));
  sk.fill(0);
  const accounts = [...w.accounts, a];
  await setItem(K.accounts, JSON.stringify(accounts));
  wallet.set((x) => ({ ...x, accounts }));
  await switchAccount(index);
  return a;
}

export async function renameAccount(index: number, name: string) {
  const accounts = wallet.get().accounts.map((a) => (a.index === index ? { ...a, name: name.trim() || a.name } : a));
  await setItem(K.accounts, JSON.stringify(accounts));
  wallet.set((x) => ({ ...x, accounts }));
}

export async function switchAccount(index: number) {
  await setItem(K.current, String(index));
  wallet.set((x) => ({ ...x, current: index }));
}

export async function updateSettings(p: Partial<Settings>) {
  const settings = { ...wallet.get().settings, ...p };
  await setItem(K.settings, JSON.stringify(settings));
  wallet.set((x) => ({ ...x, settings }));
}

/** Things that cache anything derived from the words register here to be cleared on wipe or restore. */
export const resetHooks: (() => void)[] = [];
const reset = () => resetHooks.forEach((f) => f());

export const readPhrase = () => secrets.get(K.phrase);

/** The current account's LYX private key as hex, or null if this phone has none for it. Only for showing it to its owner. */
export const readKeyHex = () => secrets.get(K.key(wallet.get().current));

/** Removes everything from this phone. The words are the only way back. */
export async function wipe() {
  if (decoyOpen.get()) {
    decoyOpen.set(false);
    await clearDecoyData();
    await removeItem(DECOY);
    wallet.set((w) => ({ ...w, locked: true, exists: true }));
    await reloadAccounts();
    await reloadForSwitch();
    return;
  }
  for (const a of wallet.get().accounts) await secrets.del(K.key(a.index));
  await secrets.del(K.phrase);
  keysLost.set(false);
  // gift card keys: the list says which ones this phone holds
  try {
    for (const g of JSON.parse((await getItem('w.gifts')) ?? '[]') as { address: string }[]) await secrets.del(`gift.${g.address}`).catch(() => {});
  } catch {}
  for (const k of ['w.gifts', 'w.btcms', 'w.ethms', 'w.shared', 'w.boardposts', 'w.tokenlocks', K.accounts, K.current, K.settings, K.pin, 'w.addrs', 'w.chains', 'w.ethtokens', 'w.dest.btc', 'w.dest.eth', 'w.dest.sol', 'w.dest.trx', 'w.started', 'w.told', 'w.nodes', 'w.pin', 'w.secmode', 'w.tokens', 'w.contacts', 'w.pending', 'w.sites', 'w.recent', 'w.jars', 'w.capsules', 'w.genesis', 'w.swaps', 'w.swapcfg', 'browser.bookmarks', 'w.watch', 'w.spent', 'w.backup.ok', 'w.trusted', 'w.trustprot', 'w.newdev', 'w.towers']) await removeItem(k);
  // the decoy goes with the real wallet
  await clearDecoyData().catch(() => {});
  await removeItem(DECOY).catch(() => {});
  reset();
  wallet.set({ ready: true, exists: false, locked: false, accounts: [], current: 0, settings: DEFAULTS });
}

// ---------- passcode ----------

const pinHash = (salt: Uint8Array, pin: string) => bytesToHex(sha256(concatBytes(salt, utf8ToBytes(`lokyx/pin/${pin}`))));

export async function setPasscode(pin: string) {
  const salt = randomBytes(16);
  if (decoyOpen.get()) {
    // Never touch the real passcode from inside the decoy.
    await setItem(DECOY, JSON.stringify({ salt: bytesToHex(salt), hash: pinHash(salt, pin) }));
    wallet.set((w) => ({ ...w, exists: w.accounts.length > 0, locked: false }));
    return;
  }
  await setItem(K.pin, JSON.stringify({ salt: bytesToHex(salt), hash: pinHash(salt, pin), fails: 0, until: 0 }));
  wallet.set((w) => ({ ...w, exists: w.accounts.length > 0, locked: false }));
}

export const hasPasscode = async () => !!(await getItem(K.pin));

/** Checks the passcode. After five misses in a row it makes you wait, longer each time. */
export async function checkPasscode(pin: string): Promise<{ ok: boolean; wait?: number; decoy?: boolean }> {
  const raw = await getItem(K.pin);
  if (!raw) return { ok: false };
  const p = JSON.parse(raw) as { salt: string; hash: string; fails: number; until: number };
  if (!p || typeof p.salt !== 'string' || typeof p.hash !== 'string') return { ok: false };
  const now = Date.now();
  if (p.until > now) return { ok: false, wait: Math.ceil((p.until - now) / 1000) };
  if (pinHash(hexToBytes(p.salt), pin) === p.hash) {
    if (p.fails) await setItem(K.pin, JSON.stringify({ ...p, fails: 0, until: 0 }));
    return { ok: true };
  }
  const d = await getItem(DECOY);
  if (d) {
    const q = JSON.parse(d) as { salt: string; hash: string };
    if (pinHash(hexToBytes(q.salt), pin) === q.hash) {
      if (p.fails) await setItem(K.pin, JSON.stringify({ ...p, fails: 0, until: 0 }));
      return { ok: true, decoy: true };
    }
  }
  const fails = p.fails + 1;
  const until = fails >= 5 ? now + 30_000 * 2 ** (fails - 5) : 0;
  await setItem(K.pin, JSON.stringify({ ...p, fails, until }));
  return { ok: false, wait: until ? Math.ceil((until - now) / 1000) : undefined };
}

export const unlock = () => {
  wallet.set((w) => ({ ...w, locked: false }));
  // a phone that has gained a biometric since the keys were stored moves them to the stronger mode
  const w = wallet.get();
  void upgradeMode([K.phrase, ...w.accounts.map((a) => K.key(a.index))]);
};

/** The keys-lost screen's "Try again": read once more. Nothing is erased; only a clean read clears the screen. */
export const retryKeys = (): Promise<RetryResult> => retryRead(() => secrets.get(K.phrase), () => keysLost.set(false));

/**
 * The keys-lost screen's "Restore": checks the typed words against the address this phone already holds
 * and only then replaces the stored keys. Wrong words change nothing. The wallet is never wiped.
 */
export async function restoreKeys(words: string): Promise<RestoreResult> {
  const r = await restoreVerified({
    words,
    stored: wallet.get().accounts.map((a) => ({ index: a.index, address: a.address })),
    isMnemonic,
    normalize: normalizeMnemonic,
    derive: (w, i) => later(() => deriveKey(w, i)),
    addressOf: addressFromPrivateKey,
    toHex: bytesToHex,
    del: (n) => secrets.del(n),
    set: (n, v) => secrets.set(n, v),
    names: { phrase: K.phrase, key: K.key },
  });
  if (r.ok) keysLost.set(false);
  return r;
}
export const lock = () => {
  if (decoyOpen.get()) {
    decoyOpen.set(false);
    wallet.set((w) => ({ ...w, locked: true, exists: true }));
    void reloadAccounts().then(reloadForSwitch);
    return;
  }
  wallet.set((w) => ({ ...w, locked: w.exists }));
};

// ---------- the decoy wallet ----------
// A second, complete wallet with its own 24 words, opened by its own passcode. Someone who forces you to
// unlock sees a normal wallet; the real one is never shown, changed or removed from inside it.

const DECOY = 'w.decoy';
const DECOY_KEYS = ['d.accounts', 'd.current', 'd.addrs', 'd.ethtokens', 'd.dest.btc', 'd.dest.eth', 'd.started', 'd.told', 'd.tokens', 'd.contacts', 'd.pending', 'd.sites', 'd.recent', 'd.jars', 'd.capsules', 'd.swaps', 'd.swapcfg'];

export const hasDecoy = async () => !!(await getItem(DECOY));
export const inDecoy = () => decoyOpen.get();

async function reloadAccounts() {
  const [list, cur] = await Promise.all([getItem(K.accounts), getItem(K.current)]);
  const accounts: AccountRef[] = list ? JSON.parse(list) : [];
  wallet.set((w) => ({ ...w, accounts, current: cur ? Number(cur) : accounts[0]?.index ?? 0 }));
}

/** The address of the decoy's first account, for topping it up from the real wallet. */
export async function decoyAddress(): Promise<string | null> {
  const raw = await getItem('d.accounts');
  return raw ? (JSON.parse(raw) as AccountRef[])[0]?.address ?? null : null;
}

async function clearDecoyData() {
  const raw = await getItem('d.accounts');
  const list: AccountRef[] = raw ? JSON.parse(raw) : [];
  for (const a of list) await secrets.del(`d.key.${a.index}`).catch(() => {});
  for (let i = 0; i < 4; i++) await secrets.del(`d.key.${i}`).catch(() => {});
  await secrets.del('d.phrase').catch(() => {});
  for (const k of DECOY_KEYS) await removeItem(k).catch(() => {});
}

/** Makes a fresh decoy wallet and its passcode. Returns the decoy's address. */
export async function setupDecoy(pin: string): Promise<string> {
  if (decoyOpen.get()) throw new Error('Not available here');
  if (!/^\d{6}$/.test(pin)) throw new Error('Six digits');
  const raw = await getItem(K.pin);
  if (!raw) throw new Error('Set your passcode first');
  const p = JSON.parse(raw) as { salt: string; hash: string };
  if (pinHash(hexToBytes(p.salt), pin) === p.hash) throw new Error("The decoy passcode can't be the same as your real one");
  await clearDecoyData();
  const phrase = newMnemonic();
  const sk = await later(() => deriveKey(phrase, 0));
  const first: AccountRef = { index: 0, name: 'Main', address: addressFromPrivateKey(sk) };
  decoyOpen.set(true);
  try {
    await secrets.set(K.phrase, phrase);
    await secrets.set(K.key(0), bytesToHex(sk));
    await setItem(K.accounts, JSON.stringify([first]));
    await setItem(K.current, '0');
  } finally {
    decoyOpen.set(false);
    sk.fill(0);
  }
  const salt = randomBytes(16);
  await setItem(DECOY, JSON.stringify({ salt: bytesToHex(salt), hash: pinHash(salt, pin) }));
  return first.address;
}

export async function removeDecoy() {
  if (decoyOpen.get()) throw new Error('Not available here');
  await clearDecoyData();
  await removeItem(DECOY);
}

/** After the decoy passcode: switch every store over to the decoy wallet, then open it. */
export async function openDecoy() {
  decoyOpen.set(true);
  await reloadAccounts();
  await reloadForSwitch();
  wallet.set((w) => ({ ...w, exists: true, locked: false }));
}

// ---------- signing ----------

async function withKey<T>(f: (sk: Uint8Array) => T): Promise<T> {
  const w = wallet.get();
  const hex = await secrets.get(K.key(w.current));
  if (!hex) throw new Error('This account has no key on this phone');
  const sk = hexToBytes(hex);
  try {
    return f(sk);
  } finally {
    sk.fill(0);
  }
}

/** For swaps: the LOKYX key, used to work out the swap's secret and bitcoin keys. Nothing is stored. */
export const withLyxKey = <T>(f: (sk: Uint8Array) => T) => withKey(f);

/** Sign and send a swap lock, claim or refund. Returns the transaction hash (a lock's hash is its id). */
export async function sendSwap(op: SwapOp, amount = 0n): Promise<string> {
  const { chainId, nonce, balance } = await chainAndNonce();
  if (op.kind === 'lock' && amount >= balance) throw new Error("You don't have enough LYX for that and the fee");
  const tx = await withKey((sk) => signSwap(op, chainId, nonce, sk, amount));
  return broadcast(tx);
}

async function chainAndNonce() {
  const [info, acct] = await Promise.all([rpc<ChainInfo>('lyx_chainInfo'), rpc<Account>('lyx_getAccount', { address: currentAddress() })]);
  const expires = BigInt(info.height) + BigInt(Math.floor(86_400 / Math.max(1, info.targetBlockTime)));
  return { chainId: BigInt(info.chainId), nonce: BigInt(acct.pendingNonce), balance: BigInt(acct.balance), expires };
}

export const transferFee = () => minTransferFee();

/** Sign and send LYX. Returns the transaction hash. */
export async function sendLyx(to: string, value: bigint): Promise<string> {
  const { chainId, nonce, balance, expires } = await chainAndNonce();
  const fee = minTransferFee();
  if (value + fee > balance) throw new Error("You don't have enough LYX for that and the fee");
  // A transfer that isn't mined within a day is dropped rather than left to surprise anyone.
  const tx = await withKey((sk) => signTransfer({ chainId, nonce, to, value, fee, expires }, sk));
  return broadcast(tx);
}

/** Sign and send a contract call or deploy. */
export async function sendContract(op: ContractOp, to: string, value = 0n): Promise<string> {
  const { chainId, nonce } = await chainAndNonce();
  const tx = await withKey((sk) => signContract(op, to, chainId, nonce, sk, value));
  return broadcast(tx);
}

/** The fee a deploy or call pays: its size plus the whole gas limit (unused gas comes back). */
export const contractFee = (op: ContractOp, to: string, value = 0n) =>
  minFee(
    { chainId: 0n, nonce: 0n },
    op.kind === 'deploy' ? { kind: 'deploy', value, code: op.code, abi: op.abi, input: op.input, gas: op.gas } : { kind: 'call', to, value, input: op.input, gas: op.gas },
  );

/**
 * Sign any operation and send it. By default the current account signs for itself. With `as`, a different
 * key signs for another account (the vault recovery key cancelling or sweeping): `as.from` is the address
 * that sends, and the chain takes the fee from the vault.
 */
export async function sendOp(op: Op, as?: { sk: Uint8Array; from?: string }): Promise<string> {
  const sk = as?.sk;
  const from = as?.from ?? (sk ? addressFromPrivateKey(sk) : currentAddress());
  const [info, acct] = await Promise.all([rpc<ChainInfo>('lyx_chainInfo'), rpc<Account>('lyx_getAccount', { address: from })]);
  const f = { chainId: BigInt(info.chainId), nonce: BigInt(acct.pendingNonce), from, expires: BigInt(info.height) + BigInt(Math.floor(86_400 / Math.max(1, info.targetBlockTime))) };
  const tx = sk ? signOp(op, f, sk) : await withKey((k) => signOp(op, f, k));
  const hash = await broadcast(tx);
  // things this phone started are not reported back to it as surprises
  if (op.kind === 'keyRotate') await markRotationStarted(from, op.newKey).catch(() => {});
  else await markStarted(hash).catch(() => {});
  return hash;
}

async function broadcast(tx: SignedTx) {
  const h = await rpc<string>('lyx_sendRawTransaction', { tx: bytesToHex(tx.bytes) });
  return h || tx.hash;
}

/** Sign a message for a website, so it can tell this address is yours. Never a transaction. */
export async function signMessage(message: string): Promise<string> {
  const digest = keccak_256(concatBytes(utf8ToBytes('LOKYX/msg/v1'), utf8ToBytes(message)));
  const sig = await withKey((sk) => secp256k1.sign(digest, sk, { prehash: false, format: 'recovered' }));
  return bytesToHex(concatBytes(sig.slice(1, 65), sig.slice(0, 1)));
}

export const isWeb = Platform.OS === 'web';

/** Face unlock on Android: moves every stored key (real wallet and decoy) between the two storage modes. */
export async function setFaceUnlock(on: boolean) {
  if (decoyOpen.get()) return 'unavailable' as const;
  const names = [K.phrase, ...wallet.get().accounts.map((a) => K.key(a.index))];
  try {
    const list = JSON.parse((await getItem('d.accounts')) ?? '[]') as { index: number }[];
    names.push('d.phrase', ...list.map((a) => `d.key.${a.index}`));
  } catch {
    /* no decoy wallet */
  }
  return moveToFace(on, names);
}
