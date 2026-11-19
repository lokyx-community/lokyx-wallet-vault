import { useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop, SvgXml } from 'react-native-svg';
import { LOGOS } from './logos';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { T } from './Text';
import { Logo } from './Logo';
import { Press } from './controls';
import { Digits } from './Digits';
import { Skeleton } from './Skeleton';
import { F } from './theme';
import type { LogoId } from './logos';

export type CardKind = 'lyx' | 'bk' | 'gr' | 'btc' | 'eth' | 'sol' | 'trx' | 'usdt' | 'usdc' | 'base' | 'arb' | 'op' | 'pol' | 'bnb' | 'avax';

export type Surf = { stops: [string, number][]; ink: string; sub: string; edge: string; glow: number; mark: number };

// Each coin wears its own colour, lit from the top left and deepening to the bottom right, with its mark large
// and faint in the corner. LOKYX is graphite and black, never blue. Coins not in the wallet stay graphite.
const WHITE = { ink: '#FFFFFF', sub: 'rgba(255,255,255,0.72)' };
export const SURFACE: Record<CardKind, Surf> = {
  lyx: { stops: [['#80808A', 0], ['#2C2C32', 0.5], ['#040405', 1]], ...WHITE, edge: 'rgba(255,255,255,0.22)', glow: 0.16, mark: 0.2 },
  bk: { stops: [['#2A2A2E', 0], ['#0D0D0F', 0.55], ['#000000', 1]], ink: '#F5F5F7', sub: 'rgba(245,245,247,0.55)', edge: 'rgba(255,255,255,0.18)', glow: 0.16, mark: 0.17 },
  gr: { stops: [['#4B4B52', 0], ['#25252A', 0.55], ['#131316', 1]], ink: '#F5F5F7', sub: 'rgba(245,245,247,0.58)', edge: 'rgba(255,255,255,0.2)', glow: 0.16, mark: 0.17 },
  btc: { stops: [['#FFB23A', 0], ['#F58A0A', 0.45], ['#8F4300', 1]], ...WHITE, edge: 'rgba(255,224,176,0.4)', glow: 0.2, mark: 0.2 },
  eth: { stops: [['#8FA0FF', 0], ['#4658EA', 0.45], ['#161F85', 1]], ...WHITE, edge: 'rgba(206,214,255,0.4)', glow: 0.2, mark: 0.2 },
  sol: { stops: [['#B27DFF', 0], ['#4F7FEA', 0.5], ['#0FE08C', 1]], ...WHITE, edge: 'rgba(224,214,255,0.4)', glow: 0.2, mark: 0.2 },
  trx: { stops: [['#FF3A58', 0], ['#D2102F', 0.45], ['#6E0416', 1]], ...WHITE, edge: 'rgba(255,200,208,0.4)', glow: 0.2, mark: 0.2 },
  usdt: { stops: [['#3FD9AA', 0], ['#14A57A', 0.45], ['#0A5A44', 1]], ...WHITE, edge: 'rgba(200,250,232,0.38)', glow: 0.2, mark: 0.2 },
  base: { stops: [['#6B97FF', 0], ['#0052FF', 0.5], ['#001A66', 1]], ...WHITE, edge: 'rgba(190,210,255,0.4)', glow: 0.2, mark: 0.2 },
  arb: { stops: [['#52B9FF', 0], ['#1F6FA8', 0.5], ['#0B1B2E', 1]], ...WHITE, edge: 'rgba(190,230,255,0.4)', glow: 0.2, mark: 0.2 },
  op: { stops: [['#FF6A7B', 0], ['#D80F28', 0.5], ['#5A0510', 1]], ...WHITE, edge: 'rgba(255,200,208,0.4)', glow: 0.2, mark: 0.2 },
  pol: { stops: [['#B58BFF', 0], ['#7A3FE0', 0.5], ['#2B1066', 1]], ...WHITE, edge: 'rgba(224,206,255,0.4)', glow: 0.2, mark: 0.2 },
  bnb: { stops: [['#E8B93A', 0], ['#B07C0A', 0.5], ['#4D3300', 1]], ...WHITE, edge: 'rgba(255,236,170,0.4)', glow: 0.2, mark: 0.2 },
  avax: { stops: [['#FF7C7D', 0], ['#E84142', 0.5], ['#5A0F10', 1]], ...WHITE, edge: 'rgba(255,204,204,0.4)', glow: 0.2, mark: 0.2 },
  usdc: { stops: [['#4DA3FF', 0], ['#1E6FD0', 0.45], ['#0E3E80', 1]], ...WHITE, edge: 'rgba(206,228,255,0.38)', glow: 0.2, mark: 0.2 },
};
const COLOURED: Partial<Record<LogoId, CardKind>> = { btc: 'btc', eth: 'eth', sol: 'sol', trx: 'trx', usdt: 'usdt', usdc: 'usdc' };
/** The card a coin wears once it is in the wallet: its own colour if it has one, graphite if not. */
export const kindFor = (logo: LogoId | null | undefined): CardKind => (logo && COLOURED[logo]) || 'gr';
export const inkOf = (k: CardKind) => SURFACE[k].ink;

