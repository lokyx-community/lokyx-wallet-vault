import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Icon, type IconName } from './Icon';
import { Press } from './controls';
import { T } from './Text';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';

export type ActionItem = { icon: IconName; label: string; onPress: () => void };

/** A frosted pill under the main card. The first action (Send) is open with its name; the others are quiet icons. */
export function ActionRow({ items }: { items: ActionItem[] }) {
  const [main, ...rest] = items;
  return (
    <Animated.View entering={FadeInDown.delay(90).duration(DUR.slow).easing(EASE_OUT)} style={{ alignItems: 'center', paddingTop: 22 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 64, paddingHorizontal: 8, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.16)' }}>
        {main && (
          <Press onPress={main.onPress} accessibilityLabel={main.label} scaleTo={0.95} style={{ height: 48, paddingLeft: 16, paddingRight: 20, borderRadius: 24, backgroundColor: '#F4F4F6', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name={main.icon} size={20} color="#111" width={2.1} />
            <T style={{ fontFamily: F.semibold, fontSize: 15, color: '#111' }}>{main.label}</T>
          </Press>
        )}
        {rest.map((a) => (
          <Press key={a.label} onPress={a.onPress} accessibilityLabel={a.label} scaleTo={0.9} style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={a.icon} size={22} color={C.text} width={1.8} />
          </Press>
        ))}
      </View>
    </Animated.View>
  );
}
