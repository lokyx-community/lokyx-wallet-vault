// Vault rules and wording that need no phone: recovery keys, setting checks, the plain-language
// description of every operation (what "clear signing" shows), countdowns. Tested in test/vault.test.ts.

import { addressFromPrivateKey, deriveKey, formatLyx, isAddress, normalizeMnemonic, parseLyx, shortHash, type Op, type VaultSettings } from './lokyx.ts';

export const DELAYS: [string, number][] = [['1 hour', 3600], ['1 day', 86400], ['3 days', 3 * 86400], ['1 week', 7 * 86400]];
export const HEIR_WAITS: [string, number][] = [['6 months', 182 * 86400], ['1 year', 365 * 86400]];
export const MIN_DELAY_SECS = 3600;
export const MAX_DELAY_SECS = 30 * 86400;
export const MIN_INACTIVE_SECS = 30 * 86400;

export const KEY_THEFT_NOTICE = "Key stolen? Rotation won't save your funds. Sweep your vault or move your funds now.";

export const blocksFor = (secs: number, blockTime: number) => BigInt(Math.max(1, Math.ceil(secs / Math.max(1, blockTime))));

/** "1 day 3 hours", "12 minutes". */
export function duration(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 90) return `${s} seconds`;
  if (s < 5400) return `${Math.round(s / 60)} minutes`;
  if (s < 2 * 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m && h < 10 ? `${h} h ${m} min` : `${Math.round(s / 3600)} hours`;
  }
  return `${Math.round(s / 86400)} days`;
}
export const inTime = (blocks: number, blockTime: number) => duration(Math.max(0, blocks) * blockTime);

/** The recovery phrase gives two addresses: index 0 is the safe address, index 1 signs cancels and sweeps. */
export function recoveryKeys(phrase: string) {
  const p = normalizeMnemonic(phrase);
  const safeKey = deriveKey(p, 0);
  const recKey = deriveKey(p, 1);
  const out = { safe: addressFromPrivateKey(safeKey), recovery: addressFromPrivateKey(recKey), recKey };
  safeKey.fill(0);
  return out;
}

export interface SettingsInput {
  owner: string;
  recovery: string;
  safe: string;
  allowanceLyx: string;
  delaySecs: number;
  heir?: { address: string; waitSecs: number } | null;
  blockTime: number;
}

