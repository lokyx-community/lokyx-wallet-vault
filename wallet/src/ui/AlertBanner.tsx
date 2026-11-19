import { View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from './Text';
import { Press } from './controls';
import { C } from './theme';
import { alerts } from '../lib/watch';
import { useStore } from '../lib/store';
import { useWallet } from '../lib/wallet';

/** Shown on every screen while something is waiting on your accounts that this phone didn't start. */
export function AlertBanner() {
  const list = useStore(alerts);
  const w = useWallet();
  const insets = useSafeAreaInsets();
  if (!list.length || w.locked || !w.exists) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, top: insets.top + 4, zIndex: 900 }}>
      <Press onPress={() => router.push('/alerts')} accessibilityRole="button" accessibilityLabel="Review what is waiting" style={{ borderRadius: 16, backgroundColor: C.bad, paddingVertical: 12, paddingHorizontal: 16 }}>
        <T v="callout" color="#fff">{list.length === 1 ? list[0].text : `${list.length} things are waiting on your accounts`}</T>
        <T v="caption" color="#fff">Tap to review or cancel</T>
      </Press>
    </View>
  );
}
