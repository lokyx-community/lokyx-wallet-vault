import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { Press } from './controls';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { TokenLogo } from './CoinLogo';
import { ChainRing } from './ChainRing';
import { RingCode } from './RingCode';
import { QrDots } from './Qr';
import { LyxBadge, SURFACE, Watermark, kindFor, type CardKind } from './WalletCards';
import { F } from './theme';
import type { LogoId } from './logos';
import { shortCard, type RecvChain } from '../lib/receive-core';

export interface CardToken {
  symbol: string;
  logo?: LogoId | null;
  contract?: string;
}

/** A thin outline in the token's own colour when it has one, so a chosen token is seen at a glance. */
const tintOf = (logo?: LogoId | null): string | null => {
  const k = kindFor(logo);
  return k === 'gr' ? null : SURFACE[k].stops[1][0];
};

/** The coin's round mark, with the chain's small mark on its corner when it is a token. */
function Mark({ chain, kind, logo, token, size }: { chain: RecvChain; kind: CardKind; logo?: LogoId; token?: CardToken; size: number }) {
  const chainMark = kind === 'lyx' ? <LyxBadge size={size} /> : logo ? <Logo id={logo} size={size} /> : null;
  if (!token) return chainMark;
  const small = Math.round(size * 0.46);
  return (
    <View style={{ width: size, height: size }}>
      {token.logo ? <Logo id={token.logo} size={size} /> : <TokenLogo symbol={token.symbol} seed={token.contract ?? token.symbol} size={size} />}
      <View style={{ position: 'absolute', right: -size * 0.12, bottom: -size * 0.12, width: small, height: small, borderRadius: small / 2, backgroundColor: '#0B0A07', alignItems: 'center', justifyContent: 'center' }}>
        {logo ? <Logo id={logo} size={Math.round(small * 0.86)} /> : null}
      </View>
    </View>
  );
}

/**
 * One coin's receive card: its own colour like on Home, the address as a round-dot QR or as the LOKYX ring (the plate turns over),
 * and the address below. Picking a token puts the token on the card: its name, its mark with the chain's badge, a thin outline in its colour.
 */
