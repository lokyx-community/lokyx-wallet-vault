import { useEffect, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { Sheet } from './Sheet';
import { T } from './Text';
import { Button, Press } from './controls';
import { Icon } from './Icon';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';
import { TUTORIALS, nextStep, type SceneKind, type TutorialId } from '../lib/tutorial-core';

const W = 300;
const H = 150;

/** One loop of the picture, 0 to 1, over and over while a step is on screen. */
function useLoop(ms = 2800) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.linear }), -1, false);
  }, [p, ms]);
  return p;
}

const Dot = ({ size, color = C.text, style }: { size: number; color?: string; style: any }) => (
  <Animated.View style={[{ position: 'absolute', left: W / 2 - size / 2, top: H / 2 - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />
);

// One key splits into three that move apart: no one of them holds everything.
function Split({ p }: { p: SharedValue<number> }) {
  const targets = [
    { x: -90, y: 0 },
    { x: 60, y: -38 },
    { x: 60, y: 38 },
  ];
  return (
    <>
      {targets.map((t, i) => (
        <SplitDot key={i} p={p} x={t.x} y={t.y} />
      ))}
      <Big p={p} />
    </>
  );
}
function SplitDot({ p, x, y }: { p: SharedValue<number>; x: number; y: number }) {
  const s = useAnimatedStyle(() => {
    const q = interpolate(p.value, [0.15, 0.45, 0.85, 1], [0, 1, 1, 0], 'clamp');
    return { opacity: q, transform: [{ translateX: x * q }, { translateY: y * q }] };
  });
  return <Dot size={20} style={s} />;
}
function Big({ p }: { p: SharedValue<number> }) {
  const s = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.15, 0.2, 0.9, 1], [1, 1, 0, 0, 1], 'clamp'), transform: [{ scale: interpolate(p.value, [0, 0.15], [1, 0.8], 'clamp') }] }));
  return <Dot size={34} style={s} />;
}

// A ring with a hand going round: the wait.
function Wait({ p }: { p: SharedValue<number> }) {
  const hand = useAnimatedStyle(() => ({ transform: [{ rotate: `${p.value * 360}deg` }] }));
  const ring = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.05, 0.95, 1], [0.5, 1, 1, 0.5]) }));
  return (
    <>
      <Animated.View style={[{ position: 'absolute', left: W / 2 - 46, top: H / 2 - 46, width: 92, height: 92, borderRadius: 46, borderWidth: 3, borderColor: C.line2 }, ring]} />
      <Animated.View style={[{ position: 'absolute', left: W / 2 - 2, top: H / 2 - 36, width: 4, height: 72 }, hand]}>
        <View style={{ width: 4, height: 36, borderRadius: 2, backgroundColor: C.text }} />
      </Animated.View>
      <Dot size={10} style={{}} />
    </>
  );
}

// A phone, then a tick: you approve it on your phone.
function Approve({ p }: { p: SharedValue<number> }) {
  const phone = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(p.value, [0, 0.3, 0.45, 1], [1, 1, 1.04, 1], 'clamp') }] }));
  const tick = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.4, 0.55, 0.9, 1], [0, 1, 1, 0], 'clamp'), transform: [{ scale: interpolate(p.value, [0.4, 0.55, 0.65], [0.4, 1.15, 1], 'clamp') }] }));
  return (
    <>
      <Animated.View style={[{ position: 'absolute', left: W / 2 - 34, top: H / 2 - 56, width: 68, height: 112, borderRadius: 16, borderWidth: 2, borderColor: C.soft, backgroundColor: C.card }, phone]} />
      <Dot size={44} color={C.good} style={tick} />
      <Animated.View style={[{ position: 'absolute', left: W / 2 - 12, top: H / 2 - 12 }, tick]}>
        <Icon name="check" size={24} color="#000" width={2.8} />
      </Animated.View>
    </>
  );
}

// A card with a coin dropping into it.
function Drop({ p }: { p: SharedValue<number> }) {
  const coin = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.1, 0.85, 1], [0, 1, 1, 0], 'clamp'), transform: [{ translateY: interpolate(p.value, [0.1, 0.5], [-90, 6], 'clamp') }] }));
  const ripple = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.5, 0.55, 0.85], [0, 0.7, 0], 'clamp'), transform: [{ translateY: 6 }, { scale: interpolate(p.value, [0.5, 0.85], [1, 3], 'clamp') }] }));
  return (
    <>
      <View style={{ position: 'absolute', left: W / 2 - 74, top: H / 2 - 34, width: 148, height: 96, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: 'rgba(201,160,87,0.4)' }} />
      <Dot size={28} style={{ opacity: 0.12 }} />
      <Animated.View style={[{ position: 'absolute', left: W / 2 - 17, top: H / 2 - 17, width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: 'rgba(201,160,87,0.9)' }, ripple]} />
      <Dot size={28} style={coin} />
    </>
  );
}

