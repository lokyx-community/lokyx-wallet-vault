import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Platform, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { PasscodePad } from '../ui/Passcode';
import { Button, Press } from '../ui/controls';
import { FaceScan } from '../ui/FaceCheck';
import { T } from '../ui/Text';
import { Mark } from '../ui/Icon';
import { C } from '../ui/theme';
import { askBiometric, bioName, biometricKind, type Bio } from '../lib/auth';
import { checkPasscode, openDecoy, unlock, useWallet, wipe } from '../lib/wallet';
import { resetCapsules } from '../lib/capsules';
import { resetData } from '../lib/data';
import { DUR, EASE_OUT } from '../ui/motion';

export default function Unlock() {
  const insets = useSafeAreaInsets();
  const w = useWallet();
  const [bio, setBio] = useState<Bio>(null);
  const [pad, setPad] = useState(false);
  const [asking, setAsking] = useState(false);

  const tryBio = useCallback(async () => {
    setAsking(true);
    const ok = await askBiometric('Open your wallet');
    setAsking(false);
    if (ok) unlock();
  }, []);

  useEffect(() => {
    biometricKind().then((b) => {
      const on = w.settings.biometrics ? b : null;
      setBio(on);
      setPad(!on);
      if (on) setTimeout(tryBio, 350);
    });
  }, [w.settings.biometrics, tryBio]);

  // coming back to the app on this screen asks again
  useEffect(() => {
    // only after a real trip to the background; the Face ID sheet itself makes the app 'inactive'
    let away = false;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') away = true;
      if (s === 'active' && away && bio && !pad && !asking) {
        away = false;
        tryBio();
      }
    });
    return () => sub.remove();
  }, [bio, pad, asking, tryBio]);

  const forgot = () => {
    const go = async () => {
      await wipe();
      resetData();
      resetCapsules();
      router.replace('/restore');
    };
    const msg = 'This takes the wallet off this phone. You can bring it back with your 24 words. Without them, your LYX is gone for good.';
    if (Platform.OS === 'web') {
      if (confirm(msg)) go();
    } else
      Alert.alert('Use your 24 words?', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove and restore', style: 'destructive', onPress: go },
      ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 12, paddingHorizontal: 24, justifyContent: 'space-between' }}>
      {pad ? (
        <Animated.View key="pad" entering={FadeIn.duration(300)} style={{ alignItems: 'center', gap: 32 }}>
          <Mark size={44} color={C.text} />
          <PasscodePad
            title="Welcome back"
            sub="Enter your passcode"
            bio={bio === 'face' ? 'face' : bio ? 'finger' : undefined}
            onBio={tryBio}
            onDone={async (pin) => {
              const r = await checkPasscode(pin);
              if (r.ok) {
                setTimeout(() => (r.decoy ? void openDecoy() : unlock()), 160);
                return true;
              }
              return r.wait ? `Too many tries. Wait ${r.wait}s.` : 'Wrong passcode';
            }}
          />
        </Animated.View>
      ) : (
        <Animated.View key="face" entering={FadeIn.duration(400)} exiting={FadeOut.duration(150)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 30 }}>
          <Mark size={44} color={C.text} />
          <Press haptic onPress={tryBio} accessibilityLabel={`Unlock with ${bioName(bio)}`} style={{ width: 168, height: 168, borderRadius: 48, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' }}>
            <FaceScan size={88} kind={bio === 'finger' ? 'finger' : 'face'} />
          </Press>
          <Animated.View entering={FadeInDown.delay(150).duration(DUR.base).easing(EASE_OUT)} style={{ alignItems: 'center', gap: 8 }}>
            <T v="display">Welcome back</T>
            <T v="body" dim>{bio === 'finger' ? 'Touch the sensor to open your wallet' : `Look at your phone to open your wallet`}</T>
          </Animated.View>
          <View style={{ alignSelf: 'stretch', gap: 6 }}>
            <Button title={`Unlock with ${bioName(bio)}`} icon={bio === 'finger' ? 'finger' : 'face'} onPress={tryBio} />
            <Button title="Use passcode" kind="plain" onPress={() => setPad(true)} />
          </View>
        </Animated.View>
      )}
      <Press onPress={forgot} style={{ alignSelf: 'center', padding: 12 }}>
        <T v="sub" dim>Forgot passcode?</T>
      </Press>
    </View>
  );
}
