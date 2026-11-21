import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { formatEther } from 'viem';
import Svg, { Circle } from 'react-native-svg';
import Animated, { Easing, FadeIn, FadeInDown, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { T } from './Text';
import { Button, Field, Press } from './controls';
import { Icon } from './Icon';
import { Avatar } from './RingCode';
import { SlideToPay } from './SlideToPay';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';
import { shortAddr } from '../lib/format';
import { activeNets, lookupToken } from '../lib/multichain';
import { combineTone, capApproval, typedAmount, type Tone } from '../lib/sign-view-core';
import { describeData } from '../lib/evm-dapp-core';
import { formatUnits } from '../lib/multichain-core';
import type { ContractCheck } from '../lib/contract-check';
import type { Assessment } from '../lib/signing-core';

const ROSE = '#D98880';
const TONE = {
  allow: { color: C.good, word: 'LOOKS FINE', glyph: 'check' as const },
  review: { color: C.wait, word: 'BE CAREFUL', glyph: 'info' as const },
  stop: { color: ROSE, word: 'STOPPED', glyph: 'x' as const },
};
/** The ring scans for at least this long, so a fast answer still reads as "checked" and not "guessed". */
const MIN_SCAN = 900;
const HOLD_MS = 1600;

/** A ring that turns while the checks run, then closes in the verdict's colour. */
function Seal({ tone }: { tone: Tone | null }) {
  const still = useReducedMotion();
  const spin = useSharedValue(0);
  const done = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    spin.value = withRepeat(withTiming(360, { duration: 1100, easing: Easing.linear }), -1);
  }, [still, spin]);
  useEffect(() => {
    done.value = withTiming(tone ? 1 : 0, { duration: 600, easing: EASE_OUT });
  }, [tone, done]);
  const arc = useAnimatedStyle(() => ({ opacity: 1 - done.value, transform: [{ rotate: `${spin.value}deg` }] }));
  const ring = useAnimatedStyle(() => ({ opacity: done.value }));
  const core = useAnimatedStyle(() => ({ opacity: done.value, transform: [{ scale: 0.7 + 0.3 * done.value }] }));
  const t = tone ? TONE[tone] : null;
  const col = t?.color ?? '#fff';
  return (
    <View style={{ width: 84, height: 84, alignSelf: 'center' }} accessible accessibilityLabel={t ? t.word.toLowerCase() : 'checking this request'}>
      <Svg width={84} height={84} style={{ position: 'absolute' }}>
        <Circle cx={42} cy={42} r={38} stroke="rgba(255,255,255,0.1)" strokeWidth={3} fill="none" />
      </Svg>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, ring]}>
        <Svg width={84} height={84}>
          <Circle cx={42} cy={42} r={38} stroke={col} strokeWidth={3} fill="none" />
        </Svg>
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, arc]}>
        <Svg width={84} height={84}>
          <Circle cx={42} cy={42} r={38} stroke="#fff" strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray="40 200" />
        </Svg>
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: 10, top: 10, width: 64, height: 64, borderRadius: 32, backgroundColor: col + '24', alignItems: 'center', justifyContent: 'center' }, core]}>
        {t ? <Icon name={t.glyph === 'x' ? 'close' : t.glyph} size={28} color={col} width={2.4} /> : null}
      </Animated.View>
    </View>
  );
}

/** Press and keep holding to confirm: a bar fills, and letting go early cancels. The deliberate way through a warning. */
function HoldButton({ label, onDone, disabled }: { label: string; onDone: () => void; disabled?: boolean }) {
  const p = useSharedValue(0);
  const [w, setW] = useState(0);
  const fire = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    onDone();
  };
  const g = Gesture.LongPress()
    .enabled(!disabled)
    .minDuration(HOLD_MS)
    .maxDistance(40)
    .onBegin(() => {
      p.value = withTiming(1, { duration: HOLD_MS, easing: Easing.linear });
    })
    .onStart(() => runOnJS(fire)())
    .onFinalize(() => {
      p.value = withTiming(0, { duration: 200 });
    });
  const fill = useAnimatedStyle(() => ({ width: p.value * w }));
  return (
    <GestureDetector gesture={g}>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Press and hold" style={{ height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', opacity: disabled ? 0.4 : 1 }}>
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(245,184,61,0.32)' }, fill]} />
        <T style={{ fontFamily: F.medium, fontSize: 15, color: C.soft }}>{label}</T>
      </View>
    </GestureDetector>
  );
}

function Card({ small, children, sub }: { small: string; children: React.ReactNode; sub?: string }) {
  return (
    <View style={{ flex: 1, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)', paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', gap: 6 }}>
      <T style={{ fontFamily: F.semibold, fontSize: 11, letterSpacing: 1.6, color: C.faint }}>{small}</T>
      {children}
      {sub ? <T v="caption" dim style={{ textAlign: 'center' }} numberOfLines={2}>{sub}</T> : null}
    </View>
  );
}
const Big = ({ children }: { children: string }) => <T style={{ fontFamily: F.semibold, fontSize: 18, letterSpacing: -0.4, textAlign: 'center' }} numberOfLines={2}>{children}</T>;

