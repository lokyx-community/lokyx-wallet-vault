import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Defs, Mask, Path, Rect } from 'react-native-svg';
import Animated, { Easing, FadeIn, useAnimatedProps, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Button, IconButton, Press, Field, success, tap } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { PaySheet } from '../ui/PaySheet';
import { ActionRow } from '../ui/ActionRow';
import { RingCode } from '../ui/RingCode';
import { Qr } from '../ui/Qr';
import { Segmented } from '../ui/Segmented';
import { Sheet } from '../ui/Sheet';
import { Keypad, typeAmount } from '../ui/Keypad';
import { toast } from '../ui/Toast';
import { C, F } from '../ui/theme';
import { useAccountRef } from '../lib/wallet';
import { parsePayload, ringFromPhoto, type Found } from '../lib/scan';
import { parseGift } from '../lib/gift-core';
import { parseBoardLink } from '../lib/board';
import { shortAddr } from '../lib/format';
import { DUR, EASE_OUT } from '../ui/motion';
import { tapSupported, useTapReceive, useTapSend } from '../lib/tap';
import { tapAsk, tapRequest, tapTokenRequest } from '../lib/tap-core';
import { TapPill, TapWaves } from '../ui/TapPill';
import { useCoins } from '../lib/coins';
import { activeNets } from '../lib/multichain';
import { ETH_NETS } from '../lib/multichain-core';
import { requestUri } from '../lib/scan-core';

type Mode = 'show' | 'scan' | 'tap';
type For = 'lyx' | 'btc' | 'eth' | 'sol' | 'trx';
const NAMES: Record<For, string> = { lyx: 'LOKYX', btc: 'Bitcoin', eth: 'Ethereum', sol: 'Solana', trx: 'Tron' };

export default function RingScreen() {
  const q = useLocalSearchParams<{ mode?: Mode; for?: For }>();
  const [mode, setMode] = useState<Mode>(q.mode === 'scan' ? 'scan' : q.mode === 'tap' ? 'tap' : 'show');
  const insets = useSafeAreaInsets();
  const canTap = useRef(tapSupported()).current;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {mode === 'show' ? <Show /> : mode === 'tap' ? <Tap /> : <Scan />}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'flex-end' }}>
        <IconButton name="close" label="Close" onPress={() => router.back()} bg={mode !== 'show' ? 'rgba(30,30,34,0.7)' : C.fill} />
      </View>
      {!q.for && <View style={{ position: 'absolute', bottom: insets.bottom + 18, left: 0, right: 0, alignItems: 'center' }}>
        <View style={{ width: canTap ? 300 : 240 }}>
          <Segmented<Mode> value={mode} onChange={setMode} options={canTap ? [['show', 'My ring'], ['tap', 'Tap'], ['scan', 'Scan']] : [['show', 'My ring'], ['scan', 'Scan']]} />
        </View>
      </View>}
    </View>
  );
}

// ---------- showing your ring ----------

