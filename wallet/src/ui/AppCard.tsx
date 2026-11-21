import { useEffect, useId, useRef, type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient as LG, Rect, Stop } from 'react-native-svg';
import { AppGlyph, type GlyphName } from './AppGlyph';
import { T } from './Text';
import { C, F } from './theme';
import { takeLift, type Rect as LiftRect } from '../lib/lift';

export type AppKind = 'apps' | 'shared' | 'vault' | 'capsule' | 'gift' | 'mint' | 'jar' | 'mining' | 'markets';

type Tint = readonly [string, string, string];
/** One card per app: its name, its line, its tint, and the mark that sits faintly behind the numbers. */
export const APP: Record<AppKind, { title: string; sub: string; tint: Tint; glyph: GlyphName }> = {
  apps: { title: 'APPS WALLET', sub: 'FOR APPS AND WEBSITES', tint: ['rgba(255,255,255,0.26)', 'rgba(255,255,255,0.07)', 'rgba(255,255,255,0.14)'], glyph: 'lock' },
  shared: { title: 'SHARED ACCOUNTS', sub: 'PAY WHEN ENOUGH AGREE', tint: ['rgba(190,195,210,0.34)', 'rgba(60,64,78,0.5)', 'rgba(140,146,162,0.4)'], glyph: 'shared' },
  vault: { title: 'VAULT', sub: 'A LIMIT AND A WAIT', tint: ['rgba(120,124,140,0.42)', 'rgba(30,32,40,0.62)', 'rgba(70,74,90,0.5)'], glyph: 'vault' },
  capsule: { title: 'NEPTUNE TIME CAPSULE', sub: 'SEALED UNTIL A DAY', tint: ['rgba(110,125,170,0.4)', 'rgba(18,22,40,0.66)', 'rgba(60,70,110,0.5)'], glyph: 'capsule' },
  gift: { title: 'GIFT CARDS', sub: 'BTC · USDT · USDC', tint: ['rgba(190,195,210,0.32)', 'rgba(60,64,78,0.5)', 'rgba(120,125,140,0.4)'], glyph: 'gift' },
  mint: { title: 'MINT A TOKEN', sub: 'ANY CHAIN', tint: ['rgba(255,255,255,0.26)', 'rgba(255,255,255,0.07)', 'rgba(255,255,255,0.14)'], glyph: 'token' },
  jar: { title: 'SAVINGS JAR', sub: 'LOCKED UNTIL A DAY', tint: ['rgba(255,255,255,0.26)', 'rgba(255,255,255,0.07)', 'rgba(255,255,255,0.14)'], glyph: 'jar' },
  mining: { title: 'MINING', sub: 'EARN LYX WITH A COMPUTER', tint: ['rgba(120,124,140,0.42)', 'rgba(30,32,40,0.62)', 'rgba(70,74,90,0.5)'], glyph: 'mining' },
  markets: { title: 'MARKETS', sub: 'PREDICT, WITH PLAY MONEY', tint: ['rgba(110,125,170,0.4)', 'rgba(18,22,40,0.66)', 'rgba(60,70,110,0.5)'], glyph: 'markets' },
};

export interface AppCardProps {
  kind: AppKind;
  width: number;
  height: number;
  /** the big line at the bottom left, like "$312" or "2" */
  big?: string;
  /** the grey unit after it, like "LYX" */
  unit?: string;
  /** one quiet line under it */
  small?: string;
  /** 0 to 1: a thin bar along the foot, for a limit used or time passed */
  bar?: number;
  /** top right: a small chip */
  corner?: ReactNode;
  /** anything drawn over the card, like a row of coin marks */
  children?: ReactNode;
}

