import { View } from 'react-native';
import { T } from './Text';
import { C, F } from './theme';

/** What happens, in order: a dot per step on a thin line. The first step is the one happening now. */
export function Timeline({ steps }: { steps: [string, string][] }) {
  return (
    <View style={{ backgroundColor: C.fill, borderRadius: 26, padding: 20 }}>
      {steps.map(([a, b], i) => (
        <View key={a} style={{ flexDirection: 'row', gap: 16 }}>
          <View style={{ alignItems: 'center', width: 14 }}>
            <View style={{ width: 14, height: 14, borderRadius: 7, marginTop: 3, backgroundColor: i === 0 ? C.text : 'transparent', borderWidth: i === 0 ? 0 : 2, borderColor: C.faint }} />
            {i < steps.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: 28, backgroundColor: C.line2, marginVertical: 4 }} /> : null}
          </View>
          <View style={{ flex: 1, paddingBottom: i < steps.length - 1 ? 14 : 0, gap: 2 }}>
            <T style={{ fontFamily: F.semibold, fontSize: 16 }}>{a}</T>
            <T v="sub" dim style={{ lineHeight: 19 }}>{b}</T>
          </View>
        </View>
      ))}
    </View>
  );
}
