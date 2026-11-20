import { Aurora } from '../ui/Aurora';
import { useEffect, useId, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient as LG, Rect, Stop } from 'react-native-svg';
import Animated, { FadeInDown, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Button, Press } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { C, F } from '../ui/theme';
import { DUR, EASE_OUT } from '../ui/motion';
import { doneVaultFirst } from '../lib/vaultfirst';

const GOLD = '#C9A057';
const CHOICES = [
  { id: 'vault', name: 'A vault', tag: 'RECOMMENDED', lines: ['Small payments go straight out', 'Big ones wait 24 h, you can cancel', 'A thief gets one day\'s allowance at most'] },
  { id: 'plain', name: 'A plain wallet', tag: '', lines: ['Everything moves at once', 'Whoever has your words has it all'] },
] as const;
type Id = (typeof CHOICES)[number]['id'];

/** The engraved rings behind the chosen card, like the globe lines on the Apps wallet card. They fade in when the card is chosen. */
function Rings({ on }: { on: Animated.SharedValue<number> }) {
  const id = 'r' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const style = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ scale: interpolate(on.value, [0, 1], [0.9, 1]) }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', right: -70, top: -70, width: 300, height: 300 }, style]}>
      <Svg width={300} height={300} viewBox="0 0 100 100">
        {Array.from({ length: 13 }, (_, i) => (
          <Circle key={i} cx={50} cy={50} r={9 + i * 3.2} fill="none" stroke="#fff" strokeWidth={0.2} opacity={0.2} />
        ))}
      </Svg>
    </Animated.View>
  );
}

function Choice({ c, i, picked, onPick }: { c: (typeof CHOICES)[number]; i: number; picked: boolean; onPick: () => void }) {
  const still = useReducedMotion();
  const gid = 'g' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const sel = useSharedValue(picked ? 1 : 0);
  useEffect(() => {
    sel.value = still ? (picked ? 1 : 0) : picked ? withTiming(1, { duration: DUR.slow, easing: EASE_OUT }) : withTiming(0, { duration: DUR.base, easing: EASE_OUT });
  }, [picked, still, sel]);
  const tick = useSharedValue(picked ? 1 : 0);
  useEffect(() => {
    tick.value = still ? (picked ? 1 : 0) : picked ? withSpring(1, { damping: 11, stiffness: 190 }) : withTiming(0, { duration: DUR.fast });
  }, [picked, still, tick]);
  const border = useAnimatedStyle(() => ({ borderColor: `rgba(200,200,206,${0.18 + sel.value * 0.5})` }));
  const dim = useAnimatedStyle(() => ({ opacity: 0.62 + sel.value * 0.38 }));
  const dot = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(tick.value, [0, 1], [0.3, 1]) }], opacity: tick.value }));
  const vault = c.id === 'vault';
  return (
    <Animated.View entering={FadeInDown.delay(120 + i * 90).duration(DUR.base).easing(EASE_OUT)}>
      <Press onPress={onPick} haptic={false} scaleTo={0.985}>
        <Animated.View style={[{ borderRadius: 28, borderWidth: 1, overflow: 'hidden', paddingHorizontal: 20, paddingTop: 18, paddingBottom: vault ? 8 : 14 }, border]}>
          <Svg style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} width="100%" height="100%">
            <Defs>
              <LG id={gid} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor="#1E1E23" />
                <Stop offset="1" stopColor="#0C0C0E" />
              </LG>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${gid})`} />
          </Svg>
          {vault ? <Rings on={sel} /> : null}
          <Animated.View style={dim}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 }}>
              <View style={{ gap: 4 }}>
                {c.tag ? <T style={{ fontFamily: F.semibold, fontSize: 11, letterSpacing: 3, color: GOLD }}>{c.tag}</T> : null}
                <T style={{ fontFamily: F.semibold, fontSize: vault ? 30 : 24, letterSpacing: -0.8, color: C.text }}>{c.name}</T>
              </View>
              <View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: C.line2, alignItems: 'center', justifyContent: 'center' }}>
                <Animated.View style={[{ position: 'absolute', width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, dot]}>
                  <Icon name="check" size={18} color="#000" width={2.8} />
                </Animated.View>
              </View>
            </View>
            <View style={{ paddingTop: 8 }}>
              {c.lines.map((l, k) => (
                <View key={l} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: vault ? 52 : 44, borderTopWidth: k ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.09)' }}>
                  <Icon name="check" size={15} color={vault ? GOLD : C.faint} width={2.4} />
                  <T style={{ flex: 1, fontFamily: vault ? F.medium : F.regular, fontSize: vault ? 17 : 15, color: vault ? C.text : C.sub, letterSpacing: -0.2 }}>{l}</T>
                </View>
              ))}
            </View>
          </Animated.View>
        </Animated.View>
      </Press>
    </Animated.View>
  );
}
/** Asked once, after the wallet is made. A vault is the first choice; the plain wallet is one tap away. */
export default function VaultFirst() {
  const insets = useSafeAreaInsets();
  const [pick, setPick] = useState<Id>('vault');
  const go = async () => {
    await doneVaultFirst();
    router.replace('/');
    if (pick === 'vault') setTimeout(() => router.push('/ethvault/setup'), 60);
  };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 20, paddingHorizontal: 22, gap: 22 }}>
      <Aurora />
      <View style={{ flexDirection: 'row', gap: 8, paddingTop: 6 }}>
        <View style={{ flex: 1, height: 2, borderRadius: 1, backgroundColor: C.text }} />
        <View style={{ flex: 1, height: 2, borderRadius: 1, backgroundColor: C.line2 }} />
        <View style={{ flex: 2 }} />
      </View>
      <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)} style={{ gap: 12, paddingTop: 26 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 36, letterSpacing: -1.2, lineHeight: 41 }}>Where should your savings live?</T>
        <T v="callout" dim style={{ lineHeight: 22 }}>Your words open your wallet. A vault adds a second lock, so stolen words alone can't empty it.</T>
      </Animated.View>
      <View style={{ gap: 14, flex: 1 }}>
        {CHOICES.map((c, i) => (
          <Choice key={c.id} c={c} i={i} picked={pick === c.id} onPick={() => setPick(c.id)} />
        ))}
      </View>
      <View style={{ gap: 10 }}>
        <Button title={pick === 'vault' ? 'Continue with a vault' : 'Continue with a plain wallet'} onPress={go} />
        <T v="caption" dim style={{ textAlign: 'center' }}>You can add a vault later in Apps.</T>
      </View>
    </View>
  );
}
