import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { SURFACE, Watermark, type CardKind } from './WalletCards';
import { T } from './Text';
import { Digits } from './Digits';
import { Skeleton } from './Skeleton';
import { Logo } from './Logo';
import { CoinLogo, TokenLogo } from './CoinLogo';
import { F } from './theme';
import type { LogoId } from './logos';

export interface NeonData {
  /** which rim colours */
  rim: string;
  title: string;
  sub?: string;
  balance: string;
  unit: string;
  /** the second line: the fiat value on mainnet, or "Testnet · no market value" */
  note?: string;
  /** the whole coin mark, top right */
  mark: { kind: 'lyx' } | { kind: 'logo'; id: LogoId } | { kind: 'token'; symbol: string; seed: string };
  address?: string;
}

const R = 26;

/** A credit card is 85.6 by 54 mm, so every card in the wallet is this shape. */
export const CARD_RATIO = 1.586;
export const cardHeight = (width: number) => Math.round(width / CARD_RATIO);

export function NeonCard({ c, width, height, hide }: { c: NeonData; width: number; height?: number; hide?: boolean }) {
  const h = height ?? cardHeight(width);
  const kind: CardKind = (c.rim in SURFACE ? c.rim : 'gr') as CardKind;
  const s = SURFACE[kind];
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [whole, dec] = c.balance.includes('.') ? [c.balance.slice(0, c.balance.indexOf('.')), c.balance.slice(c.balance.indexOf('.'))] : [c.balance, ''];
  const numeric = /^[\d,]+$/.test(whole) && /^(\.\d+)?$/.test(dec);
  const big = { fontFamily: F.medium, fontSize: 40, lineHeight: 48, letterSpacing: -1.8 } as const;
  const small = { fontFamily: F.regular, fontSize: 23, lineHeight: 30, letterSpacing: -0.6 } as const;
  const mark = Math.min(46, Math.round(h * 0.2));
  const logo = c.mark.kind === 'logo' ? c.mark.id : undefined;
  return (
    <View style={{ width, height: h, borderRadius: R, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 10 }}>
      <Svg width={width} height={h} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            {s.stops.map(([col, o]) => <Stop key={o} offset={o} stopColor={col} />)}
          </LinearGradient>
          <RadialGradient id={`p${id}`} cx="0.14" cy="0" r="0.75">
            <Stop offset="0" stopColor="#fff" stopOpacity="0.18" />
            <Stop offset="1" stopColor="#fff" stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id={`h${id}`} x1="0" y1="0" x2="0.55" y2="1">
            <Stop offset="0" stopColor="#fff" stopOpacity="0.2" />
            <Stop offset="0.55" stopColor="#fff" stopOpacity="0.03" />
            <Stop offset="1" stopColor="#fff" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id={`d${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000" stopOpacity="0.38" />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={h} fill={`url(#g${id})`} />
        <Rect width={width} height={h} fill={`url(#p${id})`} />
        {/* a soft fall of light from the top left, with no hard edge */}
        <Rect width={width} height={h} fill={`url(#h${id})`} />
        <Rect y={h * 0.55} width={width} height={h * 0.45} fill={`url(#d${id})`} />
      </Svg>
      <Watermark kind={kind} logo={logo} h={h} />
      {/* stops short of the coin mark so a long network name never runs under it */}
      <View style={{ position: 'absolute', left: 22, top: 24, right: mark + 44 }}>
        <T numberOfLines={1} style={{ fontFamily: F.semibold, fontSize: 12, letterSpacing: 1.8, color: s.ink }}>{c.title.toUpperCase()}</T>
        {c.sub ? <T numberOfLines={1} style={{ fontFamily: F.regular, fontSize: 12, color: s.sub, paddingTop: 3 }}>{c.sub}</T> : null}
      </View>
      <View style={{ position: 'absolute', right: 20, top: 20 }}>
        {c.mark.kind === 'lyx' ? <CoinLogo chain="lyx" size={mark} /> : c.mark.kind === 'token' ? <TokenLogo symbol={c.mark.symbol} seed={c.mark.seed} size={mark} /> : <Logo id={c.mark.id} size={mark} />}
      </View>
      <View style={{ position: 'absolute', left: 22, right: 18, bottom: 46, flexDirection: 'row', alignItems: 'flex-end', overflow: 'hidden' }}>
        {hide ? (
          <T style={{ ...big, color: s.ink }}>••••</T>
        ) : !c.balance ? (
          <View style={{ height: 48, justifyContent: 'center' }}><Skeleton w={150} h={30} r={10} /></View>
        ) : numeric ? (
          <>
            <Digits text={whole} intro style={big} color={s.ink} />
            {dec ? <Digits text={dec} intro style={small} color={s.sub} /> : null}
          </>
        ) : (
          <T style={{ ...big, color: s.ink }}>{c.balance}</T>
        )}
        <T style={{ fontFamily: F.medium, fontSize: 14, color: s.sub, paddingBottom: 10, paddingLeft: 7 }}>{c.unit}</T>
      </View>
      {c.note ? <T numberOfLines={1} style={{ position: 'absolute', left: 22, right: 18, bottom: 20, fontFamily: F.regular, fontSize: 12.5, color: s.sub }}>{c.note}</T> : null}
    </View>
  );
}
