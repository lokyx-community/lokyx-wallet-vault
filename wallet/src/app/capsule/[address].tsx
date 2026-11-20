import { Aurora } from '../../ui/Aurora';
import { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, Share, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import Animated, { Easing, FadeIn, FadeInDown, FadeInUp, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Button, ErrorText, Field, Group, IconButton, Line, failure, success } from '../../ui/controls';
import { Sheet } from '../../ui/Sheet';
import { Digits } from '../../ui/Digits';
import { RingCode } from '../../ui/RingCode';
import { CapsuleShape, OrbitScene, PLANET } from '../../ui/Orbit';
import { toast } from '../../ui/Toast';
import { C, F } from '../../ui/theme';
import { TYPE_CAPSULE } from '../../lib/ring';
import { parseLyx } from '../../lib/lokyx';
import { currentAddress } from '../../lib/wallet';
import { confirmIt } from '../../lib/auth';
import { useChain } from '../../lib/chain';
import { addToCapsule, capsuleFor, capsuleTitle, dateText, openCapsule, readNote, readState, remember, updateLocal, useCapsule, type CapsuleState } from '../../lib/capsules';
import { labelFor, niceLyx } from '../../lib/format';
import { ContractsOnly } from '../../ui/ContractsOnly';
import { KeyboardScroll } from '../../ui/KeyboardScroll';
import { DUR, EASE_OUT } from '../../ui/motion';

function Countdown({ opens }: { opens: number }) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor(opens - now));
  const parts: [string, number][] = [
    ['days', Math.floor(s / 86400)],
    ['hours', Math.floor((s % 86400) / 3600)],
    ['min', Math.floor((s % 3600) / 60)],
    ['sec', s % 60],
  ];
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
      {parts.map(([l, v], i) => (
        <View key={l} style={{ alignItems: 'center', minWidth: 70, paddingVertical: 12, borderRadius: 18, backgroundColor: C.fill, flex: i === 0 ? 1.2 : 1 }}>
          <Digits text={i === 0 ? v.toLocaleString('en-US') : String(v).padStart(2, '0')} style={{ fontFamily: F.semibold, fontSize: 30, letterSpacing: -1, lineHeight: 38 }} />
          <T v="caption" dim>{l}</T>
        </View>
      ))}
    </View>
  );
}

/** The capsule pulses, splits in two, and what was inside comes out. */
function Opening({ amount, note, onDone }: { amount: string; note: string | null; onDone: () => void }) {
  const { width } = useWindowDimensions();
  const pulse = useSharedValue(1);
  const split = useSharedValue(0);
  const flash = useSharedValue(0);
  const [stage, setStage] = useState(0);
  const [typed, setTyped] = useState('');
  const [shown, setShown] = useState('0');
  useEffect(() => {
    pulse.value = withSequence(withTiming(1.06, { duration: 360, easing: EASE_OUT }), withTiming(1, { duration: 520, easing: EASE_OUT }));
    split.value = withDelay(950, withTiming(1, { duration: 900, easing: EASE_OUT }));
    flash.value = withDelay(950, withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 900, easing: Easing.out(Easing.quad) })));
    const a = setTimeout(() => {
      setStage(1);
      success();
    }, 1000);
    const b = setTimeout(() => setShown(niceLyx(amount)), 1500);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [amount, pulse, split, flash]);
  useEffect(() => {
    if (stage < 1 || !note) return;
    let i = 0;
    const t = setInterval(() => {
      i += Math.max(1, Math.round(note.length / 120));
      setTyped(note.slice(0, i));
      if (i >= note.length) clearInterval(t);
    }, 28);
    return () => clearInterval(t);
  }, [stage, note]);
  const whole = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const left = useAnimatedStyle(() => ({ transform: [{ translateX: -split.value * 90 }, { translateY: split.value * 30 }, { rotate: `${-split.value * 40}deg` }], opacity: Math.max(0, 1 - split.value * 1.3) }));
  const right = useAnimatedStyle(() => ({ transform: [{ translateX: split.value * 90 }, { translateY: split.value * 30 }, { rotate: `${split.value * 40}deg` }], opacity: Math.max(0, 1 - split.value * 1.3) }));
  const glow = useAnimatedStyle(() => ({ opacity: flash.value, transform: [{ scale: 0.4 + flash.value * 2.6 }] }));
  const sparks = Array.from({ length: 14 }, (_, i) => (i / 14) * Math.PI * 2);
  return (
    <View style={{ alignItems: 'center', gap: 22 }}>
      <View style={{ width, height: 170, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: PLANET.light }, glow]} />
        {sparks.map((a, i) => (
          <Spark key={i} angle={a} go={stage >= 1} />
        ))}
        <Animated.View style={[{ flexDirection: 'row' }, whole]}>
          <Animated.View style={[{ width: 40, height: 38, borderTopLeftRadius: 19, borderBottomLeftRadius: 19, backgroundColor: '#F5F5F7' }, left]} />
          <Animated.View style={[{ width: 40, height: 38, borderTopRightRadius: 19, borderBottomRightRadius: 19, backgroundColor: '#D9DCE6' }, right]} />
        </Animated.View>
      </View>
      {stage >= 1 && (
        <Animated.View entering={FadeInUp.duration(DUR.base).easing(EASE_OUT)} style={{ alignItems: 'center', gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Digits text={shown} style={{ fontFamily: F.semibold, fontSize: 54, letterSpacing: -2, lineHeight: 66 }} />
            <T style={{ fontFamily: F.medium, fontSize: 20, color: C.sub }}>LYX</T>
          </View>
          <T v="sub" dim>is yours now</T>
        </Animated.View>
      )}
      {stage >= 1 && !!note && (
        <Animated.View entering={FadeIn.delay(300)} style={{ alignSelf: 'stretch', borderRadius: 26, backgroundColor: '#F2EFE8', padding: 20, minHeight: 120 }}>
          <T style={{ color: '#1C1A17', fontFamily: F.regular, fontSize: 18, lineHeight: 27 }}>{typed}</T>
        </Animated.View>
      )}
      {stage >= 1 && (
        <Animated.View entering={FadeIn.delay(900)} style={{ alignSelf: 'stretch' }}>
          <Button title="Done" kind="line" onPress={onDone} />
        </Animated.View>
      )}
    </View>
  );
}

