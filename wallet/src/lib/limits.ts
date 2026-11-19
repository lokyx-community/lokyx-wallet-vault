import { getItem, setItem } from './kv';
import { askPasscode } from './auth';
import { parseLyx } from './lokyx';
import { wallet } from './wallet';
import { addSpent, overLimit, spentToday, type Spent } from './limits-core';

const KEY = 'w.spent';
const read = async (): Promise<Spent | undefined> => {
  try {
    return JSON.parse((await getItem(KEY)) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
};

/** Above the daily limit the passcode is needed on top of Face ID. True when the payment may go ahead. */
export async function checkDailyLimit(value: bigint): Promise<boolean> {
  const raw = wallet.get().settings.dailyLimit;
  let lim: bigint | null = null;
  try {
    lim = raw ? parseLyx(raw) : null;
  } catch {}
  if (!overLimit(lim, spentToday(await read(), Date.now()), value)) return true;
  return askPasscode(`This is over your daily limit of ${raw} LYX. Enter your passcode`);
}

export async function noteSpent(value: bigint): Promise<void> {
  await setItem(KEY, JSON.stringify(addSpent(await read(), Date.now(), value)));
}