/** The glass card every app wears: a tint, a faint mark behind, the name in wide letters, and the numbers that matter. */
export function AppCard({ kind, width, height, big, unit, small, bar, corner, children }: AppCardProps) {
  const a = APP[kind];
  const id = 'g' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const tall = height > 200;
  const r = tall ? 34 : 30;
  const d = Math.round(Math.min(width, height) * 1.05);
  return (
    <View style={{ width, height, borderRadius: r, overflow: 'hidden', borderWidth: 0.6, borderColor: 'rgba(255,255,255,0.3)' }}>
      <Svg width={width} height={height} style={{ position: 'absolute' }}>
        <Defs>
          <LG id={id + 't'} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={a.tint[0]} />
            <Stop offset="0.6" stopColor={a.tint[1]} />
            <Stop offset="1" stopColor={a.tint[2]} />
          </LG>
          <LG id={id + 's'} x1="0" y1="0" x2="0.6" y2="1">
            <Stop offset="0" stopColor="#fff" stopOpacity={0.18} />
            <Stop offset="0.4" stopColor="#fff" stopOpacity={0} />
          </LG>
        </Defs>
        <Rect width={width} height={height} fill={`url(#${id}t)`} />
        <Rect width={width} height={height} fill={`url(#${id}s)`} />
      </Svg>
      <View pointerEvents="none" style={{ position: 'absolute', right: -d * 0.22, bottom: -d * 0.26, opacity: 0.16 }}>
        <AppGlyph name={a.glyph} size={d} color="#fff" fill={0.4} />
      </View>
      <T style={{ position: 'absolute', left: 22, top: 20, fontFamily: F.semibold, fontSize: 12, letterSpacing: 6, color: C.text }} numberOfLines={1}>{a.title}</T>
      <T style={{ position: 'absolute', left: 22, top: 39, fontFamily: F.medium, fontSize: 9.5, letterSpacing: 1.8, color: 'rgba(255,255,255,0.72)' }} numberOfLines={1}>{a.sub}</T>
      {corner ? <View style={{ position: 'absolute', right: 18, top: 17 }}>{corner}</View> : null}
      {big ? (
        <T style={{ position: 'absolute', left: 22, right: 22, bottom: bar !== undefined ? 50 : small ? 44 : 22, fontFamily: F.medium, fontSize: tall ? 40 : 36, letterSpacing: -1.6, fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>
          {big}
          {unit ? <T style={{ fontFamily: F.regular, fontSize: 15, letterSpacing: 0, color: 'rgba(255,255,255,0.75)' }}>{`  ${unit}`}</T> : null}
        </T>
      ) : null}
      {small ? <T style={{ position: 'absolute', left: 22, right: 22, bottom: bar !== undefined ? 24 : 22, fontSize: 13, color: 'rgba(255,255,255,0.78)' }} numberOfLines={1}>{small}</T> : null}
      {bar !== undefined ? (
        <View style={{ position: 'absolute', left: 22, right: 22, bottom: 22, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.16)' }}>
          <View style={{ width: `${Math.round(Math.max(0, Math.min(1, bar)) * 100)}%`, height: 4, borderRadius: 2, backgroundColor: '#fff' }} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

export const WIDE_H = 150;

/** A small chip for a card's top right corner. */
export function CardChip({ text, dot }: { text: string; dot?: boolean }) {
  return (
    <View style={{ height: 24, paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.14)', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} /> : null}
      <T style={{ fontSize: 11, color: '#E5E5EA' }}>{text}</T>
    </View>
  );
}

/**
 * The app's card on its own page. When the page was opened from a card on the Apps tab, it starts as that tall card,
 * exactly where it sat, and shrinks into its wide shape at the top, the two crossfading on the way. Same move as Home.
 */
export function AppHero({ kind, width, big, unit, small, bar, corner, children }: Omit<AppCardProps, 'height'>) {
  const still = useReducedMotion();
  const from = useRef<LiftRect | null | undefined>(undefined);
  if (from.current === undefined) from.current = takeLift();
  const f0 = from.current;
  const ref = useRef<View>(null);
  const p = useSharedValue(f0 && !still ? 0 : 1);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const started = useRef(false);
  const onLayout = () => {
    if (!f0 || still || started.current) return;
    started.current = true;
    ref.current?.measureInWindow((x, y) => {
      dx.value = f0.x - x;
      dy.value = f0.y - y;
      p.value = 0;
      p.value = withTiming(1, { duration: 620, easing: Easing.bezier(0.22, 1, 0.36, 1) });
    });
  };
  useEffect(() => () => { from.current = null; }, []);
  const box = useAnimatedStyle(() => {
    const w0 = f0 ? f0.w : width;
    const h0 = f0 ? f0.h : WIDE_H;
    return { width: w0 + (width - w0) * p.value, height: h0 + (WIDE_H - h0) * p.value, transform: [{ translateX: dx.value * (1 - p.value) }, { translateY: dy.value * (1 - p.value) }] };
  });
  const tall = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, p.value * 2.6) }));
  const wide = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, (p.value - 0.25) * 2.2)) }));
  const props = { kind, big, unit, small, bar, corner };
  if (!f0 || still) return <AppCard {...props} width={width} height={WIDE_H}>{children}</AppCard>;
  return (
    <View style={{ height: WIDE_H }}>
      <Animated.View ref={ref} collapsable={false} onLayout={onLayout} style={[{ borderRadius: 34, overflow: 'hidden', zIndex: 2 }, box]}>
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, wide]}>
          <AppCard {...props} width={width} height={WIDE_H}>{children}</AppCard>
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, tall]} pointerEvents="none">
          <AppCard {...props} width={f0.w} height={f0.h} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** The hero for a page with 20 px margins: the card's width follows the screen. */
export function PageHero(p: Omit<AppCardProps, 'height' | 'width'>) {
  const { width } = useWindowDimensions();
  return <AppHero {...p} width={width - 40} />;
}
