import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient as LG, Path, RadialGradient as RG, Rect, Stop } from 'react-native-svg';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import type { StyleProp, ViewStyle } from 'react-native';
import { T } from './Text';
import { Logo } from './Logo';
import { F } from './theme';

/** The card is drawn at one size and scaled to the screen, so every gap stays as designed. */
export const CARD_W = 350;
export const CARD_H = 221;
const GOLD = '#C9A057';
const SLOT_X = [22, 70, 118];
const COINS = ['eth', 'usdt', 'usdc'] as const;

type S = StyleProp<AnimatedStyle<StyleProp<ViewStyle>>>;
/** Optional animated styles. Without them the card is simply shown finished: engraved, three coins inside. */
export interface CardAnim {
  eng?: S;
  spec?: S;
  coins?: [S, S, S];
}

/**
 * The Apps wallet card: satin-black metal with a hairline gold edge, a gold chip, three engraved slots for
 * coins and concentric globe lines. It carries no balance, because the wallet holds every chain.
 */
export function AppsCardArt({ anim }: { anim?: CardAnim }) {
  const id = 'c' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View style={{ width: CARD_W, height: CARD_H }}>
      <View style={{ ...StyleSheet.absoluteFillObject, borderRadius: 26, overflow: 'hidden' }}>
        <Svg width={CARD_W} height={CARD_H} style={StyleSheet.absoluteFill}>
          <Defs>
            <LG id={id + 'b'} x1="0.1" y1="0" x2="0.9" y2="1">
              <Stop offset="0" stopColor="#2A2A2F" />
              <Stop offset="0.48" stopColor="#141417" />
              <Stop offset="1" stopColor="#070708" />
            </LG>
            <RG id={id + 'h'} cx={0.08 * CARD_W} cy={0} r={CARD_W * 0.62} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#fff" stopOpacity={0.17} />
              <Stop offset="1" stopColor="#fff" stopOpacity={0} />
            </RG>
          </Defs>
          <Rect x={0} y={0} width={CARD_W} height={CARD_H} fill={`url(#${id}b)`} />
          <Rect x={0} y={0} width={CARD_W} height={CARD_H} fill={`url(#${id}h)`} />
          <Rect x={0.5} y={0.5} width={CARD_W - 1} height={CARD_H - 1} rx={25.5} fill="none" stroke="rgba(201,160,87,0.30)" strokeWidth={1} />
          <Path d="M24 0.5H326" stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
        </Svg>
        {/* concentric globe lines, cropped by the corner */}
        <Svg width={300} height={300} viewBox="0 0 100 100" style={{ position: 'absolute', right: -110, top: -60, opacity: 0.16 }}>
          {Array.from({ length: 13 }, (_, i) => (
            <Circle key={i} cx={50} cy={50} r={10 + i * 3} fill="none" stroke="#fff" strokeWidth={0.18} />
          ))}
        </Svg>
        {/* the gold chip */}
        <Svg width={54} height={42} viewBox="0 0 54 42" style={{ position: 'absolute', right: 20, top: 18 }}>
          <Defs>
            <LG id={id + 'g'} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#F3D58A" />
              <Stop offset="0.5" stopColor="#C9A057" />
              <Stop offset="1" stopColor="#8A6424" />
            </LG>
          </Defs>
          <Rect x={0.5} y={0.5} width={53} height={41} rx={8} fill={`url(#${id}g)`} stroke="rgba(255,240,200,0.6)" />
          <G stroke="#6B4C1B" strokeOpacity={0.55} strokeWidth={1} fill="none">
            <Path d="M0 14h16M0 28h16M38 14h16M38 28h16M16 0v42M38 0v42" />
            <Rect x={16} y={9} width={22} height={24} rx={5} />
          </G>
          <G transform="translate(19.5 11.5) scale(.15)">
            <Path d="M50 16A34 34 0 1 0 84 50" stroke="#4A3210" strokeWidth={16} strokeLinecap="round" fill="none" />
            <Circle cx={74} cy={26} r={8.5} fill="#4A3210" />
          </G>
        </Svg>
        {/* contactless waves */}
        <Svg width={22} height={26} viewBox="0 0 22 26" fill="none" style={{ position: 'absolute', right: 84, top: 26, opacity: 0.85 }}>
          <G stroke={GOLD} strokeWidth={1.4} strokeLinecap="round" fill="none">
            <Path d="M4 6c3 4 3 10 0 14" />
            <Path d="M9 3c5 6 5 14 0 20" />
            <Path d="M14 0c7 8 7 18 0 26" />
          </G>
        </Svg>
        <Animated.View style={[StyleSheet.absoluteFill, anim?.eng]}>
          {SLOT_X.map((x) => (
            <View key={x} style={{ position: 'absolute', left: x, top: 158, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(201,160,87,0.38)' }} />
          ))}
          <View style={{ position: 'absolute', left: 22, top: 20 }}>
            <T style={{ fontFamily: F.medium, fontSize: 11, letterSpacing: 2.6, color: '#F5F5F7' }}>APPS WALLET</T>
            <T style={{ fontFamily: F.regular, fontSize: 12, color: 'rgba(245,245,247,0.6)', paddingTop: 3 }}>For websites only</T>
          </View>
          <T style={{ position: 'absolute', right: 22, bottom: 24, fontFamily: F.semibold, fontSize: 11, letterSpacing: 3.4, color: GOLD }}>LOKYX</T>
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
      {COINS.map((c, i) => (
        <Animated.View key={c} style={[{ position: 'absolute', left: SLOT_X[i] + 3, top: 161, width: 34, height: 34, borderRadius: 17, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }, anim?.coins?.[i]]}>
          <Logo id={c} size={34} />
        </Animated.View>
      ))}
    </View>
  );
}
