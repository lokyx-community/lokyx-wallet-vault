// The "Motion in background" switch in You. On by default; off stops the light from following how the phone is held.
import { useEffect } from 'react';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';

const onStore = store<boolean>(true);
let loaded = false;
async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const v = await getItem('w.motionbg');
    if (v === '0') onStore.set(false);
  } catch {}
}

export function useMotionBg(): [boolean, (v: boolean) => void] {
  useEffect(() => {
    load();
  }, []);
  return [useStore(onStore), (v) => { onStore.set(v); setItem('w.motionbg', v ? '1' : '0').catch(() => {}); }];
}
