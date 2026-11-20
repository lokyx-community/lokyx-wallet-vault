import { Aurora } from '../../ui/Aurora';
import { useCallback, useMemo } from 'react';
import { RefreshControl, SectionList, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Icon, type IconName } from '../../ui/Icon';
import { Press } from '../../ui/controls';
import { EmptyState } from '../../ui/EmptyState';
import { C, F } from '../../ui/theme';
import { DUR, EASE_OUT } from '../../ui/motion';
import { dayLabel } from '../../lib/format';
import { clearInbox, loadInbox, markAllRead, useInbox, unreadCount, type InboxItem, type InboxKind } from '../../lib/inbox';

const ICON: Record<InboxKind, IconName> = { receive: 'receive', send: 'send', vault: 'shield', alert: 'bell', info: 'info' };
const TINT: Record<InboxKind, string> = { receive: C.good, send: C.text, vault: C.bad, alert: C.bad, info: C.sub };

const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function Item({ i, n, unread, first, last }: { i: InboxItem; n: number; unread: boolean; first: boolean; last: boolean }) {
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(n, 6) * 40).duration(DUR.base).easing(EASE_OUT)} style={{ backgroundColor: C.fill, borderTopLeftRadius: first ? 24 : 0, borderTopRightRadius: first ? 24 : 0, borderBottomLeftRadius: last ? 24 : 0, borderBottomRightRadius: last ? 24 : 0, overflow: 'hidden', borderTopWidth: first ? 0 : 0.5, borderTopColor: C.line2 }}>
      <Press onPress={() => i.route && router.push(i.route as never)} scaleTo={0.99} style={{ flexDirection: 'row', gap: 14, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'flex-start' }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={ICON[i.kind]} size={19} color={TINT[i.kind]} width={1.9} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T style={{ flex: 1, fontFamily: unread ? F.semibold : F.medium, fontSize: 15.5 }} numberOfLines={2}>{i.title}</T>
            <T v="caption" dim>{ago(i.at)}</T>
          </View>
          <T v="sub" dim style={{ lineHeight: 19 }} numberOfLines={4}>{i.body}</T>
        </View>
        {unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.text, marginTop: 6 }} /> : null}
      </Press>
    </Animated.View>
  );
}

/** Everything the wallet told you, newest first. Opening the tab marks it read. */
export default function Notifications() {
  const insets = useSafeAreaInsets();
  const list = useInbox();
  // what was unread when the tab opened stays marked while you look at it, then clears
  const seen = useMemo(() => new Set(list.filter((i) => !i.read).map((i) => i.id)), [list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(
    useCallback(() => {
      loadInbox().catch(() => {});
      const t = setTimeout(() => markAllRead().catch(() => {}), 1500);
      return () => clearTimeout(t);
    }, []),
  );
  const sections = useMemo(() => {
    const out: { title: string; data: InboxItem[] }[] = [];
    for (const i of list) {
      const t = dayLabel(Math.floor(i.at / 1000));
      const last = out[out.length - 1];
      if (last && last.title === t) last.data.push(i);
      else out.push({ title: t, data: [i] });
    }
    return out;
  }, [list]);
  const unread = unreadCount(list);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Aurora />
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 6, flexDirection: 'row', alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 34, letterSpacing: -1.2 }}>Inbox</T>
          <T v="caption" dim>{unread ? `${unread} new` : 'Everything the wallet told you'}</T>
        </View>
        {list.length > 0 ? (
          <Press onPress={() => clearInbox().catch(() => {})} hitSlop={10} accessibilityLabel="Clear all">
            <T style={{ fontFamily: F.medium, fontSize: 14.5, color: C.sub }}>Clear</T>
          </Press>
        ) : null}
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void loadInbox()} tintColor={C.sub} />}
        renderSectionHeader={({ section }) => <T style={{ fontFamily: F.semibold, fontSize: 13, color: C.sub, paddingTop: 22, paddingBottom: 8, paddingHorizontal: 8 }}>{section.title}</T>}
        renderItem={({ item, index, section }) => <Item i={item} n={index} unread={seen.has(item.id)} first={index === 0} last={index === section.data.length - 1} />}
        ListEmptyComponent={<EmptyState icon="bell" title="Nothing yet" body="Payments you receive, money that leaves your wallet and vault withdrawals will show up here, even the ones you missed." />}
      />
    </View>
  );
}
