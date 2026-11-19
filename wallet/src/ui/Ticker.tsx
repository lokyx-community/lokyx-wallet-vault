import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useChain } from '../lib/chain';
import { T } from './Text';
import { Digits } from './Digits';
import { C, F } from './theme';

/** "Block 12,345 · 14s": a live line that ticks when a new block lands. */
export function BlockTicker() {
  const { info, error } = useChain();
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const ping = useSharedValue(0);
  useEffect(() => {
    if (info?.height) ping.value = withSequence(withTiming(1, { duration: 10 }), withTiming(0, { duration: 1400, easing: Easing.out(Easing.quad) }));
  }, [info?.height, ping]);
  const ring = useAnimatedStyle(() => ({ opacity: ping.value, transform: [{ scale: 1 + (1 - ping.value) * 2.2 }] }));
  const ok = !!info && !error;
  const age = info ? Math.max(0, Math.round(Date.now() / 1000 - info.bestTimestamp)) : 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityLabel={ok ? `Block ${info!.height}` : 'Offline'}>
      <View style={{ width: 8, height: 8, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: C.good }, ring]} />
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ok ? C.good : C.bad }} />
      </View>
      {ok ? (
        <>
          <T v="caption" dim>Block</T>
          <Digits text={info!.height.toLocaleString('en-US')} style={{ fontFamily: F.medium, fontSize: 12.5, lineHeight: 16 }} color={C.soft} />
          <T v="caption" color={C.faint}>· {age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`}</T>
        </>
      ) : (
        <T v="caption" dim>{error ? 'Offline' : 'Connecting…'}</T>
      )}
    </View>
  );
}
