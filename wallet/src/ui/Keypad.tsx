import { View } from 'react-native';
import { Press, tick } from './controls';
import { T } from './Text';
import { Icon, type IconName } from './Icon';
import { C } from './theme';

/** A phone-style number pad. `extra` sits bottom-left: a dot for amounts, Face ID for passcodes. */
export function Keypad({ onKey, extra, extraIcon, extraLabel }: { onKey: (k: string) => void; extra?: string; extraIcon?: IconName; extraLabel?: string }) {
  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [extra ?? (extraIcon ? 'x' : ''), '0', 'del'],
  ];
  return (
    <View style={{ gap: 6, width: '100%', maxWidth: 360, alignSelf: 'center' }}>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {r.map((k, j) =>
            k === '' ? (
              <View key={j} style={{ flex: 1, height: 64 }} />
            ) : (
              <Press
                key={j}
                haptic={false}
                scaleTo={0.88}
                accessibilityLabel={k === 'del' ? 'Delete' : k === 'x' ? extraLabel : k}
                onPress={() => {
                  tick();
                  onKey(k);
                }}
                style={{ flex: 1, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 32 }}
              >
                {k === 'del' ? <Icon name="backspace" size={26} color={C.text} /> : k === 'x' && extraIcon ? <Icon name={extraIcon} size={28} color={C.text} /> : <T style={{ fontSize: 30, lineHeight: 38, fontFamily: 'Geist_400Regular', letterSpacing: -0.5 }}>{k}</T>}
              </Press>
            ),
          )}
        </View>
      ))}
    </View>
  );
}

/** Applies a key to an amount being typed: one dot, sensible leading zeros, limited decimals. */
export function typeAmount(cur: string, k: string, decimals = 8): string {
  if (k === 'del') return cur.slice(0, -1);
  if (k === '.') return cur.includes('.') ? cur : (cur || '0') + '.';
  if (cur === '0') return k;
  const [, f] = cur.split('.');
  if (f !== undefined && f.length >= decimals) return cur;
  if (cur.replace('.', '').length >= 14) return cur;
  return cur + k;
}
