import { Linking, View } from 'react-native';
import { T } from './Text';
import { Press } from './controls';
import { Icon } from './Icon';
import { C, F } from './theme';
import type { ContractCheck } from '../lib/contract-check';

const COLOR = { ok: C.good, caution: C.wait, danger: C.bad } as const;

/** What the wallet found out about the contract before signing. When the verdict is not "ok" the details are always open and
 *  the slide stays locked until the box is ticked. */
export function ContractCheckCard({ check, read, onRead, explorer }: { check: ContractCheck | null | 'busy'; read: boolean; onRead: (v: boolean) => void; explorer: string }) {
  if (check === 'busy') return <T v="caption" dim>Checking the contract…</T>;
  if (!check) return null;
  const v = check.verdict;
  const color = COLOR[v.level];
  return (
    <View style={{ borderRadius: 20, backgroundColor: C.fill, borderWidth: 1, borderColor: color, padding: 16, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="info" size={20} color={color} />
        <T style={{ fontFamily: F.semibold, fontSize: 16, color, flex: 1 }}>{v.headline}</T>
      </View>
      {check.call.name ? <T v="sub" dim>{`Function: ${check.call.name}`}</T> : null}
      {v.reasons.map((r, i) => (
        <T key={i} v="sub" style={{ lineHeight: 20 }}>{r}</T>
      ))}
      {check.parties.map((p) => (
        <Press key={p.address + p.role} onPress={() => Linking.openURL(`${explorer}${p.address}`).catch(() => {})} haptic={false}>
          <T v="caption" color={C.soft}>{`Open ${p.role === 'spender' ? 'the spender' : 'the contract'} on the explorer`}</T>
        </Press>
      ))}
      {v.review ? (
        <Press onPress={() => onRead(!read)} haptic={false} accessibilityLabel="I have read this" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4 }}>
          <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center', backgroundColor: read ? color : 'transparent' }}>
            {read ? <Icon name="check" size={14} color={C.bg} width={3} /> : null}
          </View>
          <T v="sub" style={{ flex: 1 }}>I read this and still want to continue</T>
        </Press>
      ) : null}
    </View>
  );
}