/** The LOKYX mark as a small badge: a black disc with the white ring, like the other coins' round logos. */
function LyxBadge({ size }: { size: number }) {
  const ring = 'M50 16A34 34 0 1 0 84 50';
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={50} fill="#000" />
      <G transform="translate(14 14) scale(0.72)">
        <Path d={ring} stroke="#fff" strokeWidth={15} strokeLinecap="round" fill="none" />
        <Circle cx={74} cy={26} r={8} fill="#fff" />
      </G>
    </Svg>
  );
}

/** A coin's round logo as the card's badge. */
function Badge({ kind, logo, size }: { kind: CardKind; logo?: LogoId; size: number }) {
  if (kind === 'lyx') return <LyxBadge size={size} />;
  return logo ? <Logo id={logo} size={size} /> : null;
}

/** The coin's mark large and faint over a darker disc, cropped by the bottom right corner. */
export function Watermark({ kind, logo, h }: { kind: CardKind; logo?: LogoId; h: number }) {
  const size = Math.round(h * 0.95);
  const disc = Math.round(h * 1.3);
  const ring = 'M50 16A34 34 0 1 0 84 50';
  const glyph = useMemo(() => {
    if (!logo) return '';
    const xml = LOGOS[logo];
    // keep only the white drawing; if the coin's drawing is coloured instead (Solana), drop the disc and paint the drawing white
    const white = xml.replace(/#[0-9A-Fa-f]{6}\b/g, (m) => (/^#F{6}$/i.test(m) ? '#FFFFFF' : 'none'));
    if (white.includes('#FFFFFF')) return white;
    return xml.replace(/<circle[^>]*\/>/g, '').replace(/#[0-9A-Fa-f]{6}\b/g, '#FFFFFF');
  }, [logo]);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', right: -disc * 0.22, bottom: -disc * 0.3, width: disc, height: disc, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: disc, height: disc, borderRadius: disc / 2, backgroundColor: 'rgba(0,0,0,0.14)' }} />
      {kind === 'lyx' ? (
        <Svg width={size} height={size} viewBox="0 0 100 100" opacity={0.2}>
          <Path d={ring} stroke="#fff" strokeWidth={16} strokeLinecap="round" fill="none" />
          <Circle cx={74} cy={26} r={8.5} fill="#fff" />
        </Svg>
      ) : logo ? (
        <View style={{ opacity: 0.2 }}><SvgXml xml={glyph} width={size} height={size} /></View>
      ) : null}
    </View>
  );
}

function Surface({ kind, w, h, radius, badge, logo, peek }: { kind: CardKind; w: number; h: number; radius: number; badge: number; logo?: LogoId; peek?: SharedValue<number> }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const s = SURFACE[kind];
  const badgeFade = useAnimatedStyle(() => ({ opacity: peek ? 1 - peek.value : 1 }));
  return (
    <>
      <Svg style={StyleSheet.absoluteFill} width={w} height={h}>
        <Defs>
          <LinearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            {s.stops.map(([c, o]) => <Stop key={o} offset={o} stopColor={c} />)}
          </LinearGradient>
        </Defs>
        <Rect width={w} height={h} fill={`url(#g${id})`} />
      </Svg>
      {badge > 0 ? <Watermark kind={kind} logo={logo} h={h} /> : null}
      {badge > 0 ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', right: 20, top: 18 }, badgeFade]}>
          <Badge kind={kind} logo={logo} size={badge} />
        </Animated.View>
      ) : null}
    </>
  );
}

export interface CardData {
  kind: CardKind;
  logo?: LogoId;
  title: string;
  sub?: string;
  balance: string;
  unit: string;
  address?: string;
  tag?: string;
}

