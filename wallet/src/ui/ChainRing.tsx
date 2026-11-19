import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { chainToSun } from '../lib/chain-sun';
import { sunLevels, sunPaths } from '../lib/sun';
import { C } from './theme';
import { Logo } from './Logo';

/** The art for a Bitcoin or Ethereum address: the sun's rays, frame and colours, with the chain's own mark in the middle. */
export function useChainSun(chain: 'btc' | 'eth' | 'trx' | 'sol', address: string, size: number) {
  return useMemo(() => {
    const s = chainToSun(chain, address);
    if (!s) return null;
    return sunPaths(sunLevels(s.bytes, s.type), size);
  }, [chain, address, size]);
}

/** A Bitcoin or Ethereum address as a sun, in white, with the coin's real mark in the middle. */
export function ChainRing({ chain, address, size, color = C.text, centre }: { chain: 'btc' | 'eth' | 'trx' | 'sol'; address: string; size: number; color?: string; centre?: React.ReactNode }) {
  const art = useChainSun(chain, address, size);
  if (!art) return <View style={{ width: size, height: size }} />;
  const mid = size * 0.36;
  return (
    <View style={{ width: size, height: size }} accessibilityRole="image" accessibilityLabel={`Sun code for this ${chain === 'btc' ? 'Bitcoin' : chain === 'trx' ? 'Tron' : chain === 'sol' ? 'Solana' : 'Ethereum'} address`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={art.frame} stroke={color} strokeWidth={art.frameStroke} fill="none" />
        <Path d={art.each.slice(1).join('')} stroke={color} strokeWidth={art.stroke} strokeLinecap="round" fill="none" />
        <Path d={art.each[0]} stroke={color} strokeWidth={art.stroke * 1.15} strokeLinecap="round" fill="none" />
      </Svg>
      <View style={{ position: 'absolute', left: (size - mid) / 2, top: (size - mid) / 2 }} pointerEvents="none">
        {centre ?? <Logo id={chain} size={mid} />}
      </View>
    </View>
  );
}
