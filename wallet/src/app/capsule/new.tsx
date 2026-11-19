import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, FadeIn, FadeInDown, FadeInUp, interpolate, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Button, ErrorText, Field, IconButton, Press, failure, success, tick } from '../../ui/controls';
import { Segmented } from '../../ui/Segmented';
import { SlideToPay } from '../../ui/SlideToPay';
import { OrbitScene } from '../../ui/Orbit';
import { C, F } from '../../ui/theme';
import { isAddress, parseLyx } from '../../lib/lokyx';
import { currentAddress, useAccountRef, useWallet } from '../../lib/wallet';
import { useContacts } from '../../lib/data';
import { dateText, estimateSeal, lockFor, seal } from '../../lib/capsules';
import { bioName, biometricKind, confirmIt, type Bio } from '../../lib/auth';
import { labelFor } from '../../lib/format';
import { useChain } from '../../lib/chain';
import { ContractsOnly } from '../../ui/ContractsOnly';
import { KeyboardScroll } from '../../ui/KeyboardScroll';
import { DUR, EASE_OUT } from '../../ui/motion';

const PRESETS: [string, (d: Date) => Date][] = [
  ['A month', (d) => new Date(d.getFullYear(), d.getMonth() + 1, d.getDate(), 9)],
  ['Six months', (d) => new Date(d.getFullYear(), d.getMonth() + 6, d.getDate(), 9)],
  ['A year', (d) => new Date(d.getFullYear() + 1, d.getMonth(), d.getDate(), 9)],
  ['Five years', (d) => new Date(d.getFullYear() + 5, d.getMonth(), d.getDate(), 9)],
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      <T v="caption" dim>{label}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Press onPress={() => (tick(), onMinus())} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.fill2 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 16 }}>−</T>
        </Press>
        <Animated.Text key={value} entering={FadeInDown.duration(160)} style={{ minWidth: 48, textAlign: 'center', color: C.text, fontFamily: F.semibold, fontSize: 18 }}>
          {value}
        </Animated.Text>
        <Press onPress={() => (tick(), onPlus())} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.fill2 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 16 }}>+</T>
        </Press>
      </View>
    </View>
  );
}

