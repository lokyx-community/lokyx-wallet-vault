import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Group, Press, Row, Screen } from '../../ui/controls';
import { CoinLogo } from '../../ui/CoinLogo';
import { Logo } from '../../ui/Logo';
import { C, F } from '../../ui/theme';
import { DUR, EASE_OUT } from '../../ui/motion';
import { FEATURES } from '../../lib/features';
import { loadSwaps, loadSwapSettings, swapId, swapTitle, sw, useSwaps } from '../../lib/swaps';

const Stack = ({ children }: { children: ReactNode }) => <View style={{ flexDirection: 'row', alignItems: 'center' }}>{children}</View>;
const Over = ({ children, first }: { children: ReactNode; first?: boolean }) => (
  <View style={{ marginLeft: first ? 0 : -10, borderRadius: 99, borderWidth: 2, borderColor: C.fill }}>{children}</View>
);

/** One of the two ways to swap: what it is, who settles it, and a button. */
function Door({ title, logos, text, tag, button, solid, onPress }: { title: string; logos: ReactNode; text: string; tag?: string; button: string; solid?: boolean; onPress: () => void }) {
  return (
    <Press onPress={onPress} scaleTo={0.985} style={{ borderRadius: 26, backgroundColor: C.fill, padding: 20, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 20 }}>{title}</T>
          {tag ? (
            <View style={{ borderRadius: 10, backgroundColor: C.fill2, paddingHorizontal: 8, paddingVertical: 2 }}>
              <T v="caption" dim>{tag}</T>
            </View>
          ) : null}
        </View>
        {logos}
      </View>
      <T v="sub" dim style={{ lineHeight: 21 }}>{text}</T>
      <View style={{ height: 52, borderRadius: 26, backgroundColor: solid ? C.ink : C.fill2, alignItems: 'center', justifyContent: 'center' }}>
        <T style={{ fontFamily: F.semibold, fontSize: 16, color: solid ? C.inkText : C.text }}>{button}</T>
      </View>
    </Press>
  );
}

/** Swap: two doors. Instant goes through a partner. Atomic is directly with another person. */
export default function SwapTab() {
  const list = useSwaps();
  useEffect(() => {
    void loadSwaps();
    void loadSwapSettings();
  }, []);
  return (
    <Screen title="Swap" large back={false}>
      <T v="sub" dim style={{ marginTop: -8 }}>Choose how you want to settle.</T>
      <Door
        title="Instant"
        tag={FEATURES.swap ? undefined : 'Not on yet'}
        logos={<Stack><Over first><CoinLogo chain="lyx" size={26} /></Over><Over><CoinLogo chain="btc" size={26} /></Over><Over><CoinLogo chain="eth" size={26} /></Over><Over><Logo id="bnb" size={26} /></Over></Stack>}
        text="A quote in seconds, settled in about a minute. Any supported pair, through a trade partner."
        button={FEATURES.swap ? 'Get a quote' : 'See how it works'}
        solid
        onPress={() => router.push('/swap/quote')}
      />
      <Door
        title="Atomic"
        logos={<Stack><Over first><CoinLogo chain="lyx" size={26} /></Over><Over><CoinLogo chain="btc" size={26} /></Over><Over><CoinLogo chain="eth" size={26} /></Over></Stack>}
        text="Trade directly with another person. Both trades go through, or both get their coins back. Nobody holds your coins."
        button="Make or take an offer"
        onPress={() => router.push('/swap')}
      />
      <Door
        title="Markets"
        tag={FEATURES.predict ? undefined : 'Not on yet'}
        logos={<Stack><Over first><Logo id="usdt" size={26} /></Over><Over><CoinLogo chain="lyx" size={26} /></Over></Stack>}
        text="Bet Yes or No on what happens next. Prices come from other people. Test coins only, for now."
        button={FEATURES.predict ? 'Open markets' : 'See how it works'}
        onPress={() => router.push('/predict')}
      />
      {list.length > 0 && (
        <Group title="Your swaps">
          {list.map((r, i) => (
            <Animated.View key={swapId(r)} entering={FadeInDown.delay(i * 40).duration(DUR.base).easing(EASE_OUT)}>
              <Row title={swapTitle(r)} sub={r.accept ? (r.role === 'initiator' ? 'You made this offer' : 'You accepted') : 'Waiting for the other person'} right={<CoinLogo chain={sw.assetOf(r.offer)} size={26} />} onPress={() => router.push(`/swap/${encodeURIComponent(swapId(r))}`)} />
            </Animated.View>
          ))}
        </Group>
      )}
      <T v="caption" dim style={{ textAlign: 'center', lineHeight: 18 }}>Test networks only for now.</T>
    </Screen>
  );
}
