import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { C } from './theme';

const AP = Animated.createAnimatedComponent(Path);

/** One owner's arc: a faint track, and a lit stroke that draws itself along it when that owner approves. */
function Arc({ d, len, lit, color, index, still, w }: { w: number; d: string; len: number; lit: boolean; color: string; index: number; still: boolean }) {
  const p = useSharedValue(still ? (lit ? 1 : 0) : 0);
  useEffect(() => {
    p.value = still ? (lit ? 1 : 0) : withDelay(lit ? 160 + index * 140 : 0, withTiming(lit ? 1 : 0, { duration: 520, easing: Easing.out(Easing.cubic) }));
  }, [lit, index, still, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: len * (1 - p.value) }));
  return <AP d={d} stroke={color} strokeWidth={w} strokeLinecap="round" fill="none" strokeDasharray={[len, len]} animatedProps={props} />;
}

/** A ring cut into one arc per owner. The first `have` arcs are lit: how many have approved out of how many it takes. They draw in one by one, and turn green when enough have agreed. */
export function ApprovalRing({ n, have, need, size = 120, stroke = 7, children }: { n: number; have: number; need: number; size?: number; stroke?: number; children?: ReactNode }) {
  const still = useReducedMotion();
  const r = size / 2 - stroke;
  const c = size / 2;
  const gap = n > 1 ? 0.16 : 0;
  const arc = (i: number) => {
    const a0 = -Math.PI / 2 + (i / n) * Math.PI * 2 + gap / 2;
    const a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2 - gap / 2;
    const p = (a: number) => `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
    return { d: `M${p(a0)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`, len: r * (a1 - a0) + 1 };
  };
  const color = have >= need ? C.good : '#F4F4F6';
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {Array.from({ length: n }, (_, i) => (
          <Path key={`t${i}`} d={arc(i).d} stroke="rgba(255,255,255,0.14)" strokeWidth={stroke} strokeLinecap="round" fill="none" />
        ))}
        {Array.from({ length: n }, (_, i) => {
          const a = arc(i);
          return <Arc key={`l${i}`} d={a.d} len={a.len} lit={i < have} color={color} index={i} still={still} w={stroke} />;
        })}
      </Svg>
      {children}
    </View>
  );
}
