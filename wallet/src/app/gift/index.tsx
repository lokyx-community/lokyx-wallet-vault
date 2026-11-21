import { View, useWindowDimensions } from 'react-native';
import { PageHero } from '../../ui/AppCard';
import { router } from 'expo-router';
import { T } from '../../ui/Text';
import { Press, Screen } from '../../ui/controls';
import { Primary, Secondary } from '../../ui/Glass';
import { GiftCardFace } from '../../ui/GiftCardFace';
import { useGifts } from '../../lib/gifts';

/** Gift cards you made, and the way in to make or claim one. */
export default function Gifts() {
  const { width } = useWindowDimensions();
  const list = useGifts();
  const open = list.filter((g) => !g.closed);
  const old = list.filter((g) => g.closed);
  const rowW = Math.min(width - 40, 340);
  const card = (g: (typeof list)[number], old?: boolean) => {
    const [n, u] = g.amount.split(' ');
    return (
      <Press key={g.address} onPress={() => router.push(`/gift/${g.address}`)} scaleTo={0.985} style={{ alignSelf: 'center', opacity: old ? 0.5 : 1 }}>
        <GiftCardFace coin={g.coin} width={rowW} note={g.note || new Date(g.made).toLocaleDateString()} balance={n} unit={u ?? ''} tag={old ? 'Closed' : undefined} />
      </Press>
    );
  };
  return (
    <Screen title="Gift cards">
      <PageHero kind="gift" small="Send a card to anyone" />
      <T v="sub" dim style={{ lineHeight: 20, textAlign: 'center', paddingHorizontal: 8 }}>Put coins on a card and send it as a link or QR. Whoever has it can move them into their own wallet. Until they do, you can take them back.</T>
      <Primary title="Make a gift card" onPress={() => router.push('/gift/new')} />
      <Secondary title="Claim a gift card" onPress={() => router.push('/gift/claim')} />
      {open.length > 0 && (
        <View style={{ gap: 10 }}>
          <T v="sub" dim style={{ paddingHorizontal: 6, paddingTop: 14 }}>Cards you made</T>
          {open.map((g) => card(g))}
        </View>
      )}
      {old.length > 0 && (
        <View style={{ gap: 10 }}>
          <T v="sub" dim style={{ paddingHorizontal: 6, paddingTop: 14 }}>Claimed or taken back</T>
          {old.map((g) => card(g, true))}
        </View>
      )}
    </Screen>
  );
}
