import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { T } from '../ui/Text';
import { Button, Note, Screen } from '../ui/controls';
import { ConfirmOp } from '../ui/ConfirmOp';
import { C } from '../ui/theme';
import { alerts, check } from '../lib/watch';
import { useStore } from '../lib/store';
import { usePoll, type ChainInfo } from '../lib/rpc';
import { hexToBytes } from '../lib/lokyx';
import { inTime, KEY_THEFT_NOTICE } from '../lib/vault-core';
import { EthAlerts } from '../ui/EthAlerts';
import { IntroHero } from '../ui/Feature';

/** What is waiting that this phone didn't start, with a one-slide cancel. */
export default function Alerts() {
  const list = useStore(alerts);
  const info = usePoll<ChainInfo>('lyx_chainInfo', {}, 6000);
  const bt = info.data?.targetBlockTime ?? 60;
  const height = info.data?.height ?? 0;
  const [open, setOpen] = useState('');
  const done = () => { setOpen(''); check(false).catch(() => {}); };
  return (
    <Screen title="Waiting" large>
      {list.length === 0 ? <IntroHero icon="check" title="All clear" text="Nothing is waiting on your accounts." /> : <T v="callout" dim style={{ lineHeight: 22 }}>You did not start these on this phone. If you don't recognise one, cancel it now.</T>}
      {list.map((a) => (
        <View key={a.key} style={{ gap: 12, padding: 18, borderRadius: 24, backgroundColor: C.fill }}>
          <T v="callout">{a.text}</T>
          <T v="sub" dim>Releases in {inTime(a.releaseHeight - height, bt)}</T>
          {open === a.key ? (
            <ConfirmOp
              op={a.kind === 'rotation' ? { kind: 'keyCancelRotate', account: a.account } : { kind: 'vaultCancel', id: hexToBytes(a.id!) }}
              me={a.account} blockTime={bt} label="Slide to cancel" onDone={done}
            />
          ) : (
            <Button title="Cancel this" onPress={() => setOpen(a.key)} />
          )}
        </View>
      ))}
      <EthAlerts />
      <T v="caption" dim style={{ lineHeight: 18 }}>Cancelling is signed with this account's key. If a thief has changed it, or you only have the recovery words, use the recovery key.</T>
      <Button title="Use my recovery key" kind="line" onPress={() => router.push('/vault/recover')} />
      <T v="caption" dim style={{ lineHeight: 18 }}>{KEY_THEFT_NOTICE}</T>
    </Screen>
  );
}
