import { useEffect, useSyncExternalStore } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { CoinLogo, TokenLogo } from './CoinLogo';
import { Logo, logoFor } from './Logo';
import type { LogoId } from './logos';
import { T } from './Text';
import { C, F } from './theme';
import { EASE_IN_OUT, EASE_OUT } from './motion';

// A coin that travels between two phones held top to top, in the app's own motion language: nothing bounces,
// everything eases out and settles. Depth does the talking: the coin turns in perspective, leaves a soft trail,
// and a contact shadow and a bloom of light tie it to the screen it leaves or lands on.
//   out: it lifts off the sender's screen, turns away from you and leaves through the top.
//   in:  it falls in from the top of the other phone, turns to face you, lands in a bloom of light, and is absorbed.

/** Any coin the wallet holds: its own mark, or for a token with no mark of its own, its first letters. */
type Kind = 'lyx' | LogoId;
export type FlightToken = { symbol: string; seed: string };
export type Flight = { id: number; dir: 'out' | 'in'; chain: Kind; label?: string; token?: FlightToken };
let current: Flight | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function flyCoin(dir: 'out' | 'in', chain: Kind = 'lyx', label?: string, token?: FlightToken) {
  const known = token ? logoFor(token.symbol) : null;
  current = { id: Date.now() + Math.random(), dir, chain: known ?? chain, label, token: known ? undefined : token };
  emit();
}
const clear = (id: number) => {
  if (current?.id === id) {
    current = null;
    emit();
  }
};

export function CoinFlightHost() {
  const f = useSyncExternalStore((s) => (subs.add(s), () => subs.delete(s)), () => current);
  return f ? (f.dir === 'out' ? <Out key={f.id} flight={f} /> : <In key={f.id} flight={f} />) : null;
}

const SIZE = 88;
const buzz = (s: Haptics.ImpactFeedbackStyle) => Platform.OS !== 'web' && Haptics.impactAsync(s).catch(() => {});
const success = () => Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

/** The coin itself: the mark on a lit face, with a thin bright rim and a sheen that sweeps across as it turns. */
function Face({ chain, token, size, sweep }: { chain: Kind; token?: FlightToken; size: number; sweep: SharedValue<number> }) {
  const glare = useAnimatedStyle(() => ({ transform: [{ translateX: -size * 1.2 + sweep.value * size * 2.6 }, { skewX: '-18deg' }] }));
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)' }}>
      {token ? <TokenLogo symbol={token.symbol} seed={token.seed} size={size} /> : chain === 'lyx' || chain === 'btc' || chain === 'eth' ? <CoinLogo chain={chain} size={size} /> : <Logo id={chain} size={size} />}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -4, bottom: -4, width: size * 0.55 }, glare]}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="g" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#fff" stopOpacity="0" />
              <Stop offset="0.5" stopColor="#fff" stopOpacity="0.7" />
              <Stop offset="1" stopColor="#fff" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#g)" />
        </Svg>
      </Animated.View>
      {/* the lower edge sits a little darker, like a lit disc */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: size * 0.5, backgroundColor: 'rgba(0,0,0,0.12)' }} />
    </View>
  );
}

/** A soft pool of light: used as a contact shadow, a bloom and a glow. */
function Glow({ size, color = '#fff', peak = 0.5, style }: { size: number; color?: string; peak?: number; style?: any }) {
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="r" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={peak} />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#r)" />
      </Svg>
    </Animated.View>
  );
}

// ---------- leaving: the sender's phone ----------

