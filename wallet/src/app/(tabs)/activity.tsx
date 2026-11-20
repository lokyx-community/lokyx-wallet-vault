import { Aurora } from '../../ui/Aurora';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, SectionList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../../ui/Text';
import { ActivityRow, EventRow, FeedRow, PendingRow } from '../../ui/ActivityRow';
import { useEvents } from '../../lib/events';
import type { AppEvent } from '../../lib/events-core';
import { Press } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { TextInput } from 'react-native';
import { loadTxMeta, metaId, useAllTxMeta } from '../../lib/txmeta';
import { matches } from '../../lib/txmeta-core';
import { C, F } from '../../ui/theme';
import { SkeletonRows } from '../../ui/Skeleton';
import { EmptyState } from '../../ui/EmptyState';
import { rpc, type History, type HistoryItem } from '../../lib/rpc';
import { useAccountRef, useWallet } from '../../lib/wallet';
import { usePending } from '../../lib/data';
import { dayLabel, nameFor, timeAgo } from '../../lib/format';
import { useOtherFeed } from '../../lib/feed';
import { FEED_COINS, type FeedCoin, type FeedItem } from '../../lib/feed-core';

type Filter = 'all' | 'sent' | 'received' | 'mined' | 'events';
type Row = { k: 'lyx'; it: HistoryItem; time: number } | { k: 'x'; it: FeedItem; time: number } | { k: 'ev'; it: AppEvent; time: number };
const kindOk = (kind: string, f: Filter) => f === 'all' || (f === 'events' ? false : f === 'sent' ? kind === 'sent' || kind === 'self' : kind === f);