function Spark({ angle, go }: { angle: number; go: boolean }) {
  const k = useSharedValue(0);
  useEffect(() => {
    if (go) k.value = withTiming(1, { duration: 900 + Math.random() * 400, easing: Easing.out(Easing.cubic) });
  }, [go, k]);
  const d = 70 + Math.random() * 60;
  const a = useAnimatedStyle(() => ({ opacity: k.value > 0 ? 1 - k.value : 0, transform: [{ translateX: Math.cos(angle) * d * k.value }, { translateY: Math.sin(angle) * d * k.value }, { scale: 1 - k.value * 0.6 }] }));
  return <Animated.View style={[{ position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: angle % 2 > 1 ? PLANET.light : '#F5F5F7' }, a]} />;
}

function Floating() {
  const k = useSharedValue(0);
  useEffect(() => {
    k.value = withRepeat(withSequence(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.sin) })), -1);
  }, [k]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: -6 * k.value }, { rotate: `${-14 + 6 * k.value}deg` }] }));
  return (
    <Animated.View style={a}>
      <CapsuleShape w={86} h={40} />
    </Animated.View>
  );
}

function CapsuleScreen() {
  const { address } = useLocalSearchParams<{ address: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const local = useCapsule(address);
  const chain = useChain().info;
  const me = currentAddress();
  const [st, setSt] = useState<CapsuleState | null>(null);
  const [note, setNote] = useState<string | null | undefined>(undefined); // undefined: not looked yet
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<{ amount: string; note: string | null } | null>(null);
  const [ring, setRing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [more, setMore] = useState('');

  const load = useCallback(async () => {
    try {
      const s = capsuleFor(address) ? await readState(address) : await remember(address);
      setSt(s);
      if (s.opened && !capsuleFor(address)?.opened) await updateLocal(address, { opened: s.opened });
      try {
        setNote(await readNote(address));
      } catch {
        setNote(null); // the time network can't be reached; the rest still works
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [address]);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const chainNow = chain?.bestTimestamp ?? Date.now() / 1000;
  const ready = !!st && chainNow >= st.opens;
  const forMe = st?.to === me;
  const c = local ?? (st ? { ...st, title: '', amountLyx: st.amountLyx, opened: st.opened || undefined } : null);

  const open = async () => {
    if (!st) return;
    setErr('');
    if (!(await confirmIt('Open the time capsule', { keyFollows: true }))) return;
    setBusy(true);
    try {
      const amount = st.amountLyx;
      const n = typeof note === 'string' ? note : await readNote(address).catch(() => null);
      await openCapsule(address);
      setOpening({ amount, note: n });
    } catch (e) {
      failure();
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const link = `lokyx:capsule/${address}`;
    const msg = `I sealed a time capsule for you. It opens on ${st ? dateText(st.opens) : 'the day'}.\n${link}`;
    if (Platform.OS === 'web') {
      await Clipboard.setStringAsync(msg);
      toast('Copied, ready to paste');
    } else await Share.share({ message: msg });
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Aurora />
      <KeyboardScroll contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40, gap: 20 }}>
        <View style={{ paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
          <IconButton name="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/capsule'))} />
          {st && !st.opened && <IconButton name="scan" label="Show its ring" onPress={() => setRing(true)} />}
        </View>

        {opening ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 30 }}>
            <Opening amount={opening.amount} note={opening.note} onDone={() => router.replace('/capsule')} />
          </View>
        ) : !st ? (
          <View style={{ alignItems: 'center', paddingTop: 120, gap: 10 }}>
            {err ? <ErrorText hint>{err}</ErrorText> : <T v="sub" dim>Finding the capsule…</T>}
          </View>
        ) : (
          <>
            <Animated.View entering={FadeIn.duration(600)} style={{ alignItems: 'center', height: Math.min(width, 440) * 0.62, justifyContent: 'center' }}>
              {st.opened ? <Floating /> : ready ? <Floating /> : <OrbitScene size={Math.min(width, 440)} riders={[Math.min(1, (Date.now() / 1000 - st.sealed) / Math.max(1, st.opens - st.sealed))]} speed={1.6} />}
            </Animated.View>
            <View style={{ paddingHorizontal: 20, gap: 6, alignItems: 'center' }}>
              <T v="title" style={{ textAlign: 'center' }}>{c ? capsuleTitle({ ...c, from: st.from, to: st.to, opens: st.opens, sealed: st.sealed, title: local?.title ?? '' }, me) : ''}</T>
              <T v="sub" color={ready && !st.opened ? PLANET.light : C.sub}>
                {st.opened ? `Opened on ${dateText(st.opened)}` : ready ? (forMe ? 'Today is the day' : `Ready for ${labelFor(st.to)} to open`) : `Opens on ${dateText(st.opens)}`}
              </T>
            </View>

            <View style={{ paddingHorizontal: 20, gap: 18 }}>
              {!st.opened && !ready && <Countdown opens={st.opens} />}

              {!st.opened && ready && forMe && (
                <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)}>
                  <Button title="Open it" onPress={open} busy={busy} />
                </Animated.View>
              )}

              {(st.opened || ready) && typeof note === 'string' && (
                <View style={{ borderRadius: 26, backgroundColor: '#F2EFE8', padding: 20 }}>
                  <T style={{ color: '#1C1A17', fontFamily: F.regular, fontSize: 18, lineHeight: 27 }}>{note || '(no note)'}</T>
                </View>
              )}
              {(st.opened || ready) && note === null && (
                <View style={{ borderRadius: 22, backgroundColor: C.fill, padding: 16, gap: 4 }}>
                  <T v="callout">The note is still locked</T>
                  <T v="sub" dim>It unlocks with today's key from the time network, which can't be reached right now. It'll show up here once it can.</T>
                </View>
              )}
              {!st.opened && !ready && local?.note && st.from === me && (
                <View style={{ borderRadius: 22, backgroundColor: C.fill, padding: 16, gap: 6 }}>
                  <T v="caption" dim>What you wrote. It's locked on the chain; only this phone kept a copy.</T>
                  <T v="body" color={C.soft} numberOfLines={4}>{local.note}</T>
                </View>
              )}

              <Group>
                <Line label="From" value={labelFor(st.from)} />
                <Line label="For" value={labelFor(st.to)} />
                <Line label="Inside" value={st.opened ? 'Taken out' : `${niceLyx(st.amountLyx)} LYX`} />
                <Line label="Sealed" value={st.sealed ? dateText(st.sealed) : '…'} />
              </Group>
              <ErrorText>{err}</ErrorText>

              {!st.opened && (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button title="Add LYX" icon="plus" kind="line" onPress={() => setAdding(true)} style={{ flex: 1 }} />
                  {st.to !== me && <Button title="Send it to them" icon="share" kind="line" onPress={share} style={{ flex: 1.3 }} />}
                </View>
              )}
            </View>
          </>
        )}
      </KeyboardScroll>

      <Sheet open={ring} onClose={() => setRing(false)}>
        <View style={{ alignItems: 'center', gap: 16 }}>
          <T v="headline">This capsule's ring</T>
          <RingCode address={address} size={Math.min(width - 96, 280)} type={TYPE_CAPSULE} />
          <T v="sub" dim style={{ textAlign: 'center' }}>Whoever scans it with LOKYX Wallet can follow the capsule. Only the person it's for can open it.</T>
          <Button title="Share link" icon="share" kind="line" onPress={share} style={{ alignSelf: 'stretch' }} />
        </View>
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)}>
        <View style={{ gap: 14 }}>
          <T v="title">Add LYX</T>
          <Field value={more} onChangeText={(s) => setMore(s.replace(/[^\d.]/g, ''))} placeholder="How much" keyboardType="decimal-pad" autoFocus />
          <Button
            title={more ? `Add ${more} LYX` : 'Add'}
            disabled={!more}
            busy={busy}
            onPress={async () => {
              let v: bigint;
              try {
                v = parseLyx(more);
              } catch (e) {
                return toast((e as Error).message, 'info');
              }
              setAdding(false);
              await new Promise((r) => setTimeout(r, 250));
              if (!(await confirmIt(`Add ${more} LYX`, { keyFollows: true }))) return;
              setBusy(true);
              try {
                await addToCapsule(address, v, more);
                success();
                toast(`${more} LYX on its way in`);
                setMore('');
              } catch (e) {
                failure();
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </View>
      </Sheet>
    </View>
  );
}

export default function CapsuleScreenGate() {
  return (
    <ContractsOnly>
      <CapsuleScreen />
    </ContractsOnly>
  );
}
