import { useEffect, useState } from 'react';
import { AccessibilityInfo, Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedProps, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { T } from './Text';
import { Press, tick } from './controls';
import { Icon } from './Icon';
import { C, F } from './theme';
import { EASE_OUT } from './motion';
import { shortAddr } from '../lib/format';
import { slipRows, slipText, type SlipInput } from '../lib/slip-core';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const TOOTH = 14;

/** The green seal: the ring draws, then the tick. Waiting shows a quiet ring in the waiting colour instead. */
function Seal({ done }: { done: boolean }) {
  const ring = useSharedValue(0);
  const mark = useSharedValue(0);
  useEffect(() => {
    ring.value = withDelay(250, withTiming(1, { duration: 600, easing: EASE_OUT }));
    mark.value = done ? withDelay(750, withTiming(1, { duration: 350, easing: EASE_OUT })) : withTiming(0, { duration: 150 });
  }, [done, ring, mark]);
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: 151 * (1 - ring.value) }));
  const markProps = useAnimatedProps(() => ({ strokeDashoffset: 30 * (1 - mark.value) }));
  const tint = done ? C.good : C.wait;
  return (
    <Svg width={52} height={52} viewBox="0 0 54 54">
      <Circle cx={27} cy={27} r={24} fill={done ? 'rgba(61,214,140,0.12)' : 'rgba(245,184,61,0.10)'} />
      <AnimatedCircle cx={27} cy={27} r={24} fill="none" stroke={tint} strokeWidth={2.5} strokeDasharray="151" animatedProps={ringProps} transform="rotate(-90 27 27)" strokeLinecap="round" />
      <AnimatedPath d="M17 28l7 7 13-14" fill="none" stroke={C.good} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="30" animatedProps={markProps} />
      {done ? null : <Path d="M27 17v10l6 4" fill="none" stroke={C.wait} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />}
    </Svg>
  );
}

/** A torn bottom edge: a row of small triangles in the slip's own colour. */
function Torn({ width }: { width: number }) {
  const n = Math.max(1, Math.round(width / TOOTH));
  const w = width / n;
  let d = `M0 0`;
  for (let i = 0; i < n; i++) d += `L${i * w + w / 2} ${TOOTH * 0.55}L${(i + 1) * w} 0`;
  return (
    <Svg width={width} height={TOOTH * 0.55} style={{ marginTop: -1 }}>
      <Path d={`${d}Z`} fill={C.fill2} />
    </Svg>
  );
}

const Dash = () => <View style={{ borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: C.line2, marginVertical: 8 }} />;

/**
 * The slip you get after a payment: a green seal, the amount, and the plain facts of the payment. It feels like a till
 * receipt in the app's own dark glass. Share sends the same facts as text, with the full address and transaction id.
 */
export function Slip({ slip, done, caption }: { slip: SlipInput; done: boolean; caption?: string }) {
  const [w, setW] = useState(0);
  const [copied, setCopied] = useState(false);
  const rows = slipRows(slip);
  const big = slip.amount.length > 9;
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Animated.View entering={FadeInDown.duration(520).easing(EASE_OUT)} style={{ paddingHorizontal: 4 }}>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ backgroundColor: C.fill2, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 0.5, borderBottomWidth: 0, borderColor: C.line2, paddingHorizontal: 22, paddingTop: 24, paddingBottom: 18 }}>
        <View style={{ alignItems: 'center' }}>
          <Seal done={done} />
          <T style={{ fontFamily: F.semibold, fontSize: big ? 32 : 42, lineHeight: big ? 40 : 50, letterSpacing: -1.4, color: C.text, marginTop: 10 }} numberOfLines={1} adjustsFontSizeToFit>
            {slip.amount}
            <T style={{ fontFamily: F.medium, fontSize: 16, color: C.sub }}>{`  ${slip.unit}`}</T>
          </T>
          <T v="caption" dim style={{ marginTop: 4, textAlign: 'center' }}>
            {caption ?? (slip.testnet ? 'Test network · no market value' : done ? 'Confirmed' : 'On its way')}
          </T>
        </View>
        <Dash />
        {rows.map((r, i) => (
          <Animated.View key={r.label} entering={FadeIn.delay(450 + i * 90).duration(320)} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, gap: 16 }}>
            <T v="sub" dim style={{ fontSize: 14 }}>{r.label}</T>
            <T style={{ fontFamily: F.mono, fontSize: 13, color: C.text, flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>{r.value}</T>
          </Animated.View>
        ))}
        <Dash />
        <Animated.View entering={FadeIn.delay(450 + rows.length * 90).duration(320)}>
          <Press
            onPress={() => {
              Clipboard.setStringAsync(slip.hash).catch(() => {});
              tick();
              setCopied(true);
            }}
            accessibilityLabel="Copy the transaction id"
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, gap: 16 }}
          >
            <T v="sub" dim style={{ fontSize: 14 }}>Transaction</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
              <T style={{ fontFamily: F.mono, fontSize: 13, color: copied ? C.good : C.text }} numberOfLines={1}>{copied ? 'Copied' : shortAddr(slip.hash, 6, 4)}</T>
              <Icon name={copied ? 'check' : 'copy'} size={15} color={copied ? C.good : C.faint} />
            </View>
          </Press>
        </Animated.View>
      </View>
      {w > 0 ? <Torn width={w} /> : null}
    </Animated.View>
  );
}

/** Opens the system share sheet with the slip as text. */
export function shareSlip(slip: SlipInput) {
  return Share.share({ message: slipText(slip) }).catch(() => {});
}

/** True a moment after `active` turns on (after the whole coin animation has played: fold, flight, check, words), at once if the phone asks for less motion. */
export function useReveal(active: boolean, ms = 6800): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) return;
    let live = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((still) => {
        if (!live) return;
        if (still) setOn(true);
        else t = setTimeout(() => live && setOn(true), ms);
      });
    return () => {
      live = false;
      if (t) clearTimeout(t);
    };
  }, [active, ms]);
  return active && on;
}
