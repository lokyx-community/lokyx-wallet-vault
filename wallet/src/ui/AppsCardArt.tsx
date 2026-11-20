import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient as LG, Path, RadialGradient as RG, Rect, Stop } from 'react-native-svg';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import type { StyleProp, ViewStyle } from 'react-native';
import { T } from './Text';
import { Logo } from './Logo';
import type { LogoId } from './logos';
import { F } from './theme';

/** The card is drawn at one size and scaled to the screen, so every gap stays as designed. */
export const CARD_W = 350;
export const CARD_H = 221;
const SOFT = 'rgba(245,245,247,0.7)';
const SLOT_X = [22, 70, 118];
/** The coins that drop into the slots during the making animation. A card that is simply shown holds only what the wallet really holds. */
const DEMO_COINS: readonly LogoId[] = ['eth', 'usdt', 'usdc'];

type S = StyleProp<AnimatedStyle<StyleProp<ViewStyle>>>;
/** Optional animated styles. Without them the card is simply shown finished: engraved, with a coin in a slot only for each coin held. */
export interface CardAnim {
  eng?: S;
  spec?: S;
  coins?: [S, S, S];
}

/**
 * The Apps wallet card: frosted glass with a hairline light edge, a LOKYX-sign chip, three engraved slots for
 * coins and concentric globe lines. It carries no balance, because the wallet holds every chain.
 */
export function AppsCardArt({ anim, coinsShown }: { anim?: CardAnim; coinsShown?: readonly LogoId[] }) {
  const shown = (coinsShown ?? (anim ? DEMO_COINS : [])).slice(0, 3);
  const id = 'c' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View style={{ width: CARD_W, height: CARD_H }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 26, overflow: 'hidden' }}>
        <Svg width={CARD_W} height={CARD_H} style={StyleSheet.absoluteFill}>
          <Defs>
            <LG id={id + 'b'} x1="0.1" y1="0" x2="0.9" y2="1">
              <Stop offset="0" stopColor="#fff" stopOpacity={0.14} />
              <Stop offset="0.5" stopColor="#fff" stopOpacity={0.06} />
              <Stop offset="1" stopColor="#fff" stopOpacity={0.09} />
            </LG>
            <RG id={id + 'h'} cx={0.08 * CARD_W} cy={0} r={CARD_W * 0.62} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#fff" stopOpacity={0.2} />
              <Stop offset="1" stopColor="#fff" stopOpacity={0} />
            </RG>
          </Defs>
          <Rect x={0} y={0} width={CARD_W} height={CARD_H} fill="rgba(18,18,22,0.55)" />
          <Rect x={0} y={0} width={CARD_W} height={CARD_H} fill={`url(#${id}b)`} />
          <Rect x={0} y={0} width={CARD_W} height={CARD_H} fill={`url(#${id}h)`} />
          <Rect x={0.5} y={0.5} width={CARD_W - 1} height={CARD_H - 1} rx={25.5} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
          <Path d="M24 0.5H326" stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
        </Svg>
        {/* concentric globe lines, cropped by the corner */}
        <Svg width={300} height={300} viewBox="0 0 100 100" style={{ position: 'absolute', right: -110, top: -60, opacity: 0.16 }}>
          {Array.from({ length: 13 }, (_, i) => (
            <Circle key={i} cx={50} cy={50} r={10 + i * 3} fill="none" stroke="#fff" strokeWidth={0.18} />
          ))}
        </Svg>
        {/* the glass chip with the LOKYX sign */}
        <View style={{ position: 'absolute', right: 20, top: 18, width: 54, height: 42, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={26} height={26} viewBox="0 0 32 32">
            <Path d="M16.74 7.53 A8.5 8.5 0 1 0 24.47 16.74" stroke="#F5F5F7" strokeWidth={3.2} strokeLinecap="round" fill="none" />
            <Circle cx={22.5} cy={10.5} r={1.8} fill="#F5F5F7" />
          </Svg>
        </View>
        <Animated.View style={[StyleSheet.absoluteFill, anim?.eng]}>
          {SLOT_X.map((x) => (
            <View key={x} style={{ position: 'absolute', left: x, top: 158, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.28)' }} />
          ))}
          <View style={{ position: 'absolute', left: 22, top: 20 }}>
            <T style={{ fontFamily: F.medium, fontSize: 11, letterSpacing: 2.6, color: '#F5F5F7' }}>APPS WALLET</T>
            <T style={{ fontFamily: F.regular, fontSize: 12, color: 'rgba(245,245,247,0.6)', paddingTop: 3 }}>For websites only</T>
          </View>
          <T style={{ position: 'absolute', right: 22, bottom: 24, fontFamily: F.semibold, fontSize: 11, letterSpacing: 3.4, color: SOFT }}>LOKYX</T>
        </Animated.View>
        {/* a light sweep */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Animated.View style={[{ position: 'absolute', top: -30, bottom: -30, left: 0, width: CARD_W * 0.6 }, anim?.spec ?? { opacity: 0 }]}>
            <Svg width={CARD_W * 0.6} height={CARD_H + 60}>
              <Defs>
                <LG id={id + 's'} x1="0" y1="0" x2="1" y2="0.18">
                  <Stop offset="0.2" stopColor="#fff" stopOpacity={0} />
                  <Stop offset="0.5" stopColor="#fff" stopOpacity={0.2} />
                  <Stop offset="0.8" stopColor="#fff" stopOpacity={0} />
                </LG>
              </Defs>
              <Rect width={CARD_W * 0.6} height={CARD_H + 60} fill={`url(#${id}s)`} />
            </Svg>
          </Animated.View>
        </View>
      </View>
      {shown.map((c, i) => (
        <Animated.View key={c} style={[{ position: 'absolute', left: SLOT_X[i] + 3, top: 161, width: 34, height: 34, borderRadius: 17, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }, anim?.coins?.[i]]}>
          <Logo id={c} size={34} />
        </Animated.View>
      ))}
    </View>
  );
}
