import { useEffect, useId, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient as LG, RadialGradient as RG, Rect, Stop } from 'react-native-svg';
import { T } from '../../ui/Text';
import { Field, Press } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { C, F } from '../../ui/theme';
import { siteUrl } from '../../lib/rpc';
import { sites, useSites } from '../../lib/data';
import { currentAddress } from '../../lib/wallet';
import { toUrl } from '../../lib/provider';
import { Planet } from '../../ui/Orbit';
import { Aurora } from '../../ui/Aurora';
import { useBookmarks } from '../../lib/bookmarks';
import { useCapsules } from '../../lib/capsules';
import { useContractsOn } from '../../lib/chain';
import { KeyboardScroll } from '../../ui/KeyboardScroll';
import { Logo } from '../../ui/Logo';
import { DUR, EASE_OUT } from '../../ui/motion';
import { AppGlyph, type GlyphName } from '../../ui/AppGlyph';
import { Sheet } from '../../ui/Sheet';

const open = (u: string) => router.push(`/browser?url=${encodeURIComponent(u)}`);

type Tone = { g: [string, string, string]; ink: string };
const TONES: Record<'champagne' | 'platinum' | 'pearl' | 'walnut', Tone> = {
  champagne: { g: ['#F1E2C4', '#CDB07F', '#76603C'], ink: '#2A2112' },
  platinum: { g: ['#F2F2F6', '#B7B9C5', '#5E606C'], ink: '#1E2028' },
  pearl: { g: ['#FBF7EE', '#D9D2C2', '#8C8570'], ink: '#26231B' },
  walnut: { g: ['#D6B79C', '#9A6B4B', '#432A1D'], ink: '#FFF4EA' },
};
type ToneName = keyof typeof TONES;

/** Each block of the page arrives a beat after the one above it, easing in from just below. */
function useRise(i: number) {
  const still = useReducedMotion();
  return still ? undefined : FadeInDown.delay(70 + i * 80).duration(DUR.slow + 120).easing(EASE_OUT);
}

/** A slow drift, up and down, so resting things are never completely still. */
function useFloat(period: number, amp: number, phase = 0) {
  const still = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    v.value = withDelay(phase, withRepeat(withSequence(withTiming(1, { duration: period, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: period, easing: Easing.inOut(Easing.sin) })), -1));
  }, [still, period, phase, v]);
  return useAnimatedStyle(() => ({ transform: [{ translateY: -amp * v.value }] }));
}

/** A square of metal-like colour with the app's mark on it. */
function ToneTile({ tone, glyph, size = 36, radius = 10 }: { tone: ToneName; glyph: GlyphName; size?: number; radius?: number }) {
  const t = TONES[tone];
  const id = 't' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.35)' }}>
      <Svg style={{ position: 'absolute' }} width={size} height={size}>
        <Defs>
          <LG id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={t.g[0]} />
            <Stop offset="0.55" stopColor={t.g[1]} />
            <Stop offset="1" stopColor={t.g[2]} />
          </LG>
        </Defs>
        <Rect x={0} y={0} width={size} height={size} fill={`url(#${id})`} />
      </Svg>
      <AppGlyph name={glyph} size={Math.round(size * 0.56)} color={t.ink} fill={0.28} />
    </View>
  );
}

/** A website you use often, as an app icon with its name underneath. */
function Fav({ title, fixed, onPress, index }: { title: string; fixed?: boolean; onPress: () => void; index: number }) {
  const still = useReducedMotion();
  const id = 'f' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Animated.View entering={still ? undefined : FadeInDown.delay(180 + index * 60).duration(DUR.slow).easing(EASE_OUT)} style={{ width: 74, alignItems: 'center' }}>
      <Press onPress={onPress} scaleTo={0.92} style={{ alignItems: 'center', gap: 7 }}>
        <View style={{ width: 62, height: 62, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)' }}>
          <Svg style={{ position: 'absolute' }} width={62} height={62}>
            <Defs>
              <LG id={id} x1="0" y1="0" x2="0.4" y2="1">
                <Stop offset="0" stopColor="#26262B" />
                <Stop offset="1" stopColor="#141417" />
              </LG>
            </Defs>
            <Rect x={0} y={0} width={62} height={62} fill={`url(#${id})`} />
          </Svg>
          {fixed ? <Icon name="globe" size={26} color={C.text} width={1.7} /> : <T style={{ fontFamily: F.semibold, fontSize: 17, letterSpacing: -0.3 }}>{title.slice(0, 2).toUpperCase()}</T>}
        </View>
        <T style={{ fontSize: 11.5, color: C.soft, letterSpacing: -0.1 }} numberOfLines={1}>{title}</T>
      </Press>
    </Animated.View>
  );
}

