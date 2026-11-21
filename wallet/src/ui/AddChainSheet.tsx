import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';
import { MarkDraw } from './Intro';
import { Sheet } from './Sheet';
import { T } from './Text';
import { Field, Press } from './controls';
import { Logo } from './Logo';
import { Icon } from './Icon';
import type { LogoId } from './logos';
import { C, F } from './theme';
import { EVM_FAMILIES, EVM_ORDER, type EvmFamily } from '../lib/multichain-core';

/** A chain in the list. `live` ones the wallet can really hold today; the rest show as "Soon" and cannot be switched on. */
interface Row { id: string; name: string; sub: string; logo: LogoId; live: boolean }

const SOON: Row[] = [
  { id: 'xrp', name: 'XRP', sub: 'XRP Ledger', logo: 'xrp', live: false },
  { id: 'ada', name: 'Cardano', sub: 'ADA', logo: 'ada', live: false },
  { id: 'ton', name: 'Toncoin', sub: 'TON', logo: 'ton', live: false },
  { id: 'doge', name: 'Dogecoin', sub: 'DOGE', logo: 'doge', live: false },
  { id: 'ltc', name: 'Litecoin', sub: 'LTC', logo: 'ltc', live: false },
  { id: 'linea', name: 'Linea', sub: 'ETH', logo: 'linea', live: false },
  { id: 'scroll', name: 'Scroll', sub: 'ETH', logo: 'scroll', live: false },
  { id: 'mantle', name: 'Mantle', sub: 'MNT', logo: 'mantle', live: false },
  { id: 'gnosis', name: 'Gnosis', sub: 'XDAI', logo: 'gnosis', live: false },
  { id: 'celo', name: 'Celo', sub: 'CELO', logo: 'celo', live: false },
];

const LIVE: Row[] = [
  { id: 'sol', name: 'Solana', sub: 'SOL', logo: 'sol', live: true },
  { id: 'trx', name: 'Tron', sub: 'TRX', logo: 'trx', live: true },
  ...EVM_ORDER.map((f) => ({ id: f, name: EVM_FAMILIES[f].name, sub: `${EVM_FAMILIES[f].unit} · same address as Ethereum`, logo: EVM_FAMILIES[f].logo as LogoId, live: true })),
];

/** White "Add"; once added the ring draws, the dot drops in, a soft light crosses the pill and it reads "Added". Tap again to remove. */
function AddPill({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const sweep = useSharedValue(-40);
  useEffect(() => {
    if (on) { sweep.value = -40; sweep.value = withDelay(500, withTiming(110, { duration: 900, easing: Easing.out(Easing.cubic) })); }
  }, [on, sweep]);
  const bar = useAnimatedStyle(() => ({ transform: [{ translateX: sweep.value }, { skewX: '-20deg' }] }));
  return (
    <Press onPress={onPress} accessibilityLabel={on ? `Remove ${label}` : `Add ${label}`} scaleTo={0.94} style={{ minWidth: 92, height: 36, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: on ? 'rgba(255,255,255,0.1)' : '#fff', borderWidth: on ? 0.5 : 0, borderColor: 'rgba(255,255,255,0.28)' }}>
      {on ? (
        <>
          <MarkDraw size={16} delay={0} />
          <T style={{ fontFamily: F.semibold, fontSize: 13.5, color: '#fff' }}>Added</T>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, width: 26, backgroundColor: 'rgba(255,255,255,0.22)' }, bar]} />
        </>
      ) : (
        <T style={{ fontFamily: F.semibold, fontSize: 13.5, color: '#000' }}>Add</T>
      )}
    </Press>
  );
}

/** "+" on Home: switch a chain on and it takes its colour and joins your cards. Nothing here asks for a token. */
export function AddChainSheet({ open, onClose, isOn, toggle }: { open: boolean; onClose: () => void; isOn: (id: string) => boolean; toggle: (id: string, on: boolean) => void }) {
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const match = (r: Row) => !t || `${r.name} ${r.sub}`.toLowerCase().split(/\s+/).some((w) => w.startsWith(t));
  const mine = useMemo(() => LIVE.filter((r) => isOn(r.id) && match(r)), [t, isOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const more = useMemo(() => [...LIVE.filter((r) => !isOn(r.id)), ...SOON].filter(match), [t, isOn]); // eslint-disable-line react-hooks/exhaustive-deps

  const row = (r: Row) => {
    const on = r.live && isOn(r.id);
    return (
      <Animated.View key={r.id} entering={FadeIn.duration(260)} exiting={FadeOut.duration(160)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, height: 62 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', shadowColor: '#fff', shadowOpacity: on ? 0.28 : 0, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } }}>
          <Logo id={r.logo} size={40} grey={!on} />
        </View>
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: F.medium, fontSize: 16, color: r.live ? C.text : C.sub }}>{r.name}</T>
          <T v="caption" dim>{r.live ? r.sub : `${r.sub} · mainnet`}</T>
        </View>
        {r.live ? (
          <AddPill on={on} label={r.name} onPress={() => toggle(r.id, !on)} />
        ) : (
          <T style={{ fontFamily: F.medium, fontSize: 12.5, letterSpacing: 1.2, color: C.faint }}>SOON</T>
        )}
      </Animated.View>
    );
  };

  const head = (s: string) => <T style={{ fontFamily: F.semibold, fontSize: 11.5, letterSpacing: 1.6, color: C.sub, paddingTop: 14, paddingBottom: 2 }}>{s}</T>;

  return (
    <Sheet open={open} onClose={onClose}>
      <View style={{ gap: 4 }}>
        <T v="headline">Add a chain</T>
        <T v="caption" dim style={{ paddingBottom: 12 }}>Tap Add and the chain joins your cards. Tokens are added inside each chain.</T>
        <Field value={q} onChangeText={setQ} placeholder="Search chains" autoCapitalize="none" autoCorrect={false} />
        <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {mine.length > 0 ? head('YOUR CHAINS') : null}
          {mine.map(row)}
          {more.length > 0 ? head('MORE CHAINS') : null}
          {more.map(row)}
          {mine.length + more.length === 0 ? <T v="sub" dim style={{ paddingVertical: 24, textAlign: 'center' }}>No chain with that name</T> : null}
        </ScrollView>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10 }}>
          <Icon name="shield" size={14} color={C.faint} width={2} />
          <T v="caption" dim style={{ flex: 1 }}>Only chains this wallet can really hold can be switched on.</T>
        </View>
      </View>
    </Sheet>
  );
}

export type { EvmFamily };
