// Tap to pay between two Android phones, over Bluetooth Low Energy. The native part is modules/lokyx-tap.
// One phone holds out a payment request at very low power, the other reads it only when almost touching.

import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { parsePayload, type Found } from './scan-core';
import { TAP_RSSI, tapProblem, type TapState } from './tap-core';

interface Native {
  isSupported(): boolean;
  hasPermission(): boolean;
  startBroadcast(text: string): void;
  stopBroadcast(): void;
  startScan(minRssi: number): void;
  stopScan(): void;
  addListener(name: string, cb: (e: any) => void): { remove(): void };
}

let native: Native | null | undefined;
function mod(): Native | null {
  if (native === undefined) {
    try {
      native = Platform.OS === 'android' ? requireNativeModule<Native>('LokyxTap') : null;
    } catch {
      native = null;
    }
  }
  return native;
}

/** Can this phone tap? Android 12 or newer with Bluetooth Low Energy. */
export function tapSupported(): boolean {
  try {
    return !!mod()?.isSupported();
  } catch {
    return false;
  }
}

/** Has the person already allowed "Nearby devices"? */
export function tapPermission(): boolean {
  try {
    return !!mod()?.hasPermission();
  } catch {
    return false;
  }
}

/** Ask for "Nearby devices" (the phone shows its own prompt). */
export const askTapPermission = () => allowed();

async function allowed(): Promise<boolean> {
  const m = mod();
  if (!m) return false;
  if (m.hasPermission()) return true;
  const r = await PermissionsAndroid.requestMultiple([
    'android.permission.BLUETOOTH_SCAN',
    'android.permission.BLUETOOTH_ADVERTISE',
    'android.permission.BLUETOOTH_CONNECT',
  ] as any);
  return Object.values(r).every((v) => v === 'granted');
}

interface Tap {
  state: TapState;
  problem: string;
}

function useTap(start: (m: Native) => void, stop: (m: Native) => void, on: boolean, onPayload?: (text: string) => void) {
  const [s, setS] = useState<Tap>({ state: 'idle', problem: '' });
  const cb = useRef(onPayload);
  cb.current = onPayload;
  const begin = start;
  const end = stop;
  useEffect(() => {
    const m = mod();
    if (!on || !m) {
      setS({ state: 'idle', problem: '' });
      return;
    }
    let live = true;
    const subs = [
      m.addListener('onState', (e: { state: TapState }) => live && setS({ state: e.state, problem: '' })),
      m.addListener('onError', (e: { reason: string }) => live && setS({ state: 'idle', problem: tapProblem(e.reason) })),
      m.addListener('onPayload', (e: { payload: string }) => live && (setS({ state: 'read', problem: '' }), cb.current?.(e.payload))),
    ];
    setS({ state: 'starting', problem: '' });
    allowed().then((ok) => {
      if (!live) return;
      if (!ok) return setS({ state: 'idle', problem: tapProblem('permission') });
      try {
        begin(m);
      } catch {
        setS({ state: 'idle', problem: tapProblem('start') });
      }
    });
    return () => {
      live = false;
      subs.forEach((x) => x.remove());
      try {
        end(m);
      } catch {
        /* already stopped */
      }
    };
  }, [on, begin, end]);
  return s;
}

/** Hold out a request (while `on`) so a phone that is almost touching can read it. */
export function useTapReceive(text: string, on: boolean): Tap {
  const start = useCallback((m: Native) => m.startBroadcast(text), [text]);
  const stop = useCallback((m: Native) => m.stopBroadcast(), []);
  return useTap(start, stop, on && !!text);
}

/** Look for a phone held very close (while `on`), and hand over what it asks for. */
export function useTapSend(on: boolean, found: (f: Found) => void): Tap {
  const start = useCallback((m: Native) => m.startScan(TAP_RSSI), []);
  const stop = useCallback((m: Native) => m.stopScan(), []);
  return useTap(start, stop, on, (text) => {
    const f = parsePayload(text);
    if (f) found(f);
  });
}
