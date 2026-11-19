import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { Easing, FadeIn, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { Press, tap } from './controls';
import { C } from './theme';

const WORDS: Record<string, string> = {
  starting: 'Getting ready…',
  broadcasting: 'Hold the top of your phone to theirs',
  read: 'Sent to their phone',
};

export interface TapCoin {
  id: string;
  label: string;
}

/** Under what you are showing: turn on "tap", pick what you want to be paid in, and hold your phone to theirs. */
export function TapPill({ on, state, problem, onPress, coins, coin, onCoin }: { on: boolean; state: string; problem: string; onPress: () => void; coins?: TapCoin[]; coin?: string; onCoin?: (id: string) => void }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (on) pulse.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1);
    else pulse.value = 0;
  }, [on, pulse]);
  const wave = useAnimatedStyle(() => ({ opacity: on ? (1 - pulse.value) * 0.55 : 0, transform: [{ scale: 1 + pulse.value * 0.9 }] }));
  const sent = on && state === 'read';
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingBottom: 12, alignSelf: 'stretch' }}>
      <Press onPress={onPress} accessibilityLabel={on ? 'Stop tap to pay' : 'Tap to pay'} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, height: 46, borderRadius: 23, backgroundColor: on ? C.ink : C.fill }}>
        <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[{ position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: C.good }, wave]} />
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: on ? C.good : C.sub }} />
        </View>
        <T v="callout" color={on ? C.inkText : C.text}>{sent ? 'Sent' : on ? 'Tap is on' : 'Tap to receive'}</T>
      </Press>
      {coins && coins.length > 1 && on ? (
        <Animated.View entering={FadeIn.duration(220)} style={{ alignSelf: 'stretch' }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 4, flexGrow: 1, justifyContent: 'center' }}>
            {coins.map((c) => (
              <Press key={c.id} haptic={false} onPress={() => (tap(), onCoin?.(c.id))} accessibilityLabel={`Be paid in ${c.label}`} style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: coin === c.id ? C.text : C.fill }}>
                <T v="sub" color={coin === c.id ? C.inkText : C.soft}>{c.label}</T>
              </Press>
            ))}
          </ScrollView>
        </Animated.View>
      ) : null}
      {on || problem ? (
        <T v="sub" dim={!problem} color={problem ? C.bad : undefined} style={{ textAlign: 'center' }}>
          {problem || WORDS[state] || ''}
        </T>
      ) : null}
    </View>
  );
}

/**
 * Sits behind whatever you are showing. While tap is on, soft waves leave it like a signal; when the other phone
 * has read the request, one green wave and a quick pop say it went through.
 */
export function TapWaves({ on, sent, size, children }: { on: boolean; sent: boolean; size: number; children: React.ReactNode }) {
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const ok = useSharedValue(0);
  const pop = useSharedValue(1);
  useEffect(() => {
    if (on) {
      a.value = 0;
      b.value = 0;
      a.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1);
      b.value = withDelay(1200, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1));
    } else {
      cancelAnimation(a);
      cancelAnimation(b);
      a.value = withTiming(0, { duration: 200 });
      b.value = withTiming(0, { duration: 200 });
    }
  }, [on, a, b]);
  useEffect(() => {
    if (!sent) return;
    ok.value = 0;
    ok.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
    pop.value = withSequence(withTiming(1.05, { duration: 140 }), withSpring(1, { damping: 8, stiffness: 160 }));
  }, [sent, ok, pop]);
  const wave = (v: typeof a) => useAnimatedStyle(() => ({ opacity: on && v.value > 0 ? (1 - v.value) * 0.45 : 0, transform: [{ scale: 1 + v.value * 0.32 }] })); // eslint-disable-line react-hooks/rules-of-hooks
  const w1 = wave(a);
  const w2 = wave(b);
  const good = useAnimatedStyle(() => ({ opacity: (1 - ok.value) * (ok.value > 0 ? 1 : 0), transform: [{ scale: 1 + ok.value * 0.45 }] }));
  const lift = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const r = size / 2;
  const ring = { position: 'absolute' as const, width: size, height: size, borderRadius: r, borderWidth: 2 };
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View pointerEvents="none" style={[ring, { borderColor: '#fff' }, w1]} />
      <Animated.View pointerEvents="none" style={[ring, { borderColor: '#fff' }, w2]} />
      <Animated.View pointerEvents="none" style={[ring, { borderColor: C.good, borderWidth: 3 }, good]} />
      <Animated.View style={lift}>{children}</Animated.View>
    </View>
  );
}