function Out({ flight }: { flight: Flight }) {
  const { width, height } = useWindowDimensions();
  const t = useSharedValue(0); // the climb
  const turn = useSharedValue(0); // the turn in perspective
  const rise = useSharedValue(0); // appearing under your finger
  const sweep = useSharedValue(0);
  const edge = useSharedValue(0); // the light at the top edge as it leaves
  useEffect(() => {
    buzz(Haptics.ImpactFeedbackStyle.Medium);
    const h = setTimeout(() => buzz(Haptics.ImpactFeedbackStyle.Light), 820);
    rise.value = withTiming(1, { duration: 260, easing: EASE_OUT });
    t.value = withDelay(140, withTiming(1, { duration: 1050, easing: Easing.bezier(0.55, 0, 0.8, 0.35) }, (fin) => fin && runOnJS(clear)(flight.id)));
    turn.value = withDelay(140, withTiming(1, { duration: 1050, easing: EASE_OUT }));
    sweep.value = withDelay(220, withTiming(1, { duration: 760, easing: EASE_IN_OUT }));
    edge.value = withDelay(820, withSequence(withTiming(1, { duration: 200, easing: EASE_OUT }), withTiming(0, { duration: 420, easing: EASE_IN_OUT })));
    return () => clearTimeout(h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fromY = height * 0.7;
  const toY = -SIZE * 1.6;
  const cx = width / 2 - SIZE / 2;

  const coin = (lag: number, fade: number) =>
    useAnimatedStyle(() => { // eslint-disable-line react-hooks/rules-of-hooks
      const p = Math.max(0, t.value - lag);
      return {
        opacity: rise.value * fade * (1 - Math.max(0, t.value - 0.92) * 12),
        transform: [
          { translateX: Math.sin(p * Math.PI) * 10 },
          { translateY: fromY + (toY - fromY) * p },
          { perspective: 700 },
          { rotateX: `${-26 * turn.value}deg` },
          { rotateY: `${turn.value * 540}deg` },
          { scale: (0.7 + rise.value * 0.3) * (1 - p * 0.5) },
        ],
      };
    });
  const main = coin(0, 1);
  const g1 = coin(0.05, 0.3);
  const g2 = coin(0.1, 0.16);
  const g3 = coin(0.15, 0.07);
  const shadow = useAnimatedStyle(() => ({ opacity: rise.value * 0.55 * (1 - Math.min(1, t.value * 3.2)), transform: [{ translateY: fromY + SIZE * 0.95 }, { scaleX: 1 + t.value * 0.8 }, { scaleY: 0.34 }] }));
  const top = useAnimatedStyle(() => ({ opacity: edge.value * 0.7, transform: [{ scaleX: 0.7 + edge.value * 0.6 }] }));
  const label = useAnimatedStyle(() => ({ opacity: rise.value * (1 - Math.min(1, t.value * 5)), transform: [{ translateY: fromY + SIZE + 14 + (1 - rise.value) * 8 }] }));

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      <Animated.View style={[{ position: 'absolute', left: width / 2 - SIZE, top: 0, width: SIZE * 2, height: SIZE * 2, alignItems: 'center' }, shadow]}>
        <Glow size={SIZE * 2} peak={0.55} style={{ position: 'relative' }} color="#000" />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: width / 2 - width * 0.45, top: -width * 0.28, width: width * 0.9, height: width * 0.56, alignItems: 'center' }, top]}>
        <Glow size={width * 0.9} peak={0.5} style={{ position: 'relative' }} />
      </Animated.View>
      {[g3, g2, g1].map((st, i) => (
        <Animated.View key={i} style={[{ position: 'absolute', left: cx, top: 0, width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: 'rgba(255,255,255,0.9)' }, st]} />
      ))}
      <Animated.View style={[{ position: 'absolute', left: cx, top: 0, width: SIZE }, main]}>
        <Face chain={flight.chain} token={flight.token} size={SIZE} sweep={sweep} />
      </Animated.View>
      {flight.label ? (
        <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center' }, label]}>
          <T style={{ fontFamily: F.semibold, fontSize: 17, letterSpacing: -0.2, color: C.text }}>{flight.label}</T>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ---------- arriving: the receiver's phone ----------

function In({ flight }: { flight: Flight }) {
  const { width, height } = useWindowDimensions();
  const drop = useSharedValue(0); // falls in
  const land = useSharedValue(0); // the light when it lands
  const ring = useSharedValue(0);
  const press = useSharedValue(0);
  const sweep = useSharedValue(0);
  const gone = useSharedValue(0); // absorbed into the screen
  useEffect(() => {
    drop.value = withTiming(1, { duration: 980, easing: Easing.bezier(0.16, 0.84, 0.3, 1) });
    sweep.value = withTiming(1, { duration: 980, easing: EASE_IN_OUT });
    const land1 = 760;
    land.value = withDelay(land1, withTiming(1, { duration: 900, easing: EASE_OUT }));
    ring.value = withDelay(land1 + 90, withTiming(1, { duration: 1000, easing: EASE_OUT }));
    press.value = withDelay(land1, withSequence(withTiming(1, { duration: 120, easing: EASE_OUT }), withTiming(0, { duration: 420, easing: EASE_OUT })));
    gone.value = withDelay(1750, withTiming(1, { duration: 420, easing: EASE_IN_OUT }, (fin) => fin && runOnJS(clear)(flight.id)));
    const h1 = setTimeout(() => (buzz(Haptics.ImpactFeedbackStyle.Heavy), success()), land1 + 40);
    return () => clearTimeout(h1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fromY = -SIZE * 1.8;
  const toY = height * 0.2;
  const cx = width / 2 - SIZE / 2;
  const coin = (lag: number, fade: number) =>
    useAnimatedStyle(() => { // eslint-disable-line react-hooks/rules-of-hooks
      const p = Math.max(0, drop.value - lag);
      return {
        opacity: fade * Math.min(1, drop.value * 7) * (1 - gone.value),
        transform: [
          { translateY: fromY + (toY - fromY) * p },
          { perspective: 700 },
          { rotateX: `${24 * (1 - drop.value)}deg` },
          { rotateY: `${(1 - drop.value) * 540}deg` },
          { scale: (0.55 + p * 0.45 - press.value * 0.05) * (1 - gone.value * 0.55) },
        ],
      };
    });
  const main = coin(0, 1);
  const g1 = coin(0.05, 0.26);
  const g2 = coin(0.1, 0.13);
  const g3 = coin(0.15, 0.06);
  const bloom = useAnimatedStyle(() => ({ opacity: (1 - land.value) * (land.value > 0 ? 1 : 0), transform: [{ scale: 0.35 + land.value * 1.9 }] }));
  const rim = useAnimatedStyle(() => ({ opacity: (1 - ring.value) * (ring.value > 0 ? 0.7 : 0), transform: [{ scale: 0.7 + ring.value * 1.5 }] }));
  const rim2 = useAnimatedStyle(() => ({ opacity: (1 - ring.value) * (ring.value > 0.12 ? 0.4 : 0), transform: [{ scale: 0.55 + Math.max(0, ring.value - 0.12) * 1.9 }] }));
  const label = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, (drop.value - 0.7) * 4)) * (1 - gone.value), transform: [{ translateY: toY + SIZE + 14 + (1 - Math.min(1, Math.max(0, (drop.value - 0.7) * 3.3))) * 10 }] }));
  const cy = toY + SIZE / 2;
  const R = SIZE * 3;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      <Animated.View style={[{ position: 'absolute', left: width / 2 - R, top: cy - R }, bloom]}>
        <Glow size={R * 2} peak={0.55} color="#7CF2B8" style={{ position: 'relative' }} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: width / 2 - SIZE, top: cy - SIZE, width: SIZE * 2, height: SIZE * 2, borderRadius: SIZE, borderWidth: 2, borderColor: C.good }, rim]} />
      <Animated.View style={[{ position: 'absolute', left: width / 2 - SIZE, top: cy - SIZE, width: SIZE * 2, height: SIZE * 2, borderRadius: SIZE, borderWidth: 1.5, borderColor: '#fff' }, rim2]} />
      {[g3, g2, g1].map((st, i) => (
        <Animated.View key={i} style={[{ position: 'absolute', left: cx, top: 0, width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: 'rgba(255,255,255,0.9)' }, st]} />
      ))}
      <Animated.View style={[{ position: 'absolute', left: cx, top: 0, width: SIZE }, main]}>
        <Face chain={flight.chain} token={flight.token} size={SIZE} sweep={sweep} />
      </Animated.View>
      {flight.label ? (
        <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center' }, label]}>
          <T style={{ fontFamily: F.semibold, fontSize: 22, letterSpacing: -0.4, color: C.good }}>{flight.label}</T>
        </Animated.View>
      ) : null}
    </View>
  );
}