function Show() {
  const me = useAccountRef();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const size = Math.min(width - 48, 350);
  const [ask, setAsk] = useState(false);
  const [amt, setAmt] = useState('');
  const [view, setView] = useState<'ring' | 'qr'>('ring');
  const [req, setReq] = useState('');
  const address = me?.address ?? '';
  const canTap = useRef(tapSupported()).current;
  const [tapOn, setTapOn] = useState(false);
  const [tapCoin, setTapCoin] = useState('lyx');
  const coins = useCoins();
  const chainId = ETH_NETS[activeNets().eth].chainId;
  const tapList = [
    { id: 'lyx', label: 'LOKYX' },
    ...(coins.btc.address ? [{ id: 'btc', label: 'Bitcoin' }] : []),
    ...(coins.eth.address ? [{ id: 'eth', label: 'Ethereum' }] : []),
    ...(coins.eth.address ? coins.tokens.map((t) => ({ id: t.contract, label: t.symbol })) : []),
  ];
  const tok = coins.tokens.find((t) => t.contract === tapCoin);
  const tapText =
    tapCoin === 'lyx' ? tapRequest(address, req || undefined)
    : tapCoin === 'btc' ? requestUri('btc', coins.btc.address ?? '')
    : tok ? tapTokenRequest(tok.contract, coins.eth.address ?? '', chainId)
    : coins.eth.address ?? '';
  const tapState = useTapReceive(tapText, tapOn);
  useEffect(() => {
    if (tapState.state !== 'read') return;
    const id = setTimeout(() => setTapOn(false), 2600);
    return () => clearTimeout(id);
  }, [tapState.state]);

  const copy = async () => {
    await Clipboard.setStringAsync(address);
    success();
    toast('Address copied', 'copy');
  };
  const share = async (amount?: string) => {
    const link = `lokyx:${address}${amount ? `?amount=${amount}` : ''}`;
    const msg = amount ? `Please send me ${amount} LYX\n${link}` : `My LOKYX address\n${address}`;
    if (Platform.OS === 'web') {
      await Clipboard.setStringAsync(msg);
      toast('Copied, ready to paste');
    } else await Share.share({ message: msg });
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 76, alignItems: 'center', paddingHorizontal: 24 }}>
      <Animated.View entering={FadeIn.duration(300)} style={{ alignItems: 'center', gap: 6 }}>
        <T v="title">My ring</T>
        <T v="sub" dim>{req ? `Asking for ${req} LYX` : view === 'ring' ? 'Scan this ring to pay me' : 'Any QR scanner can read this'}</T>
      </Animated.View>
      <View style={{ flex: 1, justifyContent: 'center', paddingBottom: 40 }}>
        <TapWaves on={tapOn} sent={tapOn && tapState.state === 'read'} size={size}>
        <Press haptic={false} disabled={!!req} onPress={() => setView((v) => (v === 'ring' ? 'qr' : 'ring'))} accessibilityLabel="Flip between ring and QR" scaleTo={0.99}>
        {view === 'ring' && !req ? (
          <Animated.View key="ring" entering={FadeIn.duration(220)}>
            <RingCode address={address} size={size} />
          </Animated.View>
        ) : (
          <Animated.View key={`qr${req}`} entering={FadeIn.duration(220)} style={{ padding: 14, backgroundColor: '#fff', borderRadius: 24 }}>
            <Qr value={`lokyx:${address}${req ? `?amount=${req}` : ''}`} size={size - 60} />
          </Animated.View>
        )}
        </Press>
        </TapWaves>
      </View>
      {canTap && <TapPill on={tapOn} state={tapState.state} problem={tapState.problem} onPress={() => setTapOn((v) => !v)} coins={tapList} coin={tapCoin} onCoin={setTapCoin} />}
      <T v="mono" color={C.soft} style={{ textAlign: 'center', lineHeight: 22, paddingHorizontal: 10 }}>
        <T v="mono" style={{ fontFamily: F.semibold }}>{address.slice(0, 6)}</T>
        {address.slice(6, -6)}
        <T v="mono" style={{ fontFamily: F.semibold }}>{address.slice(-6)}</T>
      </T>
      <View style={{ paddingBottom: insets.bottom + 86 }}>
        <ActionRow items={[
          { icon: 'copy', label: 'Copy', onPress: copy },
          { icon: 'share', label: 'Share', onPress: () => share(req || undefined) },
          { icon: 'plus', label: req ? 'Clear the amount' : 'Ask for an amount', onPress: () => (req ? setReq('') : setAsk(true)) },
          { icon: 'qr', label: view === 'ring' ? 'Show QR' : 'Show ring', onPress: () => { setReq(''); setView((v) => (v === 'ring' ? 'qr' : 'ring')); } },
        ]} />
      </View>

      <Sheet open={ask} onClose={() => setAsk(false)}>
        <View style={{ gap: 18 }}>
          <T v="headline" style={{ textAlign: 'center' }}>How much are you asking for?</T>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8, height: 70 }}>
            <T style={{ fontFamily: F.semibold, fontSize: 52, letterSpacing: -2, color: amt ? C.text : C.faint }}>{amt || '0'}</T>
            <T style={{ fontFamily: F.medium, fontSize: 20, color: C.sub }}>LYX</T>
          </View>
          <Keypad onKey={(k) => setAmt((a) => typeAmount(a, k))} extra="." />
          <Button
            title="Share request"
            disabled={!amt || Number(amt) === 0}
            onPress={() => {
              setAsk(false);
              setReq(amt.replace(/\.$/, ''));
              setView('qr');
            }}
          />
        </View>
      </Sheet>
    </View>
  );
}

