import { View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { Press } from './controls';
import { T } from './Text';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';

/** "Which is word 7?" with four words to tap. Used when setting up and when checking the backup later. */
export function WordChoices({ n, options, onPick, disabled }: { n: number; options: string[]; onPick: (w: string) => void; disabled?: boolean }) {
  return (
    <Animated.View key={n} entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)} exiting={FadeOut.duration(120)} style={{ gap: 18 }}>
      <T style={{ fontFamily: F.semibold, fontSize: 28, letterSpacing: -0.8 }}>Which is word {n}?</T>
      <View style={{ gap: 10 }}>
        {options.map((w) => (
          <Press key={w} onPress={() => onPick(w)} disabled={disabled} style={{ height: 60, borderRadius: 20, backgroundColor: C.fill, justifyContent: 'center', paddingHorizontal: 22 }}>
            <T style={{ fontFamily: F.medium, fontSize: 18 }}>{w}</T>
          </Press>
        ))}
      </View>
    </Animated.View>
  );
}
