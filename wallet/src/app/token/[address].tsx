import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Button, Group, Line, Row, Screen, success } from '../../ui/controls';
import { toast } from '../../ui/Toast';
import { C, F } from '../../ui/theme';
import { rpc, siteUrl, type RunResult } from '../../lib/rpc';
import { amountOf, formatUnits, tokenBalance, tokens, useTokens } from '../../lib/data';
import { useAccountRef, useWallet } from '../../lib/wallet';
import { shortAddr } from '../../lib/format';
import { ContractsOnly } from '../../ui/ContractsOnly';
import { DUR, EASE_OUT } from '../../ui/motion';

function TokenScreen() {
  const { address } = useLocalSearchParams<{ address: string }>();
  const t = useTokens().find((x) => x.address === address);
  const me = useAccountRef();
  const hide = useWallet().settings.hideBalance;
  const [bal, setBal] = useState<bigint>();
  const [supply, setSupply] = useState<bigint>();
  useEffect(() => {
    if (!t || !me) return;
    tokenBalance(t, me.address).then(setBal).catch(() => {});
    rpc<RunResult>('lyx_call', { to: t.address, method: 'total_supply', args: [] })
      .then((r) => r.ok && setSupply(amountOf(r.result)))
      .catch(() => {});
  }, [t, me]);
  if (!t) return <Screen title="Token"><T v="sub" dim>This token isn't in your list.</T></Screen>;
  return (
    <Screen title="">
      <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)} style={{ alignItems: 'center', gap: 12, paddingVertical: 10 }}>
        <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#E9B86A', alignItems: 'center', justifyContent: 'center', shadowColor: '#E9B86A', shadowOpacity: 0.3, shadowRadius: 22, shadowOffset: { width: 0, height: 6 } }}>
          <View style={{ width: 86, height: 86, borderRadius: 43, backgroundColor: '#F6D793', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ fontFamily: F.semibold, fontSize: 22, color: '#6A4A1A', letterSpacing: -0.6 }}>{t.symbol.slice(0, 5)}</T>
          </View>
        </View>
        <T v="callout" dim>{t.name}</T>
        <T style={{ fontFamily: F.semibold, fontSize: 46, letterSpacing: -1.8 }}>{hide ? '••••' : bal === undefined ? '…' : formatUnits(bal, t.decimals)}</T>
      </Animated.View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Send" icon="send" onPress={() => router.push(`/send?token=${t.address}`)} style={{ flex: 1 }} />
        <Button title="Receive" icon="receive" kind="line" onPress={() => router.push('/ring?mode=show')} style={{ flex: 1 }} />
      </View>
      <Group>
        <Line label="Symbol" value={t.symbol} />
        <Line label="Made in total" value={supply === undefined ? '…' : formatUnits(supply, t.decimals, 2)} />
        <Line label="Contract" value={shortAddr(t.address)} />
      </Group>
      <Group>
        <Row
          icon="copy"
          title="Copy contract address"
          onPress={async () => {
            await Clipboard.setStringAsync(t.address);
            success();
            toast('Copied');
          }}
        />
        <Row icon="lock" title={`Lock some ${t.symbol} away`} onPress={() => router.push(`/token/locks?token=${t.address}`)} />
        <Row icon="globe" title="Open in explorer" onPress={() => router.push(`/browser?url=${encodeURIComponent(`${siteUrl()}/#/address/${t.address}`)}`)} />
        <Row
          icon="trash"
          title="Hide this token"
          danger
          onPress={async () => {
            await tokens.save((x) => x.filter((y) => y.address !== t.address));
            router.back();
          }}
        />
      </Group>
    </Screen>
  );
}

export default function TokenScreenGate() {
  return (
    <ContractsOnly>
      <TokenScreen />
    </ContractsOnly>
  );
}
