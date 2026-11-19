import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Field } from './controls';
import { T } from './Text';
import { C, F } from './theme';

/** A round mark above an intro screen, with a line of what the feature is. */
export function IntroHero({ icon, title, text }: { icon: IconName; title?: string; text: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: C.fill, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={32} color={C.text} width={1.8} />
      </View>
      {title ? <T style={{ fontFamily: F.semibold, fontSize: 19 }}>{title}</T> : null}
      <T v="callout" dim style={{ textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 }}>{text}</T>
    </View>
  );
}

/** One thing a feature does: a mark, a title, and the whole sentence under it. */
export function Feature({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={21} color={C.text} width={1.9} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 16 }}>{title}</T>
        <T v="sub" dim style={{ lineHeight: 20 }}>{text}</T>
      </View>
    </View>
  );
}

export const Features = ({ children }: { children: ReactNode }) => <View style={{ gap: 22, paddingVertical: 10 }}>{children}</View>;

/** Type back a word from the paper copy. A tick shows when it matches. */
export function WordCheck({ n, value, ok, onChange }: { n: number; value: string; ok: boolean; onChange: (t: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.fill, borderRadius: 20, paddingLeft: 18, paddingRight: 12, height: 64 }}>
      <T v="sub" dim style={{ width: 64 }}>{`Word ${n}`}</T>
      <Field value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off" style={{ flex: 1, backgroundColor: 'transparent', paddingHorizontal: 0, fontSize: 18 }} />
      {ok ? <Icon name="check" size={20} color="#9BE5BD" width={2.6} /> : null}
    </View>
  );
}
