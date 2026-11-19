import { View } from 'react-native';
import { C } from './theme';

/** Where you are in setting up a wallet: the current step is a longer bar. */
export function SetupSteps({ at, n = 5 }: { at: number; n?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 4 }} accessibilityLabel={`Step ${at + 1} of ${n}`}>
      {Array.from({ length: n }).map((_, i) => (
        <View key={i} style={{ height: 4, width: i === at ? 26 : 8, borderRadius: 2, backgroundColor: i <= at ? C.text : C.line2 }} />
      ))}
    </View>
  );
}
