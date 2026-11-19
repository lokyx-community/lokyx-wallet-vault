import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Icon, type IconName } from './Icon';
import { T } from './Text';
import { Button } from './controls';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';

/** An empty screen that says what goes here and what to do, in one calm card, never a red box. */
export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: { label: string; onPress: () => void } }) {
  return (
    <Animated.View entering={FadeIn.duration(DUR.slow).easing(EASE_OUT)} style={{ alignItems: 'center', gap: 10, paddingVertical: 56, paddingHorizontal: 28 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 1.5, borderColor: C.line2, alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
        <Icon name={icon} size={28} color={C.sub} width={1.7} />
      </View>
      <T style={{ fontFamily: F.semibold, fontSize: 17 }}>{title}</T>
      <T v="sub" dim style={{ textAlign: 'center', lineHeight: 20 }}>{body}</T>
      {action ? <View style={{ alignSelf: 'stretch', paddingTop: 10 }}><Button title={action.label} kind="line" onPress={action.onPress} /></View> : null}
    </Animated.View>
  );
}
