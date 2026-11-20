import { useEffect, useId, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient as LG, RadialGradient as RG, Rect, Stop } from 'react-native-svg';
import { T } from '../../ui/Text';
import { Field, Press } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { C, F } from '../../ui/theme';
import { siteUrl } from '../../lib/rpc';
import { sites, useJars, useShared, useSites } from '../../lib/data';
import { currentAddress } from '../../lib/wallet';
import { toUrl } from '../../lib/provider';
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

/** A website you use often, as an app icon with its name underneath. */
function Fav({ title, fixed, onPress, index }: { title: string; fixed?: boolean; onPress: () => void; index: number }) {
  const still = useReducedMotion();
  return (
    <Animated.View entering={still ? undefined : FadeInDown.delay(180 + index * 60).duration(DUR.slow).easing(EASE_OUT)} style={{ width: 64, alignItems: 'center' }}>
      <Press onPress={onPress} scaleTo={0.92} style={{ alignItems: 'center', gap: 7 }}>
        <View style={{ width: 56, height: 56, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)' }}>
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

const glass = { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)' } as const;

/** A glass tile of the page: a mark, a name, one line (or a live fact), and room for a picture. */
function Tile({ w, h, glyph, name, line, meta, onPress, dim, children, wide }: { w?: number; h: number; glyph: GlyphName; name: string; line: string; meta?: string; onPress: () => void; dim?: boolean; children?: React.ReactNode; wide?: boolean }) {
  return (
    <Press onPress={onPress} scaleTo={0.98} style={{ width: w, flex: w ? undefined : 1, height: h, borderRadius: 30, opacity: dim ? 0.55 : 1 }}>
      <View style={[{ flex: 1, borderRadius: 30, overflow: 'hidden', padding: 14, justifyContent: 'space-between', flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : undefined, gap: wide ? 14 : 0 }, glass]}>
        {children}
        {wide ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
              <AppGlyph name={glyph} size={20} color="#fff" />
            </View>
            {meta ? <T style={{ fontSize: 12, color: C.sub }}>{meta}</T> : null}
          </View>
        )}
        {wide ? null : (
          <View>
            <T style={{ fontFamily: F.semibold, fontSize: 17, letterSpacing: -0.4 }} numberOfLines={1}>{name}</T>
            <T style={{ fontSize: 12.5, lineHeight: 16, color: C.sub, marginTop: 2 }} numberOfLines={2}>{line}</T>
          </View>
        )}
      </View>
    </Press>
  );
}

/** Quiet concentric rings, the Vault's picture. */
function Rings() {
  return (
    <Svg style={{ position: 'absolute', right: -30, top: 40 }} width={140} height={140} viewBox="0 0 130 130">
      <Circle cx={65} cy={65} r={48} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth={1.2} />
      <Circle cx={65} cy={65} r={34} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={1.2} />
      <Circle cx={65} cy={65} r={20} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1.2} />
      <Circle cx={65} cy={65} r={6} fill="#fff" />
    </Svg>
  );
}

/** A thin ring that fills as a capsule's day gets closer. */
function Progress({ p, size = 36 }: { p: number; size?: number }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={3.5} />
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" strokeDasharray={`${c * Math.max(0.04, Math.min(1, p))} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </Svg>
  );
}