// Two coins trade places.
function Swap({ p }: { p: SharedValue<number> }) {
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: -64 * Math.cos(Math.PI * interpolate(p.value, [0.1, 0.7], [0, 1], 'clamp')) }, { translateY: -18 * Math.sin(Math.PI * interpolate(p.value, [0.1, 0.7], [0, 1], 'clamp')) }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: 64 * Math.cos(Math.PI * interpolate(p.value, [0.1, 0.7], [0, 1], 'clamp')) }, { translateY: 18 * Math.sin(Math.PI * interpolate(p.value, [0.1, 0.7], [0, 1], 'clamp')) }] }));
  return (
    <>
      <Dot size={40} color={C.text} style={a} />
      <Dot size={40} color={C.sub} style={b} />
    </>
  );
}

// A Yes and a No price that always add to 100.
function Price({ p }: { p: SharedValue<number> }) {
  const yes = useAnimatedStyle(() => ({ width: interpolate(p.value, [0, 0.35, 0.7, 1], [150, 180, 180, 150], 'clamp') }));
  const no = useAnimatedStyle(() => ({ width: interpolate(p.value, [0, 0.35, 0.7, 1], [90, 60, 60, 90], 'clamp') }));
  return (
    <View style={{ position: 'absolute', left: 30, right: 30, top: H / 2 - 36, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <T v="sub" style={{ width: 28 }}>Yes</T>
        <Animated.View style={[{ height: 22, borderRadius: 11, backgroundColor: C.good }, yes]} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <T v="sub" style={{ width: 28 }}>No</T>
        <Animated.View style={[{ height: 22, borderRadius: 11, backgroundColor: C.faint }, no]} />
      </View>
    </View>
  );
}

const SCENES: Record<SceneKind, (p: { p: SharedValue<number> }) => ReactElement> = {
  split: Split,
  wait: Wait,
  approve: Approve,
  drop: Drop,
  swap: Swap,
  price: Price,
};

function Scene({ kind }: { kind: SceneKind }) {
  const p = useLoop(kind === 'wait' ? 3200 : 2800);
  const S = SCENES[kind];
  return (
    <View style={{ width: W, height: H, alignSelf: 'center', borderRadius: 24, backgroundColor: C.fill, overflow: 'hidden' }}>
      <S p={p} />
    </View>
  );
}

/**
 * The first-time walk-through for a feature: a short looping picture and one plain line per step, three steps.
 * Skip is always there. Finishing, skipping and dragging it away all call onClose.
 */
export function Tutorial({ id, open, onClose }: { id: TutorialId; open: boolean; onClose: () => void }) {
  const t = TUTORIALS[id];
  const [i, setI] = useState(0);
  useEffect(() => {
    if (open) setI(0);
  }, [open]);
  const step = t.steps[i];
  const last = i === t.steps.length - 1;
  return (
    <Sheet open={open} onClose={onClose}>
      <View style={{ gap: 18, paddingBottom: 6 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.7, lineHeight: 31 }}>{t.title}</T>
        <Scene key={`${id}-${i}`} kind={step.scene} />
        <View style={{ minHeight: 70 }}>
          <Animated.View key={i} entering={FadeIn.duration(DUR.base).easing(EASE_OUT)} exiting={FadeOut.duration(DUR.fast)}>
            <T v="callout" dim style={{ lineHeight: 23 }}>{step.line}</T>
          </Animated.View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          {t.steps.map((_, n) => (
            <View key={n} style={{ width: n === i ? 20 : 7, height: 7, borderRadius: 4, backgroundColor: n === i ? C.text : C.line2 }} />
          ))}
        </View>
        <View style={{ gap: 10 }}>
          <Button
            title={last ? 'Got it' : 'Next'}
            onPress={() => {
              const n = nextStep(i, t.steps.length);
              if (n.done) onClose();
              else setI(n.i);
            }}
          />
          {last ? null : <Button title="Skip" kind="plain" onPress={onClose} />}
        </View>
      </View>
    </Sheet>
  );
}

/** A quiet "How it works" link to put on a feature screen so the tutorial can be seen again. */
export function HowItWorks({ onPress }: { onPress: () => void }) {
  return (
    <Press onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel="How it works" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: 8 }}>
      <Icon name="info" size={16} color={C.sub} width={2} />
      <T v="sub" dim>How it works</T>
    </Press>
  );
}
