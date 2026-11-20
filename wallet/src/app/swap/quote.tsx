import { Aurora } from '../../ui/Aurora';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../../ui/Text';
import { Icon } from '../../ui/Icon';
import { Field, IconButton, Press, tick } from '../../ui/controls';
import { Segmented } from '../../ui/Segmented';
import { KeyboardScroll } from '../../ui/KeyboardScroll';
import { Panel, Primary, Secondary } from '../../ui/Glass';
import { COIN_TINT, PassCard } from '../../ui/PassCard';
import { Logo } from '../../ui/Logo';
import { C, F } from '../../ui/theme';
import { DUR, EASE_OUT } from '../../ui/motion';
import { FEATURES } from '../../lib/features';
import { FEE_CHARGED, SWAP_COINS, bpsFor, directReady, feeOn, fromUnits, percentText, toUnits, type SwapCoin, type SwapMode } from '../../lib/swap-fees';

/** The LOKYX mark on a graphite coin, the same ring the cards use. */
function LyxMark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={50} fill="#2B2B30" />
      <Path d="M50 24A26 26 0 1 0 76 50" stroke="#F5F5F7" strokeWidth={11} strokeLinecap="round" fill="none" />
      <Circle cx={69} cy={31} r={6.5} fill="#F5F5F7" />
    </Svg>
  );
}
const Mark = ({ id, size }: { id: SwapCoin; size: number }) => (id === 'lyx' ? <LyxMark size={size} /> : <Logo id={id} size={size} />);

function Chips({ value, onPick }: { value: SwapCoin; onPick: (c: SwapCoin) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {SWAP_COINS.map((c) => {
        const on = c.id === value;
        return (
          <Press key={c.id} haptic={false} scaleTo={0.96} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={c.name} onPress={() => (tick(), onPick(c.id))} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 38, paddingHorizontal: 12, borderRadius: 19, backgroundColor: on ? C.ink : 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: on ? C.ink : 'rgba(255,255,255,0.12)' }}>
            <Mark id={c.id} size={20} />
            <T style={{ fontFamily: F.semibold, fontSize: 14, color: on ? C.inkText : C.text }}>{c.symbol}</T>
          </Press>
        );
      })}
    </View>
  );
}

