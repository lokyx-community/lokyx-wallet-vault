// must match the rust node byte for byte:
// src/lib/lokyx.test.ts checks them against testdata/vectors.json, which the node generates.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils.js';
import { bech32m } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

export const HRP = 'lyx';
export const COIN = 10n ** 18n;
export const DECIMALS = 18;
export const MIN_FEE_PER_BYTE = 1_000_000_000_000n;
export const COIN_TYPE = 7701;

export { bytesToHex, hexToBytes };

// ---------- addresses ----------

export function addressFromBytes(a20: Uint8Array): string {
  const payload = new Uint8Array(21);
  payload.set(a20, 1);
  return bech32m.encode(HRP, bech32m.toWords(payload));
}

export function addressToBytes(addr: string): Uint8Array {
  const s = addr.trim();
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) throw new Error('Mixed-case address');
  const { prefix, words } = bech32m.decode(s.toLowerCase() as `${string}1${string}`);
  if (prefix !== HRP) throw new Error('Address must start with lyx1');
  const bytes = bech32m.fromWords(words);
  if (bytes.length !== 21) throw new Error('Wrong address length');
  if (bytes[0] !== 0) throw new Error(`Unsupported address version ${bytes[0]}`);
  return bytes.slice(1);
}

export function isAddress(s: string): boolean {
  try {
    addressToBytes(s);
    return true;
  } catch {
    return false;
  }
}

export function addressFromPrivateKey(sk: Uint8Array): string {
  const pub = secp256k1.getPublicKey(sk, false);
  return addressFromBytes(keccak_256(pub.slice(1)).slice(12));
}

// ---------- keys ----------

export const newMnemonic = () => generateMnemonic(wordlist, 256);
/** 12 words, for vault recovery keys. */
export const newShortMnemonic = () => generateMnemonic(wordlist, 128);

export function normalizeMnemonic(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(' ');
}

export const isMnemonic = (phrase: string) => validateMnemonic(normalizeMnemonic(phrase), wordlist);

export function deriveKey(phrase: string, index = 0, passphrase = ''): Uint8Array {
  const seed = mnemonicToSeedSync(normalizeMnemonic(phrase), passphrase);
  const key = HDKey.fromMasterSeed(seed).derive(`m/44'/${COIN_TYPE}'/0'/0/${index}`).privateKey;
  seed.fill(0);
  if (!key) throw new Error('Key derivation failed');
  return key;
}

// ---------- transactions, format v2 (borsh layout, see src/tx.rs) ----------

export const TX_VERSION = 2;
export const MAX_MEMO_BYTES = 64;
export const MAX_BATCH = 256;
/** The signature is an enum: one tag byte (0 = secp256k1 recoverable), 64 bytes r||s, one recovery id. */
const SIG_BYTES = 1 + 64 + 1;
/** Base units per unit of gas. */
export const GAS_PRICE = 1_000_000_000n;

