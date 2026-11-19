// Background check for vault withdrawals, setting changes and key rotations this phone didn't start.
// iOS and Android decide when the task actually runs (roughly every 15 minutes at best, never
// guaranteed); opening the app also checks. Everything it needs is non-secret, so it works while locked.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { getItem, setItem } from './kv';
import { store } from './store';
import { rpc, type Account } from './rpc';
import { balanceDrop, balanceRise, findAlerts, fresh, newReceipts, newSends, prune, receiptKey, rotationKey, sendKey, type Alert } from './watch-core';
import type { History } from './rpc';
import { shortAddr } from './format';
import { addInbox, type InboxKind } from './inbox';

const TASK = 'lokyx-watch';
const STARTED = 'w.started';
const TOLD = 'w.told';
const TOLD_ETH = 'w.told.eth';

/** What the app shows: everything waiting right now that this phone didn't start. */
export const alerts = store<Alert[]>([]);

async function readSet(k: string): Promise<Set<string>> {
  try {
    return new Set(JSON.parse((await getItem(k)) ?? '[]'));
  } catch {
    return new Set();
  }
}
const writeSet = (k: string, s: Set<string>) => setItem(k, JSON.stringify([...s].slice(-500)));

/** Remember that this phone started something, so it isn't reported back as a surprise. */
export async function markStarted(hash: string) {
  const s = await readSet(STARTED);
  s.add(hash.replace(/^0x/, '').toLowerCase());
  await writeSet(STARTED, s);
}
export async function markRotationStarted(account: string, newKey: string) {
  const s = await readSet(STARTED);
  s.add(rotationKey(account, newKey));
  await writeSet(STARTED, s);
}

/** Look at every account on this phone. Returns what is waiting; notifies about new items when `notify`. */
export async function check(notify: boolean): Promise<Alert[]> {
  const raw = await getItem('w.accounts');
  const mine: { address: string }[] = raw ? JSON.parse(raw) : [];
  const node = (await getItem('w.node')) || undefined;
  const accts: Account[] = [];
  for (const m of mine) {
    try {
      accts.push(await (node ? rpc<Account>('lyx_getAccount', { address: m.address }, node) : rpc<Account>('lyx_getAccount', { address: m.address })));
    } catch {
      /* node unreachable: try again next time */
    }
  }
  const started = await readSet(STARTED);
  const all = findAlerts(accts, started, (a) => shortAddr(a, 10, 6));
  alerts.set(all);
  const told = await readSet(TOLD);
  if (notify) {
    for (const a of fresh(all, told)) {
      const title = a.kind === 'rotation' ? 'Key rotation started' : 'Vault: something is waiting';
      await Notifications.scheduleNotificationAsync({ content: { title, body: `${a.text}. Tap to review or cancel.`, data: { account: a.account, key: a.key } }, trigger: null }).catch(() => {});
      await addInbox({ id: `v:${a.key}`, kind: 'vault', title, body: `${a.text}. Review it, and cancel it if it isn't yours.`, route: '/alerts' }).catch(() => {});
      told.add(a.key);
    }
  }
  await writeSet(TOLD, prune(told, all));
  await checkReceipts(mine, node, notify).catch(() => {});
  // Ethereum vaults: queued transactions this phone didn't start, and any live setting that is not what was set up
  try {
    // loaded here, not at the top: ethvault imports wallet, and wallet imports this file (a load-order loop crashed the app)
    const { checkEthVaults } = await import('./ethvault');
    const eth = await checkEthVaults();
    const told2 = await readSet(TOLD_ETH);
    if (notify) {
      for (const a of eth.filter((x) => !told2.has(x.key) && !x.key.endsWith(':unreachable'))) {
        const title = a.kind === 'queued' ? 'Ethereum vault: something is waiting' : 'Ethereum vault: a setting is not as expected';
        await Notifications.scheduleNotificationAsync({ content: { title, body: `${a.text}. Tap to review or cancel.`, data: { eth: a.net, key: a.key } }, trigger: null }).catch(() => {});
        await addInbox({ id: `e:${a.key}`, kind: 'vault', title, body: `${a.text}. Review it, and cancel it if it isn't yours.`, route: '/alerts' }).catch(() => {});
        told2.add(a.key);
      }
    }
    await writeSet(TOLD_ETH, new Set([...told2].filter((k) => eth.some((x) => x.key === k))));
  } catch {
    /* the Ethereum servers are unreachable: the vault screen says so when it is opened */
  }
  return all;
}

