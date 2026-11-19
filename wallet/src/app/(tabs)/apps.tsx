import { useId, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
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
import { CoinLogo } from '../../ui/CoinLogo';
import Svg, { Defs, LinearGradient as LG, Rect, Stop } from 'react-native-svg';
import { DUR, EASE_OUT } from '../../ui/motion';
import { AppGlyph, type GlyphName } from '../../ui/AppGlyph';
import { Sheet } from '../../ui/Sheet';

const open = (u: string) => router.push(`/browser?url=${encodeURIComponent(u)}`);

type Tone = { g: [string, string, string]; ink: string; glow: string };
const TONES: Record<'champagne' | 'platinum' | 'pearl' | 'walnut', Tone> = {
  champagne: { g: ['#F1E2C4', '#CDB07F', '#76603C'], ink: '#2A2112', glow: '#CDB07F' },
  platinum: { g: ['#F2F2F6', '#B7B9C5', '#5E606C'], ink: '#1E2028', glow: '#B7B9C5' },
  pearl: { g: ['#FBF7EE', '#D9D2C2', '#8C8570'], ink: '#26231B', glow: '#D9D2C2' },
  walnut: { g: ['#D6B79C', '#9A6B4B', '#432A1D'], ink: '#FFF4EA', glow: '#9A6B4B' },
};

/** A glossy card for one thing people use,. */
function Shelf({ tone, label, name, line, glyph, art, onPress, dim }: { tone: keyof typeof TONES; label: string; name: string; line: string; glyph: GlyphName; art?: React.ReactNode; onPress: () => void; dim?: boolean }) {
  const t = TONES[tone];
  const gid = 's' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Press onPress={onPress} scaleTo={0.97} style={{ width: 232, height: 146, borderRadius: 24, opacity: dim ? 0.6 : 1 }}>
      <View style={{ flex: 1, borderRadius: 24, overflow: 'hidden', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.35)' }}>
        <Svg style={{ position: 'absolute' }} width="100%" height="100%">
          <Defs>
            <LG id={gid} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={t.g[0]} />
              <Stop offset="0.55" stopColor={t.g[1]} />
              <Stop offset="1" stopColor={t.g[2]} />
            </LG>
            <LG id={gid + 'h'} x1="0" y1="0" x2="0.5" y2="1">
              <Stop offset="0" stopColor="#fff" stopOpacity="0.32" />
              <Stop offset="0.5" stopColor="#fff" stopOpacity="0.04" />
              <Stop offset="1" stopColor="#fff" stopOpacity="0" />
            </LG>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${gid})`} />
          <Rect width="100%" height="100%" fill={`url(#${gid}h)`} />
        </Svg>
        <View style={{ position: 'absolute', right: -22, bottom: -26, opacity: 0.16 }}>
          <AppGlyph name={glyph} size={128} color={t.ink} fill={0.3} />
        </View>
        <View style={{ flex: 1, padding: 16, justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T style={{ fontFamily: F.semibold, fontSize: 12, letterSpacing: 1.6, color: t.ink, opacity: 0.62 }}>{label}</T>
            {art}
          </View>
          <View style={{ gap: 3 }}>
            <T style={{ fontFamily: F.medium, fontSize: 19, letterSpacing: -0.4, color: t.ink }} numberOfLines={1}>{name}</T>
            <T style={{ fontSize: 12, lineHeight: 16, color: t.ink, opacity: 0.72 }} numberOfLines={2}>{line}</T>
          </View>
        </View>
      </View>
    </Press>
  );
}

function Heading({ children }: { children: string }) {
  return <T v="sub" dim style={{ paddingHorizontal: 6 }}>{children}</T>;
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

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <Aurora width={sw} height={340} strength={0.6} />
    <KeyboardScroll style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: insets.bottom + 130, gap: 26 }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 16 }}>
        <T v="display">Apps</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)', paddingLeft: 16 }}>
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
            style={{ flex: 1, backgroundColor: 'transparent', height: 50 }}
          />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {marks.map((b) => (
            <Press key={b.url} onPress={() => open(b.url)} scaleTo={0.95} style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={b.fixed ? 'globe' : 'star'} size={14} color={C.sub} width={2} />
              <T v="sub">{b.title}</T>
            </Press>
          ))}
        </View>
      </View>

      <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)}>
        <Press onPress={() => router.push('/capsule')} scaleTo={0.98} style={{ borderRadius: 30, backgroundColor: '#0B1030', borderWidth: 0.5, borderColor: 'rgba(143,168,255,0.2)', overflow: 'hidden' }}>
          <View style={{ position: 'absolute', right: 26, top: 22 }}><Planet size={92} /></View>
          <View style={{ padding: 20, paddingTop: 96, gap: 3 }}>
            <T style={{ fontFamily: F.medium, fontSize: 22, letterSpacing: -0.4 }}>Time capsule</T>
            <T v="sub" dim>{capsules.length ? `${capsules.length} waiting for their day` : 'Seal LYX until a day you choose'}</T>
            {!contractsOn && <T v="caption" color={C.faint}>You can open it once the network is reachable</T>}
          </View>
        </Press>
      </Animated.View>

      <View style={{ gap: 12 }}>
        <Heading>Send and share</Heading>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingHorizontal: 4, paddingVertical: 10 }} style={{ marginHorizontal: -20 }} contentInset={{ left: 16, right: 16 }}>
          <View style={{ width: 12 }} />
          <Shelf tone="champagne" label="GIFT CARDS" name="Send a card" line="BTC, USDT, USDC and more" glyph="gift" onPress={() => router.push('/gift')} />
          <Shelf tone="pearl" label="SHARED" name="Shared accounts" line="Pay when enough agree" glyph="shared" onPress={() => router.push('/shared')} />
          <View style={{ width: 12 }} />
        </ScrollView>
      </View>

      <View style={{ gap: 12 }}>
        <Heading>Keep it safe</Heading>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingHorizontal: 4, paddingVertical: 10 }} style={{ marginHorizontal: -20 }}>
          <View style={{ width: 12 }} />
          <Shelf tone="champagne" label="FOR WEBSITES" name="Apps wallet" line="The only account sites can see" glyph="vault" onPress={() => router.push('/apps-wallet')} />
          <Shelf tone="platinum" label="VAULT" name="Vault" line="Any coin. A daily limit and a delay" glyph="lock" onPress={() => router.push('/vaults')} />
          <Shelf tone="walnut" label="SAVINGS" name="Savings jar" line="Lock LYX until a date" glyph="jar" onPress={() => router.push('/jar')} dim={!contractsOn} />
          <View style={{ width: 12 }} />
        </ScrollView>
      </View>

      <View style={{ gap: 12 }}>
        <Heading>Make and run</Heading>
        <Row3 rows={[
          { glyph: 'token', name: 'Make a token', line: 'Your own coin, in a minute', onPress: () => setMake(true) },
          { glyph: 'mining', name: 'Mining', line: 'Earn LYX with your computer', onPress: () => router.push('/mining') },
          { glyph: 'vault', name: 'Import a wallet', line: 'Find your old money and move it into a vault', onPress: () => router.push('/import') },
          { glyph: 'explorer', name: 'Explorer', line: 'Every block and payment', onPress: () => open(`${site}/#/explorer`) },
        ]} />
      </View>

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
