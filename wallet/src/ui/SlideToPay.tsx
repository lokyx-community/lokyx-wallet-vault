import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, interpolateColor, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Icon, type IconName } from './Icon';
import { T } from './Text';
import { C, F } from './theme';
import { tap, tick } from './controls';
import { biometricKind } from '../lib/auth';
import { useWallet } from '../lib/wallet';
import { DUR, EASE_OUT } from './motion';

const H = 64;
const KNOB = 54;
const PAD = (H - KNOB) / 2;

/**
 * Slide the knob all the way across to pay. Letting go early springs it back, so a payment
 * can't go out from a stray tap. `onSlide` runs at the end (that's where Face ID is asked);
 * if it returns false the knob comes back.
 */
export function SlideToPay({ label, onSlide, icon, busy, disabled }: { label: string; onSlide: () => Promise<boolean | void> | boolean | void; icon?: IconName; busy?: boolean; disabled?: boolean; done?: IconName }) {
  // the knob shows how you'll confirm: your face, your finger, or the passcode lock
  const bioOn = useWallet().settings.biometrics;
  const [shown, setShown] = useState<IconName>(icon ?? 'face');
  useEffect(() => {
    if (icon) return;
    biometricKind().then((b) => setShown(bioOn && b ? (b === 'finger' ? 'finger' : 'face') : 'lock'));
  }, [icon, bioOn]);
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const shine = useSharedValue(0);
  const nudge = useSharedValue(0);
  const max = Math.max(1, w - KNOB - PAD * 2);
  const [locked, setLocked] = useState(false);
  const [sent, setSent] = useState(false);
  const mark = useSharedValue(0);
  // 1 while the knob is far enough across that letting go confirms; 0 otherwise
  const armed = useSharedValue(0);

  useEffect(() => {
    shine.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1);
  }, [shine]);

  const running = useRef(false);
  const finish = async () => {
    // one run at a time: a second slide, a tap or a screen reader action while the first is still going must not start another
    if (running.current) return;
    running.current = true;
    setLocked(true);
    tap(Haptics.ImpactFeedbackStyle.Heavy);
    let ok: boolean | void = false;
    try {
      ok = await onSlide();
    } catch {
      ok = false;
    }
    if (ok === false) {
      x.value = withSpring(0, { overshootClamping: true, damping: 18, stiffness: 180 });
      setLocked(false);
      running.current = false;
    } else {
      // it went through: the knob turns into a tick and the whole bar settles green
      setSent(true);
      mark.value = withTiming(1, { duration: DUR.base, easing: EASE_OUT });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  };
  const tickAt = (n: number) => {
    if (n < 3) tap(Haptics.ImpactFeedbackStyle.Light);
  };

  // a small tug to the right when tapped, to show it wants a slide
  const hint = () => {
    tick();
    nudge.value = withSequence(withTiming(18, { duration: 160 }), withTiming(0, { duration: DUR.base, easing: EASE_OUT }));
  };

  const pan = Gesture.Pan()
    .enabled(!disabled && !busy && !locked && w > 0)
    .activeOffsetX([-6, 6])
    .failOffsetY([-24, 24])
    .onBegin(() => {
      start.value = x.value;
    })
    .onUpdate((e) => {
      const v = Math.min(max, Math.max(0, start.value + e.translationX));
      // a light tap at a third and two thirds of the way, a firm one at the end
      if (v >= max * 0.33 && x.value < max * 0.33) runOnJS(tickAt)(1);
      if (v >= max * 0.66 && x.value < max * 0.66) runOnJS(tickAt)(2);
      if (v >= max * 0.98 && x.value < max * 0.98) runOnJS(tick)();
      // crossing the line either way is felt, so you know whether letting go will confirm
      const a = v >= max * 0.9 ? 1 : 0;
      if (a !== armed.value) {
        armed.value = withTiming(a, { duration: 120 });
        runOnJS(a ? tap : tick)();
      }
      x.value = v;
    })
    .onFinalize(() => {
      armed.value = withTiming(0, { duration: 160 });
    })
    .onEnd(() => {
      if (x.value >= max * 0.9) {
        x.value = withSpring(max, { overshootClamping: true, damping: 20, stiffness: 300 });
        runOnJS(finish)();
      } else x.value = withSpring(0, { overshootClamping: true, damping: 16, stiffness: 200 });
    });
  const tapG = Gesture.Tap()
    .enabled(!disabled && !busy && !locked)
    .onEnd(() => runOnJS(hint)());

  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value + nudge.value }] }));
  const fill = useAnimatedStyle(() => ({
    width: x.value + nudge.value + KNOB + PAD,
    backgroundColor: interpolateColor(Math.max(x.value, mark.value * max), [0, max], [C.fill2, 'rgba(61,214,140,0.34)']),
  }));
  const knobGlow = useAnimatedStyle(() => ({ shadowOpacity: interpolate(x.value, [0, max], [0.15, 0.6], 'clamp') }));
  // armed: the knob turns green and a line says to let go
  const knobArmed = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(armed.value, [0, 1], [C.ink, C.good]), transform: [{ scale: 1 + armed.value * 0.06 }] }));
  const release = useAnimatedStyle(() => ({ opacity: armed.value }));
  const text = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, max * 0.55], [1, 0], 'clamp'), transform: [{ translateX: x.value * 0.25 }] }));
  const gleam = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(shine.value, [0, 1], [-120, w + 40]) }], opacity: locked ? 0 : 0.5 }));

  const working = busy || locked;
  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tapG)}>
      <View
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityActions={[{ name: 'activate', label }]}
        onAccessibilityAction={() => !disabled && !working && finish()}
        style={{ height: H, borderRadius: H / 2, backgroundColor: C.fill, overflow: 'hidden', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
      >
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: H / 2, }, fill]} />
        <Animated.View style={[{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }, text]} pointerEvents="none">
          <View style={{ overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: KNOB * 0.7 }}>
              <T style={{ fontFamily: F.semibold, fontSize: 17, color: C.soft }}>{label}</T>
              <Icon name="chevron" size={14} color={C.faint} width={2.4} />
            </View>
            <Animated.View style={[{ position: 'absolute', top: -10, bottom: -10, width: 50, backgroundColor: 'rgba(255,255,255,0.35)', transform: [{ rotate: '18deg' }] }, gleam]} />
          </View>
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }, release]} pointerEvents="none">
          <T style={{ fontFamily: F.semibold, fontSize: 17, color: C.good }}>Let go to confirm</T>
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', left: PAD, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', shadowColor: '#3DD68C', shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 6 }, knob, knobGlow, knobArmed]}>
          {sent ? <Icon name="check" size={28} color={C.inkText} width={2.6} /> : working ? <ActivityIndicator color={C.inkText} /> : <Icon name={shown} size={28} color={C.inkText} width={1.9} />}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