function Heading({ children }: { children: string }) {
  return <T style={{ fontFamily: F.semibold, fontSize: 22, letterSpacing: -0.5, lineHeight: 28 }}>{children}</T>;
}

/** The one big card of the page: the Apps wallet, with the coins that sit inside it and a light that passes over it. */
function Feature({ width, onPress }: { width: number; onPress: () => void }) {
  const still = useReducedMotion();
  const id = 'z' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const H = 236;
  const sheen = useSharedValue(-1);
  useEffect(() => {
    if (still) return;
    sheen.value = withDelay(900, withRepeat(withSequence(withTiming(1.2, { duration: 1500, easing: Easing.inOut(Easing.quad) }), withDelay(4800, withTiming(-1, { duration: 0 }))), -1));
  }, [still, sheen]);
  const sheenStyle = useAnimatedStyle(() => ({ transform: [{ translateX: sheen.value * width * 0.9 }, { rotate: '16deg' }] }));
  const c0 = useFloat(1700, 2.5, 0);
  const c1 = useFloat(1900, 2.5, 300);
  const c2 = useFloat(2100, 2.5, 600);
  const coins = [['eth', c0], ['usdt', c1], ['usdc', c2]] as const;
  return (
    <Press onPress={onPress} scaleTo={0.985} haptic={false} style={{ width, height: H, borderRadius: 28 }}>
      <View style={{ flex: 1, borderRadius: 28, overflow: 'hidden', borderWidth: 0.5, borderColor: 'rgba(201,160,87,0.45)', shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 22, shadowOffset: { width: 0, height: 18 }, backgroundColor: '#0B0B0C' }}>
        <Svg style={{ position: 'absolute' }} width={width} height={H}>
          <Defs>
            <LG id={id + 'b'} x1="0.1" y1="0" x2="0.9" y2="1">
              <Stop offset="0" stopColor="#2A2A2F" />
              <Stop offset="0.48" stopColor="#141417" />
              <Stop offset="1" stopColor="#070708" />
            </LG>
            <RG id={id + 'h'} cx={width * 0.08} cy={0} r={width * 0.62} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#fff" stopOpacity={0.17} />
              <Stop offset="1" stopColor="#fff" stopOpacity={0} />
            </RG>
            <LG id={id + 'g'} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#F3D58A" />
              <Stop offset="0.5" stopColor="#C9A057" />
              <Stop offset="1" stopColor="#8A6424" />
            </LG>
          </Defs>
          <Rect x={0} y={0} width={width} height={H} fill={`url(#${id}b)`} />
          <Rect x={0} y={0} width={width} height={H} fill={`url(#${id}h)`} />
          <Rect x={width - 76} y={22} width={54} height={42} rx={8} fill={`url(#${id}g)`} stroke="rgba(255,240,200,0.6)" strokeWidth={1} />
          <Rect x={width - 76 + 16} y={31} width={22} height={24} rx={5} fill="none" stroke="rgba(107,76,27,0.55)" strokeWidth={1} />
        </Svg>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -40, bottom: -40, left: 0, width: 80, backgroundColor: 'rgba(255,255,255,0.09)' }, sheenStyle]} />
        <View style={{ position: 'absolute', left: 24, top: 24, right: 90 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 11.5, letterSpacing: 2.2, color: '#C9A057' }}>FOR WEBSITES</T>
          <T style={{ fontFamily: F.semibold, fontSize: 30, letterSpacing: -0.9, lineHeight: 36, marginTop: 6 }}>Apps wallet</T>
          <T style={{ fontSize: 14.5, lineHeight: 20, color: 'rgba(245,245,247,0.62)', marginTop: 3 }}>The only account sites can see. Your vault stays hidden.</T>
        </View>
        <View style={{ position: 'absolute', left: 24, bottom: 24, flexDirection: 'row', gap: 8 }}>
          {coins.map(([id2, style], i) => (
            <Animated.View key={id2} entering={still ? undefined : FadeInDown.delay(500 + i * 120).duration(DUR.slow).easing(EASE_OUT)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(201,160,87,0.38)', alignItems: 'center', justifyContent: 'center' }}>
              <Animated.View style={style}><Logo id={id2} size={34} /></Animated.View>
            </Animated.View>
          ))}
        </View>
        <View style={{ position: 'absolute', right: 24, bottom: 28, height: 34, paddingHorizontal: 20, borderRadius: 17, backgroundColor: '#F5F5F7', justifyContent: 'center' }}>
          <T style={{ fontFamily: F.semibold, fontSize: 15, letterSpacing: -0.2, color: '#000' }}>Open</T>
        </View>
      </View>
    </Press>
  );
}

