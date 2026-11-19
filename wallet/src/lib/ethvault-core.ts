// Vault protection on Ethereum-family test networks (Base Sepolia, Arbitrum Sepolia): pure logic, no network and no
// phone APIs, so it is tested against a real EVM (test/ethvault.test.ts). Design: docs/ETH_VAULT.md.
//
// The vault is a Safe (v1.4.1 L2). Its only owner is the RECOVERY key (from 12 words shown once). The phone's key
// is NOT an owner. It has three narrow roles:
//   - delegate of the Allowance Module: spends up to a per-token daily allowance, instantly;
//   - module of a Zodiac Delay (v1.0.1): queues anything else, which can run only after the wait;
//   - member of one Roles v1 role that may call exactly Delay.setTxNonce on the Delay (cancel the queue).
// Anyone can execute a queued item after the wait and anyone can submit a Safe transaction that the recovery key
// signed offline (so a cancel or sweep never depends on the phone having gas).

import {
  concat, decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, encodePacked, getAddress, getCreate2Address, hashTypedData, hexToBigInt, keccak256, pad, parseAbi, toHex, zeroAddress,
  type Abi, type Hex,
} from 'viem';
import { sign } from 'viem/accounts';

// ---------- networks and the exact audited deployments ----------

export type VaultNet = 'base-sepolia' | 'arbitrum-sepolia' | 'sepolia' | 'op-sepolia';

export const VAULT_NETS: Record<VaultNet, { label: string; chainId: number; rpc: string; explorer: string; real: false }> = {
  'base-sepolia': { label: 'Base Sepolia', chainId: 84532, rpc: 'https://sepolia.base.org', explorer: 'https://sepolia.basescan.org', real: false },
  'arbitrum-sepolia': { label: 'Arbitrum Sepolia', chainId: 421614, rpc: 'https://sepolia-rollup.arbitrum.io/rpc', explorer: 'https://sepolia.arbiscan.io', real: false },
  sepolia: { label: 'Ethereum Sepolia', chainId: 11155111, rpc: 'https://ethereum-sepolia-rpc.publicnode.com', explorer: 'https://sepolia.etherscan.io', real: false },
  'op-sepolia': { label: 'Optimism Sepolia', chainId: 11155420, rpc: 'https://sepolia.optimism.io', explorer: 'https://sepolia-optimism.etherscan.io', real: false },
};

/**
 * Canonical addresses. Safe's come from @safe-global/safe-deployments 1.37.67 (v1.4.1, official on both networks).
 * The module addresses are the deterministic-deployment addresses of the audited releases; they are NOT yet on these
 * testnets and must be deployed there from the same bytecode (docs/ETH_VAULT.md decision 2).
 * `codeHash` is keccak256 of the runtime code. Safe's hashes are the official published ones. A contract without a
 * pinned hash is reported as "not verified" and `scripts/pin-eth-vault-hashes.mjs` fills it in from mainnet.
 */
export const CONTRACTS = {
  safeSingleton: { address: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762', codeHash: '0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff' },
  safeProxyFactory: { address: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67', codeHash: '0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317' },
  multiSend: { address: '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526', codeHash: '0x0e4f7fc66550a322d1e7688e181b75e217e662a4f3f4d6a29b22bc61217c4b77' },
  multiSendCallOnly: { address: '0x9641d764fc13c8B624c04430C7356C1C7C8102e2', codeHash: '0xecd5bd14a08c5d2122379900b2f272bdf107a7e92423c10dd5fe3254386c9939' },
  fallbackHandler: { address: '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99', codeHash: '0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9' },
  allowanceModule: { address: '0xAA46724893dedD72658219405185Fb0Fc91e091C', codeHash: null as Hex | null }, // Safe Allowance Module v0.1.1
  delayMastercopy: { address: '0xd54895B1121A2eE3f37b502F507631FA1331BED6', codeHash: null as Hex | null }, // Zodiac Delay v1.0.1 (NOT 1.1.x)
  rolesMastercopy: { address: '0xD8DfC1d938D7D163C5231688341e9635E9011889', codeHash: null as Hex | null }, // Zodiac Roles v1.1.0 (NOT v2)
  moduleProxyFactory: { address: '0x000000000000aDdB49795b0f9bA5BC298cDda236', codeHash: null as Hex | null },
} as const satisfies Record<string, { address: Hex; codeHash: Hex | null }>;

export type Deployment = { [K in keyof typeof CONTRACTS]: Hex };
export const deploymentOf = (c: typeof CONTRACTS = CONTRACTS): Deployment =>
  Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.address])) as unknown as Deployment;

/** Zodiac releases that must never be used: Delay 1.1.x and Roles v2.1.x accept a reverting ERC-1271 "signature". */
export const FORBIDDEN_ZODIAC = ['Delay 1.1.0', 'Delay 1.1.1', 'Roles 2.1.0', 'Roles 2.1.1'];
export const ZODIAC_ADVISORY = 'https://www.gnosis.io/blog/post-mortem-gnosis-pay-vulnerability-exploit';
export const ZODIAC_ADVISORY_SAFE = 'https://help.safe.global/articles/3569845223-zodiac-module-vulnerability';

export const SENTINEL: Hex = '0x0000000000000000000000000000000000000001';
export const ETH: Hex = zeroAddress;
export const DAY_MIN = 1440;
export const MIN_WAIT = 24 * 3600;
export const DEFAULT_WAIT = 48 * 3600;
export const EXPIRY = 7 * 24 * 3600;
/** The Roles role id the phone key is a member of. */
export const PHONE_ROLE = 1;
/**
 * The Roles role the recovery key is a member of (option B). It can only cancel the queue and send the vault's coins to the
 * safe address. The Safe's own owner is then an address nobody can sign for, so the recovery key cannot do anything else.
 */
export const RECOVERY_ROLE = 2;
/**
 * The role the phone key has on the gate, a second Roles module that sits in front of the Delay. Through it the phone can queue
 * exactly two things: ETH to the safe address, and a transfer of a listed token to the safe address. No other target, no
 * delegatecall, no settings. The gate's owner is the Safe, which nobody can sign for, so none of this can be changed after the
 * vault is made. Anything bigger than the daily allowance goes to the safe address; to change the rules you make a new vault.
 */
export const GATE_ROLE = 1;
/** The owner a locked vault ends up with: nobody holds its key, so no one can sign a Safe transaction directly. */
export const DEAD: Hex = '0x000000000000000000000000000000000000dEaD';
const OP_CALL = 0;
const OP_DELEGATE = 1;

