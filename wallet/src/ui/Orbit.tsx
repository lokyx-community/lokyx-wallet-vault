import { useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, RadialGradient, Stop } from 'react-native-svg';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';

// The one place the wallet uses colour: Neptune, a deep blue planet that capsules circle while they wait.
export const PLANET = { light: '#8FA8FF', mid: '#4A6CF0', deep: '#1B2A78', edge: '#0A1036', glow: 'rgba(84,118,250,0.30)' };

export function Planet({ size }: { size: number }) {
  const breathe = useSharedValue(0);
  useEffect(() => {
    breathe.value = withRepeat(withSequence(withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 3200, easing: Easing.inOut(Easing.sin) })), -1);
  }, [breathe]);
  const slide = useSharedValue(0);
  useEffect(() => {
    slide.value = withRepeat(withTiming(1, { duration: 70000, easing: Easing.linear }), -1, false);
  }, [slide]);
  const drift = useAnimatedStyle(() => ({ transform: [{ translateX: slide.value * size }] }));
  const glow = useAnimatedStyle(() => ({ opacity: 0.65 + 0.35 * breathe.value, transform: [{ scale: 1 + 0.04 * breathe.value }] }));
  const g = size * 1.9;
  const r = size / 2;
  // each planet needs its own gradient ids, or a second one on screen borrows the first one's
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Animated.View style={[{ position: 'absolute', left: (size - g) / 2, top: (size - g) / 2, width: g, height: g }, glow]}>
        <Svg width={g} height={g}>
          <Defs>
            <RadialGradient id={`halo${id}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0.48" stopColor={PLANET.mid} stopOpacity={0.45} />
              <Stop offset="0.62" stopColor={PLANET.mid} stopOpacity={0.12} />
              <Stop offset="1" stopColor={PLANET.mid} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={g / 2} cy={g / 2} r={g / 2} fill={`url(#halo${id})`} />
        </Svg>
      </Animated.View>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={`body${id}`} cx="36%" cy="30%" r="78%">
            <Stop offset="0" stopColor={PLANET.light} />
            <Stop offset="0.35" stopColor={PLANET.mid} />
            <Stop offset="0.78" stopColor={PLANET.deep} />
            <Stop offset="1" stopColor={PLANET.edge} />
          </RadialGradient>
          <ClipPath id={`disc${id}`}>
            <Circle cx={r} cy={r} r={r} />
          </ClipPath>
        </Defs>
        <Circle cx={r} cy={r} r={r} fill={`url(#body${id})`} />
      </Svg>
      {/* Neptune's bands drift across the disc, and its storm goes with them; a soft shade on the right keeps it round */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, borderRadius: r, overflow: 'hidden' }}>
        <Animated.View style={[{ position: 'absolute', left: -size, top: 0, width: size * 2, height: size }, drift]}>
          <Svg width={size * 2} height={size}>
            {[0, 1].map((k) => (
              <G key={k} opacity={0.3}>
                <Ellipse cx={size * (k + 0.5)} cy={r * 0.55} rx={size * 0.62} ry={r * 0.06} fill="#fff" />
                <Ellipse cx={size * (k + 0.5)} cy={r * 0.92} rx={size * 0.62} ry={r * 0.045} fill="#fff" />
                <Ellipse cx={size * (k + 0.5)} cy={r * 1.25} rx={size * 0.62} ry={r * 0.07} fill={PLANET.edge} />
                <Ellipse cx={size * (k + 0.5)} cy={r * 1.5} rx={size * 0.62} ry={r * 0.04} fill="#fff" />
                <Ellipse cx={size * (k + 0.28)} cy={r * 1.1} rx={r * 0.3} ry={r * 0.15} fill={PLANET.edge} opacity={1.6} />
                <Ellipse cx={size * (k + 0.28) + r * 0.34} cy={r * 1.03} rx={r * 0.2} ry={r * 0.035} fill="#fff" opacity={2.2} />
                <Ellipse cx={size * (k + 0.74)} cy={r * 0.7} rx={r * 0.3} ry={r * 0.04} fill="#fff" opacity={1.4} />
              </G>
            ))}
          </Svg>
        </Animated.View>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id={`shade${id}`} cx="30%" cy="28%" r="85%">
              <Stop offset="0.55" stopColor="#000" stopOpacity={0} />
              <Stop offset="1" stopColor="#000" stopOpacity={0.5} />
            </RadialGradient>
          </Defs>
          <Circle cx={r} cy={r} r={r} fill={`url(#shade${id})`} />
        </Svg>
      </View>
    </View>
  );
}