/** A rounded list of apps, one per row. */
function Group({ rows }: { rows: { tone: ToneName; glyph: GlyphName; name: string; line: string; onPress: () => void; dim?: boolean }[] }) {
  return (
    <View style={{ borderRadius: 22, backgroundColor: C.fill, overflow: 'hidden' }}>
      {rows.map((r, i) => (
        <Press key={r.name} onPress={r.onPress} haptic={false} scaleTo={0.99} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 66, paddingVertical: 10, paddingHorizontal: 16, borderTopWidth: i ? 0.5 : 0, borderTopColor: C.line2, opacity: r.dim ? 0.55 : 1 }}>
          <ToneTile tone={r.tone} glyph={r.glyph} />
          <View style={{ flex: 1, gap: 1 }}>
            <T style={{ fontFamily: F.medium, fontSize: 16.5, letterSpacing: -0.2 }} numberOfLines={1}>{r.name}</T>
            <T style={{ fontSize: 13, lineHeight: 18, color: C.sub }} numberOfLines={2}>{r.line}</T>
          </View>
          <Icon name="chevron" size={14} color={C.faint} width={2.2} />
        </Press>
      ))}
    </View>
  );
}

/** A big square: a colour, a mark, a name. The mark behind it drifts slowly. */
function Square({ tone, glyph, name, line, w, onPress, phase }: { tone: ToneName; glyph: GlyphName; name: string; line: string; w: number; onPress: () => void; phase: number }) {
  const t = TONES[tone];
  const id = 'q' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const drift = useFloat(2600, 5, phase);
  return (
    <Press onPress={onPress} scaleTo={0.97} style={{ width: w, height: w, borderRadius: 26 }}>
      <View style={{ flex: 1, borderRadius: 26, overflow: 'hidden', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.4)', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 12 } }}>
        <Svg style={{ position: 'absolute' }} width={w} height={w}>
          <Defs>
            <LG id={id} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={t.g[0]} />
              <Stop offset="0.55" stopColor={t.g[1]} />
              <Stop offset="1" stopColor={t.g[2]} />
            </LG>
            <LG id={id + 'h'} x1="0" y1="0" x2="0.5" y2="1">
              <Stop offset="0" stopColor="#fff" stopOpacity={0.34} />
              <Stop offset="0.5" stopColor="#fff" stopOpacity={0.03} />
              <Stop offset="1" stopColor="#fff" stopOpacity={0} />
            </LG>
          </Defs>
          <Rect x={0} y={0} width={w} height={w} fill={`url(#${id})`} />
          <Rect x={0} y={0} width={w} height={w} fill={`url(#${id}h)`} />
        </Svg>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', right: -26, bottom: -30, opacity: 0.15 }, drift]}>
          <AppGlyph name={glyph} size={150} color={t.ink} fill={0.3} />
        </Animated.View>
        <View style={{ position: 'absolute', left: 16, top: 16, width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <AppGlyph name={glyph} size={22} color={t.ink} />
        </View>
        <View style={{ position: 'absolute', left: 16, right: 12, bottom: 16 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 18.5, letterSpacing: -0.5, lineHeight: 23, color: t.ink }} numberOfLines={2}>{name}</T>
          <T style={{ fontSize: 12.5, lineHeight: 16, color: t.ink, opacity: 0.72, marginTop: 2 }} numberOfLines={2}>{line}</T>
        </View>
      </View>
    </Press>
  );
}

function Row3({ rows }: { rows: { glyph: GlyphName; name: string; line: string; onPress: () => void; dim?: boolean }[] }) {
  return (
    <View style={{ borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.11)', overflow: 'hidden' }}>
      {rows.map((r, i) => (
        <Press key={r.name} onPress={r.onPress} haptic={false} scaleTo={0.99} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: i ? 0.5 : 0, borderTopColor: 'rgba(255,255,255,0.09)', opacity: r.dim ? 0.55 : 1 }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <AppGlyph name={r.glyph} size={24} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T style={{ fontFamily: F.medium, fontSize: 16, letterSpacing: -0.2 }} numberOfLines={1}>{r.name}</T>
            <T v="caption" dim numberOfLines={2}>{r.line}</T>
          </View>
          <Icon name="chevron" size={14} color={C.faint} width={2.2} />
        </Press>
      ))}
    </View>
  );
}

export default function Apps() {
  const insets = useSafeAreaInsets();
  const { width: sw } = useWindowDimensions();
  const [text, setText] = useState('');
  const [make, setMake] = useState(false);
  const me = currentAddress();
  const connected = useSites().filter((s) => s.address === me);
  const site = siteUrl();
  const capsules = useCapsules().filter((c) => !c.opened);
  const contractsOn = useContractsOn();
  const marks = useBookmarks();
  const cw = sw - 40;
  const sq = Math.floor((cw - 20) / 2);
  const r = [useRise(0), useRise(1), useRise(2), useRise(3), useRise(4), useRise(5), useRise(6)];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Aurora />
    <KeyboardScroll style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: insets.bottom + 130, gap: 30 }} keyboardShouldPersistTaps="handled">
      <Animated.View entering={r[0]} style={{ gap: 16 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 36, letterSpacing: -1.1, lineHeight: 42 }}>Apps</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.075)', paddingLeft: 14 }}>
          <Icon name="search" size={18} color={C.sub} width={2} />
          <Field
            value={text}
            onChangeText={setText}
            placeholder="Search or type a website"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="web-search"
            returnKeyType="go"
            onSubmitEditing={() => text.trim() && open(toUrl(text))}
            style={{ flex: 1, backgroundColor: 'transparent', height: 46 }}
          />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, marginTop: 4 }}>
          {marks.map((b, i) => (
            <Fav key={b.url} index={i} title={b.title} fixed={b.fixed} onPress={() => open(b.url)} />
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={r[1]} style={{ gap: 12 }}>
        <Heading>Keep it safe</Heading>
        <Feature width={cw} onPress={() => router.push('/apps-wallet')} />
        <Group rows={[
          { tone: 'platinum', glyph: 'lock', name: 'Vault', line: 'Any coin. A daily limit and a delay', onPress: () => router.push('/vaults') },
          { tone: 'walnut', glyph: 'jar', name: 'Savings jar', line: 'Lock LYX until a date', onPress: () => router.push('/jar'), dim: !contractsOn },
          { tone: 'pearl', glyph: 'vault', name: 'Import a wallet', line: 'Find old money, move it to a vault', onPress: () => router.push('/import') },
        ]} />
      </Animated.View>

      <Animated.View entering={r[2]} style={{ gap: 12 }}>
        <Heading>Send and share</Heading>
        <View style={{ flexDirection: 'row', gap: 20 }}>
          <Square tone="champagne" glyph="gift" name="Send a card" line="BTC, USDT, USDC, more" w={sq} phase={0} onPress={() => router.push('/gift')} />
          <Square tone="pearl" glyph="shared" name="Shared accounts" line="Pay when enough agree" w={sq} phase={500} onPress={() => router.push('/shared')} />
        </View>
        <Press onPress={() => router.push('/capsule')} scaleTo={0.98} style={{ borderRadius: 26, overflow: 'hidden', height: 132, backgroundColor: '#0B1030', borderWidth: 0.5, borderColor: 'rgba(143,168,255,0.25)' }}>
          <View style={{ position: 'absolute', right: 22, top: 20 }}><Planet size={92} /></View>
          <View style={{ position: 'absolute', left: 22, bottom: 20, right: 130, gap: 2 }}>
            <T style={{ fontFamily: F.semibold, fontSize: 22, letterSpacing: -0.5 }}>Time capsule</T>
            <T style={{ fontSize: 13.5, color: '#9AA6D8' }} numberOfLines={2}>{capsules.length ? `${capsules.length} waiting for their day` : 'Seal LYX until a day you choose'}</T>
            {!contractsOn && <T v="caption" color={C.faint}>You can open it once the network is reachable</T>}
          </View>
        </Press>
      </Animated.View>

      <Animated.View entering={r[3]} style={{ gap: 12 }}>
        <Heading>Make and run</Heading>
        <Group rows={[
          { tone: 'champagne', glyph: 'token', name: 'Make a token', line: 'Your own coin, in a minute', onPress: () => setMake(true) },
          { tone: 'platinum', glyph: 'mining', name: 'Mining', line: 'Earn LYX with your computer', onPress: () => router.push('/mining') },
          { tone: 'pearl', glyph: 'explorer', name: 'Explorer', line: 'Every block and payment', onPress: () => open(`${site}/#/explorer`) },
        ]} />
      </Animated.View>

      <Sheet open={make} onClose={() => setMake(false)}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <T v="title">Make a token</T>
          <T v="sub" dim>Choose where your new coin will live.</T>
          <Row3 rows={[
            { glyph: 'token', name: 'On LOKYX', line: 'Quick and cheap. Ready in about a minute.', onPress: () => { setMake(false); router.push('/make-token'); }, dim: !contractsOn },
            { glyph: 'token', name: 'On Ethereum', line: 'An ERC-20 coin. Costs a little ETH for network fees.', onPress: () => { setMake(false); router.push('/chain/make-token'); } },
          ]} />
        </View>
      </Sheet>

      {contractsOn && (
      <Animated.View layout={LinearTransition.duration(DUR.base).easing(EASE_OUT)} style={{ gap: 4 }}>
        <T v="sub" dim style={{ paddingBottom: 4 }}>Connected</T>
        {connected.length === 0 ? (
          <T v="sub" color={C.faint}>Sites you connect to show up here. You can cut them off any time.</T>
        ) : (
          connected.map((s) => (
            <Animated.View key={s.origin} exiting={FadeOut} layout={LinearTransition.duration(DUR.base).easing(EASE_OUT)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 }}>
              <Press onPress={() => open(s.origin)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }}>
                <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}>
                  <T style={{ fontFamily: F.semibold, fontSize: 13 }}>{s.origin.replace(/^https?:\/\/(www\.)?/, '').slice(0, 2).toUpperCase()}</T>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="callout" numberOfLines={1}>{s.origin.replace(/^https?:\/\//, '')}</T>
                  <T v="caption" dim>Can see your address</T>
                </View>
              </Press>
              <Press onPress={() => sites.save((x) => x.filter((y) => !(y.origin === s.origin && y.address === me)))} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1, borderColor: C.line2, justifyContent: 'center' }}>
                <T v="caption" style={{ fontFamily: F.medium }}>Disconnect</T>
              </Press>
            </Animated.View>
          ))
        )}
      </Animated.View>
      )}
    </KeyboardScroll>
    </View>
  );
}
