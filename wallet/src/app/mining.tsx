import { useMemo } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Group, Line, Note, Row, Screen, success } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/Toast';
import { C, F } from '../ui/theme';
import { siteUrl, usePoll, type History } from '../lib/rpc';
import { useAccountRef } from '../lib/wallet';
import { useChain } from '../lib/chain';
import { niceLyx, timeAgo } from '../lib/format';
import { ActivityRow } from '../ui/ActivityRow';
import { DUR, EASE_OUT } from '../ui/motion';

function hashrate(h: number) {
  if (h >= 1e6) return `${(h / 1e6).toFixed(1)} MH/s`;
  if (h >= 1e3) return `${(h / 1e3).toFixed(1)} kH/s`;
  return `${Math.round(h)} H/s`;
}

export default function Mining() {
  const me = useAccountRef();
  const chain = useChain().info;
  const hist = usePoll<History>('lyx_getAddressHistory', me ? { address: me.address, limit: 100 } : null, 15000).data;
  const mined = useMemo(() => (hist?.items ?? []).filter((i) => i.kind === 'mined'), [hist]);
  const earned = useMemo(() => mined.reduce((s, i) => s + Number(i.amountLyx), 0), [mined]);

  return (
    <Screen title="Mining" large>
      <T v="callout" dim style={{ lineHeight: 22 }}>LOKYX is mined with ordinary computers. Every block pays the miner who finds it, about once a minute across the network.</T>

      <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)} style={{ borderRadius: 28, backgroundColor: C.fill, padding: 22, gap: 18 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ gap: 4 }}>
            <T v="sub" dim>You've mined</T>
            <T style={{ fontFamily: F.semibold, fontSize: 34, letterSpacing: -1.2 }}>{(hist?.blocksMined ?? 0).toLocaleString('en-US')}</T>
            <T v="caption" dim>blocks</T>
          </View>
          <View style={{ gap: 4, alignItems: 'flex-end' }}>
            <T v="sub" dim>Earned lately</T>
            <T style={{ fontFamily: F.semibold, fontSize: 34, letterSpacing: -1.2 }}>{niceLyx(String(earned), 2)}</T>
            <T v="caption" dim>LYX</T>
          </View>
        </View>
        {mined[0] && <T v="sub" dim>Last block {timeAgo(mined[0].timestamp)}</T>}
      </Animated.View>

      <Group title="The network">
        <Line label="Height" value={chain ? chain.height.toLocaleString('en-US') : '…'} />
        <Line label="All miners together" value={chain ? hashrate(chain.networkHashrateEstimate) : '…'} />
        <Line label="Coins in circulation" value={chain ? `${niceLyx(chain.issuedLyx, 0)} LYX` : '…'} />
      </Group>

      <Group title="Mine on your computer">
        <Row icon="globe" title="Download the miner" sub="Windows, Mac and Linux" onPress={() => router.push(`/browser?url=${encodeURIComponent(`${siteUrl()}/#/download`)}`)} />
        <Row
          icon="copy"
          title="Copy my address"
          sub="Paste it when the miner asks where to pay"
          onPress={async () => {
            await Clipboard.setStringAsync(me?.address ?? '');
            success();
            toast('Address copied');
          }}
        />
      </Group>

      {mined.length > 0 && (
        <View style={{ gap: 2 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 20, paddingBottom: 6, paddingTop: 6 }}>Blocks you found</T>
          {mined.slice(0, 20).map((it, i) => (
            <ActivityRow key={it.blockHash} item={it} i={i} />
          ))}
        </View>
      )}
      {hist && mined.length === 0 && (
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 8 }}>
          <Icon name="chip" size={20} color={C.sub} />
          <T v="sub" dim style={{ flex: 1 }}>No blocks yet. Start the miner with your address and they'll show up here.</T>
        </View>
      )}
    </Screen>
  );
}
