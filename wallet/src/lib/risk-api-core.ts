// What a security service (GoPlus) says about an address or a token, boiled down to one level and a few flags.
// Pure, so it is tested (test/risk-api.test.ts). The relay worker and the phone both import this file.
// "ok" means the service has nothing bad on record: it never means "safe", and the phone never turns a colour green from it.

export type ApiLevel = 'ok' | 'caution' | 'danger' | 'unknown';
export interface ApiVerdict {
  level: ApiLevel;
  flags: string[];
  source: 'goplus';
}

/** Mainnets the service covers and the wallet can ask about (chain ids). Test networks are not covered. */
export const API_CHAINS = new Set([1, 56, 137, 42161, 10, 8453, 43114, 59144, 534352, 100, 42220]);

const THEFT = ['phishing_activities', 'stealing_attack', 'blackmail_activities', 'honeypot_related_address', 'fake_kyc', 'blacklist_doubt', 'cybercrime'];
const OTHER = ['money_laundering', 'financial_crime', 'darkweb_transactions', 'malicious_mining_activities', 'sanctioned'];
const on = (v: unknown) => v === '1' || v === 1 || v === true;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Malicious Address API `result` → verdict. */
export function normAddressResult(raw: unknown): ApiVerdict {
  const r = obj(raw);
  if (!r) return { level: 'unknown', flags: [], source: 'goplus' };
  const theft = THEFT.filter((k) => on(r[k]));
  const other = OTHER.filter((k) => on(r[k]));
  return { level: theft.length ? 'danger' : other.length ? 'caution' : 'ok', flags: [...theft, ...other], source: 'goplus' };
}

const rate = (v: unknown) => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Token Security API `result` (keyed by contract address) → verdict for one token. */
export function normTokenResult(raw: unknown, address: string): ApiVerdict {
  const all = obj(raw);
  const t = all ? obj(all[address.toLowerCase()]) : null;
  if (!t) return { level: 'unknown', flags: [], source: 'goplus' };
  const danger: string[] = [];
  const caution: string[] = [];
  if (on(t.is_honeypot)) danger.push('honeypot');
  if (on(t.cannot_sell_all)) danger.push('cannotSell');
  if (on(t.owner_change_balance)) danger.push('ownerBalance');
  if (on(t.selfdestruct)) danger.push('selfdestruct');
  if (rate(t.sell_tax) >= 0.5) danger.push('sellTax');
  else if (rate(t.sell_tax) >= 0.1) caution.push('sellTax');
  if (rate(t.buy_tax) >= 0.1) caution.push('buyTax');
  if (t.is_open_source === '0' || t.is_open_source === 0) caution.push('closedCode');
  if (on(t.hidden_owner)) caution.push('hiddenOwner');
  if (on(t.transfer_pausable)) caution.push('pausable');
  if (on(t.is_blacklisted)) caution.push('blacklist');
  if (on(t.can_take_back_ownership)) caution.push('takeBackOwner');
  if (on(t.slippage_modifiable)) caution.push('slippage');
  return { level: danger.length ? 'danger' : caution.length ? 'caution' : 'ok', flags: [...danger, ...caution], source: 'goplus' };
}

const WORDS: Record<string, string> = {
  phishing_activities: 'Reported for phishing.',
  stealing_attack: 'Reported for stealing coins.',
  blackmail_activities: 'Reported for blackmail.',
  honeypot_related_address: 'Linked to tokens that cannot be sold.',
  fake_kyc: 'Reported for fake identity checks.',
  blacklist_doubt: 'On a security blacklist.',
  cybercrime: 'Linked to cybercrime.',
  money_laundering: 'Linked to money laundering.',
  financial_crime: 'Linked to financial crime.',
  darkweb_transactions: 'Linked to dark-web payments.',
  malicious_mining_activities: 'Linked to malicious mining.',
  sanctioned: 'On a sanctions list.',
  honeypot: 'You could buy this token but not sell it.',
  cannotSell: 'This token may block you from selling all of it.',
  ownerBalance: 'Its owner can change your balance.',
  selfdestruct: 'Its code can destroy itself.',
  sellTax: 'It takes a large fee when you sell.',
  buyTax: 'It takes a large fee when you buy.',
  closedCode: 'Its code is hidden, so nobody can check it.',
  hiddenOwner: 'It has a hidden owner with special powers.',
  pausable: 'Its owner can freeze transfers.',
  blacklist: 'Its owner can block certain wallets.',
  takeBackOwnership: 'Its owner can take control back after giving it up.',
  takeBackOwner: 'Its owner can take control back after giving it up.',
  slippage: 'Its owner can change the fees at any time.',
};
export const flagText = (f: string) => WORDS[f] ?? 'Flagged by a security service.';

/** The worst of several verdicts (danger > caution > ok > unknown). Null when there are none. */
export function worstVerdict(list: (ApiVerdict | null)[]): ApiVerdict | null {
  const rank: Record<ApiLevel, number> = { unknown: 0, ok: 1, caution: 2, danger: 3 };
  let best: ApiVerdict | null = null;
  for (const v of list) if (v && (!best || rank[v.level] > rank[best.level])) best = v;
  return best;
}
