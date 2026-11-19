import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { T } from './Text';
import { Button } from './controls';
import { CoinLogo } from './CoinLogo';
import { Logo } from './Logo';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';
import { shortAddr } from '../lib/format';
import type { Found } from '../lib/scan';

const NAMES = { lyx: 'LOKYX', btc: 'Bitcoin', eth: 'Ethereum', sol: 'Solana', trx: 'Tron' } as const;

/** Where a found address goes next: the send screen of its coin, filled in. */
export function payRoute(f: Found, token?: string): string {
  if (f.chain === 'sol' || f.chain === 'trx') return `/xsend?chain=${f.chain}&to=${f.address}`;
  if (f.chain) return `/chain/send?chain=${f.chain}&to=${f.address}${f.amount ? `&amount=${f.amount}` : ''}${token ? `&token=${token}` : ''}${f.units ? `&units=${f.units}` : ''}`;
  return `/send?to=${f.address}${f.amount ? `&amount=${f.amount}` : ''}`;
}

/** The glass sheet that names who you are paying and what, shown after a scan or a tap. */
export function PaySheet({ found, bottom, token }: { found: Found; bottom: number; token?: string }) {
  const chain = found.chain ?? 'lyx';
  return (
    <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)} style={{ position: 'absolute', left: 12, right: 12, bottom, borderRadius: 30, backgroundColor: 'rgba(22,22,26,0.94)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)', padding: 20, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {chain === 'sol' || chain === 'trx' ? <Logo id={chain} size={40} /> : <CoinLogo chain={chain} size={40} />}
        <View style={{ flex: 1 }}>
          <T v="callout">{`Pay ${shortAddr(found.address)}`}</T>
          <T v="sub" dim>{NAMES[chain]}</T>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(155,229,189,0.12)' }}>
          <T v="sub" color={C.good}>Right network</T>
        </View>
      </View>
      {found.amount ? <T style={{ fontFamily: F.regular, fontSize: 40, letterSpacing: -1.4, textAlign: 'center' }}>{found.amount}</T> : <T v="sub" dim style={{ textAlign: 'center' }}>You choose the amount next.</T>}
      <Button title={found.amount ? 'Pay' : 'Continue'} onPress={() => router.replace(payRoute(found, token))} />
    </Animated.View>
  );
}
