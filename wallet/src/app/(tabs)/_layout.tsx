import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Tabs, type BottomTabBarProps } from 'expo-router/tabs';
import { BlurView } from 'expo-blur';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Icon, type IconName } from '../../ui/Icon';
import { T } from '../../ui/Text';
import { Press, tap } from '../../ui/controls';
import { C } from '../../ui/theme';
import { settlePending } from '../../lib/data';
import { loadInbox, unreadCount, useInbox } from '../../lib/inbox';
import { DUR, EASE_OUT } from '../../ui/motion';

const TABS: Record<string, [string, IconName]> = {
  index: ['Home', 'home'],
  activity: ['Activity', 'activity'],
  trade: ['Swap', 'swap'],
  apps: ['Apps', 'apps'],
  notifications: ['Inbox', 'bell'],
  you: ['You', 'you'],
};

function Tab({ name, on, onPress }: { name: string; on: boolean; onPress: () => void }) {
  const [label, icon] = TABS[name];
  const k = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    k.value = withTiming(on ? 1 : 0, { duration: DUR.base, easing: EASE_OUT });
  }, [on, k]);
  const pill = useAnimatedStyle(() => ({ opacity: k.value, transform: [{ scale: 0.86 + 0.14 * k.value }] }));
  const color = on ? C.text : '#8E8E93';
  const unread = unreadCount(useInbox());
  return (
    <Press scaleTo={0.92} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label} onPress={onPress} style={{ flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.12)' }, pill]} />
      <View>
        <Icon name={icon} size={21} color={color} width={on ? 2.1 : 1.9} />
        {name === 'notifications' && unread > 0 ? <View accessibilityLabel={`${unread} unread`} style={{ position: 'absolute', top: -2, right: -3, minWidth: 9, height: 9, borderRadius: 5, backgroundColor: C.bad, borderWidth: 1.5, borderColor: '#242428' }} /> : null}
      </View>
      <T style={{ fontSize: 10.5, fontFamily: 'Geist_500Medium', color, paddingTop: 2 }}>{label}</T>
    </Press>
  );
}

/** A floating glass pill with the tabs. The highlight slides in under the one you're on. */
function Bar({ state, navigation, descriptors }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const go = (i: number) => {
    const r = state.routes[i];
    const ev = navigation.emit({ type: 'tabPress', target: r.key, canPreventDefault: true });
    if (state.index !== i && !ev.defaultPrevented) {
      tap(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate(r.name);
    }
  };
  return (
    <View style={{ position: 'absolute', bottom: Math.max(insets.bottom, 14) + 4, height: 62, width: 340, alignSelf: 'center' }}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: 31, overflow: 'hidden', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)' }]}>
        {Platform.OS === 'ios' ? <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} /> : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#242428', opacity: Platform.OS === 'ios' ? 0.78 : 0.97 }]} />
      </View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', padding: 7, gap: 2 }}>
        {state.routes.map((r, i) => r.name === 'notifications' || (descriptors[r.key]?.options as { href?: string | null }).href === null ? null : <Tab key={r.key} name={r.name} on={state.index === i} onPress={() => go(i)} />)}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const [, setN] = useState(0);
  useEffect(() => {
    loadInbox().catch(() => {});
  }, []);
  useEffect(() => {
    const t = setInterval(() => settlePending().then(() => setN((n) => n + 1)), 8000);
    return () => clearInterval(t);
  }, []);
  return (
    <Tabs tabBar={(p) => <Bar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg }, animation: 'shift' }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="activity" />
      <Tabs.Screen name="trade" />
      <Tabs.Screen name="apps" />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="you" />
    </Tabs>
  );
}
