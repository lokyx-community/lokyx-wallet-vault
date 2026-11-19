import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient as RG, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { T } from '../../ui/Text';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/controls';
import { AppsCardArt, CARD_H, CARD_W } from '../../ui/AppsCardArt';
import { C, F } from '../../ui/theme';
import { EASE_OUT } from '../../ui/motion';

/** Where the whole sequence is, 0 to 1. The end of it (0.92) is the settled "ready" screen. */
const END = 0.92;
const LENGTH = 8300;

/** 0 before `a`, 1 after `b`, eased in between. */
const seg = (t: number, a: number, b: number) => {
  'worklet';
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return EASE_OUT(x);
};
const mix = (p: number, from: number, to: number) => {
  'worklet';
  return from + (to - from) * p;
};

function useCoin(t: SharedValue<number>, a: number, b: number) {
  return useAnimatedStyle(() => {
    const x = t.value;
    const land = seg(x, a, b);
    const bump = x > b ? interpolate(x, [b, b + 0.015, b + 0.03], [0, 1, 0], 'clamp') : 0;
    return { opacity: land, transform: [{ translateY: mix(land, 60, 0) + bump * 2 }, { scale: mix(land, 0.7, 1) - bump * 0.03 }] };
  });
}

/** The Apps wallet being made, then the ready screen. Everything on it is shown in the order it really happens. */
export default function AppsMade() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const still = useReducedMotion();
  const t = useSharedValue(still ? END : 0);
  const k = Math.min(1, (width - 40) / CARD_W);
  const top = insets.top + 176;

  useEffect(() => {
    if (still) return;
    t.value = withTiming(END, { duration: LENGTH, easing: Easing.linear });
    // a light tap as each coin lands, and a soft one when the card says it has three coins
    const at = [0.4, 0.47, 0.54, 0.68].map((p) => (p / END) * LENGTH);
    const ids = at.map((ms, i) => setTimeout(() => (i < 3 ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(() => {}), ms));
    return () => ids.forEach(clearTimeout);
  }, [still, t]);

  const stage = useAnimatedStyle(() => ({ transform: [{ translateY: mix(seg(t.value, 0.7, 0.82), 0, -112) }] }));
  const deal = useAnimatedStyle(() => {
    const x = t.value;
    const d = seg(x, 0.06, 0.24);
    const sway1 = interpolate(x, [0.24, 0.36, 0.52, 0.66], [0, 1, 0, 0], 'clamp');
    const rx = mix(d, 58, 0) + interpolate(x, [0.24, 0.36, 0.52, 0.66], [0, 4, -3, 0], 'clamp');
    const ry = interpolate(x, [0.24, 0.36, 0.52, 0.66], [0, -9, 8, 0], 'clamp');
    void sway1;
    return {
      opacity: interpolate(x, [0.06, 0.08], [0, 1], 'clamp'),
      transform: [{ perspective: 1100 }, { translateY: mix(d, 140, 0) }, { rotateX: `${rx}deg` }, { rotateY: `${ry}deg` }, { scale: mix(d, 0.9, 1) }],
    };
  });
  const slot = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0.06, 0.1, 0.16], [0, 1, 0], 'clamp') }));
  const eng = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0.22, 0.3], [0, 1], 'clamp') }));
  const spec = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(t.value, [0.24, 0.36, 0.52, 0.66], [-252, -21, 115, 273], 'clamp') }] }));
  const c0 = useCoin(t, 0.32, 0.4);
  const c1 = useCoin(t, 0.39, 0.47);
  const c2 = useCoin(t, 0.46, 0.54);
  const hint = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0.3, 0.34, 0.52, 0.58], [0, 1, 1, 0], 'clamp') }));
  const cnt = useAnimatedStyle(() => {
    const p = seg(t.value, 0.6, 0.68);
    return { opacity: p, transform: [{ translateY: mix(p, 6, 0) }] };
  });
  const badge = useAnimatedStyle(() => {
    const p = seg(t.value, 0.64, 0.7);
    return { opacity: p, transform: [{ scale: mix(p, 0.4, 1) }] };
  });
  const titleA = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0.6, 0.65], [1, 0], 'clamp') }));
  const titleB = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0.67, 0.75], [0, 1], 'clamp') }));
  const rows = useAnimatedStyle(() => {
    const p = seg(t.value, 0.78, 0.88);
    return { opacity: p, transform: [{ translateY: mix(p, 18, 0) }] };
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Svg width={width} height={640} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RG id="glow" cx={width / 2} cy={0} rx={width * 0.75} ry={420} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="rgb(165,168,186)" stopOpacity={0.34} />
            <Stop offset="0.55" stopColor="rgb(165,168,186)" stopOpacity={0.09} />
            <Stop offset="1" stopColor="rgb(165,168,186)" stopOpacity={0} />
          </RG>
        </Defs>
        <Rect x={0} y={0} width={width} height={640} fill="url(#glow)" />
      </Svg>

      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 20, top, width: CARD_W * k, height: CARD_H * k, borderRadius: 26 * k, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.16)' }, slot]} />

      <Animated.View style={[StyleSheet.absoluteFill, stage]} pointerEvents="box-none">
        <View style={{ position: 'absolute', left: (width - CARD_W * k) / 2, top, width: CARD_W * k, height: CARD_H * k }}>
          <Animated.View style={[{ width: CARD_W, height: CARD_H, transformOrigin: 'top left', shadowColor: '#000', shadowOpacity: 0.75, shadowRadius: 24, shadowOffset: { width: 0, height: 24 }, elevation: 16 }, { transform: [{ scale: k }] }]}>
            <Animated.View style={[{ width: CARD_W, height: CARD_H }, deal]}>
              <AppsCardArt anim={{ eng, spec, coins: [c0, c1, c2] }} />
              <Animated.Text style={[{ position: 'absolute', left: 22, top: 100, fontFamily: F.regular, fontSize: 15, color: 'rgba(245,245,247,0.55)' }, hint]}>Any coin, on any network</Animated.Text>
              <Animated.Text style={[{ position: 'absolute', left: 22, top: 100, fontFamily: F.medium, fontSize: 20, letterSpacing: -0.3, color: '#F5F5F7' }, cnt]}>3 coins inside</Animated.Text>
              <Animated.View style={[{ position: 'absolute', right: 22, top: 98, width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, badge]}>
                <Icon name="check" size={17} color="#000" width={2.8} />
              </Animated.View>
            </Animated.View>
          </Animated.View>
        </View>

        <View style={{ position: 'absolute', left: 20, right: 20, top: top + 290, height: 70 }} pointerEvents="none">
          <Animated.View style={[StyleSheet.absoluteFill, titleA]}>
            <T style={{ textAlign: 'center', fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.7, lineHeight: 33 }}>Making your Apps wallet</T>
            <T v="callout" dim style={{ textAlign: 'center', paddingTop: 4 }}>A small wallet just for websites</T>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, titleB]}>
            <T style={{ textAlign: 'center', fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.7, lineHeight: 33 }}>Apps wallet ready</T>
            <T v="callout" dim style={{ textAlign: 'center', paddingTop: 4 }}>Websites connect here. Your vault stays hidden.</T>
          </Animated.View>
        </View>
      </Animated.View>

      <Animated.View style={[{ position: 'absolute', left: 20, right: 20, top: top + 290, gap: 16 }, rows]}>
        <View style={{ borderRadius: 24, backgroundColor: C.fill, overflow: 'hidden' }}>
          <Line icon="shield" tint={C.good} bg="rgba(61,214,140,0.14)" title="Sites reach only what’s inside" sub="Never your main wallet or your vault" />
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.line2, marginLeft: 64 }} />
          <Line icon="globe" tint={C.text} bg={C.fill2} title="Your vault stays hidden" sub="Sites can’t see it or ask for it" />
        </View>
        <Button title="Open a website" onPress={() => router.replace('/browser')} />
      </Animated.View>
    </View>
  );
}

function Line({ icon, tint, bg, title, sub }: { icon: 'shield' | 'globe'; tint: string; bg: string; title: string; sub: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={19} color={tint} width={1.9} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontFamily: F.medium, fontSize: 16, letterSpacing: -0.1 }}>{title}</T>
        <T style={{ fontFamily: F.regular, fontSize: 12.5, color: C.sub }}>{sub}</T>
      </View>
    </View>
  );
}
