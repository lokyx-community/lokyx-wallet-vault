import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { T } from './Text';
import { Press } from './controls';
import { CoinLogo } from './CoinLogo';
import { Skeleton } from './Skeleton';
import { activeNets, btcBalance, ensureAddresses, ethBalance, useAsync, useChainSettings } from '../lib/multichain';
import { BTC_NETS, ETH_NETS, formatBtc, formatUnits } from '../lib/multichain-core';
import { wallet } from '../lib/wallet';
import { DUR, EASE_OUT } from './motion';

/** Bitcoin and Ethereum rows under the LYX balance. Test networks only in this beta. */
export function OtherChains({ hide }: { hide: boolean }) {
  useChainSettings();
  const nets = activeNets();
  const a = useAsync(async () => (wallet.get().exists ? ensureAddresses().catch(() => null) : null), []);
  const addrs = a.data;
  const b = useAsync(async () => (addrs ? btcBalance(nets.btc, addrs.btc[nets.btc]) : null), [addrs, nets.btc], 30_000);
  const e = useAsync(async () => (addrs ? ethBalance(nets.eth, addrs.eth) : null), [addrs, nets.eth], 30_000);
  const rows = [
    { chain: 'btc', tag: 'BTC', name: BTC_NETS[nets.btc].label, bal: b.data ? `${formatBtc(b.data.confirmed)}` : b.error ? '–' : '' },
    { chain: 'eth', tag: 'ETH', name: ETH_NETS[nets.eth].label, bal: e.data != null ? formatUnits(e.data, 18, 6) : e.error ? '–' : '' },
  ];
  return (
    <View style={{ gap: 2, paddingTop: 6 }}>
      {rows.map((r, i) => (
        <Animated.View key={r.chain} entering={FadeInDown.delay(120 + i * 70).duration(DUR.base).easing(EASE_OUT)}>
        <Press onPress={() => router.push(`/chain/${r.chain}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 }}>
          <CoinLogo chain={r.chain as 'btc' | 'eth'} size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <T v="callout" style={{ fontSize: 16 }}>{r.name}</T>
            <T v="caption" dim>Test coins, no value</T>
          </View>
          {!hide && r.bal === '' ? <Skeleton w={56} h={16} /> : <T v="callout" style={{ fontSize: 16, fontVariant: ['tabular-nums'] }}>{hide ? '•••' : r.bal}</T>}
        </Press>
        </Animated.View>
      ))}
    </View>
  );
}