export const ABI = {
  safe: parseAbi([
    'function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)',
    'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool)',
    'function enableModule(address module)',
    'function disableModule(address prevModule, address module)',
    'function addOwnerWithThreshold(address owner, uint256 threshold)',
    'function removeOwner(address prevOwner, address owner, uint256 threshold)',
    'function swapOwner(address prevOwner, address oldOwner, address newOwner)',
    'function swapOwner(address prevOwner, address oldOwner, address newOwner)',
    'function changeThreshold(uint256 threshold)',
    'function setGuard(address guard)',
    'function setFallbackHandler(address handler)',
    'function getOwners() view returns (address[])',
    'function getThreshold() view returns (uint256)',
    'function nonce() view returns (uint256)',
    'function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)',
    'function getStorageAt(uint256 offset, uint256 length) view returns (bytes)',
    'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
    'event ExecutionFailure(bytes32 txHash, uint256 payment)',
    'event ExecutionSuccess(bytes32 txHash, uint256 payment)',
    'event EnabledModule(address indexed module)',
    'event DisabledModule(address indexed module)',
    'event ChangedGuard(address indexed guard)',
    'event ChangedThreshold(uint256 threshold)',
    'event AddedOwner(address indexed owner)',
    'event RemovedOwner(address indexed owner)',
    'event ChangedFallbackHandler(address indexed handler)',
  ]),
  factory: parseAbi(['function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address)']),
  moduleFactory: parseAbi(['function deployModule(address masterCopy, bytes initializer, uint256 saltNonce) returns (address)']),
  multiSend: parseAbi(['function multiSend(bytes transactions)']),
  delay: parseAbi([
    'function setUp(bytes initParams)',
    'function enableModule(address module)',
    'function disableModule(address prevModule, address module)',
    'function execTransactionFromModule(address to, uint256 value, bytes data, uint8 operation) returns (bool)',
    'function executeNextTx(address to, uint256 value, bytes data, uint8 operation)',
    'function setTxCooldown(uint256 cooldown)',
    'function setTxExpiration(uint256 expiration)',
    'function setTxNonce(uint256 nonce)',
    'function skipExpired()',
    'function txCooldown() view returns (uint256)',
    'function txExpiration() view returns (uint256)',
    'function txNonce() view returns (uint256)',
    'function queueNonce() view returns (uint256)',
    'function owner() view returns (address)',
    'function avatar() view returns (address)',
    'function target() view returns (address)',
    'function getTxCreatedAt(uint256 nonce) view returns (uint256)',
    'function getTxHash(uint256 nonce) view returns (bytes32)',
    'function isModuleEnabled(address module) view returns (bool)',
    'function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)',
    'event TransactionAdded(uint256 indexed queueNonce, bytes32 indexed txHash, address to, uint256 value, bytes data, uint8 operation)',
  ]),
  roles: parseAbi([
    'function setUp(bytes initParams)',
    'function assignRoles(address module, uint16[] roles, bool[] memberOf)',
    'function scopeTarget(uint16 role, address targetAddress)',
    'function scopeAllowFunction(uint16 role, address targetAddress, bytes4 functionSig, uint8 options)',
    'function allowTarget(uint16 role, address targetAddress, uint8 options)',
    'function scopeFunction(uint16 role, address targetAddress, bytes4 functionSig, bool[] isParamScoped, uint8[] paramType, uint8[] paramComp, bytes[] compValue, uint8 options)',
    'function execTransactionWithRole(address to, uint256 value, bytes data, uint8 operation, uint16 role, bool shouldRevert) returns (bool)',
    'function owner() view returns (address)',
    'function avatar() view returns (address)',
    'function target() view returns (address)',
  ]),
  allowance: parseAbi([
    'function addDelegate(address delegate)',
    'function removeDelegate(address delegate, bool removeAllowances)',
    'function setAllowance(address delegate, address token, uint96 allowanceAmount, uint16 resetTimeMin, uint32 resetBaseMin)',
    'function deleteAllowance(address delegate, address token)',
    'function executeAllowanceTransfer(address safe, address token, address to, uint96 amount, address paymentToken, uint96 payment, address delegate, bytes signature)',
    'function getTokenAllowance(address safe, address delegate, address token) view returns (uint256[5])',
    'function getTokens(address safe, address delegate) view returns (address[])',
    'function getDelegates(address safe, uint48 start, uint8 pageSize) view returns (address[] results, uint48 next)',
    'event ExecuteAllowanceTransfer(address indexed safe, address delegate, address token, address to, uint96 value, uint16 nonce)',
  ]),
  erc20: parseAbi([
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function increaseAllowance(address spender, uint256 added) returns (bool)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
    'function balanceOf(address who) view returns (uint256)',
  ]),
  signMessageLib: parseAbi(['function signMessage(bytes data)']),
};

// ---------- addresses (counterfactual, the same on every network) ----------

/** keccak256 of the SafeProxy creation code (v1.4.1), checked against the factory in tests. */
export const SAFE_PROXY_CREATION_CODE: Hex = '0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564';

export interface VaultPlan {
  /** the 12-word recovery key's address: the Safe's only owner */
  recovery: Hex;
  /** the phone's everyday address: Allowance delegate, Delay module, Roles member */
  phone: Hex;
  /** where a sweep sends everything */
  safeAddress: Hex;
}

/** Salt nonce: fixed per phone address, so the vault has the same address on every network. */
export const saltNonce = (phone: Hex) => hexToBigInt(keccak256(encodePacked(['string', 'address'], ['LOKYX ETH vault v1', phone])));

export function safeInitializer(recovery: Hex, d: Deployment = deploymentOf()): Hex {
  return encodeFunctionData({ abi: ABI.safe, functionName: 'setup', args: [[recovery], 1n, zeroAddress, '0x', d.fallbackHandler, zeroAddress, 0n, zeroAddress] });
}

export function safeAddress(plan: Pick<VaultPlan, 'recovery' | 'phone'>, d: Deployment = deploymentOf()): Hex {
  const init = safeInitializer(plan.recovery, d);
  const salt = keccak256(concat([keccak256(init), pad(toHex(saltNonce(plan.phone)), { size: 32 })]));
  const bytecode = concat([SAFE_PROXY_CREATION_CODE, pad(d.safeSingleton, { size: 32 })]);
  return getCreate2Address({ from: d.safeProxyFactory, salt, bytecodeHash: keccak256(bytecode) });
}

/** The EIP-1167 minimal proxy the module factory deploys. */
const proxyCode = (master: Hex) => concat(['0x602d8060093d393df3363d3d373d3d3d363d73', master, '0x5af43d82803e903d91602b57fd5bf3']);

/** Initializers fixed at creation (the same on every network). Per-network wait/expiry are set at activation. */
export function delayInitializer(safe: Hex): Hex {
  return encodeFunctionData({ abi: ABI.delay, functionName: 'setUp', args: [encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }], [safe, safe, safe, BigInt(DEFAULT_WAIT), BigInt(EXPIRY)])] });
}
export function rolesInitializer(safe: Hex): Hex {
  return encodeFunctionData({ abi: ABI.roles, functionName: 'setUp', args: [encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }], [safe, safe, safe])] });
}

