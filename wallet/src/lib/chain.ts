// One shared look at the chain tip, refreshed every few seconds, for the block ticker and fees.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { rpc, type ChainInfo } from './rpc';
import { store, useStore } from './store';

export const chain = store<{ info?: ChainInfo; error?: string; seenAt: number }>({ seenAt: 0 });
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;

async function tick() {
  if (AppState.currentState === 'background') return;
  try {
    const info = await rpc<ChainInfo>('lyx_chainInfo');
    const prev = chain.get().info;
    if (!prev || prev.height !== info.height || prev.peers !== info.peers || prev.mempoolSize !== info.mempoolSize) chain.set({ info, seenAt: Date.now() });
    else if (chain.get().error) chain.set((c) => ({ ...c, error: undefined }));
  } catch (e) {
    chain.set((c) => ({ ...c, error: (e as Error).message }));
  }
}

export function useChain() {
  useEffect(() => {
    if (users++ === 0) {
      tick();
      timer = setInterval(tick, 4000);
    }
    return () => {
      if (--users === 0 && timer) clearInterval(timer);
    };
  }, []);
  return useStore(chain);
}
export const refreshChain = tick;
/** Contract features (tokens, jars, capsules, connecting apps) only show where contracts are on. */
export function useContractsOn() {
  const { info } = useChain();
  return !!info && info.contractsActive !== false;
}
export const maturity = () => chain.get().info?.coinbaseMaturity ?? 60;
