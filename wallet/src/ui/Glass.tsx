import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { T } from './Text';
import { Press } from './controls';
import { Icon, type IconName } from './Icon';
import { C, F } from './theme';

/** The new look's building blocks: a frosted panel, a section label, a row, and the two buttons. */
export const Panel = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[{ borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 16, overflow: 'hidden' }, style]}>{children}</View>
);

export const Label = ({ children }: { children: string }) => (
  <T style={{ fontFamily: F.medium, fontSize: 14, color: C.sub, paddingTop: 22, paddingBottom: 8, paddingHorizontal: 6 }}>{children}</T>
);

export function GRow({ icon, title, sub, right, onPress }: { icon?: IconName; title: string; sub?: string; right?: ReactNode; onPress?: () => void }) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 }}>
      {icon ? (
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={17} color={C.text} width={1.9} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <T style={{ fontFamily: F.medium, fontSize: 15.5 }}>{title}</T>
        {sub ? <T v="caption" dim>{sub}</T> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron" size={14} color={C.faint} width={2.2} /> : null)}
    </View>
  );
  return onPress ? <Press haptic={false} scaleTo={0.985} onPress={onPress}>{body}</Press> : body;
}

export function Primary({ title, onPress, disabled, busy, busyText }: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean; busyText?: string }) {
  return (
    <Press onPress={onPress} disabled={disabled || busy} style={{ height: 56, borderRadius: 28, backgroundColor: C.ink, opacity: disabled ? 0.35 : 1, alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ fontFamily: F.semibold, fontSize: 17, color: C.inkText }}>{busy ? busyText ?? 'One moment…' : title}</T>
    </Press>
  );
}

export function Secondary({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Press onPress={onPress} disabled={disabled} style={{ height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)', opacity: disabled ? 0.4 : 1, alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ fontFamily: F.semibold, fontSize: 16 }}>{title}</T>
    </Press>
  );
}