/** Builds the settings the chain wants, or says in words what is wrong (mirrors vault.rs check_settings). */
export function buildSettings(i: SettingsInput): { settings?: VaultSettings; error?: string } {
  let allowance: bigint;
  try {
    allowance = parseLyx(i.allowanceLyx);
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (allowance === 0n) return { error: 'The daily allowance has to be more than zero, or you could not spend anything without waiting.' };
  if (!isAddress(i.safe)) return { error: 'The safe address is not a valid lyx1 address.' };
  if (!isAddress(i.recovery)) return { error: 'The recovery address is not valid.' };
  if (i.recovery === i.owner) return { error: 'The recovery key has to be different from this account.' };
  if (i.safe === i.owner) return { error: 'The safe address has to be a different account.' };
  if (i.delaySecs < MIN_DELAY_SECS || i.delaySecs > MAX_DELAY_SECS) return { error: 'The wait has to be between 1 hour and 30 days.' };
  const delay = blocksFor(i.delaySecs, i.blockTime);
  let heir: VaultSettings['heir'] = null;
  if (i.heir) {
    if (!isAddress(i.heir.address)) return { error: 'The heir address is not valid.' };
    if (i.heir.address === i.owner) return { error: 'The heir has to be a different account.' };
    const inactive = blocksFor(i.heir.waitSecs, i.blockTime);
    const min = [blocksFor(MIN_INACTIVE_SECS, i.blockTime), delay * 2n].reduce((a, b) => (a > b ? a : b));
    if (inactive < min) return { error: "The heir's waiting time is too short." };
    heir = { address: i.heir.address, inactiveBlocks: inactive };
  }
  return { settings: { recovery: i.recovery, safe: i.safe, delay, allowance, heir } };
}

export interface Ctx {
  blockTime: number;
  /** Names for addresses the person knows (contacts, own accounts). */
  label?: (addr: string) => string | undefined;
  /** The account that signs. */
  me: string;
}

const who = (a: string, c: Ctx) => c.label?.(a) ?? shortHash(a, 10, 6);
const lyx = (v: bigint) => `${formatLyx(v)} LYX`;

/** The sentence shown before signing: exactly what will happen, in words. */
export function describeOp(op: Op, c: Ctx, vaultDelayBlocks?: number): { title: string; lines: string[] } {
  const wait = vaultDelayBlocks != null ? inTime(vaultDelayBlocks, c.blockTime) : undefined;
  switch (op.kind) {
    case 'transfer':
      return { title: `Send ${lyx(op.value)}`, lines: [`Send ${lyx(op.value)} to ${who(op.to, c)}.`] };
    case 'vaultWithdraw':
      return {
        title: `Start a withdrawal of ${lyx(op.amount)}`,
        lines: [`Start a withdrawal of ${lyx(op.amount)} to ${who(op.to, c)}${wait ? `, released in ${wait}` : ' after the vault wait'}.`, 'You can cancel it any time before then.'],
      };
    case 'vaultCreate': {
      const s = op.settings;
      const lines = [
        `Turn this account into a vault. Up to ${lyx(s.allowance)} a day leaves at once; anything bigger waits ${inTime(Number(s.delay), c.blockTime)}.`,
        `A recovery key (${who(s.recovery, c)}) can cancel withdrawals and sweep everything to ${who(s.safe, c)}.`,
      ];
      if (s.heir) lines.push(`${who(s.heir.address, c)} can claim the vault after ${inTime(Number(s.heir.inactiveBlocks), c.blockTime)} with no activity.`);
      return { title: 'Turn this account into a vault', lines };
    }
    case 'vaultUpdate':
      return {
        title: 'Change vault settings',
        lines: [`Change the vault to ${lyx(op.settings.allowance)} a day, a wait of ${inTime(Number(op.settings.delay), c.blockTime)}, safe address ${who(op.settings.safe, c)}${wait ? `. This takes effect in ${wait}` : ''}.`, 'You can cancel it any time before then.'],
      };
    case 'vaultClose':
      return { title: 'Close the vault', lines: [`Turn the vault back into a normal account${wait ? ` in ${wait}` : ' after the wait'}.`, 'You can cancel it before then.'] };
    case 'vaultCancel':
      return { title: 'Cancel a pending change', lines: [`Stop pending item ${shortHash('0x' + hex(op.id), 8, 6)}. Nothing is lost.`] };
    case 'vaultSweep':
      return { title: 'Sweep the vault', lines: [`Move everything in ${who(op.vault, c)} to its safe address right now, with no wait.`, 'Use this if your key was stolen.'] };
    case 'vaultHeirClaim':
      return { title: 'Claim as heir', lines: [`Start a claim on ${who(op.vault, c)}. The owner can cancel it during the wait${wait ? ` (${wait})` : ''}.`] };
    case 'keyRotate':
      return {
        title: 'Rotate this account\'s key',
        lines: [`After the wait${wait ? ` (${wait})` : ''}, ${who(op.newKey, c)} will control this account and your current key stops working.`, KEY_THEFT_NOTICE],
      };
    case 'keyCancelRotate':
      return { title: 'Cancel a key rotation', lines: [`Stop the waiting key rotation of ${who(op.account, c)}.`] };
    default:
      return { title: 'Sign a transaction', lines: [`This ${op.kind} is not described here. Check it carefully.`] };
  }
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

export type PendingLike = { kind: 'withdraw' | 'update' | 'close'; releaseHeight: number; byHeir: boolean; to?: string; amount?: string; id: string };

/** One line per waiting item, with a countdown. `iStarted` is true when this phone's owner key made it. */
export function pendingLine(p: PendingLike, height: number, c: Ctx): string {
  const left = inTime(p.releaseHeight - height, c.blockTime);
  const when = p.releaseHeight <= height ? 'releases in the next block' : `releases in ${left}`;
  if (p.byHeir) return `Heir claim, ${when}`;
  if (p.kind === 'withdraw') return `Withdrawal of ${lyx(BigInt(p.amount ?? '0'))} to ${who(p.to ?? '', c)}, ${when}`;
  if (p.kind === 'update') return `Settings change, ${when}`;
  return `Closing the vault, ${when}`;
}