/** The gate: a Roles module whose target is the Delay, so what the phone queues has to pass its permissions first. */
export function gateInitializer(safe: Hex, delay: Hex): Hex {
  return encodeFunctionData({ abi: ABI.roles, functionName: 'setUp', args: [encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }], [safe, safe, delay])] });
}
const gateSalt = (phone: Hex) => saltNonce(phone) + 1n;

export function moduleAddress(kind: 'delay' | 'roles' | 'gate', plan: Pick<VaultPlan, 'recovery' | 'phone'>, d: Deployment = deploymentOf()): Hex {
  const safe = safeAddress(plan, d);
  const init = kind === 'delay' ? delayInitializer(safe) : kind === 'gate' ? gateInitializer(safe, moduleAddress('delay', plan, d)) : rolesInitializer(safe);
  const master = kind === 'delay' ? d.delayMastercopy : d.rolesMastercopy;
  const nonce = kind === 'gate' ? gateSalt(plan.phone) : saltNonce(plan.phone);
  const salt = keccak256(encodePacked(['bytes32', 'uint256'], [keccak256(init), nonce]));
  return getCreate2Address({ from: d.moduleProxyFactory, salt, bytecode: proxyCode(master) });
}

export const vaultAddresses = (plan: Pick<VaultPlan, 'recovery' | 'phone'>, d: Deployment = deploymentOf()) => ({
  safe: safeAddress(plan, d), delay: moduleAddress('delay', plan, d), roles: moduleAddress('roles', plan, d), gate: moduleAddress('gate', plan, d), allowance: d.allowanceModule,
});

// ---------- settings ----------

export interface TokenAllowance {
  /** address(0) for ETH */
  token: Hex;
  symbol: string;
  decimals: number;
  /** raw units per day */
  amount: bigint;
}

export interface VaultSettings {
  /** seconds a larger withdrawal waits (at least 24 h) */
  wait: number;
  allowances: TokenAllowance[];
}

export function checkSettings(s: VaultSettings): string | null {
  if (!Number.isInteger(s.wait) || s.wait < MIN_WAIT) return 'The wait must be at least 24 hours: your phone may check for alerts hours late.';
  if (s.wait > 30 * 24 * 3600) return 'The wait can be at most 30 days.';
  if (!s.allowances.length) return 'Add at least one daily allowance (even 0), or nothing can be spent quickly.';
  const seen = new Set<string>();
  for (const a of s.allowances) {
    if (a.amount < 0n || a.amount >= 2n ** 96n) return 'That allowance is out of range.';
    if (seen.has(a.token.toLowerCase())) return 'Each coin can only have one allowance.';
    seen.add(a.token.toLowerCase());
  }
  return null;
}

// ---------- multisend packing ----------

export interface Call {
  to: Hex;
  value?: bigint;
  data?: Hex;
  operation?: 0 | 1;
}

export function packMultiSend(calls: Call[]): Hex {
  return concat(
    calls.map((c) => {
      const data = c.data ?? '0x';
      return encodePacked(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [c.operation ?? OP_CALL, c.to, c.value ?? 0n, BigInt((data.length - 2) / 2), data]);
    }),
  );
}
export const multiSendData = (calls: Call[]): Hex => encodeFunctionData({ abi: ABI.multiSend, functionName: 'multiSend', args: [packMultiSend(calls)] });

// ---------- Safe transactions signed by the recovery key ----------

export interface SafeTx {
  to: Hex;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
  nonce: bigint;
}

