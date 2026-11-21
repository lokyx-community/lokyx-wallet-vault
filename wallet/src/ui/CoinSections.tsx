import { useEffect, useState, type ReactNode } from 'react';
import { Linking, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { Press } from './controls';
import { Icon } from './Icon';
import { MarkDraw } from './Intro';
import { C, F } from './theme';
import { compact, type CoinInfo } from '../lib/coininfo-core';
import { money, type Currency } from '../lib/prices-core';

const GLASS = { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)' } as const;

export function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 26, paddingBottom: 10, paddingHorizontal: 6 }}>
      <T style={{ fontFamily: F.semibold, fontSize: 12, letterSpacing: 1.6, color: C.sub }}>{title}</T>
      {right}
    </View>
  );
}

/** Name on the left, value on the right, one line each. Tapping a row with `onPress` does that (copy, open). */
export function KvPanel({ rows }: { rows: { k: string; v: string; onPress?: () => void; icon?: 'copy' }[] }) {
  return (
    <View style={{ borderRadius: 26, paddingHorizontal: 16, ...GLASS }}>
      {rows.map((r, i) => (
        <Press key={r.k} onPress={r.onPress} disabled={!r.onPress} haptic={false} scaleTo={0.99} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 50, borderTopWidth: i ? 0.5 : 0, borderTopColor: 'rgba(255,255,255,0.08)' }}>
          <T style={{ fontSize: 14.5, color: C.sub }}>{r.k}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T style={{ fontFamily: F.medium, fontSize: 15, fontVariant: ['tabular-nums'] }}>{r.v}</T>
            {r.icon ? <Icon name={r.icon} size={14} color={C.faint} width={2} /> : null}
          </View>
        </Press>
      ))}
    </View>
  );
}

export function AboutCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > 150;
  return (
    <View style={{ borderRadius: 26, padding: 16, ...GLASS }}>
      <T numberOfLines={open || !long ? undefined : 3} style={{ fontSize: 14.5, lineHeight: 22, color: C.soft }}>{text}</T>
      {long ? (
        <Press onPress={() => setOpen(!open)} haptic={false} style={{ paddingTop: 10 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 14 }}>{open ? 'Show less' : 'Read more'}</T>
        </Press>
      ) : null}
    </View>
  );
}

function Tile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <View style={{ flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 13, minHeight: 74, ...GLASS }}>
      <T style={{ fontSize: 11.5, color: C.sub }}>{k}</T>
      <T style={{ fontFamily: F.medium, fontSize: 18, marginTop: 5, letterSpacing: -0.3, fontVariant: ['tabular-nums'] }}>{v}</T>
      {sub ? <T style={{ fontSize: 11.5, color: C.sub, marginTop: 2 }}>{sub}</T> : null}
    </View>
  );
}

function SupplyBar({ have, max }: { have: number; max: number }) {
  const w = useSharedValue(0);
  const still = useReducedMotion();
  const pct = Math.min(1, have / max);
  useEffect(() => { w.value = still ? pct : withDelay(250, withTiming(pct, { duration: 1100, easing: Easing.out(Easing.cubic) })); }, [pct, still, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ borderRadius: 20, paddingHorizontal: 14, paddingVertical: 13, marginTop: 8, ...GLASS }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T style={{ fontSize: 11.5, color: C.sub }}>Supply</T>
        <T style={{ fontSize: 11.5, color: C.sub }}>{`${compact(have)} of ${compact(max)}`}</T>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', marginTop: 10, overflow: 'hidden' }}>
        <Animated.View style={[{ height: '100%', borderRadius: 3, backgroundColor: '#fff' }, fill]} />
      </View>
    </View>
  );
}

/** Market cap, volume, rank, all-time high, and the supply bar. Only what the feed actually returned. */
export function MarketBlock({ info, cur }: { info: CoinInfo; cur: Currency }) {
  const pre = cur === 'inr' ? '₹' : '$';
  const tiles: { k: string; v: string; sub?: string }[] = [];
  if (info.cap) tiles.push({ k: 'Market cap', v: compact(info.cap, pre) });
  if (info.volume) tiles.push({ k: 'Volume · 24h', v: compact(info.volume, pre) });
  if (info.rank) tiles.push({ k: 'Rank', v: `#${info.rank}` });
  if (info.ath) tiles.push({ k: 'All-time high', v: money(info.ath, cur), sub: info.athDrop != null ? `${info.athDrop.toFixed(1).replace('-', '−')}% from it` : undefined });
  if (!tiles.length) return null;
  const rows: (typeof tiles)[] = [];
  for (let i = 0; i < tiles.length; i += 2) rows.push(tiles.slice(i, i + 2));
  return (
    <View style={{ gap: 8 }}>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          {r.map((t) => <Tile key={t.k} {...t} />)}
          {r.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
      {info.circulating && info.maxSupply ? <SupplyBar have={info.circulating} max={info.maxSupply} /> : null}
      <T style={{ fontSize: 11.5, color: C.faint, paddingHorizontal: 6, paddingTop: 2 }}>Market data from CoinGecko</T>
    </View>
  );
}

/** Each line gets the LOKYX sign, drawn once, as its tick. */
export function SafetyList({ lines }: { lines: { title: string; text: string; onPress?: () => void }[] }) {
  return (
    <View style={{ borderRadius: 26, paddingHorizontal: 16, paddingVertical: 4, ...GLASS }}>
      {lines.map((l, i) => (
        <Press key={l.title} onPress={l.onPress} disabled={!l.onPress} haptic={false} scaleTo={0.99} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 13, paddingVertical: 13, borderTopWidth: i ? 0.5 : 0, borderTopColor: 'rgba(255,255,255,0.08)' }}>
          <MarkDraw size={22} delay={200 + i * 260} />
          <View style={{ flex: 1 }}>
            <T style={{ fontFamily: F.medium, fontSize: 15 }}>{l.title}</T>
            <T style={{ fontSize: 12.5, lineHeight: 18, color: C.sub, marginTop: 2 }}>{l.text}</T>
          </View>
          {l.onPress ? <Icon name="chevron" size={14} color={C.faint} width={2.2} /> : null}
        </Press>
      ))}
    </View>
  );
}

export function LinkChips({ links }: { links: { label: string; url: string }[] }) {
  if (!links.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {links.map((l) => (
        <Press key={l.label} onPress={() => Linking.openURL(l.url).catch(() => {})} haptic={false} scaleTo={0.96} accessibilityLabel={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 38, paddingHorizontal: 15, borderRadius: 19, ...GLASS }}>
          <T style={{ fontFamily: F.medium, fontSize: 14 }}>{l.label}</T>
          <Icon name="send" size={11} color={C.sub} width={2.2} />
        </Press>
      ))}
    </View>
  );
}

/** Shown where there is no market data at all (LOKYX, test networks, tokens the feed doesn't list). */
export function NoMarket({ text }: { text: string }) {
  return (
    <View style={{ borderRadius: 26, padding: 18, ...GLASS }}>
      <T style={{ fontSize: 14, lineHeight: 21, color: C.sub }}>{text}</T>
    </View>
  );
}