function NewCapsule() {
  const insets = useSafeAreaInsets();
  const me = useAccountRef();
  const w = useWallet();
  const people = useContacts();
  const chain = useChain().info;
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('');
  const [who, setWho] = useState<'me' | 'someone'>('me');
  const [to, setTo] = useState('');
  const [when, setWhen] = useState(() => PRESETS[2][1](new Date()));
  const [preset, setPreset] = useState(2);
  const [amt, setAmt] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [bio, setBio] = useState<Bio>(null);
  const [sealedAt, setSealedAt] = useState<number | null>(null);

  useEffect(() => {
    biometricKind().then((b) => setBio(w.settings.biometrics ? b : null));
  }, [w.settings.biometrics]);

  const recipient = who === 'me' ? me?.address ?? '' : to.trim().toLowerCase();
  const opens = Math.floor(when.getTime() / 1000);
  const bytes = useMemo(() => new TextEncoder().encode(note).length, [note]);
  const shift = (f: (d: Date) => void) => {
    const d = new Date(when);
    f(d);
    setPreset(-1);
    setWhen(d);
  };

  const going = useRef(false);
  const go = async (): Promise<boolean> => {
    if (going.current) return false;
    going.current = true;
    try {
      return await goOnce();
    } finally {
      going.current = false;
    }
  };
  const goOnce = async (): Promise<boolean> => {
    setErr('');
    let value = 0n;
    try {
      value = amt ? parseLyx(amt) : 0n;
    } catch (e) {
      return (setErr((e as Error).message), false);
    }
    if (!isAddress(recipient)) return (setErr("That isn't a LOKYX address"), false);
    const now = chain?.bestTimestamp ?? Date.now() / 1000;
    if (opens < now + 60) return (setErr('Pick a day in the future'), false);
    if (!note.trim() && value === 0n) return (setErr('Write a note or put some LYX in'), false);
    if (bytes > 1000) return (setErr('The note is a little too long'), false);
    setBusy(true);
    try {
      // lock the note to the day first; what goes on the chain is unreadable until then
      const locked = await lockFor(note, opens);
      const g = await estimateSeal(recipient, opens, locked, value);
      if (!g.ok) throw new Error(g.error ?? "It can't be sealed");
      if (!(await confirmIt('Seal the capsule', { keyFollows: true }))) return (setBusy(false), false);
      await seal({ to: recipient, opens, note, locked, title: title.trim(), value, amountLyx: amt.replace(/\.$/, '') || '0', gas: g.gasLimit });
      success();
      setSealedAt(Date.now());
      return true;
    } catch (e) {
      failure();
      setErr((e as Error).message);
      setBusy(false);
      return false;
    }
  };

  if (sealedAt) return <Sealing note={note} opens={opens} to={recipient} />;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 48 }}>
        <IconButton name="close" label="Close" onPress={() => router.back()} />
        <T v="headline" style={{ flex: 1, textAlign: 'center', marginRight: 40 }}>New time capsule</T>
      </View>
      <KeyboardScroll contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 22 }} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)} style={{ borderRadius: 26, backgroundColor: '#F2EFE8', padding: 20, paddingBottom: 14, gap: 6, transform: [{ rotate: '-0.6deg' }] }}>
          <Field
            value={note}
            onChangeText={setNote}
            multiline
            placeholder={who === 'me' ? 'Dear future me…' : 'Write them something for the day it opens…'}
            placeholderTextColor="#8D877C"
            selectionColor="#222"
            keyboardAppearance="light"
            style={{ backgroundColor: 'transparent', color: '#1C1A17', fontSize: 18, lineHeight: 27, minHeight: 150, paddingHorizontal: 0, paddingVertical: 0, fontFamily: F.regular }}
          />
          <T v="caption" color={bytes > 1000 ? C.bad : '#8D877C'} style={{ alignSelf: 'flex-end' }}>{1000 - bytes}</T>
        </Animated.View>

        <View style={{ gap: 10 }}>
          <T v="sub" dim>For</T>
          <Segmented<'me' | 'someone'> value={who} onChange={setWho} options={[['me', 'Future me'], ['someone', 'Someone else']]} />
          {who === 'someone' && (
            <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)} style={{ gap: 10 }}>
              <Field value={to} onChangeText={setTo} placeholder="lyx1… address" autoCapitalize="none" autoCorrect={false} mono />
              {people.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {people.map((p) => (
                    <Press key={p.address} onPress={() => (tick(), setTo(p.address))} style={{ paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: to === p.address ? C.ink : C.fill, justifyContent: 'center' }}>
                      <T v="sub" color={to === p.address ? C.inkText : C.text}>{p.name}</T>
                    </Press>
                  ))}
                </ScrollView>
              )}
            </Animated.View>
          )}
        </View>

        <View style={{ gap: 10 }}>
          <T v="sub" dim>Opens</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PRESETS.map(([l, f], i) => (
              <Press key={l} onPress={() => (tick(), setPreset(i), setWhen(f(new Date())))} style={{ paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: preset === i ? C.ink : C.fill, justifyContent: 'center' }}>
                <T v="sub" style={{ fontFamily: F.medium }} color={preset === i ? C.inkText : C.text}>{l}</T>
              </Press>
            ))}
          </View>
          <View style={{ flexDirection: 'row', borderRadius: 20, backgroundColor: C.fill, paddingVertical: 14 }}>
            <Stepper label="Day" value={String(when.getDate())} onMinus={() => shift((d) => d.setDate(d.getDate() - 1))} onPlus={() => shift((d) => d.setDate(d.getDate() + 1))} />
            <Stepper label="Month" value={MONTHS[when.getMonth()]} onMinus={() => shift((d) => d.setMonth(d.getMonth() - 1))} onPlus={() => shift((d) => d.setMonth(d.getMonth() + 1))} />
            <Stepper label="Year" value={String(when.getFullYear())} onMinus={() => shift((d) => d.setFullYear(d.getFullYear() - 1))} onPlus={() => shift((d) => d.setFullYear(d.getFullYear() + 1))} />
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <T v="sub" dim>Put LYX inside (optional)</T>
          <Field value={amt} onChangeText={(s) => setAmt(s.replace(/[^\d.]/g, ''))} placeholder="0" keyboardType="decimal-pad" />
          <Field value={title} onChangeText={setTitle} placeholder="Call it something, like Our first year" maxLength={40} />
        </View>

        <T v="caption" dim style={{ lineHeight: 18 }}>
          It opens on {dateText(opens)}{who === 'someone' && isAddress(recipient) ? `, and only ${labelFor(recipient)} can open it` : ''}. The note is locked until that moment: nobody can read it before then, wherever they look.
        </T>
        <ErrorText>{err}</ErrorText>
        <SlideToPay label={busy ? 'Sealing' : 'Slide to seal'} busy={busy} onSlide={go} />
        <T v="caption" dim style={{ textAlign: 'center', marginTop: -12 }}>Then {bio ? bioName(bio) : 'your passcode'} to confirm</T>
      </KeyboardScroll>
    </View>
  );
}