export function safeTxHash(chainId: number, safe: Hex, t: SafeTx): Hex {
  return hashTypedData({
    domain: { chainId, verifyingContract: safe },
    types: {
      SafeTx: [
        { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }, { name: 'operation', type: 'uint8' },
        { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' }, { name: 'gasPrice', type: 'uint256' },
        { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType: 'SafeTx',
    message: { to: t.to, value: t.value, data: t.data, operation: t.operation, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: zeroAddress, refundReceiver: zeroAddress, nonce: t.nonce },
  });
}

/** A 32-byte private key as 0x-prefixed hex, the only form viem's signers accept. (Passing `0x${viemBytesToHex(k)}`
 *  gave "0x0x..." and setup failed with "invalid private key, expected hex or 32 bytes, got string".) */
export function keyHex(sk: Uint8Array): Hex {
  if (sk.length !== 32) throw new Error('A private key must be 32 bytes');
  let h = '0x';
  for (const b of sk) h += b.toString(16).padStart(2, '0');
  return h as Hex;
}

/** r || s || v with v = 27 or 28, as Safe expects for an ECDSA owner signature over the EIP-712 hash. */
export async function signHash(sk: Hex, hash: Hex): Promise<Hex> {
  const s = await sign({ hash, privateKey: sk });
  const v = s.v !== undefined ? Number(s.v) : 27 + (s.yParity ?? 0);
  return concat([s.r, s.s, toHex(v, { size: 1 })]);
}

export function execTransactionData(t: SafeTx, signature: Hex): Hex {
  return encodeFunctionData({ abi: ABI.safe, functionName: 'execTransaction', args: [t.to, t.value, t.data, t.operation, 0n, 0n, 0n, zeroAddress, zeroAddress, signature] });
}

/**
 * An offline-signed recovery action. The recovery key signs once; ANY account can submit it and pay the gas, so
 * a thief who emptied the everyday address cannot stop a cancel or a sweep. It is bound to this Safe, this chain
 * and this Safe nonce, so it works once, only here, and only until the Safe's nonce moves.
 */
export interface SignedAction {
  v: 1;
  kind: 'cancel' | 'sweep';
  chainId: number;
  safe: Hex;
  tx: { to: Hex; value: string; data: Hex; operation: 0 | 1; nonce: string };
  signature: Hex;
  /** words, for the screen that asks someone to submit it */
  summary: string;
}

export async function signAction(recoverySk: Hex, chainId: number, safe: Hex, kind: SignedAction['kind'], t: SafeTx, summary: string): Promise<SignedAction> {
  const signature = await signHash(recoverySk, safeTxHash(chainId, safe, t));
  return { v: 1, kind, chainId, safe, tx: { to: t.to, value: t.value.toString(), data: t.data, operation: t.operation, nonce: t.nonce.toString() }, signature, summary };
}

export const encodeAction = (a: SignedAction): string => `lokyx-eth-action:${btoa(JSON.stringify(a))}`;
export function decodeAction(text: string): SignedAction {
  const m = text.trim().match(/^lokyx-eth-action:([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('That is not a LOKYX signed action.');
  const a = JSON.parse(atob(m[1])) as SignedAction;
  if (a.v !== 1 || !/^0x[0-9a-fA-F]{40}$/.test(a.safe) || !/^0x[0-9a-fA-F]{130}$/.test(a.signature)) throw new Error('That signed action is damaged.');
  return a;
}

/** The transaction anyone can send to submit a signed action. */
export function submission(a: SignedAction): { to: Hex; data: Hex } {
  const t: SafeTx = { to: a.tx.to, value: BigInt(a.tx.value), data: a.tx.data, operation: a.tx.operation, nonce: BigInt(a.tx.nonce) };
  return { to: a.safe, data: execTransactionData(t, a.signature) };
}

/** Cancel everything waiting in the Delay: skip to the queue's end. */
export const cancelData = (queueNonce: bigint): Hex => encodeFunctionData({ abi: ABI.delay, functionName: 'setTxNonce', args: [queueNonce] });

export async function signCancel(recoverySk: Hex, chainId: number, safe: Hex, delay: Hex, safeNonce: bigint, queueNonce: bigint) {
  return signAction(recoverySk, chainId, safe, 'cancel', { to: delay, value: 0n, data: cancelData(queueNonce), operation: OP_CALL, nonce: safeNonce }, 'Cancel everything that is waiting in this vault. It only cancels; no money moves.');
}

export interface Holding {
  token: Hex; // ETH = zero address
  amount: bigint;
}

/** Sweep: move every listed balance to the safe address in one signed batch (MultiSendCallOnly, Call only). */
export function sweepTx(d: Deployment, to: Hex, holdings: Holding[], safeNonce: bigint): SafeTx {
  const calls: Call[] = holdings
    .filter((h) => h.amount > 0n)
    .map((h) => (h.token === ETH ? { to, value: h.amount } : { to: h.token, data: encodeFunctionData({ abi: ABI.erc20, functionName: 'transfer', args: [to, h.amount] }) }));
  return { to: d.multiSendCallOnly, value: 0n, data: multiSendData(calls), operation: OP_DELEGATE, nonce: safeNonce };
}

export async function signSweep(recoverySk: Hex, chainId: number, safe: Hex, d: Deployment, to: Hex, holdings: Holding[], safeNonce: bigint) {
  return signAction(recoverySk, chainId, safe, 'sweep', sweepTx(d, to, holdings, safeNonce), `Move everything in this vault (${holdings.filter((h) => h.amount > 0n).length} balances) to ${to}.`);
}

// ---------- activation (one Safe transaction signed by the recovery key) ----------

export function activationCalls(plan: VaultPlan, settings: VaultSettings, d: Deployment = deploymentOf(), lock = true, gated = true): Call[] {
  const a = vaultAddresses(plan, d);
  const calls: Call[] = [
    { to: a.safe, data: encodeFunctionData({ abi: ABI.safe, functionName: 'enableModule', args: [a.delay] }) },
    { to: a.safe, data: encodeFunctionData({ abi: ABI.safe, functionName: 'enableModule', args: [a.roles] }) },
    { to: a.safe, data: encodeFunctionData({ abi: ABI.safe, functionName: 'enableModule', args: [d.allowanceModule] }) },
    { to: a.delay, data: encodeFunctionData({ abi: ABI.delay, functionName: 'enableModule', args: [gated ? a.gate : plan.phone] }) },
  ];
  if (settings.wait !== DEFAULT_WAIT) calls.push({ to: a.delay, data: encodeFunctionData({ abi: ABI.delay, functionName: 'setTxCooldown', args: [BigInt(settings.wait)] }) });
  calls.push({ to: d.allowanceModule, data: encodeFunctionData({ abi: ABI.allowance, functionName: 'addDelegate', args: [plan.phone] }) });
  for (const t of settings.allowances) calls.push({ to: d.allowanceModule, data: allowanceData(plan.phone, t, 0) });
  calls.push(
    { to: a.roles, data: encodeFunctionData({ abi: ABI.roles, functionName: 'assignRoles', args: [plan.phone, [PHONE_ROLE], [true]] }) },
    { to: a.roles, data: encodeFunctionData({ abi: ABI.roles, functionName: 'scopeTarget', args: [PHONE_ROLE, a.delay] }) },
    { to: a.roles, data: encodeFunctionData({ abi: ABI.roles, functionName: 'scopeAllowFunction', args: [PHONE_ROLE, a.delay, SET_TX_NONCE, 0] }) },
  );
  if (gated) calls.push(...gateRoleCalls(plan, settings, a.gate));
  // Option B: the recovery key becomes a narrow Roles member and stops being the Safe's owner. Last, so everything above ran as owner.
  if (lock) calls.push(...recoveryRoleCalls(plan, settings, a.roles, a.delay), { to: a.safe, data: encodeFunctionData({ abi: ABI.safe, functionName: 'swapOwner', args: [SENTINEL, plan.recovery, DEAD] }) });
  return calls;
}

const TRANSFER_SEL: Hex = encodeFunctionData({ abi: ABI.erc20, functionName: 'transfer', args: [zeroAddress, 0n] }).slice(0, 10) as Hex;

/** The coins the recovery key can sweep: ETH and the tokens that have an allowance (those are scoped when the vault is made). */
export const sweepable = (settings: { allowances: { token: Hex }[] }): Hex[] => [ETH, ...settings.allowances.map((t) => t.token).filter((t) => t !== ETH)];

/** What the recovery key may do through Roles: cancel the queue, send ETH to the safe address, transfer listed tokens to it. Nothing else. */
export function recoveryRoleCalls(plan: VaultPlan, settings: { allowances: { token: Hex }[] }, roles: Hex, delay: Hex): Call[] {
  const enc = (functionName: string, args: unknown[]) => encodeFunctionData({ abi: ABI.roles, functionName, args } as never);
  const calls: Call[] = [
    { to: roles, data: enc('assignRoles', [plan.recovery, [RECOVERY_ROLE], [true]]) },
    { to: roles, data: enc('scopeTarget', [RECOVERY_ROLE, delay]) },
    { to: roles, data: enc('scopeAllowFunction', [RECOVERY_ROLE, delay, SET_TX_NONCE, 0]) },
    // ETH: allowed to the safe address, with value, and to nowhere else
    { to: roles, data: enc('allowTarget', [RECOVERY_ROLE, plan.safeAddress, 1]) },
  ];
  for (const token of sweepable(settings).filter((t) => t !== ETH)) {
    calls.push(
      { to: roles, data: enc('scopeTarget', [RECOVERY_ROLE, token]) },
      // transfer(to, amount): `to` must equal the safe address, the amount is free
      { to: roles, data: enc('scopeFunction', [RECOVERY_ROLE, token, TRANSFER_SEL, [true, false], [0, 0], [0, 0], [pad(plan.safeAddress, { size: 32 }), '0x'], 0]) },
    );
  }
  return calls;
}
/** What the phone may queue through the gate: ETH to the safe address, and a listed token's transfer to the safe address. Nothing else. */
export function gateRoleCalls(plan: VaultPlan, settings: { allowances: { token: Hex }[] }, gate: Hex): Call[] {
  const enc = (functionName: string, args: unknown[]) => encodeFunctionData({ abi: ABI.roles, functionName, args } as never);
  const calls: Call[] = [
    { to: gate, data: enc('assignRoles', [plan.phone, [GATE_ROLE], [true]]) },
    { to: gate, data: enc('allowTarget', [GATE_ROLE, plan.safeAddress, 1]) },
  ];
  for (const token of sweepable(settings).filter((t) => t !== ETH)) {
    calls.push(
      { to: gate, data: enc('scopeTarget', [GATE_ROLE, token]) },
      { to: gate, data: enc('scopeFunction', [GATE_ROLE, token, TRANSFER_SEL, [true, false], [0, 0], [0, 0], [pad(plan.safeAddress, { size: 32 }), '0x'], 0]) },
    );
  }
  return calls;
}
const SET_TX_NONCE: Hex = encodeFunctionData({ abi: ABI.delay, functionName: 'setTxNonce', args: [0n] }).slice(0, 10) as Hex;

export const allowanceData = (delegate: Hex, t: TokenAllowance, resetBaseMin: number): Hex =>
  encodeFunctionData({ abi: ABI.allowance, functionName: 'setAllowance', args: [delegate, t.token, t.amount, DAY_MIN, resetBaseMin] });

export function activationTx(plan: VaultPlan, settings: VaultSettings, d: Deployment, safeNonce: bigint, lock = true, gated = true): SafeTx {
  return { to: d.multiSend, value: 0n, data: multiSendData(activationCalls(plan, settings, d, lock, gated)), operation: OP_DELEGATE, nonce: safeNonce };
}

/** The three transactions that bring a vault to life on a network: deploy the Safe and the two module proxies. */
export function creationCalls(plan: VaultPlan, d: Deployment = deploymentOf(), gated = true): Call[] {
  const safe = safeAddress(plan, d);
  const delay = moduleAddress('delay', plan, d);
  return [
    { to: d.safeProxyFactory, data: encodeFunctionData({ abi: ABI.factory, functionName: 'createProxyWithNonce', args: [d.safeSingleton, safeInitializer(plan.recovery, d), saltNonce(plan.phone)] }) },
    { to: d.moduleProxyFactory, data: encodeFunctionData({ abi: ABI.moduleFactory, functionName: 'deployModule', args: [d.delayMastercopy, delayInitializer(safe), saltNonce(plan.phone)] }) },
    { to: d.moduleProxyFactory, data: encodeFunctionData({ abi: ABI.moduleFactory, functionName: 'deployModule', args: [d.rolesMastercopy, rolesInitializer(safe), saltNonce(plan.phone)] }) },
    ...(gated ? [{ to: d.moduleProxyFactory, data: encodeFunctionData({ abi: ABI.moduleFactory, functionName: 'deployModule', args: [d.rolesMastercopy, gateInitializer(safe, delay), gateSalt(plan.phone)] }) }] : []),
  ];
}

// ---------- everyday use: spend, queue, execute, cancel ----------

/** Typed-data for the Allowance Module's delegate signature (its domain has no name or version). */
export function allowanceTransferHash(chainId: number, module: Hex, safe: Hex, t: { token: Hex; to: Hex; amount: bigint; nonce: number }): Hex {
  return hashTypedData({
    domain: { chainId, verifyingContract: module },
    types: {
      AllowanceTransfer: [
        { name: 'safe', type: 'address' }, { name: 'token', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint96' },
        { name: 'paymentToken', type: 'address' }, { name: 'payment', type: 'uint96' }, { name: 'nonce', type: 'uint16' },
      ],
    },
    primaryType: 'AllowanceTransfer',
    message: { safe, token: t.token, to: t.to, amount: t.amount, paymentToken: zeroAddress, payment: 0n, nonce: t.nonce },
  });
}

/** A quick spend within the daily allowance: the phone key signs, anyone can submit. */
export async function allowanceSpend(phoneSk: Hex, chainId: number, d: Deployment, safe: Hex, phone: Hex, t: { token: Hex; to: Hex; amount: bigint; nonce: number }): Promise<{ to: Hex; data: Hex }> {
  const signature = await signHash(phoneSk, allowanceTransferHash(chainId, d.allowanceModule, safe, t));
  return { to: d.allowanceModule, data: encodeFunctionData({ abi: ABI.allowance, functionName: 'executeAllowanceTransfer', args: [safe, t.token, t.to, t.amount, zeroAddress, 0n, phone, signature] }) };
}

/** A larger withdrawal: queue it in the Delay. The phone is a module there. */
export function queueData(c: { to: Hex; value?: bigint; data?: Hex }): Hex {
  return encodeFunctionData({ abi: ABI.delay, functionName: 'execTransactionFromModule', args: [c.to, c.value ?? 0n, c.data ?? '0x', OP_CALL] });
}
/** A larger withdrawal on a vault with a gate: the phone sends this to the gate, which passes it to the Delay only if the role allows it. */
export function gateQueueData(c: { to: Hex; value?: bigint; data?: Hex }): Hex {
  return encodeFunctionData({ abi: ABI.roles, functionName: 'execTransactionWithRole', args: [c.to, c.value ?? 0n, c.data ?? '0x', OP_CALL, GATE_ROLE, true] });
}
/** Why a larger withdrawal cannot be queued from this vault, or null. On a gated vault it can only go to the safe address, and only ETH or a listed token. */
export function refuseQueue(c: { to: Hex; data?: Hex; value?: bigint }, safeAddr: Hex, listed: Hex[]): string | null {
  const data = c.data ?? '0x';
  if (data === '0x') return same(c.to, safeAddr) ? null : 'More than today\'s allowance can only be sent to your safe address. Send less, or send it to your safe address.';
  const d = decodeAny(data);
  if (d?.functionName === 'transfer' && listed.some((t) => same(t, c.to)) && same(String((d.args as readonly unknown[])[0]), safeAddr)) return null;
  return 'More than today\'s allowance can only be sent to your safe address. Send less, or send it to your safe address.';
}
/** Queue an ERC-20 transfer (USDC, USDT: also tokens that return nothing). */
export const tokenTransferCall = (token: Hex, to: Hex, amount: bigint): { to: Hex; data: Hex } => ({ to: token, data: encodeFunctionData({ abi: ABI.erc20, functionName: 'transfer', args: [to, amount] }) });

export function executeData(c: { to: Hex; value?: bigint; data?: Hex; operation?: 0 | 1 }): Hex {
  return encodeFunctionData({ abi: ABI.delay, functionName: 'executeNextTx', args: [c.to, c.value ?? 0n, c.data ?? '0x', c.operation ?? OP_CALL] });
}

/** The recovery key's own transactions (option B). It sends them itself, so its address needs a little ETH for gas. */
export function recoveryCancelData(delay: Hex, queueNonce: bigint): Hex {
  return encodeFunctionData({ abi: ABI.roles, functionName: 'execTransactionWithRole', args: [delay, 0n, cancelData(queueNonce), OP_CALL, RECOVERY_ROLE, true] });
}
/** One transaction per coin: ETH, then each listed token. Coins that are not listed cannot be swept this way. */
export function recoverySweepCalls(roles: Hex, safeAddr: Hex, holdings: Holding[], listed: Hex[]): Call[] {
  return holdings
    .filter((h) => h.amount > 0n && listed.some((t) => t.toLowerCase() === h.token.toLowerCase()))
    .map((h) =>
      h.token === ETH
        ? { to: roles, data: encodeFunctionData({ abi: ABI.roles, functionName: 'execTransactionWithRole', args: [safeAddr, h.amount, '0x', OP_CALL, RECOVERY_ROLE, true] }) }
        : { to: roles, data: encodeFunctionData({ abi: ABI.roles, functionName: 'execTransactionWithRole', args: [h.token, 0n, encodeFunctionData({ abi: ABI.erc20, functionName: 'transfer', args: [safeAddr, h.amount] }), OP_CALL, RECOVERY_ROLE, true] }) },
    );
}

/** The phone cancels the whole queue in one slide, through its Roles permission (only Delay.setTxNonce). */
export function phoneCancelData(delay: Hex, queueNonce: bigint): Hex {
  return encodeFunctionData({ abi: ABI.roles, functionName: 'execTransactionWithRole', args: [delay, 0n, cancelData(queueNonce), OP_CALL, PHONE_ROLE, true] });
}

// ---------- reading a queued item in words (clear signing) ----------

export interface KnownToken {
  address: Hex;
  symbol: string;
  decimals: number;
}

export interface Described {
  /** one line a person can read */
  line: string;
  /** 'normal' | 'warn' (unusual) | 'danger' (can hand over the vault or drain it) */
  level: 'normal' | 'warn' | 'danger';
}

const fmt = (v: bigint, decimals: number) => {
  const s = v.toString().padStart(decimals + 1, '0');
  const i = s.slice(0, s.length - decimals);
  const f = s.slice(s.length - decimals).replace(/0+$/, '');
  return f ? `${i}.${f}` : i;
};
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const UNLIMITED = 2n ** 255n;

function decodeAny(data: Hex): { functionName: string; args?: readonly unknown[] } | null {
  for (const abi of [ABI.erc20, ABI.safe, ABI.delay, ABI.allowance, ABI.signMessageLib] as Abi[]) {
    try {
      return decodeFunctionData({ abi, data }) as { functionName: string; args?: readonly unknown[] };
    } catch {
      /* try the next */
    }
  }
  return null;
}

export function describeCall(c: { to: Hex; value: bigint; data: Hex; operation: number }, tokens: KnownToken[] = [], self: { safe?: Hex } = {}): Described {
  const tok = tokens.find((t) => t.address.toLowerCase() === c.to.toLowerCase());
  const name = tok ? tok.symbol : `the token at ${short(c.to)}`;
  if (c.operation === OP_DELEGATE) {
    return { level: 'danger', line: `Runs code from ${short(c.to)} AS your vault (a delegatecall). This can rewrite or empty the whole vault. Cancel it unless you started it yourself.` };
  }
  if (c.data === '0x') return { level: 'normal', line: `Send ${fmt(c.value, 18)} ETH to ${short(c.to)}.` };
  const d = decodeAny(c.data);
  if (!d) return { level: 'warn', line: `Calls an unknown function on ${short(c.to)}${c.value ? ` and sends ${fmt(c.value, 18)} ETH with it` : ''}. You can't tell what it does: cancel it unless you started it.` };
  const a = (d.args ?? []) as unknown[];
  switch (d.functionName) {
    case 'transfer':
      return { level: 'normal', line: `Send ${fmt(a[1] as bigint, tok?.decimals ?? 0)}${tok ? '' : ' (raw units of'} ${name}${tok ? '' : ')'} to ${short(a[0] as string)}.` };
    case 'approve':
    case 'increaseAllowance':
      return (a[1] as bigint) >= UNLIMITED
        ? { level: 'danger', line: `Lets ${short(a[0] as string)} spend ALL of your ${name}, with no limit. This is how wallets get drained. Cancel it unless you started it.` }
        : { level: 'warn', line: `Lets ${short(a[0] as string)} spend up to ${fmt(a[1] as bigint, tok?.decimals ?? 0)} ${name} from your vault.` };
    case 'permit':
      return { level: 'danger', line: `A permit that lets ${short(a[1] as string)} spend your ${name} without another transaction. Cancel it unless you started it.` };
    case 'transferFrom':
      return { level: 'warn', line: `Moves ${name} between other addresses using an approval.` };
    case 'enableModule':
      return { level: 'danger', line: `Gives ${short(a[0] as string)} full control of your vault (adds a module). Cancel it unless you started it.` };
    case 'disableModule':
      return { level: 'danger', line: `Removes a protection module (${short(a[1] as string)}) from your vault. Cancel it unless you started it.` };
    case 'setGuard':
      return { level: 'danger', line: `Changes the vault's transaction guard to ${short(a[0] as string)}. Cancel it unless you started it.` };
    case 'setFallbackHandler':
      return { level: 'danger', line: `Changes the vault's fallback handler to ${short(a[0] as string)}. Cancel it unless you started it.` };
    case 'addOwnerWithThreshold':
    case 'swapOwner':
    case 'removeOwner':
    case 'changeThreshold':
      return { level: 'danger', line: 'Changes who owns the vault. Cancel it unless you started it with your recovery key.' };
    case 'setTxCooldown':
      return { level: 'danger', line: `Changes the wait on larger withdrawals to ${Number(a[0]) / 3600} h.` };
    case 'setTxExpiration':
    case 'setTxNonce':
    case 'skipExpired':
      return { level: 'warn', line: 'Changes how the waiting list works.' };
    case 'setAllowance':
      return { level: 'warn', line: `Sets a daily allowance of ${a[2] as bigint} (raw units) of ${short(a[1] as string)} for ${short(a[0] as string)}.` };
    case 'addDelegate':
      return { level: 'danger', line: `Lets ${short(a[0] as string)} spend your daily allowance. Cancel it unless you started it.` };
    case 'signMessage':
      return { level: 'danger', line: 'Makes the vault "sign" a message, which can approve orders and permits. Cancel it unless you started it.' };
    default:
      void self;
      return { level: 'warn', line: `Calls ${d.functionName} on ${short(c.to)}.` };
  }
}

/** What the app itself will build or sign for the vault. Anything else is refused, whatever a site asks. */
export function refuseToBuild(c: { to: Hex; data?: Hex; operation?: number }): string | null {
  if ((c.operation ?? 0) === OP_DELEGATE) return 'LOKYX never queues a delegatecall from your phone.';
  const data = c.data ?? '0x';
  if (data.length >= 10) {
    const d = decodeAny(data);
    if (d && (d.functionName === 'approve' || d.functionName === 'increaseAllowance') && (d.args as readonly bigint[])[1] >= UNLIMITED) return 'An unlimited token approval from the vault is refused. Approve an exact amount, with the wait.';
    if (d?.functionName === 'permit') return 'The vault does not sign permits.';
    if (d?.functionName === 'signMessage') return 'The vault does not sign messages.';
  }
  return null;
}

/** A website asking the vault for an off-chain signature (personal_sign, eth_signTypedData*, Permit2, Seaport): never. */
export const refuseSignRequest = (): string => 'Your vault never signs messages, permits or orders. It could be used to drain it without any wait.';

// ---------- the vault's live configuration, and what is unexpected ----------

export interface Expected {
  safe: Hex;
  delay: Hex;
  roles: Hex;
  phone: Hex;
  recovery: Hex;
  wait: number;
  allowances: TokenAllowance[];
  deployment: Deployment;
  /** a vault made before the recovery key was narrowed: its recovery key is still the Safe's owner */
  legacyOwner?: boolean;
  /** the gate module of a vault whose phone can only queue sends to the safe address. Absent on older vaults, where the phone is a Delay module itself. */
  gate?: Hex;
}

export interface Live {
  owners: Hex[];
  threshold: bigint;
  modules: Hex[];
  guard: Hex;
  fallbackHandler: Hex;
  singleton: Hex;
  delay: { cooldown: bigint; expiration: bigint; modules: Hex[]; owner: Hex; avatar: Hex; target: Hex; queueNonce: bigint; txNonce: bigint; code: Hex };
  roles: { owner: Hex; avatar: Hex; target: Hex; code: Hex };
  gate?: { owner: Hex; avatar: Hex; target: Hex; code: Hex };
  delegates: Hex[];
  /** per token, raw units and reset minutes, as the Allowance Module reports them */
  allowances: { token: Hex; amount: bigint; resetMin: number }[];
  codeHashes: Partial<Record<keyof Deployment, Hex>>;
}

export interface Issue {
  level: 'danger' | 'warn';
  text: string;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const GUARD_SLOT: Hex = '0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8';
export const FALLBACK_SLOT: Hex = '0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5';

/** Compare the live configuration with what this phone set up. Anything else is an issue, whether or not an event fired. */
export function diffConfig(e: Expected, l: Live): Issue[] {
  const out: Issue[] = [];
  const bad = (text: string) => out.push({ level: 'danger', text });
  const warn = (text: string) => out.push({ level: 'warn', text });

  if (l.owners.length !== 1 || !same(l.owners[0], e.legacyOwner ? e.recovery : DEAD)) {
    const now = l.owners.map(short).join(', ') || 'none';
    bad(e.legacyOwner ? `The vault's owners are not just your recovery key (now: ${now}).` : `The vault's owner is not the locked address (now: ${now}). Someone can sign for it directly.`);
  }
  if (l.threshold !== 1n) bad(`The vault's signing threshold is ${l.threshold}, not 1.`);
  if (!same(l.singleton, e.deployment.safeSingleton)) bad(`The vault's code was swapped for ${short(l.singleton)}.`);
  if (!same(l.guard, zeroAddress)) bad(`A transaction guard is set on the vault (${short(l.guard)}). You did not set one.`);
  if (!same(l.fallbackHandler, e.deployment.fallbackHandler)) bad(`The vault's fallback handler was changed to ${short(l.fallbackHandler)}.`);

  const want = [e.delay, e.roles, e.deployment.allowanceModule];
  for (const m of l.modules) if (!want.some((w) => same(w, m))) bad(`An unknown module ${short(m)} has full control of the vault.`);
  for (const w of want) if (!l.modules.some((m) => same(m, w))) bad(`A protection module (${short(w)}) is no longer enabled on the vault.`);

  const queuer = e.gate ?? e.phone;
  if (l.delay.modules.length !== 1 || !same(l.delay.modules[0], queuer)) bad(e.gate ? `The Delay's queue can be used by ${l.delay.modules.map(short).join(', ') || 'nobody'}, not only through the gate. Something that is not limited to your safe address can queue withdrawals.` : `The Delay's queue can be used by ${l.delay.modules.map(short).join(', ') || 'nobody'}, not only by this phone.`);
  if (!same(l.delay.owner, e.safe) || !same(l.delay.avatar, e.safe) || !same(l.delay.target, e.safe)) bad('The Delay module is wired to a different account.');
  if (Number(l.delay.cooldown) !== e.wait) (Number(l.delay.cooldown) < e.wait ? bad : warn)(`The wait on larger withdrawals is ${Number(l.delay.cooldown) / 3600} h, not ${e.wait / 3600} h.`);
  if (Number(l.delay.expiration) !== EXPIRY) warn(`Queued items now expire after ${Number(l.delay.expiration) / 86400} days, not ${EXPIRY / 86400}.`);
  if (l.delay.txNonce !== l.delay.queueNonce) warn(`${l.delay.queueNonce - l.delay.txNonce} item(s) are waiting in the vault.`);
  if (!same(l.roles.owner, e.safe) || !same(l.roles.avatar, e.safe) || !same(l.roles.target, e.safe)) bad('The Roles module is wired to a different account.');
  if (e.gate) {
    if (!l.gate) bad('The gate in front of the Delay could not be read.');
    else if (!same(l.gate.owner, e.safe) || !same(l.gate.avatar, e.safe) || !same(l.gate.target, e.delay)) bad('The gate in front of the Delay is wired to a different account.');
  }

  if (l.delegates.length !== 1 || !same(l.delegates[0], e.phone)) bad(`The daily allowance can be spent by ${l.delegates.map(short).join(', ') || 'nobody'}, not only by this phone.`);
  for (const a of l.allowances) {
    const w = e.allowances.find((x) => same(x.token, a.token));
    if (!w) bad(`There is a daily allowance for a coin you did not choose (${short(a.token)}).`);
    else if (a.amount > w.amount) bad(`The daily allowance for ${w.symbol} was raised to ${fmt(a.amount, w.decimals)} (you set ${fmt(w.amount, w.decimals)}).`);
    else if (a.amount !== w.amount) warn(`The daily allowance for ${w.symbol} is now ${fmt(a.amount, w.decimals)} (you set ${fmt(w.amount, w.decimals)}).`);
    if (a.amount > 0n && a.resetMin !== DAY_MIN) warn(`The allowance for ${w?.symbol ?? short(a.token)} resets every ${a.resetMin} minutes, not daily.`);
  }
  for (const w of e.allowances) if (w.amount > 0n && !l.allowances.some((a) => same(a.token, w.token))) warn(`The daily allowance for ${w.symbol} is gone.`);

  // the contracts must be the audited ones
  for (const [k, c] of Object.entries(CONTRACTS) as [keyof Deployment, (typeof CONTRACTS)[keyof Deployment]][]) {
    const live = l.codeHashes[k];
    if (c.codeHash && live && live.toLowerCase() !== c.codeHash.toLowerCase()) bad(`${k} at ${short(e.deployment[k])} is not the audited code.`);
  }
  return out;
}

/** The wallet pins: which of the contracts have a published code hash to check against. */
export const unpinned = (): string[] => Object.entries(CONTRACTS).filter(([, v]) => !v.codeHash).map(([k]) => k);

// ---------- gas reserve ----------

export interface GasReserve {
  /** ETH wei needed on the recovery address to submit a cancel and a sweep itself on this network */
  needed: bigint;
  have: bigint;
  low: boolean;
}

/** Rough on-chain cost of one cancel plus one sweep, with room for a fee spike. */
export function gasReserve(have: bigint, gasPrice: bigint, perAction = 400_000n, margin = 3n): GasReserve {
  const needed = gasPrice * perAction * 2n * margin;
  return { needed, have, low: have < needed };
}

// ---------- alerts from the Delay queue ----------

export interface QueuedItem {
  nonce: bigint;
  txHash: Hex;
  to: Hex;
  value: bigint;
  data: Hex;
  operation: number;
  createdAt: number;
  /** earliest execution */
  readyAt: number;
  /** after this it can no longer run */
  expiresAt: number;
}

export function itemState(i: QueuedItem, now: number, txNonce: bigint): 'cancelled' | 'waiting' | 'ready' | 'expired' {
  if (i.nonce < txNonce) return 'cancelled';
  if (now >= i.expiresAt) return 'expired';
  return now >= i.readyAt ? 'ready' : 'waiting';
}

// ---------- reading the live configuration ----------

/** The only network access the config check needs: a read-only call and the code at an address. */
export interface Reader {
  call(to: Hex, data: Hex): Promise<Hex>;
  code(addr: Hex): Promise<Hex>;
}

async function view<T>(r: Reader, to: Hex, abi: Abi, fn: string, args: unknown[] = []): Promise<T> {
  const data = encodeFunctionData({ abi, functionName: fn, args } as never);
  return decodeFunctionResult({ abi, functionName: fn, data: await r.call(to, data) } as never) as T;
}

async function modulesOf(r: Reader, at: Hex, abi: Abi): Promise<Hex[]> {
  const [arr] = await view<[Hex[], Hex]>(r, at, abi, 'getModulesPaginated', [SENTINEL, 50n]);
  return arr;
}

/** Read everything the checks in `diffConfig` need, with plain eth_calls. */
export async function readLive(r: Reader, e: Expected): Promise<Live> {
  const safe = e.safe;
  const word = async (slot: Hex): Promise<Hex> => {
    // Safe.getStorageAt works through the proxy for any slot
    const [raw] = [await view<Hex>(r, safe, ABI.safe, 'getStorageAt', [hexToBigInt(slot), 1n])];
    return getAddress(`0x${raw.slice(-40)}`) as Hex;
  };
  const [owners, threshold, modules, guard, fallbackHandler, singleton] = await Promise.all([
    view<Hex[]>(r, safe, ABI.safe, 'getOwners'),
    view<bigint>(r, safe, ABI.safe, 'getThreshold'),
    modulesOf(r, safe, ABI.safe),
    word(GUARD_SLOT),
    word(FALLBACK_SLOT),
    word(pad('0x00', { size: 32 })),
  ]);
  const D = e.delay;
  const [cooldown, expiration, dMods, dOwner, dAvatar, dTarget, queueNonce, txNonce, dCode] = await Promise.all([
    view<bigint>(r, D, ABI.delay, 'txCooldown'), view<bigint>(r, D, ABI.delay, 'txExpiration'), modulesOf(r, D, ABI.delay),
    view<Hex>(r, D, ABI.delay, 'owner'), view<Hex>(r, D, ABI.delay, 'avatar'), view<Hex>(r, D, ABI.delay, 'target'),
    view<bigint>(r, D, ABI.delay, 'queueNonce'), view<bigint>(r, D, ABI.delay, 'txNonce'), r.code(D),
  ]);
  const gate = e.gate
    ? await Promise.all([view<Hex>(r, e.gate, ABI.roles, 'owner'), view<Hex>(r, e.gate, ABI.roles, 'avatar'), view<Hex>(r, e.gate, ABI.roles, 'target'), r.code(e.gate)]).then(([owner, avatar, target, code]) => ({ owner, avatar, target, code }))
    : undefined;
  const [rOwner, rAvatar, rTarget, rCode] = await Promise.all([
    view<Hex>(r, e.roles, ABI.roles, 'owner'), view<Hex>(r, e.roles, ABI.roles, 'avatar'), view<Hex>(r, e.roles, ABI.roles, 'target'), r.code(e.roles),
  ]);
  const A = e.deployment.allowanceModule;
  const [delegates] = await view<[Hex[], number]>(r, A, ABI.allowance, 'getDelegates', [safe, 0, 50]);
  const allowances: Live['allowances'] = [];
  for (const dg of delegates) {
    for (const token of await view<Hex[]>(r, A, ABI.allowance, 'getTokens', [safe, dg])) {
      const t = await view<readonly bigint[]>(r, A, ABI.allowance, 'getTokenAllowance', [safe, dg, token]);
      allowances.push({ token, amount: t[0], resetMin: Number(t[2]) });
    }
  }
  const codeHashes: Live['codeHashes'] = {};
  await Promise.all((Object.keys(CONTRACTS) as (keyof Deployment)[]).map(async (k) => {
    const c = await r.code(e.deployment[k]);
    codeHashes[k] = c === '0x' ? undefined : keccak256(c);
  }));
  return {
    owners, threshold, modules, guard, fallbackHandler, singleton,
    delay: { cooldown, expiration, modules: dMods, owner: dOwner, avatar: dAvatar, target: dTarget, queueNonce, txNonce, code: dCode },
    roles: { owner: rOwner, avatar: rAvatar, target: rTarget, code: rCode },
    gate,
    delegates, allowances, codeHashes,
  };
}

/** [amount, spent, resetTimeMin, lastResetMin, nonce] → what is left now. */
export function resetAdjusted(t: readonly bigint[], nowSec = Math.floor(Date.now() / 1000)): bigint {
  const [amount, spent, resetMin, lastReset] = t;
  const nowMin = BigInt(Math.floor(nowSec / 60));
  const s = resetMin > 0n && nowMin >= lastReset + resetMin ? 0n : spent;
  return amount > s ? amount - s : 0n;
}
