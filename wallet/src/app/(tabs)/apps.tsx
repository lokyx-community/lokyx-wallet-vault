import { useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Press } from '../../ui/controls';
import { Aurora } from '../../ui/Aurora';
import { AppCard, CardChip, WIDE_H, type AppKind } from '../../ui/AppCard';
import { AppGlyph, type GlyphName } from '../../ui/AppGlyph';
import { CardCarousel } from '../../ui/CardCarousel';
import { Sheet } from '../../ui/Sheet';
import { Logo } from '../../ui/Logo';
import { KeyboardScroll } from '../../ui/KeyboardScroll';
import { Icon } from '../../ui/Icon';
import { C, F } from '../../ui/theme';
import { DUR, EASE_OUT } from '../../ui/motion';
import { sites, useEvmSites, useJars, useShared, useSites } from '../../lib/data';
import { useApps } from '../../lib/appswallet';
import { shortAddr, niceLyx } from '../../lib/format';
import { currentAddress } from '../../lib/wallet';
import { useCapsules } from '../../lib/capsules';
import { useContractsOn } from '../../lib/chain';
import { usePoll, type Account } from '../../lib/rpc';
import { useStore } from '../../lib/store';
import { loadVaults, vaults } from '../../lib/ethvault';
import { setLift } from '../../lib/lift';
import { siteUrl } from '../../lib/rpc';
import { FEATURES } from '../../lib/features';

const glass = { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)' } as const;

/** Each block of the page arrives a beat after the one above it, easing in from just below. */
function useRise(i: number) {
  const still = useReducedMotion();
  return still ? undefined : FadeInDown.delay(70 + i * 80).duration(DUR.slow + 120).easing(EASE_OUT);
}

/** Remember where a card sits on screen, so the page it opens can lift that very card into place. */
function useLiftFrom() {
  const refs = useRef<Record<string, View | null>>({});
  const set = (id: string) => (r: View | null) => { refs.current[id] = r; };
  const go = (id: string, route: string) => {
    const v = refs.current[id];
    if (!v) {
      setLift(null);
      return router.push(route as never);
    }
    v.measureInWindow((x, y, w, h) => {
      setLift(w && h ? { x, y, w, h } : null);
      router.push(route as never);
    });
  };
  return { set, go };
}

const Label = ({ children }: { children: string }) => <T style={{ fontFamily: F.medium, fontSize: 11.5, letterSpacing: 1.8, color: C.sub, paddingLeft: 4 }}>{children}</T>;