export default function Activity() {
  const insets = useSafeAreaInsets();
  const me = useAccountRef();
  const hide = useWallet().settings.hideBalance;
  const pend = usePending();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [coin, setCoin] = useState<FeedCoin | 'all'>('all');
  const [pulling, setPulling] = useState(false);
  const other = useOtherFeed();
  const evs = useEvents();
  const [q, setQ] = useState('');
  const metas = useAllTxMeta();
  useEffect(() => { loadTxMeta(); }, []);

  const load = useCallback(
    async (before?: number) => {
      if (!me) return;
      setBusy(true);
      try {
        const h = await rpc<History>('lyx_getAddressHistory', { address: me.address, limit: 40, ...(before ? { before } : {}) });
        setItems((x) => (before ? [...x, ...h.items] : h.items));
        setNext(h.nextBefore);
        setErr('');
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [me],
  );

  useEffect(() => {
    setItems([]);
    load();
    const t = setInterval(() => load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const sections = useMemo(() => {
    const rows: Row[] = [];
    if (coin === 'all' || coin === 'lyx') for (const it of items) if (kindOk(it.kind, filter)) rows.push({ k: 'lyx', it, time: it.timestamp });
    for (const it of other.data ?? []) if ((coin === 'all' || coin === it.coin) && kindOk(it.kind, filter)) rows.push({ k: 'x', it, time: it.time });
    if (coin === 'all' && (filter === 'all' || filter === 'events')) for (const it of evs) rows.push({ k: 'ev', it, time: it.time });
    const text = (r: Row): string[] => {
      if (r.k === 'ev') return [r.it.title, r.it.sub];
      const id = r.k === 'lyx' ? r.it.txHash ?? '' : r.it.id.split(':').pop() ?? '';
      const m = metas[metaId(id)];
      const note = [m?.note, ...(m?.tags ?? [])].filter(Boolean) as string[];
      if (r.k === 'lyx') {
        const other = r.it.kind === 'received' ? r.it.from : r.it.to;
        return [nameFor(other) ?? '', other ?? '', 'LOKYX LYX', r.it.amountLyx, r.it.kind, ...note];
      }
      return [nameFor(r.it.other) ?? '', r.it.other ?? '', FEED_COINS.find((c) => c.id === r.it.coin)?.name ?? '', r.it.unit, r.it.amount, r.it.kind, ...note];
    };
    const kept = q.trim() ? rows.filter((r) => matches(q, ...text(r))) : rows;
    rows.length = 0;
    rows.push(...kept);
    rows.sort((a, b) => (b.time || Infinity) - (a.time || Infinity));
    const out: { title: string; data: Row[] }[] = [];
    for (const r of rows) {
      const d = r.time ? dayLabel(r.time) : 'Waiting';
      if (out.at(-1)?.title !== d) out.push({ title: d, data: [] });
      out.at(-1)!.data.push(r);
    }
    return out;
  }, [items, other.data, filter, coin, evs, q, metas]);
  const found = useMemo(() => {
    const all = sections.flatMap((x) => x.data).filter((r) => r.k !== 'ev');
    const last = all.map((r) => r.time).filter(Boolean).sort((a, b) => b - a)[0];
    return { n: all.length, last };
  }, [sections]);
  const summary = useMemo(() => {
    const week = Date.now() / 1000 - 7 * 86400;
    const all: { t: number; inn: boolean }[] = [];
    for (const it of items) all.push({ t: it.timestamp, inn: it.kind === 'received' || it.kind === 'mined' });
    for (const it of other.data ?? []) all.push({ t: it.time, inn: it.kind === 'received' });
    const w = all.filter((x) => x.t >= week);
    const inn = w.filter((x) => x.inn).length;
    const out = w.length - inn;
    const days = Array.from({ length: 7 }, (_, d) => {
      const lo = week + d * 86400;
      const here = w.filter((x) => x.t >= lo && x.t < lo + 86400);
      return { a: here.filter((x) => x.inn).length, b: here.filter((x) => !x.inn).length };
    });
    const top = Math.max(1, ...days.map((d) => d.a + d.b));
    return (
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 16, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)' }}>
        <View style={{ gap: 6 }}>
          <T v="caption" dim>This week</T>
          <View style={{ flexDirection: 'row', gap: 20, alignItems: 'baseline' }}>
            <T style={{ fontFamily: F.medium, fontSize: 22, letterSpacing: -0.4, color: '#9BE5BD' }}>{inn} in</T>
            <T style={{ fontFamily: F.medium, fontSize: 22, letterSpacing: -0.4, color: C.soft }}>{out} out</T>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 5, width: 120, alignItems: 'flex-end', height: 34 }}>
          {days.map((d, i) => (
            <View key={i} style={{ flex: 1, justifyContent: 'flex-end', gap: 2, height: 34 }}>
              <View style={{ height: Math.max(d.a ? 4 : 0, (d.a / top) * 30), backgroundColor: '#9BE5BD', borderRadius: 2, opacity: 0.9 }} />
              <View style={{ height: Math.max(d.b ? 4 : 0, (d.b / top) * 30), backgroundColor: '#4A4A54', borderRadius: 2 }} />
              {!d.a && !d.b && <View style={{ height: 3, backgroundColor: '#25252b', borderRadius: 2 }} />}
            </View>
          ))}
        </View>
      </View>
    );
  }, [items, other.data]);
  const loading = busy || (!other.data && !other.error);
  const anyItems = items.length > 0 || (other.data ?? []).length > 0 || evs.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Aurora />
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 20, gap: 14, paddingBottom: 8 }}>
        <T v="display">Activity</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 46, borderRadius: 23, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: q ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.14)' }}>
          <Icon name="search" size={17} color={C.sub} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search people, coins, notes" placeholderTextColor={C.faint} selectionColor={C.text} keyboardAppearance="dark" autoCorrect={false} autoCapitalize="none" returnKeyType="search" style={{ flex: 1, fontFamily: F.regular, fontSize: 15, color: C.text, paddingVertical: 0 }} />
          {q ? <Press onPress={() => setQ('')} accessibilityLabel="Clear search" haptic={false}><Icon name="close" size={16} color={C.sub} /></Press> : null}
        </View>
        {q.trim() ? (
          <View style={{ paddingHorizontal: 18, paddingVertical: 14, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)', gap: 4 }}>
            <T v="caption" dim numberOfLines={1}>{q.trim()}</T>
            <T style={{ fontFamily: F.medium, fontSize: 22, letterSpacing: -0.4 }}>{found.n} {found.n === 1 ? 'payment' : 'payments'}</T>
            {found.last ? <T v="caption" dim>Last one {timeAgo(found.last)}</T> : null}
          </View>
        ) : summary}
        <View style={{ flexDirection: 'row', gap: 26, paddingHorizontal: 4 }}>
          {([['all', 'All'], ['sent', 'Sent'], ['received', 'Received'], ['mined', 'Mined'], ['events', 'Account']] as [Filter, string][]).map(([id, name]) => (
            <Press key={id} onPress={() => setFilter(id)} haptic={false} accessibilityLabel={name} style={{ paddingBottom: 8, borderBottomWidth: 1.5, borderBottomColor: filter === id ? C.text : 'transparent' }}>
              <T style={{ fontFamily: F.medium, fontSize: 15, color: filter === id ? C.text : C.sub }}>{name}</T>
            </Press>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -20 }} contentInset={{ left: 20, right: 20 }}>
          <View style={{ width: 12 }} />
          {([{ id: 'all', name: 'All coins' }, ...FEED_COINS] as { id: FeedCoin | 'all'; name: string }[]).map((c) => (
            <Press key={c.id} onPress={() => setCoin(c.id)} accessibilityLabel={c.name} style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: coin === c.id ? C.ink : C.fill2 }}>
              <T style={{ fontFamily: F.medium, fontSize: 13.5, color: coin === c.id ? C.inkText : C.soft }}>{c.name}</T>
            </Press>
          ))}
          <View style={{ width: 12 }} />
        </ScrollView>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(r, i) => (r.k === 'ev' ? r.it.id : r.k === 'x' ? r.it.id : `${r.it.txHash ?? r.it.blockHash}${r.it.kind}${i}`)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 130 }}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            tintColor={C.sub}
            onRefresh={async () => {
              setPulling(true);
              await Promise.all([load(), other.refresh()]);
              setPulling(false);
            }}
          />
        }
        ListHeaderComponent={
          (coin === 'all' || coin === 'lyx') && (filter === 'all' || filter === 'sent') ? (
            <View>
              {pend.length > 0 && <T v="sub" dim style={{ paddingTop: 18, paddingBottom: 4 }}>Waiting</T>}
              {pend.map((p) => (
                <PendingRow key={p.hash} p={p} hide={hide} />
              ))}
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => <T v="sub" dim style={{ paddingTop: 22, paddingBottom: 9, paddingHorizontal: 6 }}>{section.title}</T>}
        renderItem={({ item, index, section }) => {
          const n = section.data.length;
          const pos = n === 1 ? 'only' : index === 0 ? 'first' : index === n - 1 ? 'last' : 'mid';
          if (item.k === 'ev') return <EventRow item={item.it} i={index} pos={pos} />;
          return item.k === 'lyx' ? <ActivityRow item={item.it} i={index} hide={hide} pos={pos} /> : <FeedRow item={item.it} i={index} hide={hide} pos={pos} />;
        }}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (next && !busy && (coin === 'all' || coin === 'lyx')) load(next);
        }}
        ListFooterComponent={busy && anyItems ? <ActivityIndicator color={C.sub} style={{ padding: 20 }} /> : null}
        ListEmptyComponent={
          loading ? (
            <SkeletonRows />
          ) : err && !(other.data ?? []).length ? (
            <EmptyState icon="info" title="Can't reach the network" body="Check your connection. Pull down to try again." />
          ) : (
            <EmptyState icon="receive" title="No activity yet" body="Payments you send and receive will show up here." />
          )
        }
      />
    </View>
  );
}
