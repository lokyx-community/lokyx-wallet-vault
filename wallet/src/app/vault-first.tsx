import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Button, Press } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { C, F } from '../ui/theme';
import { DUR, EASE_OUT } from '../ui/motion';
import { doneVaultFirst } from '../lib/vaultfirst';

const CHOICES = [
  { id: 'vault', name: 'A vault', tag: 'RECOMMENDED', lines: ['Small payments go straight out', 'Big ones wait 24 h, and you can cancel', 'A thief gets one day\'s allowance at most'] },
  { id: 'plain', name: 'A plain wallet', tag: '', lines: ['Everything moves at once', 'Whoever has your words has it all'] },
] as const;

/** Asked once, after the wallet is made. A vault is the first choice; the plain wallet is one tap away. */
export default function VaultFirst() {
  const insets = useSafeAreaInsets();
  const [pick, setPick] = useState<'vault' | 'plain'>('vault');
  const go = async () => {
    await doneVaultFirst();
    router.replace('/');
    if (pick === 'vault') setTimeout(() => router.push('/ethvault/setup'), 60);
  };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 56, paddingBottom: insets.bottom + 20, paddingHorizontal: 22, gap: 22 }}>
      <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)} style={{ gap: 10 }}>
        <T v="display">Where should your savings live?</T>
        <T v="callout" dim style={{ lineHeight: 22 }}>Your words open your wallet. A vault adds a second lock, so stolen words alone can't empty it.</T>
      </Animated.View>
      <View style={{ gap: 12, flex: 1 }}>
        {CHOICES.map((c, i) => (
          <Animated.View key={c.id} entering={FadeInDown.delay(120 + i * 90).duration(DUR.base).easing(EASE_OUT)}>
            <Press onPress={() => setPick(c.id)} haptic={false} style={{ padding: 18, borderRadius: 24, backgroundColor: C.fill, borderWidth: 1, borderColor: pick === c.id ? C.soft : C.line, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ gap: 4 }}>
                  {c.tag ? <T style={{ fontFamily: F.semibold, fontSize: 11, letterSpacing: 2, color: C.good }}>{c.tag}</T> : null}
                  <T v="headline">{c.name}</T>
                </View>
                <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: pick === c.id ? C.text : C.line2, backgroundColor: pick === c.id ? C.text : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {pick === c.id ? <Icon name="check" size={13} color={C.bg} width={3} /> : null}
                </View>
              </View>
              {c.lines.map((l) => (
                <View key={l} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c.id === 'vault' ? C.good : C.faint }} />
                  <T v="sub" dim style={{ flex: 1 }}>{l}</T>
                </View>
              ))}
            </Press>
          </Animated.View>
        ))}
      </View>
      <View style={{ gap: 8 }}>
        <Button title={pick === 'vault' ? 'Continue with a vault' : 'Continue with a plain wallet'} onPress={go} />
        <T v="caption" dim style={{ textAlign: 'center' }}>You can add a vault later in Apps.</T>
      </View>
    </View>
  );
}
