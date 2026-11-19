import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Group, Line, Row, Screen } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { C, F } from '../../ui/theme';
import { siteUrl, usePoll } from '../../lib/rpc';
import { labelFor, niceLyx, timeAgo } from '../../lib/format';
import { maturity } from '../../lib/chain';
import { DUR, EASE_OUT } from '../../ui/motion';

interface Block {
  hash: string;
  height: number;
  timestamp: number;
  miner: string;
  rewardLyx: string;
  feesLyx: string;
  txCount: number;
  confirmations: number;
  size: number;
}

export default function BlockScreen() {
  const { height } = useLocalSearchParams<{ height: string }>();
  const b = usePoll<Block>('lyx_getBlock', { height: Number(height) }, 10000).data;
  const left = b ? Math.max(0, maturity() - b.confirmations) : 0;
  return (
    <Screen title="">
      {!b ? (
        <ActivityIndicator color={C.sub} style={{ marginTop: 80 }} />
      ) : (
        <>
          <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)} style={{ alignItems: 'center', gap: 12, paddingBottom: 6 }}>
            <View style={{ width: 92, height: 92, borderRadius: 30, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="cube" size={42} color={C.text} width={1.6} />
            </View>
            <T v="callout" dim>You mined block {b.height.toLocaleString('en-US')}</T>
            <T style={{ fontFamily: F.semibold, fontSize: 44, letterSpacing: -1.8 }}>+{niceLyx(b.rewardLyx)} LYX</T>
            <T v="sub" color={left ? C.wait : C.soft}>{left ? `Spendable in ${left} more blocks` : 'Spendable now'}</T>
          </Animated.View>
          <Group>
            <Line label="When" value={timeAgo(b.timestamp)} />
            <Line label="Miner" value={labelFor(b.miner)} />
            <Line label="Fees in it" value={`${niceLyx(b.feesLyx, 6)} LYX`} />
            <Line label="Payments in it" value={String(b.txCount)} />
            <Line label="Blocks on top" value={b.confirmations.toLocaleString('en-US')} />
          </Group>
          <Group>
            <Row icon="globe" title="Open in explorer" onPress={() => router.push(`/browser?url=${encodeURIComponent(`${siteUrl()}/#/block/${b.height}`)}`)} />
          </Group>
        </>
      )}
    </Screen>
  );
}