// ---------- tap ----------

/** The sender's side: hold your phone to someone's, and what they ask for opens ready to send. */
function Tap() {
  const [found, setFound] = useState<Found | null>(null);
  const t = useTapSend(!found, (f) => {
    if (found) return;
    setFound(f);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (f.capsule) setTimeout(() => router.replace(`/capsule/${f.address}`), 900);
  });
  useEffect(() => {
    if (t.state === 'near' && Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [t.state]);
  const coins = useCoins();
  const name = found?.token ? coins.tokens.find((x) => x.contract.toLowerCase() === found.token!.toLowerCase())?.symbol : undefined;
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <TapView found={found} state={t.state} problem={t.problem} ask={found ? tapAsk(found, name) : ''} />
      {found && !found.capsule ? <PaySheet found={found} bottom={insets.bottom + 12} token={found.token} /> : null}
    </View>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const CHECK_LEN = 46;

export function TapView({ found, state, problem, ask }: { found: Found | null; state: string; problem: string; ask?: string }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const near = state === 'near' || state === 'read' || !!found;
  // searching: waves leave the phone. Found each other: they turn and rush in. Done: a green burst and a pop.
  const w = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const closing = useSharedValue(0);
  const done = useSharedValue(0);
  const disc = useSharedValue(1);
  useEffect(() => {
    w.forEach((v, i) => {
      v.value = 0;
      v.value = withDelay(i * 700, withRepeat(withTiming(1, { duration: near ? 900 : 2100, easing: near ? Easing.in(Easing.quad) : Easing.out(Easing.quad) }), -1));
    });
    closing.value = withTiming(near ? 1 : 0, { duration: 260 });
    disc.value = near ? withSpring(1.12, { damping: 10, stiffness: 180 }) : withTiming(1, { duration: 200 });
  }, [near]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!found) return;
    done.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) });
    disc.value = withSequence(withTiming(1.25, { duration: 120 }), withSpring(1, { damping: 7, stiffness: 150 }));
  }, [found]); // eslint-disable-line react-hooks/exhaustive-deps
  const styles = w.map((v) =>
    useAnimatedStyle(() => ({ // eslint-disable-line react-hooks/rules-of-hooks
      opacity: found ? 0 : near ? v.value * 0.6 : (1 - v.value) * 0.5,
      transform: [{ scale: near ? 1.6 - v.value * 1.1 : 0.5 + v.value * 1.1 }],
    })),
  );
  const burst = useAnimatedStyle(() => ({ opacity: (1 - done.value) * (done.value > 0 ? 0.9 : 0), transform: [{ scale: 0.6 + done.value * 1.5 }] }));
  const draw = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LEN * (1 - Math.min(1, Math.max(0, (done.value - 0.12) / 0.45))) }));
  const core = useAnimatedStyle(() => ({ transform: [{ scale: disc.value }] }));
  const d = Math.min(width - 80, 300);
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingTop: insets.top + 76, paddingHorizontal: 24 }}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Animated.View key={found ? 'f' : near ? 'n' : 's'} entering={FadeIn.duration(220)}>
          <T v="title" style={{ textAlign: 'center' }}>{found ? 'Got it' : near ? 'Connecting…' : 'Tap to pay'}</T>
        </Animated.View>
        <T v="sub" dim style={{ textAlign: 'center' }}>{found ? `${ask ? `${ask} · ` : ''}${shortAddr(found.address)}` : near ? 'Keep them together for a moment' : 'Hold the top of your phone to theirs. They turn on Tap under their ring.'}</T>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: d, height: d, alignItems: 'center', justifyContent: 'center' }}>
          {styles.map((st, i) => (
            <Animated.View key={i} style={[{ position: 'absolute', width: d, height: d, borderRadius: d / 2, borderWidth: 2, borderColor: C.text }, st]} />
          ))}
          <Animated.View style={[{ position: 'absolute', width: d, height: d, borderRadius: d / 2, borderWidth: 4, borderColor: C.good }, burst]} />
          <Animated.View style={[{ width: 112, height: 112, borderRadius: 56, backgroundColor: found ? C.good : C.fill, alignItems: 'center', justifyContent: 'center' }, core]}>
            {found ? (
              <Svg width={56} height={56} viewBox="0 0 56 56">
                <AnimatedPath d="M13 29 L24 40 L43 17" stroke="#000" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={`${CHECK_LEN} ${CHECK_LEN}`} animatedProps={draw} />
              </Svg>
            ) : (
              <Icon name="send" size={44} color={C.text} width={1.6} />
            )}
          </Animated.View>
        </View>
      </View>
      {problem ? <T v="sub" color={C.bad} style={{ textAlign: 'center', paddingBottom: 12 }}>{problem}</T> : null}
      <View style={{ height: insets.bottom + 90 }} />
    </View>
  );
}