/** The note folds into a capsule, which lifts off and settles into orbit. */
function Sealing({ note, opens, to }: { note: string; opens: number; to: string }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const fold = useSharedValue(0);
  const lift = useSharedValue(0);
  const scene = useSharedValue(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    fold.value = withDelay(150, withTiming(1, { duration: 750, easing: Easing.bezier(0.7, 0, 0.25, 1) }));
    lift.value = withDelay(1000, withTiming(1, { duration: 900, easing: Easing.bezier(0.5, 0, 0.2, 1) }));
    scene.value = withDelay(1250, withTiming(1, { duration: 900, easing: EASE_OUT }));
    const t = setTimeout(() => setDone(true), 1900);
    return () => clearTimeout(t);
  }, [fold, lift, scene]);

  const W = Math.min(width - 48, 360);
  const card = useAnimatedStyle(() => ({
    width: interpolate(fold.value, [0, 1], [W, 64]),
    height: interpolate(fold.value, [0, 1], [230, 30]),
    borderRadius: interpolate(fold.value, [0, 1], [26, 15]),
    backgroundColor: fold.value > 0.6 ? '#F5F5F7' : '#F2EFE8',
    transform: [
      { translateY: interpolate(lift.value, [0, 1], [0, -height * 0.26]) },
      { scale: interpolate(lift.value, [0, 1], [1, 0.25]) },
      { rotate: `${interpolate(fold.value, [0, 1], [-0.6, -18])}deg` },
    ],
    opacity: interpolate(lift.value, [0, 0.85, 1], [1, 1, 0]),
    shadowOpacity: fold.value,
  }));
  const words = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, fold.value * 2.2) }));
  const orbit = useAnimatedStyle(() => ({ opacity: scene.value, transform: [{ scale: 0.7 + 0.3 * scene.value }] }));
  const me = currentAddress();

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top, paddingBottom: insets.bottom + 20 }}>
      <Animated.View style={[{ position: 'absolute', top: insets.top + 40, left: 0, right: 0, alignItems: 'center' }, orbit]}>
        <OrbitScene size={Math.min(width, 440)} riders={[0.05]} speed={2.2} />
      </Animated.View>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
        <Animated.View style={[{ padding: 20, overflow: 'hidden', shadowColor: '#fff', shadowRadius: 18, shadowOffset: { width: 0, height: 0 } }, card]}>
          <Animated.Text numberOfLines={7} style={[{ color: '#1C1A17', fontFamily: F.regular, fontSize: 17, lineHeight: 26 }, words]}>
            {note || 'A capsule'}
          </Animated.Text>
        </Animated.View>
      </View>
      {done && (
        <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: 24, gap: 10 }}>
          <Animated.View entering={FadeInUp.duration(DUR.base).easing(EASE_OUT)} style={{ alignItems: 'center', gap: 8, paddingBottom: 18 }}>
            <T v="display">Sealed</T>
            <T v="body" dim style={{ textAlign: 'center' }}>
              It's in orbit until {dateText(opens)}.{'\n'}
              {to === me ? "We'll keep it safe for you." : `Send ${labelFor(to)} its ring so they can find it.`}
            </T>
          </Animated.View>
          <Animated.View entering={FadeIn.delay(250)} style={{ gap: 10 }}>
            <Button title="Done" onPress={() => router.replace('/capsule')} />
          </Animated.View>
        </View>
      )}
      {!done && <View style={{ flex: 1 }} />}
    </View>
  );
}

export default function NewCapsuleGate() {
  return (
    <ContractsOnly>
      <NewCapsule />
    </ContractsOnly>
  );
}