export function ReceiveCard({
  chain, kind, logo, title, net, address, qr, face, token, width, sunOk, onFlip, onCopy,
}: {
  chain: RecvChain; kind: CardKind; logo?: LogoId; title: string; net: string; address: string; qr: string; face: 'qr' | 'ring';
  token?: CardToken; width: number; sunOk: boolean; onFlip: () => void; onCopy: () => void;
}) {
  const height = Math.round(width * 1.28);
  const s = SURFACE[kind];
  const plate = Math.round(width * 0.66);
  const tint = token ? tintOf(token.logo) : null;
  const key = token ? `${token.symbol}:${token.contract ?? ''}` : '';

  const flip = useSharedValue(face === 'ring' && sunOk ? 1 : 0);
  useEffect(() => {
    flip.value = withTiming(face === 'ring' && sunOk ? 1 : 0, { duration: 560 });
  }, [face, sunOk, flip]);
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = 0.93;
    pulse.value = withSpring(1, { damping: 14, stiffness: 190 });
  }, [key, pulse]);
  const front = useAnimatedStyle(() => ({ transform: [{ perspective: 800 }, { rotateY: `${flip.value * 180}deg` }, { scale: pulse.value }] }));
  const back = useAnimatedStyle(() => ({ transform: [{ perspective: 800 }, { rotateY: `${flip.value * 180 + 180}deg` }, { scale: pulse.value }] }));

  const ringChain = chain === 'lyx' ? null : chain;
  const ringSize = Math.round(plate * 0.93);
  const faceBase = { position: 'absolute' as const, width: plate, height: plate, alignItems: 'center' as const, justifyContent: 'center' as const, backfaceVisibility: 'hidden' as const, borderWidth: tint ? 2 : 0, borderColor: tint ?? 'transparent' };

  return (
    <View style={{ width, height, borderRadius: 34, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 26, shadowOffset: { width: 0, height: 16 }, elevation: 12 }}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            {s.stops.map(([c, o]) => <Stop key={o} offset={o} stopColor={c} />)}
          </LinearGradient>
          <LinearGradient id="sheen" x1="0" y1="0" x2="0.7" y2="0.5">
            <Stop offset={0} stopColor="#fff" stopOpacity={0.2} />
            <Stop offset={1} stopColor="#fff" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#g)" />
        <Rect width={width} height={height} fill="url(#sheen)" />
      </Svg>
      <Watermark kind={kind} logo={logo} h={Math.round(height * 0.5)} />
      <View style={{ position: 'absolute', left: 22, top: 22, right: 22, flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <Mark chain={chain} kind={kind} logo={logo} token={token} size={30} />
        <Animated.View key={key} entering={FadeIn.duration(260)}>
          <T style={{ fontFamily: F.semibold, fontSize: 16, letterSpacing: -0.2, color: s.ink }}>{token ? token.symbol : title}</T>
          <T style={{ fontSize: 10, letterSpacing: 1.8, color: s.sub, marginTop: 1 }}>{token ? `ON ${net.toUpperCase()}` : net.toUpperCase()}</T>
        </Animated.View>
      </View>

      <View style={{ position: 'absolute', top: Math.round(height * 0.2), left: (width - plate) / 2, width: plate, height: plate }}>
        <Press haptic={false} scaleTo={0.99} disabled={!sunOk} onPress={onFlip} accessibilityLabel={face === 'ring' ? 'Show the QR code for other wallets' : 'Show the LOKYX ring'} style={{ width: plate, height: plate }}>
          <Animated.View style={[faceBase, { borderRadius: plate * 0.27, backgroundColor: '#F7F5F0' }, front]}>
            <QrDots value={qr} size={Math.round(plate * 0.82)} centre={(box) => (
              <View style={{ width: box, height: box, borderRadius: box * 0.3, backgroundColor: '#F7F5F0', alignItems: 'center', justifyContent: 'center' }}>
                <Mark chain={chain} kind={kind} logo={logo} token={token} size={Math.round(box * 0.74)} />
              </View>
            )} />
          </Animated.View>
          <Animated.View style={[faceBase, { borderRadius: plate / 2, backgroundColor: '#07070A' }, back]}>
            {chain === 'lyx' ? (
              <RingCode address={address} size={ringSize} color="#FFFFFF" />
            ) : ringChain ? (
              <ChainRing chain={ringChain} address={address} size={ringSize} color="#FFFFFF" centre={<Mark chain={chain} kind={kind} logo={logo} token={token} size={Math.round(ringSize * 0.34)} />} />
            ) : null}
          </Animated.View>
        </Press>
      </View>

      <View style={{ position: 'absolute', left: 0, right: 0, top: Math.round(height * 0.2) + plate + 18, alignItems: 'center', gap: 10 }}>
        {token ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.3)' }}>
            <T style={{ fontFamily: F.medium, fontSize: 12.5, color: s.ink }}>{`${token.symbol} only`}</T>
          </View>
        ) : null}
        <Press haptic={false} onPress={onCopy} accessibilityLabel="Copy address" style={{ flexDirection: 'row', alignItems: 'center', gap: 9, height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.28)' }}>
          <T v="mono" style={{ fontSize: 12.5, color: s.ink }}>{shortCard(address)}</T>
          <Icon name="copy" size={14} color={s.sub} width={2} />
        </Press>
        <T style={{ fontSize: 11.5, color: s.sub, textAlign: 'center', paddingHorizontal: 18 }} numberOfLines={1}>
          {token?.contract ? `${token.symbol} contract ${shortCard(token.contract).replace(/ … /, '…')}` : face === 'ring' && sunOk ? 'The LOKYX wallet reads the ring' : 'Scan with any wallet'}
        </T>
      </View>
    </View>
  );
}