function PillRow({ items }: { items: { name: string; onPress: () => void; dim?: boolean }[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {items.map((it) => (
        <Press key={it.name} onPress={it.onPress} haptic={false} accessibilityLabel={it.name} style={[{ flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', opacity: it.dim ? 0.5 : 1 }, glass]}>
          <T style={{ fontFamily: F.medium, fontSize: 14 }} numberOfLines={1}>{it.name}</T>
        </Press>
      ))}
    </View>
  );
}

/** A small tile for the apps you reach for less: a mark, a name, one line. */
function Tile({ glyph, name, line, onPress, dim, liftRef }: { glyph: GlyphName; name: string; line: string; onPress: () => void; dim?: boolean; liftRef?: (r: View | null) => void }) {
  return (
    <Press onPress={onPress} scaleTo={0.97} accessibilityLabel={name} style={{ flex: 1, height: 84, borderRadius: 24, opacity: dim ? 0.55 : 1 }}>
      <View ref={liftRef} collapsable={false} style={[{ flex: 1, borderRadius: 24, padding: 14, justifyContent: 'space-between' }, glass]}>
        <AppGlyph name={glyph} size={22} color="#fff" />
        <View>
          <T style={{ fontFamily: F.medium, fontSize: 14.5 }} numberOfLines={1}>{name}</T>
          <T style={{ fontSize: 11.5, color: C.sub }} numberOfLines={1}>{line}</T>
        </View>
      </View>
    </Press>
  );
}

const CHAINS = ['eth', 'bnb', 'pol', 'avax', 'arb'] as const;

export default function Apps() {
  const insets = useSafeAreaInsets();
  const { width: sw } = useWindowDimensions();
  const me = currentAddress();
  const { address } = useApps();
  const evm = useEvmSites().filter((s) => !!address && s.address.toLowerCase() === address.toLowerCase());
  const connected = useSites().filter((s) => s.address === me);
  const capsules = useCapsules().filter((c) => !c.opened);
  const jars = useJars();
  const shared = useShared();
  const contractsOn = useContractsOn();
  const acct = usePoll<Account>('lyx_getAccount', { address: me }, 20000);
  const eth = useStore(vaults);
  const [front, setFront] = useState(0);
  const [make, setMake] = useState(false);
  const [showSites, setShowSites] = useState(false);
  const lift = useLiftFrom();
  const r = [useRise(0), useRise(1), useRise(2), useRise(3), useRise(4)];
  useEffect(() => { loadVaults(); }, []);

  const cw = sw - 40;
  const tallW = Math.min(300, Math.round(sw * 0.7));
  const tallH = Math.round(tallW * 1.28);
  const vaultCount = (acct.data?.vault ? 1 : 0) + Object.values(eth).filter(Boolean).length;
  const soonest = [...capsules].sort((a, b) => a.opens - b.opens)[0];
  const daysLeft = soonest ? Math.max(0, Math.ceil((soonest.opens - Date.now() / 1000) / 86400)) : 0;
  const capProgress = soonest && soonest.opens > soonest.sealed ? (Date.now() / 1000 - soonest.sealed) / (soonest.opens - soonest.sealed) : undefined;

  const deck: { id: AppKind; route: string; node: React.ReactNode }[] = [
    {
      id: 'apps', route: '/apps-wallet',
      node: (
        <AppCard kind="apps" width={tallW} height={tallH} corner={<CardChip dot={evm.length > 0} text={evm.length ? `${evm.length} ${evm.length === 1 ? 'site' : 'sites'}` : 'No sites'} />}>
          <T style={{ position: 'absolute', left: 22, right: 22, bottom: 92, fontFamily: F.mono, fontSize: 21 }} numberOfLines={1} adjustsFontSizeToFit>{address ? shortAddr(address, 6, 4) : 'Not made yet'}</T>
          <T style={{ position: 'absolute', left: 22, right: 22, bottom: 72, fontSize: 11.5, color: 'rgba(255,255,255,0.7)' }} numberOfLines={1}>{address ? 'The only address websites see' : 'Make one to connect to websites'}</T>
          <View style={{ position: 'absolute', left: 22, bottom: 22, flexDirection: 'row' }}>
            {(['eth', 'usdt', 'usdc'] as const).map((id, i) => (
              <View key={id} style={{ marginLeft: i ? -10 : 0, width: 34, height: 34, borderRadius: 17, borderWidth: 2.5, borderColor: '#101219', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}><Logo id={id} size={29} /></View>
            ))}
          </View>
        </AppCard>
      ),
    },
    { id: 'shared', route: '/shared', node: <AppCard kind="shared" width={tallW} height={tallH} big={String(shared.length)} small={shared.length === 1 ? 'account · pay when enough agree' : 'accounts · pay when enough agree'} /> },
    { id: 'vault', route: '/vaults', node: <AppCard kind="vault" width={tallW} height={tallH} big={String(vaultCount)} small={vaultCount === 1 ? 'vault · a limit and a wait' : 'vaults · a limit and a wait'} /> },
  ];
  const buttons: Record<AppKind, { name: string; onPress: () => void }[]> = {
    apps: [{ name: address ? 'Open' : 'Make one', onPress: () => lift.go('apps', '/apps-wallet') }, { name: 'Add money', onPress: () => router.push('/apps-wallet/refill') }, { name: 'Sites', onPress: () => setShowSites(true) }],
    shared: [{ name: 'Open', onPress: () => lift.go('shared', '/shared') }, { name: 'New account', onPress: () => router.push('/shared/new') }],
    vault: [{ name: 'Open', onPress: () => lift.go('vault', '/vaults') }, { name: 'Use recovery key', onPress: () => router.push('/vault/recover') }],
    capsule: [], gift: [], mint: [], jar: [], mining: [], markets: [],
  };
  const frontId = deck[Math.min(front, deck.length - 1)].id;

  /** The wide card: tall cards above shrink into this shape on their own page. */
  const wide = (id: AppKind, route: string | null, card: React.ReactNode, label: string, dim?: boolean) => (
    <Press onPress={() => (route === 'capsule' ? (setLift(null), router.push('/capsule')) : route ? lift.go(id, route) : setMake(true))} scaleTo={0.985} accessibilityLabel={label} style={{ opacity: dim ? 0.55 : 1 }}>
      <View ref={lift.set(id)} collapsable={false}>{card}</View>
    </Press>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Aurora />
      <KeyboardScroll style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: insets.bottom + 130, gap: 18 }} keyboardShouldPersistTaps="handled">
        <Animated.View entering={r[0]}>
          <T style={{ fontFamily: F.semibold, fontSize: 36, letterSpacing: -1.1, lineHeight: 42 }}>Apps</T>
        </Animated.View>

        <Animated.View entering={r[1]} style={{ gap: 10 }}>
          <CardCarousel
            width={tallW}
            height={tallH}
            index={front}
            onIndex={setFront}
            cards={deck.map((d) => (
              <Press key={d.id} onPress={() => lift.go(d.id, d.route)} scaleTo={0.985} accessibilityLabel={APP_NAME[d.id]}>
                <View ref={lift.set(d.id)} collapsable={false}>{d.node}</View>
              </Press>
            ))}
          />
          <PillRow items={buttons[frontId]} />
        </Animated.View>

        <Animated.View entering={r[2]} layout={LinearTransition.duration(DUR.base).easing(EASE_OUT)} style={{ gap: 14 }}>
          {wide('capsule', 'capsule', (
            <AppCard kind="capsule" width={cw} height={WIDE_H} big={soonest ? niceLyx(soonest.amountLyx) : undefined} unit={soonest ? 'LYX' : undefined} small={soonest ? `opens in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}` : 'Seal LYX until a day'} bar={capProgress !== undefined ? capProgress : undefined} />
          ), 'Neptune time capsule', !contractsOn)}
          {wide('gift', '/gift', (
            <AppCard kind="gift" width={cw} height={WIDE_H - 30} small="Send a card to anyone" />
          ), 'Gift cards')}
          {wide('mint', null, (
            <AppCard kind="mint" width={cw} height={WIDE_H - 30} small="Make your own coin">
              <View style={{ position: 'absolute', right: 18, top: 16, flexDirection: 'row' }}>
                {CHAINS.map((id, i) => <View key={id} style={{ marginLeft: i ? -8 : 0, borderRadius: 14, borderWidth: 2, borderColor: '#14161c', overflow: 'hidden' }}><Logo id={id} size={24} /></View>)}
              </View>
            </AppCard>
          ), 'Mint a token')}
        </Animated.View>

        <Animated.View entering={r[3]} style={{ gap: 10 }}>
          <Label>MORE</Label>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Tile glyph="jar" name="Savings jar" line={jars.length ? `${jars.length} ${jars.length === 1 ? 'jar' : 'jars'}` : 'Lock LYX until a date'} dim={!contractsOn} onPress={() => lift.go('jar', '/jar')} liftRef={lift.set('jar')} />
            <Tile glyph="vault" name="Import" line="Move old money in" onPress={() => { setLift(null); router.push('/import'); }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Tile glyph="mining" name="Mining" line="Earn LYX" onPress={() => lift.go('mining', '/mining')} liftRef={lift.set('mining')} />
            <Tile glyph="explorer" name="Explorer" line="Look up anything" onPress={() => { setLift(null); router.push(`/browser?url=${encodeURIComponent(`${siteUrl()}/#/explorer`)}`); }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Tile glyph="markets" name="Markets" line={FEATURES.predict ? 'Predict, play money' : 'Not on yet'} onPress={() => lift.go('markets', '/predict')} liftRef={lift.set('markets')} />
            <Tile glyph="browser" name="Browser" line="Search and favourites" onPress={() => { setLift(null); router.push('/web'); }} />
          </View>
        </Animated.View>
      </KeyboardScroll>

      <Sheet open={make} onClose={() => setMake(false)}>
        <View style={{ gap: 12, paddingBottom: 8, padding: 4 }}>
          <T v="title">Mint a token</T>
          <T v="sub" dim>Choose where your new coin will live.</T>
          {[
            { name: 'On LOKYX', line: 'Quick and cheap. Ready in about a minute.', go: '/make-token', dim: !contractsOn },
            { name: 'On Ethereum and other chains', line: 'An ERC-20 coin. Costs a little of that chain’s coin for fees.', go: '/chain/make-token', dim: false },
          ].map((o) => (
            <Press key={o.name} onPress={() => { setMake(false); router.push(o.go as never); }} accessibilityLabel={o.name} style={[{ borderRadius: 22, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: o.dim ? 0.55 : 1 }, glass]}>
              <AppGlyph name="token" size={24} color="#fff" />
              <View style={{ flex: 1 }}>
                <T style={{ fontFamily: F.medium, fontSize: 16 }}>{o.name}</T>
                <T v="caption" dim>{o.line}</T>
              </View>
              <Icon name="chevron" size={14} color={C.faint} width={2.2} />
            </Press>
          ))}
        </View>
      </Sheet>

      <Sheet open={showSites} onClose={() => setShowSites(false)}>
        <View style={{ gap: 12, paddingBottom: 8, padding: 4 }}>
          <T v="title">Connected sites</T>
          <T v="sub" dim>These sites can see your Apps wallet address. Disconnect one any time.</T>
          {connected.length === 0 ? (
            <T v="sub" color={C.faint}>No sites yet. Connect one from the Browser.</T>
          ) : connected.map((s) => (
            <Animated.View key={s.origin} exiting={FadeOut} layout={LinearTransition.duration(DUR.base).easing(EASE_OUT)} style={[{ borderRadius: 22, paddingHorizontal: 16, minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 }, glass]}>
              <T style={{ flex: 1, fontFamily: F.medium, fontSize: 15 }} numberOfLines={1}>{s.origin.replace(/^https?:\/\//, '')}</T>
              <Press onPress={() => sites.save((x) => x.filter((y) => !(y.origin === s.origin && y.address === me)))} accessibilityLabel={`Disconnect ${s.origin}`} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', justifyContent: 'center' }}>
                <T v="caption" style={{ fontFamily: F.medium }}>Disconnect</T>
              </Press>
            </Animated.View>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const APP_NAME: Record<AppKind, string> = { apps: 'Apps wallet card', shared: 'Shared accounts card', vault: 'Vault card', capsule: 'Capsule', gift: 'Gift cards', mint: 'Mint a token', jar: 'Savings jar', mining: 'Mining', markets: 'Markets' };
