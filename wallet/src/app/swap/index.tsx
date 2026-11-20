import { Tutorial, HowItWorks } from '../../ui/Tutorial';
import { useTutorial } from '../../lib/tutorial';
import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Icon } from '../../ui/Icon';
import { Group, Note, Press, Row, Screen } from '../../ui/controls';
import { CoinLogo } from '../../ui/CoinLogo';
import { C, F } from '../../ui/theme';
import { DUR, EASE_OUT } from '../../ui/motion';
import { loadSwaps, loadSwapSettings, swapId, swapTitle, sw, useSwaps } from '../../lib/swaps';

/** Swaps: trade LYX for BTC or ETH directly with another person. No exchange, nobody holds the coins. */
export default function Swaps() {
  const tut = useTutorial('swap');
  const list = useSwaps();
  useEffect(() => {
    void loadSwaps();
    void loadSwapSettings();
  }, []);
  return (
    <Screen title="Swap" large right={<Press onPress={() => router.push('/swap/settings')} hitSlop={10}><Icon name="more" size={22} color={C.text} /></Press>}>
      <Tutorial id="swap" open={tut.open} onClose={tut.close} />
      <T v="sub" dim style={{ marginTop: -8 }}>Trade with a person, not an exchange.</T>
      <Press onPress={() => router.push('/swap/new')} scaleTo={0.985} style={{ borderRadius: 26, backgroundColor: C.fill, padding: 20, gap: 16 }}>
        <View style={{ alignItems: 'center', gap: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <CoinLogo chain="lyx" size={52} />
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="swap" size={18} color={C.text} width={2} />
            </View>
            <CoinLogo chain="btc" size={52} />
            <CoinLogo chain="eth" size={52} />
          </View>
        </View>
        <T v="callout" dim style={{ textAlign: 'center', lineHeight: 21 }}>Name what you give and what you want. Someone who wants the same trade takes your offer.</T>
        <View style={{ height: 52, borderRadius: 26, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ fontFamily: F.semibold, fontSize: 16, color: C.inkText }}>Make an offer</T>
        </View>
      </Press>
      <Group>
        <Row icon="people" title="Open offers" sub="Find someone to swap with" onPress={() => router.push('/swap/board')} />
        <Row icon="copy" title="I have a code" sub="Take an offer someone sent you" onPress={() => router.push('/swap/take')} />
      </Group>
      {list.length > 0 && (
        <Group title="Your swaps">
          {list.map((r, i) => (
            <Animated.View key={swapId(r)} entering={FadeInDown.delay(i * 40).duration(DUR.base).easing(EASE_OUT)}>
              <Row title={swapTitle(r)} sub={r.accept ? (r.role === 'initiator' ? 'You made this offer' : 'You accepted') : 'Waiting for the other person'} right={<CoinLogo chain={sw.assetOf(r.offer)} size={26} />} onPress={() => router.push(`/swap/${encodeURIComponent(swapId(r))}`)} />
            </Animated.View>
          ))}
        </Group>
      )}
      <T v="caption" dim style={{ textAlign: 'center', lineHeight: 18 }}>Both sides lock their coins. Either both trades go through, or both get their coins back. Test networks only for now.</T>
      <HowItWorks onPress={tut.replay} />
    </Screen>
  );
}