/** A point on a tilted orbit. Behind the planet when sin < 0, so it's drawn below it and dimmer. */
function useOrbitStyle(angle: SharedValue<number>, rx: number, ry: number, cx: number, cy: number, w: number, h: number, offset: number, dir = 1) {
  return useAnimatedStyle(() => {
    const t = dir * angle.value + offset;
    const s = Math.sin(t);
    const x = cx + rx * Math.cos(t) - w / 2;
    const y = cy + ry * s - h / 2;
    const tangent = Math.atan2(ry * Math.cos(t) * dir, -rx * s * dir);
    const front = s > 0;
    return {
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${tangent}rad` }, { scale: 0.8 + 0.25 * (s + 1) / 2 }],
      zIndex: front ? 3 : 1,
      opacity: front ? 1 : 0.45 + 0.4 * (1 + s),
    };
  });
}

export function CapsuleShape({ w = 18, h = 9, glow = true }: { w?: number; h?: number; glow?: boolean }) {
  return (
    <View style={{ width: w, height: h, borderRadius: h / 2, backgroundColor: '#F5F5F7', shadowColor: '#fff', shadowOpacity: glow ? 0.9 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, overflow: 'hidden', flexDirection: 'row' }}>
      <View style={{ flex: 1 }} />
      <View style={{ width: 1, backgroundColor: 'rgba(0,0,0,0.25)' }} />
      <View style={{ flex: 1, backgroundColor: '#D9DCE6' }} />
    </View>
  );
}

function Rider({ angle, rx, ry, cx, cy, offset }: { angle: SharedValue<number>; rx: number; ry: number; cx: number; cy: number; offset: number }) {
  const a = useOrbitStyle(angle, rx, ry, cx, cy, 18, 9, offset);
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, a]}>
      <CapsuleShape />
    </Animated.View>
  );
}

/** Neptune's rings are faint and thin, with one broken arc. `back` is the half behind the planet, `front` the half across it. */
function PlanetRings({ W, H, cx, cy, P, back }: { W: number; H: number; cx: number; cy: number; P: number; back: boolean }) {
  const arc = (rx: number, ry: number) => `M ${-rx} 0 A ${rx} ${ry} 0 0 ${back ? 1 : 0} ${rx} 0`;
  const a = back ? 0.55 : 1;
  return (
    <Svg width={W} height={H} style={[StyleSheet.absoluteFill, { zIndex: back ? 0 : 3 }]} pointerEvents="none">
      <G transform={`translate(${cx} ${cy}) rotate(-12)`} fill="none" strokeLinecap="round">
        <Path d={arc(P * 0.74, P * 0.17)} stroke="rgba(160,190,255,0.30)" strokeWidth={1.2} opacity={a} />
        <Path d={arc(P * 0.64, P * 0.14)} stroke="rgba(160,190,255,0.22)" strokeWidth={2.4} strokeDasharray={`${P * 0.2} ${P * 0.06} ${P * 0.03} ${P * 0.1}`} opacity={a} />
        <Path d={arc(P * 0.57, P * 0.12)} stroke="rgba(190,210,255,0.12)" strokeWidth={4.5} opacity={a} />
      </G>
    </Svg>
  );
}

function Moon({ angle, rx, ry, cx, cy }: { angle: SharedValue<number>; rx: number; ry: number; cx: number; cy: number }) {
  // the little moon goes round the other way
  const a = useOrbitStyle(angle, rx, ry, cx, cy, 8, 8, 1.2, -2);
  return <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 8, height: 8, borderRadius: 4, backgroundColor: '#E6CFC8', shadowColor: '#FFD9CF', shadowOpacity: 0.55, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } }, a]} />;
}

/**
 * A planet with capsules circling it. `riders` are where each capsule sits on its orbit
 * (0..1 of the way round); they all drift slowly so the scene never stands still.
 */
export function OrbitScene({ size, riders, speed = 1, planet = 0.34 }: { size: number; riders: number[]; speed?: number; planet?: number }) {
  const angle = useSharedValue(0);
  useEffect(() => {
    angle.value = withRepeat(withTiming(Math.PI * 2, { duration: 48000 / speed, easing: Easing.linear }), -1, false);
  }, [angle, speed]);
  const W = size;
  const H = size * 0.72;
  const cx = W / 2;
  const cy = H / 2;
  const P = W * planet;
  const orbits = riders.map((_, i) => ({ rx: W * (0.3 + 0.075 * (i % 3)), ry: W * (0.3 + 0.075 * (i % 3)) * 0.34 }));
  const ring = orbits.length ? orbits : [{ rx: W * 0.32, ry: W * 0.32 * 0.34 }];
  return (
    <View style={{ width: W, height: H }} pointerEvents="none">
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        {[...new Set(ring.map((o) => o.rx))].map((rx) => (
          <Ellipse key={rx} cx={cx} cy={cy} rx={rx} ry={rx * 0.34} stroke="rgba(255,255,255,0.12)" strokeWidth={1} fill="none" />
        ))}
      </Svg>
      <PlanetRings W={W} H={H} cx={cx} cy={cy} P={P} back />
      <View style={{ position: 'absolute', left: cx - P / 2, top: cy - P / 2, zIndex: 2 }}>
        <Planet size={P} />
      </View>
      <PlanetRings W={W} H={H} cx={cx} cy={cy} P={P} back={false} />
      <Moon angle={angle} rx={P * 0.78} ry={P * 0.26} cx={cx} cy={cy} />
      {riders.map((p, i) => (
        <Rider key={i} angle={angle} rx={orbits[i].rx} ry={orbits[i].ry} cx={cx} cy={cy} offset={p * Math.PI * 2 + Math.PI / 2} />
      ))}
    </View>
  );
}