export type SignProps = {
  ask: { kind: 'send'; to: string | null; value: bigint; data: string; site: { origin: string } } | { kind: 'typed'; json: string; primaryType: string; site: { origin: string } };
  chk: ContractCheck | null | 'busy';
  ass: Assessment | null;
  unit: string;
  explorer: string;
  busy: boolean;
  /** approve, optionally with rewritten transaction data (a smaller approval) */
  onApprove: (data?: string) => Promise<boolean>;
  onReject: () => void;
};

/**
 * What a website asks you to approve, in one picture. A ring scans, then says one word in one colour. Under it one plain
 * sentence and what moves, with the safe choice as the big button. Approving a warning takes a deliberate hold; a stopped
 * request has no approve button at all.
 */
export function SignRequest({ ask, chk, ass, unit, explorer, busy, onApprove, onReject }: SignProps) {
  const [scanned, setScanned] = useState(false);
  const [details, setDetails] = useState(false);
  const [more, setMore] = useState(false);
  const [typed, setTyped] = useState('');
  const [tok, setTok] = useState<{ symbol: string; decimals: number } | null>(null);
  const key = useRef(0);
  useEffect(() => {
    setScanned(false);
    setDetails(false);
    setMore(false);
    setTyped('');
    setTok(null);
    const t = setTimeout(() => setScanned(true), MIN_SCAN);
    return () => clearTimeout(t);
  }, [ask]);

  const data = ask.kind === 'send' ? describeData(ask.data) : null;
  const isApprove = data?.kind === 'approve';
  useEffect(() => {
    if (!isApprove || ask.kind !== 'send' || !ask.to) return;
    let live = true;
    lookupToken(activeNets().eth, ask.to).then((t) => live && setTok({ symbol: t.symbol, decimals: t.decimals }), () => {});
    return () => {
      live = false;
    };
  }, [ask, isApprove]);

  const ready = scanned && chk !== 'busy' && (ask.kind === 'typed' || true) && ass !== null;
  const tone: Tone | null = ready ? combineTone(ass && !ass.skipped ? ass.level : null, chk && chk !== 'busy' ? chk.verdict.level : null) : null;
  const t = tone ? TONE[tone] : null;
  const host = ask.site.origin.replace(/^https?:\/\//, '').replace(/^www\./, '');

  // the words
  const guarded = !!ass && !ass.skipped && (ass.level !== 'allow' || !!ass.main);
  const verdictWords = chk && chk !== 'busy' ? chk.verdict : null;
  let headline = 'Checking this request…';
  let says = '';
  if (tone) {
    const symbol = tok?.symbol ?? 'tokens';
    if (guarded && ass!.level !== 'allow') {
      headline = ass!.headline;
      says = ass!.sub ?? ass!.why;
    } else if (verdictWords && tone !== 'allow') {
      headline = tone === 'stop' ? 'Stop and read this first' : "We can't vouch for this contract";
      says = verdictWords.reasons[0] ?? '';
    } else if (isApprove) {
      headline = `Let this contract use your ${symbol}?`;
      says = verdictWords?.reasons[0] ?? 'A known contract.';
    } else if (ask.kind === 'send') {
      headline = data?.kind === 'other' ? 'Use a contract' : `Send ${formatEther(ask.value)} ${unit}`;
      says = verdictWords?.reasons[0] ?? 'Nothing unusual found.';
    } else {
      headline = `Sign ${ask.primaryType}`;
      says = ass?.why || 'Signing is free, but it can work like a payment later.';
    }
  }

  // the amount an approval is cut to
  const cap = isApprove && data ? (typed ? tok && typedAmount(typed, tok.decimals) : null) : null;
  const fixed = isApprove && data && !data.unlimited;
  const needsCap = isApprove && data?.unlimited && !more;
  const approveReady = !needsCap || (cap != null && cap > 0n);
  const go = async () => {
    if (ask.kind !== 'send') return onApprove();
    if (isApprove && data?.unlimited && !more && cap != null) return onApprove(capApproval(ask.data, cap) ?? undefined);
    return onApprove();
  };
  void key;

  const spender = data?.spender ?? ass?.main?.spender;
  return (
    <View style={{ gap: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <View style={{ width: 20, height: 20, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ fontFamily: F.semibold, fontSize: 10 }}>{host.slice(0, 2).toUpperCase()}</T>
        </View>
        <T v="sub" color={C.soft} style={{ fontSize: 14 }}>{host}</T>
      </View>
      <View style={{ height: 18 }} />
      <Seal tone={tone} />
      <T style={{ fontFamily: F.semibold, fontSize: 12, letterSpacing: 2.4, color: t?.color ?? C.soft, textAlign: 'center', marginTop: 12, height: 16 }}>{t ? t.word : 'CHECKING THIS REQUEST…'}</T>
      {tone ? (
        <Animated.View entering={FadeInDown.duration(DUR.slow).easing(EASE_OUT)} key={headline}>
          <T style={{ fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.8, lineHeight: 31, textAlign: 'center', marginTop: 6 }}>{headline}</T>
          {says ? <T v="sub" style={{ textAlign: 'center', color: C.soft, lineHeight: 21, marginTop: 8, paddingHorizontal: 6 }}>{says}</T> : null}
        </Animated.View>
      ) : null}

      {tone ? (
        <Animated.View entering={FadeInDown.delay(250).duration(DUR.slow).easing(EASE_OUT)} style={{ marginTop: 20, gap: 12 }}>
          {ask.kind === 'send' && isApprove ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Card small="YOU ALLOW" sub={tok ? `to use, up to` : undefined}>
                <Big>{data!.unlimited ? `All your ${tok?.symbol ?? 'tokens'}` : `${tok ? formatUnits(data!.amount ?? 0n, tok.decimals, 6) : String(data!.amount)} ${tok?.symbol ?? ''}`}</Big>
              </Card>
              <Icon name="forward" size={16} color={C.sub} />
              <Card small="TO" sub={shortAddr(spender ?? '')}>
                <Avatar address={spender ?? ''} size={36} />
              </Card>
            </View>
          ) : ask.kind === 'send' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Card small="YOU GIVE">
                <Big>{ask.value > 0n ? `${formatEther(ask.value)} ${unit}` : 'No coins'}</Big>
              </Card>
              <Icon name="forward" size={16} color={C.sub} />
              <Card small={data?.kind === 'other' ? 'YOU GET' : 'TO'} sub={data?.kind === 'other' ? 'The wallet can’t preview this yet' : undefined}>
                {data?.kind === 'other' ? <Big>?</Big> : <Avatar address={ask.to ?? ''} size={36} />}
                {data?.kind !== 'other' ? <T v="caption" dim>{shortAddr(ask.to ?? '')}</T> : null}
              </Card>
            </View>
          ) : null}

          {needsCap && tone !== 'stop' ? (
            <View style={{ gap: 8 }}>
              <T v="sub" color={C.soft}>How much can it use? After that it has to ask again.</T>
              <Field value={typed} onChangeText={(s) => setTyped(s.replace(/[^\d.]/g, ''))} placeholder={`Amount in ${tok?.symbol ?? 'tokens'}`} keyboardType="decimal-pad" />
              <Press onPress={() => setMore(true)} haptic={false}>
                <T v="caption" dim style={{ textAlign: 'center' }}>More options: <T v="caption" color={ROSE}>allow unlimited</T></T>
              </Press>
            </View>
          ) : null}
          {isApprove && data?.unlimited && more ? <T v="sub" color={ROSE} style={{ textAlign: 'center' }}>Unlimited: it can take every one of these tokens, any time, until you cancel it.</T> : null}

          {details ? (
            <Animated.View entering={FadeIn.duration(DUR.base)} style={{ borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', padding: 14, gap: 8 }}>
              {[...(ass?.reasons.map((r) => r.text) ?? []), ...(verdictWords?.reasons ?? [])].filter((x, i, a) => x && a.indexOf(x) === i).map((r, i) => (
                <T key={i} v="sub" style={{ lineHeight: 20 }}>{r}</T>
              ))}
              {chk && chk !== 'busy' ? chk.parties.map((p) => (
                <Press key={p.address + p.role} onPress={() => Linking.openURL(`${explorer}${p.address}`).catch(() => {})} haptic={false}>
                  <T v="caption" color={C.soft}>{`Open ${p.role === 'spender' ? 'the spender' : 'the contract'} on the explorer`}</T>
                </Press>
              )) : null}
            </Animated.View>
          ) : null}
        </Animated.View>
      ) : null}

      <View style={{ height: 22 }} />
      {tone === 'allow' ? (
        <View style={{ gap: 6 }}>
          <SlideToPay label={cap && tok ? `Slide to approve ${typed} ${tok.symbol}` : 'Slide to approve'} onSlide={go} busy={busy} disabled={!approveReady} />
          <Button title="Reject" kind="plain" onPress={onReject} disabled={busy} />
          <Press onPress={() => setDetails(!details)} haptic={false}><T v="caption" dim style={{ textAlign: 'center' }}>{details ? 'Hide details' : 'Details'}</T></Press>
        </View>
      ) : tone === 'review' ? (
        <View style={{ gap: 12 }}>
          <Button title="Don't approve" onPress={onReject} disabled={busy} />
          <HoldButton label="Hold to approve anyway" onDone={() => void go()} disabled={busy || !approveReady} />
          <Press onPress={() => setDetails(!details)} haptic={false}><T v="caption" dim style={{ textAlign: 'center' }}>{details ? 'Hide details' : 'Why?'}</T></Press>
        </View>
      ) : tone === 'stop' ? (
        <View style={{ gap: 10 }}>
          <Button title="Reject" onPress={onReject} disabled={busy} />
          <Press onPress={() => setDetails(!details)} haptic={false}><T v="caption" dim style={{ textAlign: 'center' }}>{details ? 'Hide details' : 'Show details'}</T></Press>
        </View>
      ) : (
        <Button title="Reject" kind="plain" onPress={onReject} />
      )}
      <T v="caption" dim style={{ textAlign: 'center', marginTop: 12 }}>The wallet looks the contract up in public code registries and on this phone. Your keys never leave it.</T>
    </View>
  );
}