TaskManager.defineTask(TASK, async () => {
  try {
    await check(true);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Ask for permission, set how notifications look, and schedule the background task. Safe to call every launch. */
export async function startWatching() {
  if (Platform.OS === 'web') return;
  try {
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('vault', { name: 'Vault alerts', importance: Notifications.AndroidImportance.HIGH });
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted && p.canAskAgain) await Notifications.requestPermissionsAsync();
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
  } catch {
    /* not available here (a simulator, the web): the in-app banner still works */
  }
  check(false).catch(() => {});
  try {
    const { startLive } = await import('./live');
    await startLive();
  } catch {
    /* the live service is Android only */
  }
}

// ---------- money coming in ----------

const SEEN_RX = 'w.rx.seen';
const RX_READY = 'w.rx.ready';
const CHAIN_BAL = 'w.rx.chains';

/** Mark payments as already told (the Home screen does this when it shows one live). */
export async function markReceiptsSeen(keys: string[]) {
  const s = await readSet(SEEN_RX);
  keys.forEach((k) => s.add(k));
  await writeSet(SEEN_RX, s);
}

const say = async (title: string, body: string, data: Record<string, string>, kind: InboxKind = 'receive', route = '/(tabs)/activity') => {
  await Notifications.scheduleNotificationAsync({ content: { title, body, data }, trigger: null }).catch(() => {});
  await addInbox({ id: `${kind}:${data.tx || data.chain || ''}:${title}:${Math.floor(Date.now() / 60_000)}`, kind, title, body, route }).catch(() => {});
};

/** "Received 1.5 LYX" for LOKYX payments, and Bitcoin / Ethereum balances that went up. */
async function checkReceipts(mine: { address: string; name?: string }[], node: string | undefined, notify: boolean) {
  const seen = await readSet(SEEN_RX);
  let alertsOn = true;
  try {
    alertsOn = JSON.parse((await getItem('w.settings')) ?? '{}').sendAlerts !== false;
  } catch {}
  // the first run after install only learns what is already there, so old payments aren't announced
  const ready = (await getItem(RX_READY)) === '1';
  for (const m of mine) {
    let h: History;
    try {
      h = await (node ? rpc<History>('lyx_getAddressHistory', { address: m.address, limit: 15 }, node) : rpc<History>('lyx_getAddressHistory', { address: m.address, limit: 15 }));
    } catch {
      continue;
    }
    for (const i of newReceipts(m.address, h.items, seen)) {
      seen.add(receiptKey(m.address, i));
      if (notify && ready) await say(`Received ${i.amountLyx} LYX`, `From ${shortAddr(i.from ?? '', 10, 6)}${m.name ? ` to ${m.name}` : ''}.`, { tx: i.txHash ?? '' });
    }
    for (const i of newSends(m.address, h.items, seen)) {
      seen.add(sendKey(m.address, i));
      if (notify && ready && alertsOn) await say(`${i.amountLyx} LYX left your wallet`, `To ${shortAddr(i.to ?? '', 10, 6)}${m.name ? ` from ${m.name}` : ''}. Not you? Open LOKYX now.`, { tx: i.txHash ?? '' }, 'send');
    }
  }
  await writeSet(SEEN_RX, seen);

  // Bitcoin and Ethereum: compare balances with last time (addresses are cached, no key needed)
  try {
    const raw = await getItem('w.addrs');
    if (raw) {
      const { btcBalance, ethBalance, activeNets, loadChains } = await import('./multichain');
      const { BTC_NETS, ETH_NETS, formatBtc, formatUnits } = await import('./multichain-core');
      await loadChains();
      const a = JSON.parse(raw) as { btc: Record<string, string>; eth: string };
      const nets = activeNets();
      const prev: Record<string, string> = JSON.parse((await getItem(CHAIN_BAL)) ?? '{}');
      const next = { ...prev };
      const btcAddr = a.btc[nets.btc];
      if (btcAddr) {
        const bb = await btcBalance(nets.btc, btcAddr);
        const b = bb.confirmed + bb.pending;
        const up = balanceRise(prev[`btc:${btcAddr}`], b);
        if (notify && ready && up > 0n) await say(`Received ${formatBtc(up)} ${BTC_NETS[nets.btc].unit}`, `On ${BTC_NETS[nets.btc].label}.`, { chain: 'btc' });
        const down = balanceDrop(prev[`btc:${btcAddr}`], b);
        if (notify && ready && alertsOn && down > 0n) await say(`${formatBtc(down)} ${BTC_NETS[nets.btc].unit} left your wallet`, `On ${BTC_NETS[nets.btc].label}. Not you? Open LOKYX now.`, { chain: 'btc' }, 'send');
        next[`btc:${btcAddr}`] = b.toString();
      }
      if (a.eth) {
        const e = await ethBalance(nets.eth, a.eth);
        const up = balanceRise(prev[`eth:${nets.eth}:${a.eth}`], e);
        if (notify && ready && up > 0n) await say(`Received ${formatUnits(up, 18, 6)} ${ETH_NETS[nets.eth].unit}`, `On ${ETH_NETS[nets.eth].label}.`, { chain: 'eth' });
        const down = balanceDrop(prev[`eth:${nets.eth}:${a.eth}`], e);
        if (notify && ready && alertsOn && down > 0n) await say(`${formatUnits(down, 18, 6)} ${ETH_NETS[nets.eth].unit} left your wallet`, `On ${ETH_NETS[nets.eth].label}. Not you? Open LOKYX now.`, { chain: 'eth' }, 'send');
        next[`eth:${nets.eth}:${a.eth}`] = e.toString();
      }
      await setItem(CHAIN_BAL, JSON.stringify(next));
    }
  } catch {
    /* explorer or RPC unreachable: next time */
  }
  if (!ready) await setItem(RX_READY, '1');
}