// ---------- scanning ----------

function Scan() {
  const q = useLocalSearchParams<{ for?: For; token?: string }>();
  const want = q.for;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [perm, ask] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [paste, setPaste] = useState(false);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [clip, setClip] = useState<Found | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Clipboard.hasStringAsync().then(async (has) => {
      if (!has) return;
      const f = parsePayload((await Clipboard.getStringAsync()).trim());
      if (f && !f.capsule) setClip(f);
    }).catch(() => {});
  }, []);
  const busy = useRef(false);
  const lastQr = useRef(0);
  const noteAt = useRef(0);
  const r = Math.min(width * 0.38, 170);
  const cy = height / 2;

  // the sweep that circles the window while looking
  const spin = useSharedValue(0);
  const hit = useSharedValue(0);
  useEffect(() => {
    spin.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.linear }), -1);
  }, [spin]);
  const sweep = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }], opacity: 1 - hit.value }));
  // the window breathes while it looks, and a ripple leaves it when it finds something
  const breathe = useSharedValue(0);
  useEffect(() => {
    breathe.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [breathe]);
  const halo = useAnimatedStyle(() => ({ opacity: (0.1 + breathe.value * 0.22) * (1 - hit.value), transform: [{ scale: 1 + breathe.value * 0.035 }] }));
  const ripple = useAnimatedStyle(() => ({ opacity: hit.value * (1 - hit.value) * 3.2, transform: [{ scale: 1 + hit.value * 0.28 }] }));
  const edge = useAnimatedStyle(() => ({ transform: [{ scale: 1 - hit.value * 0.04 }], borderColor: hit.value > 0.5 ? C.good : 'rgba(255,255,255,0.9)' }));

  // a quiet line under the circle, at most once every couple of seconds so it doesn't flicker
  const say = useCallback((t: string) => {
    if (Date.now() - noteAt.current < 1800) return;
    noteAt.current = Date.now();
    setNote(t);
  }, []);

  const done = useCallback(
    (f: Found) => {
      if (found) return;
      const kind: For = f.chain ?? 'lyx';
      // opened from a send screen: only that coin's addresses count
      if (want && (kind !== want || f.capsule)) return say(`That is a ${NAMES[kind]} address. You are sending ${NAMES[want]}.`);
      if (want === 'eth' && f.token && q.token && f.token.toLowerCase() !== q.token.toLowerCase()) return say('That request is for a different token.');
      setFound(f);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      hit.value = withTiming(1, { duration: DUR.base, easing: EASE_OUT });
      const token = f.token ?? (want === 'eth' ? q.token : undefined);
      // a person to pay waits for a tap on the sheet; capsules open straight away
      if (f.capsule) setTimeout(() => router.replace(`/capsule/${f.address}`), 520);
      else void token;
    },
    [found, hit, want, q.token, say],
  );

  // a ring or QR code from a photo in the library
  const gallery = useCallback(async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      const a = res.assets?.[0];
      if (res.canceled || !a) return;
      const qr = await scanFromURLAsync(a.uri, ['qr']).catch(() => []);
      const f = qr[0] ? parsePayload(qr[0].data) : await ringFromPhoto({ uri: a.uri, width: a.width, height: a.height }, { w: a.width, h: a.height, r: Math.min(a.width, a.height) / 2 }).catch(() => null);
      if (f) done(f);
      else say('No address or ring found in that photo.');
    } catch {
      say("Couldn't open that photo.");
    }
  }, [done, say]);

  // Rings: now and then take a small photo and look for one. Photos pause the camera's own QR reader for a
  // moment, so they wait while a QR code is in view. Otherwise one follows the last straight away: the ring is read
  // as fast as the phone can take and read a photo.
  useEffect(() => {
    if (!ready || found) return;
    let live = true;
    const loop = async () => {
      await new Promise((res) => setTimeout(res, 500));
      while (live && !found) {
        const qrInView = Date.now() - lastQr.current < 1500;
        if (!busy.current && cam.current && !qrInView) {
          busy.current = true;
          try {
            const p = await cam.current.takePictureAsync({ quality: 0.4, shutterSound: false, skipProcessing: true });
            if (p && live) {
              const f = await ringFromPhoto(p, { w: width, h: height, r });
              if (f && live) done(f);
            }
          } catch {
            /* camera busy or closed; try again */
          }
          busy.current = false;
        }
        await new Promise((res) => setTimeout(res, 120));
      }
    };
    loop();
    return () => {
      live = false;
    };
  }, [ready, found, width, height, r, done]);

  if (!perm) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  if (!perm.granted)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 18 }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: C.text, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="scan" size={40} color={C.text} width={1.6} />
        </View>
        <T v="title" style={{ textAlign: 'center' }}>Let the wallet use the camera</T>
        <T v="sub" dim style={{ textAlign: 'center' }}>To read someone's ring or QR code. Photos stay on your phone and aren't kept.</T>
        <Button title={perm.canAskAgain ? 'Allow camera' : 'Open settings'} onPress={ask} style={{ alignSelf: 'stretch' }} />
        <Press onPress={() => setPaste(true)} style={{ padding: 10 }}>
          <T v="callout" dim>Type or paste an address instead</T>
        </Press>
        <PasteSheet open={paste} onClose={() => setPaste(false)} value={typed} onChange={setTyped} onFound={done} want={want} />
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        ref={cam}
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        zoom={zoom}
        autofocus="on"
        animateShutter={false}
        onCameraReady={() => setReady(true)}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={found ? undefined : (e) => {
          lastQr.current = Date.now();
          if (!want && parseGift(e.data)) return router.replace(`/gift/claim?code=${encodeURIComponent(e.data.trim())}`);
          const b = !want ? parseBoardLink(e.data) : null;
          if (b) return router.replace(`/swap/board?join=${encodeURIComponent(`lokyx-board:${b}`)}`);
          const f = parsePayload(e.data);
          if (f) done(f);
          else say("This QR code isn't an address or a payment request.");
        }}
      />
      {/* everything outside the circle is dimmed */}
      <Svg style={StyleSheet.absoluteFill} width={width} height={height} pointerEvents="none">
        <Defs>
          <Mask id="hole">
            <Rect x={0} y={0} width={width} height={height} fill="white" />
            <Circle cx={width / 2} cy={cy} r={r} fill="black" />
          </Mask>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="rgba(0,0,0,0.72)" mask="url(#hole)" />
      </Svg>
      <View pointerEvents="none" style={{ position: 'absolute', left: width / 2 - r - 6, top: cy - r - 6, width: (r + 6) * 2, height: (r + 6) * 2 }}>
        <Animated.View style={[{ position: 'absolute', inset: -22 }, halo]}>
          <Svg width={(r + 28) * 2} height={(r + 28) * 2}>
            {Array.from({ length: 72 }, (_, i) => {
              const a = (i / 72) * Math.PI * 2;
              const c = r + 28;
              const r1 = r + 16;
              const r2 = r + (i % 6 === 0 ? 27 : 22);
              return <Path key={i} d={`M${c + Math.cos(a) * r1} ${c + Math.sin(a) * r1}L${c + Math.cos(a) * r2} ${c + Math.sin(a) * r2}`} stroke="#fff" strokeWidth={i % 6 === 0 ? 1.6 : 1} strokeLinecap="round" />;
            })}
          </Svg>
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', inset: -8, borderRadius: r + 14, borderWidth: 1, borderColor: '#fff' }, halo]} />
        <Animated.View style={[{ position: 'absolute', inset: 0, borderRadius: r + 6, borderWidth: 2, borderColor: C.good }, ripple]} />
        <Animated.View style={[{ position: 'absolute', inset: 0, borderRadius: r + 6, borderWidth: 2 }, edge]} />
        <Animated.View style={[{ position: 'absolute', inset: -10 }, sweep]}>
          <Svg width={(r + 16) * 2} height={(r + 16) * 2}>
            <Circle cx={r + 16} cy={r + 16} r={r + 14} stroke={C.text} strokeWidth={3} strokeLinecap="round" fill="none" strokeDasharray={`${(r + 14) * 0.9} ${(r + 14) * 6}`} />
          </Svg>
        </Animated.View>
      </View>

      <View pointerEvents="none" style={{ position: 'absolute', top: cy - r - 92, left: 24, right: 24, alignItems: 'center', gap: 6 }}>
        <T v="title" style={{ textAlign: 'center' }}>{found ? (found.capsule ? 'A time capsule' : 'Got it') : want ? `Scan a ${NAMES[want]} address` : 'Scan to pay'}</T>
        <T v="sub" color={C.soft} style={{ textAlign: 'center' }}>{found ? shortAddr(found.address) : 'A QR code or a LOKYX ring. Hold the phone steady, about a hand away.'}</T>
      </View>

      {found && (
        <Animated.View entering={FadeIn.duration(DUR.base).easing(EASE_OUT)} pointerEvents="none" style={{ position: 'absolute', left: width / 2 - 36, top: cy - 36, width: 72, height: 72, borderRadius: 36, backgroundColor: C.good, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={36} color="#000" width={3} />
        </Animated.View>
      )}

      {!found && note ? (
        <Animated.View key={note} entering={FadeIn.duration(DUR.base).easing(EASE_OUT)} pointerEvents="none" style={{ position: 'absolute', top: cy + r + 140, left: 24, right: 24, alignItems: 'center' }}>
          <View style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16, backgroundColor: note.startsWith('That is a') ? 'rgba(90,20,24,0.9)' : 'rgba(30,30,34,0.85)' }}>
            <T v="sub" color={note.startsWith('That is a') ? '#ffb4ba' : undefined} style={{ textAlign: 'center' }}>{note}</T>
          </View>
        </Animated.View>
      ) : null}
      {!found && Platform.OS !== 'web' && (
        <View style={{ position: 'absolute', top: cy + r + 24, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', height: 40, borderRadius: 20, backgroundColor: 'rgba(40,40,44,0.8)', padding: 3, gap: 2 }}>
            {([['1×', 0], ['2×', 0.18], ['3×', 0.34]] as [string, number][]).map(([label, z]) => (
              <Press key={label} haptic={false} onPress={() => (tap(), setZoom(z))} accessibilityLabel={`Zoom ${label}`} style={{ width: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: zoom === z ? 'rgba(255,255,255,0.22)' : 'transparent' }}>
                <T style={{ fontFamily: F.semibold, fontSize: 13.5, color: zoom === z ? '#fff' : C.sub }}>{label}</T>
              </Press>
            ))}
          </View>
        </View>
      )}
      {!found && (
        <Animated.View entering={FadeInDown.delay(200).duration(DUR.base).easing(EASE_OUT)} exiting={FadeOut.duration(DUR.fast)} style={{ position: 'absolute', top: cy + r + 76, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 16 }}>
          {Platform.OS !== 'web' && (
            <Press onPress={() => (tap(), setTorch((t) => !t))} accessibilityLabel="Torch" style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: torch ? C.ink : 'rgba(40,40,44,0.8)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="flash" size={22} color={torch ? C.inkText : C.text} width={2} />
            </Press>
          )}
          <Press onPress={gallery} accessibilityLabel="Gallery" style={{ height: 52, paddingHorizontal: 20, borderRadius: 26, backgroundColor: 'rgba(40,40,44,0.8)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="qr" size={18} color={C.text} />
            <T v="callout">Gallery</T>
          </Press>
          <Press onPress={() => setPaste(true)} accessibilityLabel="Type or paste" style={{ height: 52, paddingHorizontal: 20, borderRadius: 26, backgroundColor: 'rgba(40,40,44,0.8)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="pen" size={18} color={C.text} />
            <T v="callout">Type or paste</T>
          </Press>
        </Animated.View>
      )}
      {found && !found.capsule ? <PaySheet found={found} bottom={insets.bottom + 12} token={found.token ?? (want === 'eth' ? q.token : undefined)} /> : null}
      {!found && clip && !paste ? (
        <Animated.View entering={FadeInDown.delay(400).duration(DUR.base).easing(EASE_OUT)} style={{ position: 'absolute', top: insets.top + 12, left: 20, right: 20 }}>
          <Press onPress={() => done(clip)} style={{ height: 48, borderRadius: 24, backgroundColor: 'rgba(40,40,44,0.88)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 10 }}>
            <Icon name="copy" size={16} color={C.text} />
            <T v="sub" style={{ flex: 1 }} numberOfLines={1}>{`Address copied: ${shortAddr(clip.address)}`}</T>
            <T v="callout">Pay</T>
          </Press>
        </Animated.View>
      ) : null}
      <View style={{ height: insets.bottom }} />
      <PasteSheet open={paste} onClose={() => setPaste(false)} value={typed} onChange={setTyped} onFound={done} want={want} />
    </View>
  );
}

function PasteSheet({ open, onClose, value, onChange, onFound, want }: { open: boolean; onClose: () => void; value: string; onChange: (s: string) => void; onFound: (f: Found) => void; want?: For }) {
  const f = parsePayload(value);
  return (
    <Sheet open={open} onClose={onClose}>
      <View style={{ gap: 14 }}>
        <T v="headline">Who are you paying?</T>
        <Field value={value} onChangeText={onChange} placeholder={want === 'btc' ? 'bc1… or tb1…' : want === 'eth' ? '0x…' : 'lyx1…, bc1… or 0x…'} autoCapitalize="none" autoCorrect={false} mono autoFocus />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button
            title="Paste"
            kind="line"
            style={{ flex: 1 }}
            onPress={async () => {
              onChange((await Clipboard.getStringAsync()).trim());
            }}
          />
          <Button
            title="Continue"
            style={{ flex: 1 }}
            disabled={!f}
            onPress={() => {
              if (!f) return;
              onClose();
              onFound(f);
            }}
          />
        </View>
        {value.length > 6 && !f && <T v="sub" color={C.bad}>{`That isn't ${want ? `a ${NAMES[want]}` : 'an'} address.`}</T>}
      </View>
    </Sheet>
  );
}
