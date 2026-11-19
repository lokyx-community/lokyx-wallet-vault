import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Button, Note, success } from '../ui/controls';
import { SetupSteps } from '../ui/SetupSteps';
import { PasscodePad } from '../ui/Passcode';
import { Icon } from '../ui/Icon';
import { C } from '../ui/theme';
import { askBiometric, bioName, biometricKind, type Bio } from '../lib/auth';
import { setPasscode, updateSettings } from '../lib/wallet';
import { DUR, EASE_OUT } from '../ui/motion';

export default function Secure() {
  const insets = useSafeAreaInsets();
  const [first, setFirst] = useState('');
  const [step, setStep] = useState<'pin' | 'again' | 'bio'>('pin');
  const [bio, setBio] = useState<Bio>(null);
  useEffect(() => {
    biometricKind().then(setBio);
  }, []);

  const finish = async (useBio: boolean) => {
    await updateSettings({ biometrics: useBio });
    await setPasscode(first);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 64, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}>
      <SetupSteps at={step === 'bio' ? 4 : 3} />
      {step === 'pin' && (
        <Animated.View key="a" entering={FadeIn} style={{ flex: 1 }}>
          <PasscodePad
            title="Make a passcode"
            sub="Six numbers to open the wallet and approve payments."
            onDone={(p) => {
              setFirst(p);
              setTimeout(() => setStep('again'), 150);
              return true;
            }}
          />
        </Animated.View>
      )}
      {step === 'again' && (
        <Animated.View key="b" entering={FadeIn} style={{ flex: 1 }}>
          <PasscodePad
            title="Once more"
            sub="Type the same six numbers."
            onDone={(p) => {
              if (p !== first) {
                setTimeout(() => {
                  setFirst('');
                  setStep('pin');
                }, 700);
                return "They didn't match. Let's start again.";
              }
              if (bio) setTimeout(() => setStep('bio'), 150);
              else finish(false);
              return true;
            }}
          />
        </Animated.View>
      )}
      {step === 'bio' && (
        <View style={{ flex: 1, justifyContent: 'space-between' }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 }}>
            <Animated.View entering={FadeIn.duration(DUR.base).easing(EASE_OUT)} style={{ width: 120, height: 120, borderRadius: 36, backgroundColor: C.fill, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={bio === 'face' ? 'face' : 'finger'} size={56} color={C.text} width={1.5} />
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(120).duration(DUR.base).easing(EASE_OUT)} style={{ gap: 10, alignItems: 'center' }}>
              <T v="display" style={{ textAlign: 'center' }}>Use {bioName(bio)}?</T>
              <T v="callout" dim style={{ textAlign: "center", lineHeight: 22, paddingHorizontal: 6 }}>Open your wallet with a glance or a touch. Your phone checks it, and LOKYX never sees your face or fingerprint. Your passcode still works.</T>
            </Animated.View>
          </View>
          <View style={{ gap: 10 }}>
            <Button
              title={`Use ${bioName(bio)}`}
              onPress={async () => {
                if (await askBiometric(`Turn on ${bioName(bio)} for LOKYX`)) {
                  success();
                  await finish(true);
                }
              }}
            />
            <Button title="Not now" kind="plain" onPress={() => finish(false)} />
          </View>
        </View>
      )}
    </View>
  );
}
