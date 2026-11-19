import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Field } from './controls';
import { T } from './Text';
import { C, F } from './theme';
import { normalizeMnemonic } from '../lib/lokyx';

/** Recovery words typed into one box. Each word shows as a chip, and a ring fills toward 12 or 24. */
export function PhraseEntry({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const words = normalizeMnemonic(value).split(' ').filter(Boolean);
  const n = words.length;
  const goal = n > 12 ? 24 : 12;
  const R = 15;
  const L = 2 * Math.PI * R;
  const frac = Math.min(1, n / goal);
  const full = n === 12 || n === 24;
  return (
    <View style={{ backgroundColor: C.fill, borderRadius: 26, padding: 14, gap: 8 }}>
      {n > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {words.map((w, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 5, alignItems: 'baseline', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)' }}>
              <T allowFontScaling={false} style={{ fontFamily: F.mono, fontSize: 10.5, color: C.faint }}>{i + 1}</T>
              <T allowFontScaling={false} style={{ fontFamily: F.medium, fontSize: 14.5 }}>{w}</T>
            </View>
          ))}
        </View>
      ) : null}
      <Field value={value} onChangeText={onChange} multiline autoCapitalize="none" autoCorrect={false} autoComplete="off" spellCheck={false} placeholder={n ? 'Keep typing…' : 'word word word…'} style={{ backgroundColor: 'transparent', paddingHorizontal: 4, minHeight: n ? 56 : 120, fontSize: 18, lineHeight: 26 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
        <T v="sub" dim>{`${n} of ${goal} words`}</T>
        <Svg width={38} height={38}>
          <Circle cx={19} cy={19} r={R} stroke="rgba(255,255,255,0.12)" strokeWidth={4.5} fill="none" />
          <Circle cx={19} cy={19} r={R} stroke={full ? '#9BE5BD' : C.text} strokeWidth={4.5} fill="none" strokeLinecap="round" strokeDasharray={`${L * frac} ${L}`} rotation={-90} origin="19,19" />
        </Svg>
      </View>
    </View>
  );
}
