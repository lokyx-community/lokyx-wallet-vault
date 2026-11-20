// This phone's side of shared-account push: get the phone's Expo push token, tell the relay which shared accounts it
// belongs to, and open the right account when a push is tapped. The push only says something is waiting; the details
// are in the sealed message, which the app opens itself.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { getItem, setItem } from './kv';
import { btcShared } from './btcms';
import { ethShared } from './ethms';
import { relayBase } from './relay';
import { relayPush } from './relay-client';
import { topicOf } from './relay-seal';

export const PUSH_TOKEN = 'w.push.token';

/** Register this phone with the relay for every shared account that uses it. Safe to call often; never throws. */
export async function registerPush(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) return;
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('shared', { name: 'Shared accounts', importance: Notifications.AndroidImportance.HIGH });
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await setItem(PUSH_TOKEN, token);
    const base = await relayBase();
    const keys = [...ethShared.get(), ...btcShared.get()].map((s) => s.relay).filter((k): k is string => !!k);
    await Promise.all(keys.map((k) => relayPush(base, k, token).catch(() => {})));
  } catch {
    /* no Google services on this phone, or no network: the in-app check still works */
  }
}

/** Where a tapped push should go: the shared account whose mailbox it was, or null when it is not one of ours. */
export function routeForPush(data: unknown): string | null {
  const topic = (data as { topic?: unknown } | null)?.topic;
  if (typeof topic !== 'string') return null;
  const eth = ethShared.get().find((s) => s.relay && topicOf(s.relay) === topic);
  if (eth) return `/shared/eth/${eth.address}`;
  const btc = btcShared.get().find((s) => s.relay && topicOf(s.relay) === topic);
  return btc ? `/shared/btc/${btc.address}` : null;
}
