import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { T } from './Text';
import { Icon } from './Icon';
import { VaultRing } from './VaultRing';
import { C } from './theme';
import { DUR, EASE_OUT } from './motion';

export const CREATE_STEPS = [
  ['checking', 'Checking the audited parts'],
  ['deploying', 'Creating your vault'],
  ['activating', 'Switching the protection on'],
  ['verifying', 'Checking it matches what you set'],
  ['done', 'Ready'],
] as const;

/** The vault making itself. The ring fills as each real step finishes, so what you see is what is happening. */
export function VaultCreating({ step }: { step: string }) {
  const at = Math.max(0, CREATE_STEPS.findIndex(([k]) => k === step));
  useEffect(() => {
    if (step === 'done') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else if (step) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [step]);
  return (
    <View style={{ alignItems: 'center', gap: 26, paddingVertical: 24 }}>
      <VaultRing size={150} frac={(at + (step === 'done' ? 0 : 0.5)) / (CREATE_STEPS.length - 1)} stroke={7} breathe>
        <Icon name={step === 'done' ? 'check' : 'lock'} size={40} color={C.text} width={1.8} />
      </VaultRing>
      <View style={{ gap: 12, alignSelf: 'stretch', paddingHorizontal: 12 }}>
        {CREATE_STEPS.map(([k, label], i) => (
          <Animated.View key={k} entering={FadeIn.duration(DUR.base).easing(EASE_OUT)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: i > at ? 0.35 : 1 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: i < at || step === 'done' ? C.good : i === at ? C.text : C.line2, backgroundColor: i < at || step === 'done' ? C.good : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {i < at || step === 'done' ? <Icon name="check" size={12} color={C.bg} width={3} /> : null}
            </View>
            <T v="callout">{label}</T>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}
