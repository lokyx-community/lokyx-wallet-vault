// Live alerts (Android): a foreground service that keeps the wallet's JavaScript running with a small notice in
// the status bar, and looks at every account and vault every few seconds. Without it Android only lets the app
// check about every 15 minutes. Nothing leaves the phone except the same read-only calls the app already makes.

import { Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';
import { getItem } from './kv';
import { check } from './watch';

const EVERY_MS = 12_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function enabled(): Promise<boolean> {
  try {
    return JSON.parse((await getItem('w.settings')) ?? '{}').liveAlerts !== false;
  } catch {
    return true;
  }
}

async function loop() {
  while (BackgroundService.isRunning()) {
    try {
      await check(true);
    } catch {
      /* offline for a moment: try again on the next round */
    }
    await sleep(EVERY_MS);
  }
}

/** Start the service if the setting is on (the default). Safe to call every launch. */
export async function startLive() {
  if (Platform.OS !== 'android' || BackgroundService.isRunning() || !(await enabled())) return;
  await BackgroundService.start(loop, {
    taskName: 'LOKYX live alerts',
    taskTitle: 'LOKYX is watching',
    taskDesc: 'Your vault and payments are checked every few seconds.',
    taskIcon: { name: 'ic_launcher', type: 'mipmap' },
    color: '#3DD68C',
    linkingURI: 'lokyx://alerts',
    foregroundServiceType: ['specialUse'],
  });
}

export async function setLive(on: boolean) {
  if (Platform.OS !== 'android') return;
  if (on) await startLive();
  else if (BackgroundService.isRunning()) await BackgroundService.stop();
}
