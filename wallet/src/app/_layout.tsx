import { loadGuard } from '../lib/guard';
import { loadSigning } from '../lib/signing';
import { loadApps } from '../lib/appswallet';
import { loadVaultFirst, vaultFirst } from '../lib/vaultfirst';
import { loadTowers } from '../lib/tower';
import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { TiltDriver } from '../ui/Tilt';
import { useMotionBg } from '../lib/motionbg';
import { AppState, ScrollView, View } from 'react-native';
import { Stack, router, useGlobalSearchParams, usePathname, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ToastHost } from '../ui/Toast';
import { CoinFlightHost } from '../ui/CoinFlight';
import { ReceiptImageHost } from '../ui/Slip';
import { PasscodeHost } from '../ui/PasscodeHost';
import { FaceCheckHost } from '../ui/FaceCheck';
import { C } from '../ui/theme';
import { T } from '../ui/Text';
import { Button } from '../ui/controls';
import { load, lock, useWallet, wallet } from '../lib/wallet';
import { loadAll } from '../lib/data';
import { loadCapsules } from '../lib/capsules';
import { loadNode } from '../lib/rpc';
import { keysLost } from '../lib/secrets';
import { startWatching, check } from '../lib/watch';
import { loadChains, loadTokens } from '../lib/multichain';
import { loadWatchedX } from '../lib/xchains';
import { loadPendingFeed } from '../lib/feed-pending';
import { loadBookmarks } from '../lib/bookmarks';
import { loadGifts } from '../lib/gifts';
import { settleBoard } from '../lib/board';
import { loadBtcShared, useBtcShared } from '../lib/btcms';
import { loadEthShared, useEthShared } from '../lib/ethms';
import { registerPush, routeForPush } from '../lib/push';
import { loadSwaps, loadSwapSettings } from '../lib/swaps';
import { AlertBanner } from '../ui/AlertBanner';
import { BetaNotice } from '../ui/BetaNotice';
import * as Notifications from 'expo-notifications';
import { useStore } from '../lib/store';

SplashScreen.preventAutoHideAsync().catch(() => {});

const SETUP = ['welcome', 'create', 'restore', 'secure', 'keys-lost'];

function Gate() {
  const w = useWallet();
  const sharedCount = useEthShared().length + useBtcShared().length;
  const seg = useSegments();
  const first = seg[0] as string | undefined;
  const path = usePathname();
  const params = useGlobalSearchParams();
  const resume = useRef<string | null>(null);
  const lost = useStore(keysLost);
  useEffect(() => {
    if (lost && w.exists && first !== 'keys-lost' && first !== 'restore') router.replace('/keys-lost');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lost, first]);

  useEffect(() => {
    if (!w.ready) return;
    const inSetup = SETUP.includes(first ?? '');
    if (!w.exists && !inSetup) router.replace('/welcome');
    else if (w.exists && w.locked && first !== 'unlock') {
      // come back here once unlocked, e.g. a payment link opened while locked
      if (path && path !== '/') {
        const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
        resume.current = q ? `${path}?${q}` : path;
      }
      router.replace('/unlock');
    } else if (w.exists && !w.locked && (inSetup || first === 'unlock')) {
      const to = first === 'unlock' ? resume.current : null;
      resume.current = null;
      router.replace((to ?? (inSetup && vaultFirst.get() ? '/vault-first' : '/')) as never);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.ready, w.exists, w.locked, first]);

  // Vault watch: once unlocked, ask for notification permission, schedule the background task, check now,
  // and again whenever the app comes back to the front. A tapped alert opens the review screen.
  useEffect(() => {
    if (!w.exists || w.locked) return;
    // permission is asked inside startWatching, so the phone is registered for shared-account pushes after it
    startWatching().finally(() => registerPush());
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') { check(false).catch(() => {}); registerPush(); } });
    // a shared-account push opens that account; any other alert opens the review screen
    const tap = Notifications.addNotificationResponseReceivedListener((r) => router.push((routeForPush(r.notification.request.content.data) ?? '/alerts') as never));
    return () => { sub.remove(); tap.remove(); };
  }, [w.exists, w.locked, sharedCount]);

  // Lock again after a while in the background.
  const away = useRef(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') away.current = Date.now();
      if (s === 'active' && away.current) {
        const gone = (Date.now() - away.current) / 1000;
        away.current = 0;
        const after = wallet.get().settings.autoLock;
        if (after >= 0 && gone >= after) lock();
      }
    });
    return () => sub.remove();
  }, []);

  const [motion] = useMotionBg();
  const still = useReducedMotion();
  return (
    <>
      <StatusBar style="light" />
      {motion && !still ? <TiltDriver /> : null}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'ios_from_right', gestureEnabled: true, fullScreenGestureEnabled: true }}>
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
        <Stack.Screen name="unlock" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="secure" options={{ gestureEnabled: false }} />
        <Stack.Screen name="making" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="ring" options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom' }} />
        <Stack.Screen name="receive" options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom' }} />
        <Stack.Screen name="coin/[id]" options={{ animation: 'fade', animationDuration: 220 }} />
        <Stack.Screen name="xcoin/[chain]" options={{ animation: 'fade', animationDuration: 220 }} />
        <Stack.Screen name="coins" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="tap" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="blockchains" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="send" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="browser" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="capsule/new" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
      <AlertBanner />
      <BetaNotice />
      <PasscodeHost />
      <FaceCheckHost />
      <CoinFlightHost />
      <ReceiptImageHost />
      <ToastHost />
    </>
  );
}

/** If a screen throws while drawing, show what went wrong instead of closing the app. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, padding: 24, justifyContent: 'center', gap: 14 }}>
      <T v="title">Something went wrong</T>
      <T v="callout" dim>Nothing was sent or changed. Tell me what this says and I will fix it.</T>
      <ScrollView style={{ maxHeight: 220, borderRadius: 16, backgroundColor: C.fill, padding: 14 }}>
        <T v="caption" dim selectable>{String(error?.message ?? error)}</T>
      </ScrollView>
      <Button title="Try again" onPress={retry} />
    </View>
  );
}

export default function Root() {
  const [fonts] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, GeistMono_500Medium });
  const w = useWallet();
  useEffect(() => {
    Promise.all([loadNode(), loadAll(), loadCapsules(), loadChains(), loadTokens(), loadWatchedX(), loadPendingFeed(), loadBookmarks(), loadGifts(), loadBtcShared(), loadEthShared(), loadSwaps(), loadSwapSettings(), loadGuard(), loadSigning(), loadApps(), loadVaultFirst(), loadTowers()])
      .finally(() => {
        load();
        // a board this phone was making: pick it up in the background, never holding up the start
        settleBoard().catch(() => {});
      });
  }, []);
  useEffect(() => {
    if (fonts && w.ready) SplashScreen.hideAsync().catch(() => {});
  }, [fonts, w.ready]);
  if (!fonts || !w.ready) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaProvider>
        <Gate />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
