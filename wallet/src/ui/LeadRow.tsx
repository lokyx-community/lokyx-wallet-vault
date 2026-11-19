import { type ReactNode } from 'react';
import { View } from 'react-native';
import { Press } from './controls';
import { Icon } from './Icon';
import { T } from './Text';
import { C } from './theme';

/** A grouped-list row that starts with a logo or avatar (40 px), then a title and a quiet line, then a value. Use inside Group. */
export function LeadRow({ lead: _lead, title, sub, subColor, detail, detailSub, right, chevron, onPress }: { lead: ReactNode; title: string; sub?: string; subColor?: string; detail?: string; detailSub?: string; right?: ReactNode; chevron?: boolean; onPress?: () => void }) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 10, paddingHorizontal: 16 }}>
      {_lead}
      <View style={{ flex: 1, gap: 2 }}>
        <T v="callout" style={{ fontSize: 16 }} numberOfLines={1}>{title}</T>
        {!!sub && <T v="caption" numberOfLines={2} style={{ lineHeight: 17, color: subColor ?? C.sub }}>{sub}</T>}
      </View>
      {(!!detail || !!detailSub) && (
        <View style={{ alignItems: 'flex-end', gap: 1 }}>
          {!!detail && <T v="callout" style={{ fontSize: 16, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{detail}</T>}
          {!!detailSub && <T v="caption" dim numberOfLines={1}>{detailSub}</T>}
        </View>
      )}
      {right}
      {chevron && <Icon name="chevron" size={16} color={C.faint} width={2} />}
    </View>
  );
  return onPress ? <Press onPress={onPress} haptic={false} scaleTo={0.985}>{body}</Press> : body;
}
