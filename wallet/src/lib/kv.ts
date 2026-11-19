// Small key-value storage: the phone's secure storage, or the browser's local storage on the web.

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { nsKey } from './ns';

const web = Platform.OS === 'web';

export async function getItem(key: string): Promise<string | null> {
  key = nsKey(key);
  if (web) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string) {
  key = nsKey(key);
  if (web) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: kept for this visit only */
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function removeItem(key: string) {
  key = nsKey(key);
  if (web) {
    try {
      localStorage.removeItem(key);
    } catch {}
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
