import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from './Text';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';

/** A token that was just looked up: its symbol in a round badge, its name, and a line of detail. */
export function TokenFound({ symbol, name, detail }: { symbol: string; name?: string; detail?: string }) {
  return (
    <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 18, borderRadius: 26, backgroundColor: C.fill }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
        <T style={{ fontFamily: F.semibold, fontSize: symbol.length > 3 ? 13 : 16, color: C.inkText }}>{symbol.slice(0, 4)}</T>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 18 }}>{name || symbol}</T>
        {name ? <T v="sub" dim>{symbol}</T> : null}
        {detail ? <T v="caption" dim>{detail}</T> : null}
      </View>
    </Animated.View>
  );
}
