// Tokens, jars, capsules and the app connection all run on contracts. On a network where
// contracts aren't switched on yet, those screens say so instead of offering something that
// would be refused.
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useChain } from '../lib/chain';
import { Button, Note, Screen } from './controls';
import { T } from './Text';

export function ContractsOnly({ children }: { children: ReactNode }) {
  const { info } = useChain();
  if (!info) return <Screen>{null}</Screen>;
  if (info.contractsActive !== false) return <>{children}</>;
  return (
    <Screen>
      <View style={{ gap: 12, paddingTop: 40 }}>
        <T v="title" style={{ textAlign: 'center' }}>Not on this network yet</T>
        <Note center>
          This needs contracts, and they aren't switched on for {info.network}
          {info.contractsFrom != null ? ` until block ${info.contractsFrom.toLocaleString()}` : ''}. Sending and receiving LYX work as usual.
        </Note>
        <Button title="Back to wallet" kind="line" onPress={() => router.replace('/')} style={{ marginTop: 12 }} />
      </View>
    </Screen>
  );
}