/** The big card: the LOKYX hero on Home, and each coin's own card on its screen. */
export function WalletCard({ c, width, height: _h, hide, onPress, grey, peek }: { c: CardData; width: number; height?: number; hide?: boolean; onPress?: () => void; grey?: boolean; peek?: SharedValue<number> }) {
  const height = Math.round(width / 1.586); // credit card proportions
  const kind: CardKind = grey && c.kind !== 'lyx' ? 'gr' : c.kind;
  const s = SURFACE[kind];
  const full = useAnimatedStyle(() => ({ opacity: peek ? 1 - peek.value : 1 }));
  const strip = useAnimatedStyle(() => ({ opacity: peek ? peek.value : 0 }));
  const body = (
    <View style={{ width, height, borderRadius: 26, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 22, shadowOffset: { width: 0, height: 14 }, elevation: 12 }}>
      <Surface kind={kind} w={width} h={height} radius={26} badge={Math.round(Math.min(height * 0.21, 36))} logo={c.logo} peek={peek} />
      <Animated.View style={[StyleSheet.absoluteFill, full]}>
      <View style={{ position: 'absolute', left: 22, top: 20 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 12, letterSpacing: 1.6, color: s.ink }}>{c.title.toUpperCase()}</T>
        {c.sub ? <T style={{ fontFamily: F.regular, fontSize: 12, color: s.sub, paddingTop: 3 }}>{c.sub}</T> : null}
      </View>
      <View style={{ position: 'absolute', left: 22, bottom: 32 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
          {!hide && /^[\d,.]+$/.test(c.balance || '') ? (
            // the number rolls up from zero when the card appears, and again whenever the balance changes
            <Digits text={c.balance} intro style={{ fontFamily: F.regular, fontSize: 34, lineHeight: 42, letterSpacing: -1.2 }} color={s.ink} />
          ) : !hide && !c.balance ? (
            <View style={{ height: 42, justifyContent: 'center' }}><Skeleton w={150} h={28} r={10} /></View>
          ) : (
            <T style={{ fontFamily: F.regular, fontSize: 34, lineHeight: 42, letterSpacing: -1.2, color: s.ink, fontVariant: ['tabular-nums'] }}>{hide ? '••••' : c.balance}</T>
          )}
          <T style={{ fontFamily: F.medium, fontSize: 14, color: s.sub, paddingBottom: 8 }}>{c.unit}</T>
        </View>
      </View>
      <View style={{ position: 'absolute', left: 22, right: 22, bottom: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
        <T style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: 0.6, color: s.sub }}>{c.address ? `${c.address.slice(0, 8)}…${c.address.slice(-6)}` : ''}</T>
        {c.tag ? <T style={{ fontFamily: F.semibold, fontSize: 10, letterSpacing: 1.4, color: s.sub }}>{c.tag.toUpperCase()}</T> : null}
      </View>
      </Animated.View>
      {peek ? (
        // when the card sits behind others only its top strip shows: name on the left, balance and a small mark on the right
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, strip]}>
          <T style={{ position: 'absolute', left: 22, top: 20, fontFamily: F.semibold, fontSize: 12, letterSpacing: 1.6, color: s.ink }}>{c.title.toUpperCase()}</T>
          <T style={{ position: 'absolute', right: 66, top: 17, fontFamily: F.medium, fontSize: 17, letterSpacing: -0.3, color: s.ink, fontVariant: ['tabular-nums'] }}>{hide ? '••••' : `${c.balance || '–'} ${c.unit}`}</T>
          <View style={{ position: 'absolute', right: 20, top: 14 }}>
            <Badge kind={kind} logo={c.logo} size={30} />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
  return onPress ? <Press onPress={onPress} scaleTo={0.985} accessibilityLabel={`${c.title} card`}>{body}</Press> : body;
}

/** A coin in the list: one slim card with the coin's real logo on the left. */
export function CoinRow({ c, width, hide, onPress, grey, mark }: { c: CardData; width: number; hide?: boolean; onPress?: () => void; grey?: boolean; mark?: React.ReactNode }) {
  const kind: CardKind = grey ? 'gr' : c.kind === 'lyx' ? 'bk' : c.kind;
  const s = SURFACE[kind];
  const h = 66;
  return (
    <Press onPress={onPress} scaleTo={0.985} accessibilityLabel={c.title}>
      <View style={{ width, height: h, borderRadius: 22, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 6 }}>
        <Surface kind={kind} w={width} h={h} radius={22} badge={0} logo={c.logo} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 13, paddingLeft: 13, paddingRight: 16 }}>
          {mark ?? (c.logo ? <Logo id={c.logo} size={36} grey={grey} /> : null)}
          <View style={{ flex: 1 }}>
            <T style={{ fontFamily: F.semibold, fontSize: 15.5, letterSpacing: -0.2, color: s.ink }} numberOfLines={1}>{c.title}</T>
            <T style={{ fontFamily: F.regular, fontSize: 12, color: s.sub, paddingTop: 1 }} numberOfLines={1}>{c.sub}</T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            {!hide && !c.balance ? <Skeleton w={52} h={15} r={6} /> : <T style={{ fontFamily: F.medium, fontSize: 15.5, color: s.ink, fontVariant: ['tabular-nums'] }}>{hide ? '•••' : c.balance}</T>}
            <T style={{ fontFamily: F.regular, fontSize: 11.5, color: s.sub, paddingTop: 1 }}>{c.unit}</T>
          </View>
        </View>
      </View>
    </Press>
  );
}
