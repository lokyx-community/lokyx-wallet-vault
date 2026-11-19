import { useEffect, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { C } from './theme';
import { T } from './Text';

/**
 * Put this on any screen that shows the 24 words or a recovery key. Android: the window is marked secure
 * (FLAG_SECURE), so screenshots, screen recording and the recents thumbnail are blank. iPhone: screen
 * recording is blocked and the screen is covered the moment the app stops being active, so the app
 * switcher never shows the words.
 */
export function ScreenGuard() {
  if (Platform.OS !== 'web') usePreventScreenCapture('lokyx-secret'); // eslint-disable-line react-hooks/rules-of-hooks
  const [covered, setCovered] = useState(AppState.currentState !== 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setCovered(s !== 'active'));
    return () => sub.remove();
  }, []);
  if (!covered) return null;
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} pointerEvents="auto">
      <T v="callout" color={C.sub}>LOKYX</T>
    </View>
  );
}
