import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { C } from './theme';

/** A ring cut into one arc per owner. The first `have` arcs are lit: how many have approved out of how many it takes. */
export function ApprovalRing({ n, have, need, size = 120, stroke = 7, children }: { n: number; have: number; need: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = size / 2 - stroke;
  const c = size / 2;
  const gap = n > 1 ? 0.16 : 0;
  const arc = (i: number) => {
    const a0 = -Math.PI / 2 + (i / n) * Math.PI * 2 + gap / 2;
    const a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2 - gap / 2;
    const p = (a: number) => `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
    return `M${p(a0)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
  };
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {Array.from({ length: n }, (_, i) => (
          <Path key={i} d={arc(i)} stroke={i < have ? (have >= need ? C.good : '#F4F4F6') : 'rgba(255,255,255,0.14)'} strokeWidth={stroke} strokeLinecap="round" fill="none" />
        ))}
      </Svg>
      {children}
    </View>
  );
}
