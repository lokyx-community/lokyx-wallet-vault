import { useEffect, useMemo } from 'react';
import Svg, { Circle, G, Line } from 'react-native-svg';
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { EASE_OUT } from './motion';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { C } from './theme';

const ALine = Animated.createAnimatedComponent(Line);
const ACircle = Animated.createAnimatedComponent(Circle);
const N = 24;

// The same picture the website draws for an address: 24 spikes whose lengths come from the
// address hash, turned to an angle from the hash, with a dot in the middle.
export const signetBytes = (address: string) => keccak_256(utf8ToBytes(address.toLowerCase()));

function Spike({ i, len, strong, play, color, dim }: { i: number; len: number; strong: boolean; play: boolean; color: string; dim: string }) {
  const k = useSharedValue(play ? 0 : 1);
  useEffect(() => {
    if (play) k.value = withDelay(120 + i * 40, withTiming(1, { duration: 480, easing: Easing.bezier(0.16, 1, 0.3, 1) }));
  }, [play, i, k]);
  const p = useAnimatedProps(() => ({ y2: -40 + len * k.value, opacity: Math.min(1, k.value * 2) }));
  return <ALine x1={0} y1={-40} x2={0} y2={-40 + len} stroke={strong ? color : dim} strokeWidth={strong ? 4 : 3} strokeLinecap="round" transform={`rotate(${(i * 360) / N})`} animatedProps={p} />;
}

function Core({ r, play, color }: { r: number; play: boolean; color: string }) {
  const k = useSharedValue(play ? 0 : 1);
  useEffect(() => {
    if (play) k.value = withDelay(1250, withTiming(1, { duration: 380, easing: EASE_OUT }));
  }, [play, k]);
  const p = useAnimatedProps(() => ({ r: r * k.value }));
  return <ACircle cx={0} cy={0} fill={color} animatedProps={p} />;
}

/** An address's signet. `play` grows the spikes in one after another. `bare` drops the disc behind. */
export function Signet({ of, size = 40, play = false, bare = false, color = C.text, dim = '#5E5E66' }: { of: string; size?: number; play?: boolean; bare?: boolean; color?: string; dim?: string }) {
  const b = useMemo(() => signetBytes(of), [of]);
  const rot = (b[31] / 255) * 360;
  return (
    <Svg width={size} height={size} viewBox="-50 -50 100 100">
      {!bare && <Circle r={48} fill={C.fill2} stroke={C.line2} strokeWidth={2} />}
      <G transform={`rotate(${rot})`} key={of}>
        {Array.from({ length: N }, (_, i) => (
          <Spike key={i} i={i} len={8 + (b[i] / 255) * 22} strong={b[i] > 170} play={play} color={color} dim={dim} />
        ))}
        <Core r={5 + (b[24] % 5)} play={play} color={color} />
      </G>
    </Svg>
  );
}
