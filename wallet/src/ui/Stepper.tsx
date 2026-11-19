import { View } from 'react-native';
import { Press } from './controls';
import { Icon } from './Icon';
import { T } from './Text';
import { C, F } from './theme';

/** "2 of 3": how many approvals a shared account needs, changed with a minus and a plus. */
export function Stepper({ t, n, onChange }: { t: number; n: number; onChange: (v: number) => void }) {
  const btn = (name: 'minus' | 'plus', on: () => void, off: boolean) => (
    <Press onPress={on} disabled={off} accessibilityLabel={name === 'minus' ? 'Fewer approvals' : 'More approvals'} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ fontSize: 24, lineHeight: 28, color: C.text }}>{name === 'minus' ? '−' : '+'}</T>
    </Press>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.fill, borderRadius: 24, padding: 12 }}>
      {btn('minus', () => onChange(Math.max(1, t - 1)), t <= 1)}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <T style={{ fontFamily: F.regular, fontSize: 34, letterSpacing: -1 }}>{`${t} `}<T v="sub" dim>{`of ${n}`}</T></T>
        <T v="caption" dim>approvals to send</T>
      </View>
      {btn('plus', () => onChange(Math.min(n, t + 1)), t >= n)}
    </View>
  );
}
