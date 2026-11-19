import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { C } from './theme';
import { fillTarget, type FillStage } from '../lib/sunfill-core';
import { DUR, EASE_OUT } from './motion';

/**
 * The recipient's sun lights up ray by ray as a payment moves: signing, sending, waiting for a block.
 * When it lands every ray and the frame turn green and a tick pops in the middle; a refusal turns them red.
 * With Reduce Motion on, the rays jump to the stage instead of filling one at a time.
 * `rays` is one SVG path string per ray (sunPaths().each) and `frame` its circle.
 */
export function SunFills({ rays, frame, frameStroke, stroke, size, stage, centre }: { rays: string[]; frame: number; frameStroke: number; stroke: number; size: number; stage: FillStage; centre?: React.ReactNode }) {
  const live = useMemo(() => rays.filter((d) => d), [rays]);
  const [lit, setLit] = useState(0);
  const [still, setStill] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {});
  }, []);
  const target = Math.round(fillTarget(stage, live.length));
  useEffect(() => {
    if (still || stage === 'failed') return void setLit(stage === 'failed' ? 0 : target);
    const t = setInterval(() => setLit((n) => (n < target ? n + 1 : n)), 45);
    return () => clearInterval(t);
  }, [target, still, stage]);
  // the "waiting" stage keeps creeping toward its ceiling so the wait doesn't look frozen
  const pop = useSharedValue(0);
  useEffect(() => {
    pop.value = stage === 'done' || stage === 'failed' ? withTiming(1, { duration: DUR.slow, easing: EASE_OUT }) : 0;
  }, [stage, pop]);
  const badge = useAnimatedStyle(() => ({ opacity: Math.min(1, pop.value * 3), transform: [{ scale: 0.5 + 0.5 * pop.value }] }));
  const done = stage === 'done';
  const failed = stage === 'failed';
  const ok = done ? C.good : failed ? C.bad : C.text;
  const litD = done ? live.join('') : live.slice(0, lit).join('');
  const dimD = done ? '' : live.slice(lit).join('');
  const pct = Math.round((lit / Math.max(1, live.length)) * 100);
  return (
    <View style={{ width: size, height: size }} accessibilityRole="progressbar" accessibilityLabel={done ? 'Payment delivered' : failed ? 'Payment failed' : `Payment in progress, ${pct} percent`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={frame} stroke={done || failed ? ok : C.line2} strokeWidth={frameStroke} fill="none" />
        {dimD ? <Path d={dimD} stroke={C.line2} strokeWidth={stroke} strokeLinecap="round" fill="none" /> : null}
        {litD ? <Path d={litD} stroke={failed ? C.bad : ok} strokeWidth={stroke} strokeLinecap="round" fill="none" /> : null}
      </Svg>
      <View style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
        {done || failed ? (
          <Animated.View style={[{ width: size * 0.36, height: size * 0.36, borderRadius: size * 0.18, backgroundColor: ok, alignItems: 'center', justifyContent: 'center' }, badge]}>
            <Svg width={size * 0.2} height={size * 0.2} viewBox="0 0 24 24">
              <Path d={done ? 'M5 12.5l4.5 4.5L19 7.5' : 'M6 6l12 12M18 6L6 18'} stroke="#000" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </Svg>
          </Animated.View>
        ) : (
          centre ?? <T style={{ fontSize: size * 0.1 }}>{pct}%</T>
        )}
      </View>
    </View>
  );
}