/** Swap: Instant (through a partner, 0.5%) or Direct (atomic, between two people, 0.2%). Any pair is shown; what runs today says so. */
export default function SwapQuote() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<SwapMode>('instant');
  const [from, setFrom] = useState<SwapCoin>('lyx');
  const [to, setTo] = useState<SwapCoin>('btc');
  const [amt, setAmt] = useState('');
  const pick = (side: 'from' | 'to') => (c: SwapCoin) => {
    // choosing the coin that is on the other side turns the pair round
    if (side === 'from') {
      if (c === to) setTo(from);
      setFrom(c);
    } else {
      if (c === from) setFrom(to);
      setTo(c);
    }
  };
  const flip = () => {
    tick();
    setFrom(to);
    setTo(from);
  };

  const fc = SWAP_COINS.find((c) => c.id === from)!;
  const tc = SWAP_COINS.find((c) => c.id === to)!;
  const bps = bpsFor(mode);
  const units = useMemo(() => toUnits(amt, fc.decimals), [amt, fc.decimals]);
  const fee = units ? fromUnits(feeOn(units, bps), fc.decimals, 8) : null;
  const direct = directReady(from, to);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <Aurora />
    <KeyboardScroll contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: insets.bottom + 130, gap: 14 }} style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconButton name="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <T v="display">Swap</T>
      </View>
      <Segmented<SwapMode> value={mode} onChange={setMode} options={[['direct', 'Atomic'], ['instant', 'Instant']]} />
      <Animated.View key={mode} entering={FadeIn.duration(DUR.base).easing(EASE_OUT)}>
        <T v="sub" dim style={{ lineHeight: 21 }}>
          {mode === 'direct'
            ? 'Between you and one other person. Each side locks its coins behind the same secret, so either both trades go through or both get their coins back. Nobody holds your coins, and there is no bridge.'
            : 'Through a trade partner that finds the best price. One quote, one payment, and the coins arrive in a minute or two.'}
        </T>
      </Animated.View>

      <PassCard tint={COIN_TINT[from]} style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28, gap: 12 }}>
        <T v="caption" dim>You pay</T>
        <Chips value={from} onPick={pick('from')} />
        <Field value={amt} onChangeText={setAmt} placeholder="0.0" keyboardType="decimal-pad" big accessibilityLabel={`Amount of ${fc.symbol} to pay`} />
      </PassCard>

      <View style={{ alignItems: 'center', height: 8, zIndex: 2 }}>
        <Press onPress={flip} accessibilityLabel="Turn the pair round" style={{ position: 'absolute', top: -26, width: 46, height: 46, borderRadius: 23, backgroundColor: C.text, borderWidth: 5, borderColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="swap" size={20} color={C.bg} width={2.4} />
        </Press>
      </View>

      <PassCard tint={COIN_TINT[to]} style={{ paddingHorizontal: 18, paddingTop: 28, paddingBottom: 16, gap: 12 }}>
        <T v="caption" dim>You get</T>
        <Chips value={to} onPick={pick('to')} />
        <T style={{ fontFamily: F.regular, fontSize: 20, color: C.faint }}>
          {mode === 'instant' ? 'The quote shows here' : 'Set by the offer you pick'}
        </T>
      </PassCard>

      <Panel style={{ paddingVertical: 6 }}>
        <Line k="Fee" v={`${percentText(bps)} of what you pay`} />
        {fee ? <Line k={`On ${amt.trim()} ${fc.symbol}`} v={`${fee} ${fc.symbol}`} /> : null}
        {!FEE_CHARGED ? <Line k="Right now" v="Not charged on the test network" good /> : null}
        <Line k="Pair" v={`${fc.symbol} to ${tc.symbol}`} last />
      </Panel>

      {mode === 'instant' ? (
        <>
          <Primary title={FEATURES.swap ? 'Get a quote' : 'Instant swaps are not switched on yet'} disabled={!FEATURES.swap} onPress={() => {}} />
          <T v="caption" dim style={{ textAlign: 'center', lineHeight: 19 }}>
            Instant needs a trade partner and an outside check of the code that talks to it. It stays off until both are done. Until then, use Direct.
          </T>
        </>
      ) : direct ? (
        <>
          <Primary title="Find or make an offer" onPress={() => router.push('/swap')} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Secondary title="Offer board" onPress={() => router.push('/swap/board')} /></View>
            <View style={{ flex: 1 }}><Secondary title="I have a code" onPress={() => router.push('/swap/take')} /></View>
          </View>
          <T v="caption" dim style={{ textAlign: 'center', lineHeight: 19 }}>Test networks only: Bitcoin testnet4 or signet, and Sepolia.</T>
        </>
      ) : (
        <>
          <Primary title={`${fc.symbol} to ${tc.symbol} is not open yet`} disabled onPress={() => {}} />
          <T v="caption" dim style={{ textAlign: 'center', lineHeight: 19 }}>
            Direct swaps work today for LOKYX with Bitcoin and with Ethereum. Other pairs open one chain at a time, each with its own swap contract. For {fc.symbol} and {tc.symbol} you can swap through LOKYX in two steps, or wait for Instant.
          </T>
        </>
      )}
    </KeyboardScroll>
    </View>
  );
}

function Line({ k, v, good, last }: { k: string; v: string; good?: boolean; last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 14, paddingVertical: 11, borderBottomWidth: last ? 0 : 0.5, borderBottomColor: 'rgba(255,255,255,0.08)' }}>
      <T v="sub" dim>{k}</T>
      <T v="sub" color={good ? C.good : C.text} style={{ flexShrink: 1, textAlign: 'right' }}>{v}</T>
    </View>
  );
}
