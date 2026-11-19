import { View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Screen } from '../../ui/controls';
import { Primary, Secondary } from '../../ui/Glass';
import { CoinRow, WalletCard, type CardData, type CardKind } from '../../ui/WalletCards';
import { useGifts } from '../../lib/gifts';
import { DUR, EASE_OUT } from '../../ui/motion';

const NAMES = { lyx: 'LOKYX', btc: 'Bitcoin', eth: 'Ethereum' } as const;
const KIND: Record<keyof typeof NAMES, CardKind> = { lyx: 'lyx', btc: 'btc', eth: 'eth' };

/** Three cards fanned out, so the screen says what a gift card is before it says anything else. */
function Fan({ width }: { width: number }) {
  const cw = Math.min(width - 90, 250);
  const ch = Math.round(cw / 1.586);
  const card = (kind: CardKind, logo: CardData['logo'], title: string, balance: string, unit: string): CardData => ({ kind, logo, title, balance, unit });
  const items: { c: CardData; rot: string; x: number; y: number }[] = [
    { c: card('eth', 'eth', 'Ethereum', '0.25', 'ETH'), rot: '-9deg', x: -34, y: 8 },
    { c: card('btc', 'btc', 'Bitcoin', '0.01', 'BTC'), rot: '8deg', x: 34, y: 20 },
    { c: card('lyx', undefined, 'LOKYX', '50', 'LYX'), rot: '-1deg', x: 0, y: 40 },
  ];
  return (
    <View style={{ height: ch + 56, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
      {items.map((it, i) => (
        <Animated.View key={i} entering={FadeInDown.delay(i * 110).duration(DUR.slow).easing(EASE_OUT)} style={{ position: 'absolute', top: it.y, transform: [{ translateX: it.x }, { rotate: it.rot }] }}>
          <WalletCard c={it.c} width={cw} />
        </Animated.View>
      ))}
    </View>
  );
}

/** Gift cards you made, and the way in to make or claim one. */
export default function Gifts() {
  const { width } = useWindowDimensions();
  const list = useGifts();
  const open = list.filter((g) => !g.closed);
  const old = list.filter((g) => g.closed);
  const rowW = Math.min(width - 40, 420);
  const row = (g: (typeof list)[number]): CardData => {
    const [n, u] = g.amount.split(' ');
    return { kind: KIND[g.coin], logo: g.coin === 'lyx' ? undefined : g.coin, title: g.note || `${NAMES[g.coin]} gift`, sub: new Date(g.made).toLocaleDateString(), balance: n, unit: u ?? '' };
  };
  return (
    <Screen title="Gift cards" large>
      <Fan width={width} />
      <T v="sub" dim style={{ lineHeight: 20, textAlign: 'center', paddingHorizontal: 8 }}>Put coins on a card and send it as a link or QR. Whoever has it can move them into their own wallet. Until they do, you can take them back.</T>
      <Primary title="Make a gift card" onPress={() => router.push('/gift/new')} />
      <Secondary title="Claim a gift card" onPress={() => router.push('/gift/claim')} />
      {open.length > 0 && (
        <View style={{ gap: 10 }}>
          <T v="sub" dim style={{ paddingHorizontal: 6, paddingTop: 14 }}>Cards you made</T>
          {open.map((g) => <CoinRow key={g.address} c={row(g)} width={rowW} onPress={() => router.push(`/gift/${g.address}`)} />)}
        </View>
      )}
      {old.length > 0 && (
        <View style={{ gap: 10 }}>
          <T v="sub" dim style={{ paddingHorizontal: 6, paddingTop: 14 }}>Claimed or taken back</T>
          {old.map((g) => <CoinRow key={g.address} c={row(g)} width={rowW} grey onPress={() => router.push(`/gift/${g.address}`)} />)}
        </View>
      )}
    </Screen>
  );
}