/** Small round pills, for the things you make or open. */
function Pill({ glyph, name, onPress, dim }: { glyph: GlyphName; name: string; onPress: () => void; dim?: boolean }) {
  return (
    <Press onPress={onPress} scaleTo={0.97} style={[{ height: 46, paddingLeft: 9, paddingRight: 18, borderRadius: 23, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: dim ? 0.55 : 1 }, glass]}>
      <View style={{ width: 28, height: 28, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}><AppGlyph name={glyph} size={16} color="#fff" /></View>
      <T style={{ fontFamily: F.medium, fontSize: 14.5 }}>{name}</T>
    </Press>
  );
}

const Label = ({ children }: { children: string }) => <T style={{ fontFamily: F.medium, fontSize: 11.5, letterSpacing: 1.5, color: C.sub }}>{children}</T>;

type Cat = 'all' | 'protect' | 'share' | 'create';
function Chips({ value, onChange }: { value: Cat; onChange: (c: Cat) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {([['all', 'All'], ['protect', 'Protect'], ['share', 'Share'], ['create', 'Create']] as [Cat, string][]).map(([id, name]) => (
        <Press key={id} onPress={() => onChange(id)} haptic={false} accessibilityLabel={name} style={[{ height: 34, paddingHorizontal: 16, borderRadius: 17, justifyContent: 'center' }, value === id ? { backgroundColor: C.ink } : glass]}>
          <T style={{ fontFamily: F.medium, fontSize: 14, color: value === id ? C.inkText : C.soft }}>{name}</T>
        </Press>
      ))}
    </View>
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
  const [cat, setCat] = useState<Cat>('all');
  const me = currentAddress();
  const connected = useSites().filter((s) => s.address === me);
  const capsules = useCapsules().filter((c) => !c.opened);
  const jars = useJars();
  const sharedAccts = useShared();
  const contractsOn = useContractsOn();
  const marks = useBookmarks();
  const site = siteUrl();
  const cw = sw - 40;
  const col = Math.floor((cw - 14) / 2);
  const r = [useRise(0), useRise(1), useRise(2), useRise(3), useRise(4), useRise(5)];

  // the nearest capsule: how far along it is, and how many days are left
  const soonest = [...capsules].sort((a, b) => a.opens - b.opens)[0];
  const nowS = Date.now() / 1000;
  const capP = soonest && soonest.opens > soonest.sealed ? (nowS - soonest.sealed) / (soonest.opens - soonest.sealed) : 0;
  const capLeft = soonest ? Math.max(0, Math.ceil((soonest.opens - nowS) / 86400)) : 0;
  const capMeta = soonest ? (capLeft === 0 ? 'Today' : `${capLeft} ${capLeft === 1 ? 'day' : 'days'}`) : undefined;

  const vault = (
    <Tile w={col} h={244} glyph="lock" name="Vault" line="Any coin. A daily limit and a delay" onPress={() => router.push('/vaults')}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <Svg width={col} height={244}>
          <Defs><RG id="vg" cx={col / 2} cy={0} r={col} gradientUnits="userSpaceOnUse"><Stop offset="0" stopColor="#8296FF" stopOpacity={0.24} /><Stop offset="1" stopColor="#8296FF" stopOpacity={0} /></RG></Defs>
          <Rect x={0} y={0} width={col} height={244} fill="url(#vg)" />
        </Svg>
        <Rings />
      </View>
    </Tile>
  );
  const jar = <Tile w={col} h={114} glyph="jar" name="Savings jar" line="Lock LYX until a date" meta={jars.length ? `${jars.length} ${jars.length === 1 ? 'jar' : 'jars'}` : undefined} dim={!contractsOn} onPress={() => router.push('/jar')} />;
  const imp = <Tile w={col} h={114} glyph="vault" name="Import a wallet" line="Move old money in" onPress={() => router.push('/import')} />;
  const cap = (
    <Press onPress={() => router.push('/capsule')} scaleTo={0.98} style={{ width: col, height: 114, borderRadius: 30, opacity: contractsOn ? 1 : 0.55 }}>
      <View style={[{ flex: 1, borderRadius: 30, padding: 14, justifyContent: 'space-between' }, glass]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {soonest ? <Progress p={capP} /> : <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}><AppGlyph name="capsule" size={20} color="#fff" /></View>}
          {capMeta ? <T style={{ fontSize: 12, color: C.sub }}>{capMeta}</T> : null}
        </View>
        <View>
          <T style={{ fontFamily: F.semibold, fontSize: 17, letterSpacing: -0.4 }} numberOfLines={1}>Time capsule</T>
          <T style={{ fontSize: 12.5, lineHeight: 16, color: C.sub, marginTop: 2 }} numberOfLines={1}>{capsules.length ? `${capsules.length} waiting` : 'Seal LYX until a day'}</T>
        </View>
      </View>
    </Press>
  );
  const sharedRow = (
    <Press onPress={() => router.push('/shared')} scaleTo={0.98} style={{ height: 104, borderRadius: 30 }}>
      <View style={[{ flex: 1, borderRadius: 30, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14 }, glass]}>
        <View style={{ flexDirection: 'row' }}>
          {['#8AA0FF', '#5FE3A6', '#E8B93A'].map((c, i) => <View key={c} style={{ width: 38, height: 38, borderRadius: 19, marginLeft: i ? -12 : 0, backgroundColor: c, opacity: 0.85, borderWidth: 2.5, borderColor: '#0D0D12' }} />)}
        </View>
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 17, letterSpacing: -0.4 }}>Shared accounts</T>
          <T style={{ fontSize: 12.5, color: C.sub, marginTop: 2 }}>{sharedAccts.length ? `${sharedAccts.length} ${sharedAccts.length === 1 ? 'account' : 'accounts'} · pay when enough agree` : 'Pay when enough agree'}</T>
        </View>
        <Icon name="chevron" size={14} color={C.faint} width={2.2} />
      </View>
    </Press>
  );
  const gift = <Tile w={col} h={104} glyph="gift" name="Send a card" line="BTC, USDT, USDC" onPress={() => router.push('/gift')} />;
  const create = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      <Pill glyph="token" name="Make a token" onPress={() => setMake(true)} />
      <Pill glyph="mining" name="Mining" onPress={() => router.push('/mining')} />
      <Pill glyph="explorer" name="Explorer" onPress={() => open(`${site}/#/explorer`)} />
    </View>
  );
  const help = (
    <View style={[{ borderRadius: 26, padding: 18 }, glass]}>
      <T style={{ fontFamily: F.semibold, fontSize: 15 }}>Not sure which?</T>
      <T style={{ fontSize: 13, lineHeight: 18, color: C.sub, marginTop: 3 }}>A vault guards everyday money with a limit and a wait. A jar locks LYX until a date you pick.</T>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Aurora />
      <KeyboardScroll style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: insets.bottom + 130, gap: 22 }} keyboardShouldPersistTaps="handled">
        <Animated.View entering={r[0]} style={{ gap: 14 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 36, letterSpacing: -1.1, lineHeight: 42 }}>Apps</T>
          <View style={[{ flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: 23, paddingLeft: 16 }, glass]}>
            <Icon name="search" size={18} color={C.sub} width={2} />
            <Field value={text} onChangeText={setText} placeholder="Search or type a website" autoCapitalize="none" autoCorrect={false} keyboardType="web-search" returnKeyType="go" onSubmitEditing={() => text.trim() && open(toUrl(text))} style={{ flex: 1, backgroundColor: 'transparent', height: 46 }} />
          </View>
          <Chips value={cat} onChange={setCat} />
        </Animated.View>

        {cat === 'all' && (
          <Animated.View entering={r[1]} style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, columnGap: 10 }}>
            {marks.map((b, i) => <Fav key={b.url} index={i} title={b.title} fixed={b.fixed} onPress={() => open(b.url)} />)}
          </Animated.View>
        )}

        {cat === 'all' && (
          <Animated.View entering={r[2]}>
            <Feature width={cw} onPress={() => router.push('/apps-wallet')} />
          </Animated.View>
        )}

        <Animated.View entering={r[3]} layout={LinearTransition.duration(DUR.base).easing(EASE_OUT)} style={{ gap: 14 }}>
          {(cat === 'all' || cat === 'protect') && (
            <View style={{ flexDirection: 'row', gap: 14 }}>
              {vault}
              <View style={{ gap: 16 }}>{jar}{cat === 'protect' ? imp : cap}</View>
            </View>
          )}
          {cat === 'protect' && help}
          {(cat === 'all' || cat === 'share') && sharedRow}
          {cat === 'share' && (
            <View style={{ flexDirection: 'row', gap: 14 }}>{gift}{cap}</View>
          )}
          {cat === 'all' && <View style={{ flexDirection: 'row', gap: 14 }}>{gift}{imp}</View>}
          {(cat === 'all' || cat === 'create') && (
            <View style={{ gap: 10 }}>
              <Label>CREATE</Label>
              {create}
            </View>
          )}
        </Animated.View>

        {cat === 'all' && contractsOn && (
          <Animated.View layout={LinearTransition.duration(DUR.base).easing(EASE_OUT)} style={{ gap: 10 }}>
            <Label>CONNECTED SITES</Label>
            {connected.length === 0 ? (
              <T v="sub" color={C.faint}>Sites you connect to show up here. You can cut them off any time.</T>
            ) : (
              <View style={[{ borderRadius: 26, paddingHorizontal: 16, paddingVertical: 4 }, glass]}>
                {connected.map((s, i) => (
                  <Animated.View key={s.origin} exiting={FadeOut} layout={LinearTransition.duration(DUR.base).easing(EASE_OUT)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 62, borderTopWidth: i ? 0.5 : 0, borderTopColor: 'rgba(255,255,255,0.08)' }}>
                    <Press onPress={() => open(s.origin)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }}>
                      <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                        <T style={{ fontFamily: F.semibold, fontSize: 13 }}>{s.origin.replace(/^https?:\/\/(www\.)?/, '').slice(0, 2).toUpperCase()}</T>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <T v="callout" numberOfLines={1}>{s.origin.replace(/^https?:\/\//, '')}</T>
                        <T v="caption" dim>Can see your address</T>
                      </View>
                    </Press>
                    <Press onPress={() => sites.save((x) => x.filter((y) => !(y.origin === s.origin && y.address === me)))} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', justifyContent: 'center' }}>
                      <T v="caption" style={{ fontFamily: F.medium }}>Disconnect</T>
                    </Press>
                  </Animated.View>
                ))}
              </View>
            )}
          </Animated.View>
        )}

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
      </KeyboardScroll>
    </View>
  );
}
