import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { T } from './Text';
import { Button, ErrorText, failure, success } from './controls';
import { SlideToPay } from './SlideToPay';
import { C } from './theme';
import { confirmIt } from '../lib/auth';
import { useStore } from '../lib/store';
import { checkEthVaults, ethAlertList, phoneCancel, snapshot, vaults, type NetVault } from '../lib/ethvault';
import type { EthAlert } from '../lib/ethvault-watch-core';
import { VAULT_NETS, type VaultNet } from '../lib/ethvault-core';

const left = (readyAt: number) => {
  const s = Math.max(0, readyAt - Math.floor(Date.now() / 1000));
  const h = Math.floor(s / 3600);
  return h >= 48 ? `${Math.floor(h / 24)} days` : h >= 1 ? `${h} h ${Math.floor((s % 3600) / 60)} min` : `${Math.max(1, Math.floor(s / 60))} min`;
};

/** Ethereum vault alerts, in the same list as the others: queued items with a one-slide cancel, and settings that changed. */
export function EthAlerts() {
  const list = useStore(ethAlertList);
  const vs = useStore(vaults);
  const [open, setOpen] = useState('');
  const [err, setErr] = useState('');
  if (!list.length) return null;
  const cancel = async (a: EthAlert) => {
    setErr('');
    const v = vs[a.net as VaultNet] as NetVault | undefined;
    if (!v) return false;
    if (!(await confirmIt('Cancel everything waiting in your Ethereum vault'))) return false;
    try {
      await phoneCancel(v, await snapshot(v));
      success();
      setOpen('');
      checkEthVaults().catch(() => {});
      return true;
    } catch (e) {
      failure();
      setErr(`${(e as Error).message} If your everyday address has no ETH left for the fee, use the recovery key (its own address needs a little ETH too).`);
      return false;
    }
  };
  return (
    <>
      {list.map((a) => (
        <View key={a.key} style={{ gap: 10, padding: 14, borderRadius: 18, backgroundColor: C.fill }}>
          <T v="callout" color={a.level === 'danger' ? C.bad : undefined}>{a.text}</T>
          {a.kind === 'queued' && a.readyAt != null && <T v="sub" dim>Can run in {left(a.readyAt)}</T>}
          {a.kind === 'queued' ? (
            open === a.key ? <SlideToPay label="Slide to cancel" onSlide={() => cancel(a)} /> : <Button title="Cancel this" onPress={() => setOpen(a.key)} />
          ) : (
            <Button title="Look at my vault" kind="line" onPress={() => router.push(`/ethvault?net=${a.net}`)} />
          )}
          <T v="caption" dim>{VAULT_NETS[a.net as VaultNet]?.label}</T>
        </View>
      ))}
      <ErrorText>{err}</ErrorText>
      <Button title="Use my Ethereum recovery key" kind="line" onPress={() => router.push('/ethvault/recover')} />
    </>
  );
}