function uintLE(v: bigint, bytes: number): Uint8Array {
  if (v < 0n || v >= 1n << BigInt(bytes * 8)) throw new Error('Integer out of range');
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function fixed32(b: Uint8Array): Uint8Array {
  if (b.length !== 32) throw new Error('Expected 32 bytes');
  return b;
}

function vecU8(b: Uint8Array): Uint8Array {
  return concatBytes(uintLE(BigInt(b.length), 4), b);
}

export interface VaultSettings {
  recovery: string;
  safe: string;
  /** blocks */
  delay: bigint;
  /** base units per day */
  allowance: bigint;
  heir?: { address: string; inactiveBlocks: bigint } | null;
}

/** What a transaction does. The names are the ones in testdata/vectors.json. */
export type Op =
  | { kind: 'transfer'; to: string; value: bigint }
  | { kind: 'batch'; payments: { to: string; amount: bigint }[] }
  | { kind: 'swapLock'; amount: bigint; hashlock: Uint8Array; recipient: string; refundHeight: bigint }
  | { kind: 'swapClaim'; lock: Uint8Array; secret: Uint8Array }
  | { kind: 'swapRefund'; lock: Uint8Array }
  | { kind: 'vaultCreate'; settings: VaultSettings }
  | { kind: 'vaultWithdraw'; to: string; amount: bigint }
  | { kind: 'vaultUpdate'; settings: VaultSettings }
  | { kind: 'vaultClose' }
  | { kind: 'vaultCancel'; id: Uint8Array }
  | { kind: 'vaultSweep'; vault: string }
  | { kind: 'vaultHeirClaim'; vault: string }
  | { kind: 'keyCommitPq'; hash: Uint8Array }
  | { kind: 'keyRotate'; newKey: string }
  | { kind: 'keyCancelRotate'; account: string }
  | { kind: 'timelockLock'; beneficiary: string; amount: bigint; unlockHeight: bigint }
  | { kind: 'timelockClaim'; id: Uint8Array }
  | { kind: 'tokenCreate'; symbol: string; name: string; decimals: number; supply: bigint }
  | { kind: 'tokenTransfer'; token: Uint8Array; to: string; amount: bigint }
  | { kind: 'tokenBurn'; token: Uint8Array; amount: bigint }
  | { kind: 'deploy'; value: bigint; code: Uint8Array; abi: string; input: Uint8Array; gas: bigint }
  | { kind: 'call'; to: string; value: bigint; input: Uint8Array; gas: bigint };

function encodeSettings(s: VaultSettings): Uint8Array {
  return concatBytes(
    addressToBytes(s.recovery),
    addressToBytes(s.safe),
    uintLE(s.delay, 8),
    uintLE(s.allowance, 16),
    s.heir ? concatBytes(Uint8Array.of(1), addressToBytes(s.heir.address), uintLE(s.heir.inactiveBlocks, 8)) : Uint8Array.of(0),
  );
}

const tag = (...t: number[]) => Uint8Array.from(t);

export function encodeOp(op: Op): Uint8Array {
  switch (op.kind) {
    case 'transfer':
      return concatBytes(tag(0), addressToBytes(op.to), uintLE(op.value, 16));
    case 'batch':
      if (op.payments.length < 1 || op.payments.length > MAX_BATCH) throw new Error(`A batch has 1 to ${MAX_BATCH} payments`);
      return concatBytes(
        tag(1),
        uintLE(BigInt(op.payments.length), 4),
        ...op.payments.map((p) => concatBytes(addressToBytes(p.to), uintLE(p.amount, 16))),
      );
    case 'swapLock':
      return concatBytes(tag(2, 0), uintLE(op.amount, 16), fixed32(op.hashlock), addressToBytes(op.recipient), uintLE(op.refundHeight, 8));
    case 'swapClaim':
      return concatBytes(tag(2, 1), fixed32(op.lock), fixed32(op.secret));
    case 'swapRefund':
      return concatBytes(tag(2, 2), fixed32(op.lock));
    case 'vaultCreate':
      return concatBytes(tag(3, 0), encodeSettings(op.settings));
    case 'vaultWithdraw':
      return concatBytes(tag(3, 1), addressToBytes(op.to), uintLE(op.amount, 16));
    case 'vaultUpdate':
      return concatBytes(tag(3, 2), encodeSettings(op.settings));
    case 'vaultClose':
      return tag(3, 3);
    case 'vaultCancel':
      return concatBytes(tag(3, 4), fixed32(op.id));
    case 'vaultSweep':
      return concatBytes(tag(3, 5), addressToBytes(op.vault));
    case 'vaultHeirClaim':
      return concatBytes(tag(3, 6), addressToBytes(op.vault));
    case 'keyCommitPq':
      return concatBytes(tag(4, 0), fixed32(op.hash));
    case 'keyRotate':
      return concatBytes(tag(4, 1), addressToBytes(op.newKey));
    case 'keyCancelRotate':
      return concatBytes(tag(4, 2), addressToBytes(op.account));
    case 'timelockLock':
      return concatBytes(tag(5, 0), addressToBytes(op.beneficiary), uintLE(op.amount, 16), uintLE(op.unlockHeight, 8));
    case 'timelockClaim':
      return concatBytes(tag(5, 1), fixed32(op.id));
    case 'tokenCreate':
      return concatBytes(
        tag(6, 0),
        vecU8(utf8ToBytes(op.symbol)),
        vecU8(utf8ToBytes(op.name)),
        tag(op.decimals),
        uintLE(op.supply, 16),
      );
    case 'tokenTransfer':
      return concatBytes(tag(6, 1), fixed32(op.token), addressToBytes(op.to), uintLE(op.amount, 16));
    case 'tokenBurn':
      return concatBytes(tag(6, 2), fixed32(op.token), uintLE(op.amount, 16));
    case 'deploy':
      return concatBytes(tag(7), uintLE(op.value, 16), vecU8(op.code), vecU8(utf8ToBytes(op.abi)), vecU8(op.input), uintLE(op.gas, 8));
    case 'call':
      return concatBytes(tag(8), addressToBytes(op.to), uintLE(op.value, 16), vecU8(op.input), uintLE(op.gas, 8));
  }
}

/** Everything in a transaction except what it does. */
export interface TxFields {
  chainId: bigint;
  /** The account the transaction acts on. Defaults to the address of the signing key. */
  from?: string;
  nonce: bigint;
  /** Last block it may be included in; 0 (the default) means never expires. */
  expires?: bigint;
  memo?: Uint8Array;
  /** Defaults to the minimum for its size (and gas). */
  fee?: bigint;
}

function encodeWith(f: TxFields, from: string, fee: bigint, op: Op): Uint8Array {
  const memo = f.memo ?? new Uint8Array();
  if (memo.length > MAX_MEMO_BYTES) throw new Error(`A memo is at most ${MAX_MEMO_BYTES} bytes`);
  return concatBytes(
    Uint8Array.of(TX_VERSION),
    uintLE(f.chainId, 8),
    addressToBytes(from),
    uintLE(f.nonce, 8),
    uintLE(f.expires ?? 0n, 8),
    uintLE(fee, 16),
    vecU8(memo),
    encodeOp(op),
  );
}

const gasOf = (op: Op) => (op.kind === 'deploy' || op.kind === 'call' ? op.gas : 0n);

/** The least fee the node accepts: the size of the signed transaction, plus the whole gas limit for contracts. */
export function minFee(f: TxFields, op: Op): bigint {
  const size = BigInt(encodeWith(f, f.from ?? ZERO_ADDRESS, 0n, op).length + SIG_BYTES);
  return size * MIN_FEE_PER_BYTE + gasOf(op) * GAS_PRICE;
}

const ZERO_ADDRESS = addressFromBytes(new Uint8Array(20));

export function encodeTx(f: TxFields & { from: string; fee: bigint }, op: Op): Uint8Array {
  return encodeWith(f, f.from, f.fee, op);
}

export const signingHash = (f: TxFields & { from: string; fee: bigint }, op: Op) =>
  keccak_256(concatBytes(utf8ToBytes('LOKYX/tx/v2'), encodeTx(f, op)));

export interface SignedTx {
  bytes: Uint8Array;
  hash: string;
}

/** Build and sign. `from` defaults to the key's own address and `fee` to the minimum. */
export function signOp(op: Op, f: TxFields, sk: Uint8Array): SignedTx {
  const from = f.from ?? addressFromPrivateKey(sk);
  const full = { ...f, from, fee: f.fee ?? minFee({ ...f, from }, op) };
  const body = encodeTx(full, op);
  const rec = secp256k1.sign(keccak_256(concatBytes(utf8ToBytes('LOKYX/tx/v2'), body)), sk, { prehash: false, format: 'recovered' });
  // noble's "recovered" format is [recovery, r(32), s(32)]; the node expects tag || r || s || recovery.
  const bytes = concatBytes(body, Uint8Array.of(0), rec.slice(1, 65), rec.slice(0, 1));
  return { bytes, hash: bytesToHex(keccak_256(bytes)) };
}

// ---------- conveniences over signOp ----------

/** Size of a signed transfer with no memo. */
export const SIGNED_TRANSFER_BYTES = 168;
export const minTransferFee = () => BigInt(SIGNED_TRANSFER_BYTES) * MIN_FEE_PER_BYTE;

export interface Transfer extends TxFields {
  to: string;
  value: bigint;
}

export function signTransfer(t: Transfer, sk: Uint8Array): SignedTx {
  const { to, value, ...f } = t;
  return signOp({ kind: 'transfer', to, value }, f, sk);
}

// ---------- swaps (see src/swap.rs) ----------

/** Swap ops are sent here; nobody has its key. */
export const SWAP_ADDRESS = 'lyx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqym06fps';

export type SwapOp =
  | { kind: 'lock'; hashlock: Uint8Array; recipient: string; refundHeight: bigint }
  | { kind: 'claim'; lock: Uint8Array; secret: Uint8Array }
  | { kind: 'refund'; lock: Uint8Array };

/** Lock carries the amount; claim and refund carry none. */
export function signSwap(op: SwapOp, chainId: bigint, nonce: bigint, sk: Uint8Array, amount = 0n): SignedTx {
  const o: Op =
    op.kind === 'lock'
      ? { kind: 'swapLock', amount, hashlock: op.hashlock, recipient: op.recipient, refundHeight: op.refundHeight }
      : op.kind === 'claim'
        ? { kind: 'swapClaim', lock: op.lock, secret: op.secret }
        : { kind: 'swapRefund', lock: op.lock };
  return signOp(o, { chainId, nonce }, sk);
}

// ---------- contracts (see src/contract.rs) ----------

/** Deploys are sent here; nobody has its key. */
export const DEPLOY_ADDRESS = addressFromBytes(Uint8Array.from([...new Array(18).fill(0), 1, 4]));

export type ContractOp =
  | { kind: 'deploy'; code: Uint8Array; abi: string; input: Uint8Array; gas: bigint }
  | { kind: 'call'; input: Uint8Array; gas: bigint };

/** Sign a deploy or a call. The fee covers its size plus the whole gas limit; unused gas comes back. */
export function signContract(op: ContractOp, to: string, chainId: bigint, nonce: bigint, sk: Uint8Array, value = 0n): SignedTx {
  const o: Op =
    op.kind === 'deploy'
      ? { kind: 'deploy', value, code: op.code, abi: op.abi, input: op.input, gas: op.gas }
      : { kind: 'call', to, value, input: op.input, gas: op.gas };
  return signOp(o, { chainId, nonce }, sk);
}

// ---------- vaults (see src/vault.rs) ----------

/** Vault ops are sent here; nobody has its key. */
export const VAULT_ADDRESS = addressFromBytes(Uint8Array.from([...new Array(18).fill(0), 1, 2]));

export type VaultOp =
  | { kind: 'create'; settings: VaultSettings }
  | { kind: 'withdraw'; to: string; amount: bigint }
  | { kind: 'update'; settings: VaultSettings }
  | { kind: 'close' }
  | { kind: 'cancel'; id: Uint8Array }
  | { kind: 'sweep'; vault: string }
  | { kind: 'heirClaim'; vault: string };

const VAULT_KIND = {
  create: 'vaultCreate',
  withdraw: 'vaultWithdraw',
  update: 'vaultUpdate',
  close: 'vaultClose',
  cancel: 'vaultCancel',
  sweep: 'vaultSweep',
  heirClaim: 'vaultHeirClaim',
} as const;

export function signVault(op: VaultOp, chainId: bigint, nonce: bigint, sk: Uint8Array): SignedTx {
  return signOp({ ...op, kind: VAULT_KIND[op.kind] } as Op, { chainId, nonce }, sk);
}

// ---------- quantum key commitment and key rotation (see src/pqkey.rs) ----------

export const KEY_ADDRESS = addressFromBytes(Uint8Array.from([...new Array(18).fill(0), 1, 3]));

export function signPqCommit(hash: Uint8Array, chainId: bigint, nonce: bigint, sk: Uint8Array): SignedTx {
  return signOp({ kind: 'keyCommitPq', hash }, { chainId, nonce }, sk);
}

/** Hand `from` to another key after a delay (a vault's own, or a day). `sk` is the key that controls `from` now. */
export function signRotate(newKey: string, f: TxFields, sk: Uint8Array): SignedTx {
  return signOp({ kind: 'keyRotate', newKey }, f, sk);
}

/** Cancel a waiting rotation of `account`: by its own key, or by its vault's recovery key (then `from` is the recovery address). */
export function signCancelRotate(account: string, f: TxFields, sk: Uint8Array): SignedTx {
  return signOp({ kind: 'keyCancelRotate', account }, f, sk);
}

// ---------- timelocks and tokens (see src/timelock.rs, src/token.rs) ----------

export const TIMELOCK_ADDRESS = addressFromBytes(Uint8Array.from([...new Array(18).fill(0), 1, 5]));
export const TOKEN_ADDRESS = addressFromBytes(Uint8Array.from([...new Array(18).fill(0), 1, 6]));

// ---------- amounts ----------

export function formatLyx(base: bigint | string, maxFrac = DECIMALS): string {
  const v = typeof base === 'string' ? BigInt(base) : base;
  const whole = v / COIN;
  let frac = (v % COIN).toString().padStart(DECIMALS, '0').slice(0, maxFrac).replace(/0+$/, '');
  const w = whole.toLocaleString('en-US');
  return frac ? `${w}.${frac}` : w;
}

export function parseLyx(s: string): bigint {
  const t = s.trim();
  if (!/^\d*(\.\d*)?$/.test(t) || t === '' || t === '.') throw new Error('Enter an amount like 1.25');
  const [w, f = ''] = t.split('.');
  if (f.length > DECIMALS) throw new Error(`At most ${DECIMALS} decimal places`);
  return BigInt(w || '0') * COIN + BigInt((f + '0'.repeat(DECIMALS)).slice(0, DECIMALS));
}

// ---------- pixel fingerprints ----------

/**
 * 8x8 mirrored pixel pattern derived from a hash or address. Each cell is 0 (empty),
 * 1 (graphite), 2 (violet) or 3 (cyan, rare). Same input, same picture, everywhere.
 */
export function pixelPattern(input: string): number[] {
  const bytes = keccak_256(utf8ToBytes(input.toLowerCase()));
  const cells: number[] = new Array(64).fill(0);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) {
      const b = bytes[y * 4 + x];
      const v = b < 90 ? 0 : b < 170 ? 1 : b < 245 ? 2 : 3;
      cells[y * 8 + x] = v;
      cells[y * 8 + (7 - x)] = v;
    }
  }
  return cells;
}

export function shortHash(h: string, head = 6, tail = 4): string {
  if (h.length <= head + tail + 2) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}
