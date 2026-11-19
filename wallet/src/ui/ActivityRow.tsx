import { Linking, View } from 'react-native';
import { openPayment } from '../app/xtx';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Press } from './controls';
import type { FeedItem } from '../lib/feed-core';
import { T } from './Text';
import { Icon, type IconName } from './Icon';
import { C } from './theme';
import type { HistoryItem } from '../lib/rpc';
import { maturity } from '../lib/chain';
import type { Pending } from '../lib/data';
import { labelFor, niceLyx, timeAgo } from '../lib/format';
import { DUR, EASE_OUT } from './motion';
import { CoinLogo } from './CoinLogo';
import { Logo } from './Logo';
import type { AppEvent } from '../lib/events-core';
import { F } from './theme';

export type Pos = 'first' | 'mid' | 'last' | 'only';

/** The coin's own logo; a small arrow dot in the corner says which way the money went. */
function CoinMark({ coin, kind, wait }: { coin: 'lyx' | 'btc' | 'eth' | 'sol' | 'trx'; kind: string; wait?: boolean }) {
  const icon: IconName = kind === 'mined' ? 'cube' : kind === 'received' ? 'receive' : kind === 'self' ? 'refresh' : 'send';
  return (
    <View style={{ width: 40, height: 40 }}>
      {coin === 'sol' || coin === 'trx' ? <Logo id={coin} size={40} /> : <CoinLogo chain={coin} size={40} />}
      <View style={{ position: 'absolute', right: -4, bottom: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: wait ? C.wait : '#000', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={10} color={wait ? '#000' : C.soft} width={2.4} />
      </View>
    </View>
  );
}

/** One row of a day's panel: the panel is drawn by the rows, so first and last get the rounded ends. */
function Shell({ pos, onPress, children }: { pos: Pos; onPress: () => void; children: React.ReactNode }) {
  const top = pos === 'first' || pos === 'only';
  const bottom = pos === 'last' || pos === 'only';
  return (
    <Press haptic={false} scaleTo={0.99} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: '#0B0B0E', borderLeftWidth: 0.5, borderRightWidth: 0.5, borderTopWidth: top ? 0.5 : 0, borderBottomWidth: bottom ? 0.5 : 0, borderColor: '#1F1F25', borderTopLeftRadius: top ? 22 : 0, borderTopRightRadius: top ? 22 : 0, borderBottomLeftRadius: bottom ? 22 : 0, borderBottomRightRadius: bottom ? 22 : 0 }}>
      {children}
    </Press>
  );
}
const Rule = ({ pos }: { pos: Pos }) => (pos === 'mid' || pos === 'last' ? <View style={{ height: 0.5, backgroundColor: '#1D1D22', marginHorizontal: 16 }} /> : null);
function Amount({ text, unit, good }: { text: string; unit: string; good?: boolean }) {
  return (
    <T style={{ fontFamily: F.medium, fontSize: 19, letterSpacing: -0.4, color: good ? '#9BE5BD' : C.text, fontVariant: ['tabular-nums'] }}>
      {text} <T style={{ fontSize: 12, color: C.sub, letterSpacing: 0 }}>{unit}</T>
    </T>
  );
}

function Badge({ icon, wait }: { icon: IconName; wait?: boolean }) {
  return (
    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={20} color={C.text} width={2} />
      {wait && <View style={{ position: 'absolute', right: -1, bottom: -1, width: 14, height: 14, borderRadius: 7, backgroundColor: C.wait, borderWidth: 3, borderColor: C.bg }} />}
    </View>
  );
}

export function ActivityRow({ item, i = 0, hide, pos = 'only' }: { item: HistoryItem; i?: number; hide?: boolean; pos?: Pos }) {
  const title = item.kind === 'mined' ? 'Mined' : item.kind === 'received' ? 'Received' : item.kind === 'self' ? 'To yourself' : 'Sent';
  const who = item.kind === 'mined' ? `Block ${item.height.toLocaleString('en-US')}` : item.kind === 'received' ? `From ${labelFor(item.from)}` : item.kind === 'self' ? '' : `To ${labelFor(item.to)}`;
  const plus = item.kind === 'received' || item.kind === 'mined';
  const young = item.kind === 'mined' && item.confirmations < maturity();
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(i, 8) * 30).duration(DUR.base).easing(EASE_OUT)}>
      <Rule pos={pos} />
      <Shell pos={pos} onPress={() => (item.txHash ? router.push(`/tx/${item.txHash}`) : router.push(`/block/${item.height}`))}>
        <CoinMark coin="lyx" kind={item.kind} />
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontFamily: F.medium, fontSize: 16 }} numberOfLines={1}>{title}</T>
          <T v="caption" dim numberOfLines={1}>{who}</T>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Amount text={hide ? '•••' : `${plus ? '+' : '−'}${niceLyx(item.amountLyx)}`} unit="LYX" good={plus} />
          <T v="caption" dim>{young ? `Unlocks in ${maturity() - item.confirmations} blocks` : timeAgo(item.timestamp)}</T>
        </View>
      </Shell>
    </Animated.View>
  );
}

export function PendingRow({ p, hide }: { p: Pending; hide?: boolean }) {
  const title = p.what === 'deploy' ? 'Making a contract' : p.what === 'call' ? `Using ${labelFor(p.to)}` : `To ${labelFor(p.to)}`;
  return (
    <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)}>
      <Press haptic={false} scaleTo={0.98} onPress={() => router.push(`/tx/${p.hash}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 }}>
        <Badge icon={p.what === 'send' || p.what === 'token' ? 'send' : 'cube'} wait />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="callout" numberOfLines={1} style={{ fontSize: 16 }}>{title}</T>
          <T v="caption" color={C.wait}>Waiting for a block</T>
        </View>
        <T v="callout" color={C.soft} style={{ fontSize: 16 }}>{hide ? '•••' : p.amount ? `−${p.amount}` : ''}</T>
      </Press>
    </Animated.View>
  );
}

/** A payment on another coin: same look as a LOKYX row, opens its page in the app. */
export function FeedRow({ item, i = 0, hide, pos = 'only' }: { item: FeedItem; i?: number; hide?: boolean; pos?: Pos }) {
  const plus = item.kind === 'received';
  const who = item.other ? `${item.other.slice(0, 5)}…${item.other.slice(-4)}` : '';
  const title = item.failed ? 'Failed' : item.kind === 'received' ? 'Received' : item.kind === 'self' ? 'To yourself' : 'Sent';
  const sub = item.kind === 'self' ? item.net : who ? `${plus ? 'From' : 'To'} ${who}` : item.net;
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(i, 8) * 30).duration(DUR.base).easing(EASE_OUT)}>
      <Rule pos={pos} />
      <Shell pos={pos} onPress={() => openPayment(item)}>
        <CoinMark coin={item.coin} kind={item.kind} wait={!item.time} />
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontFamily: F.medium, fontSize: 16 }} numberOfLines={1}>{title}</T>
          <T v="caption" dim numberOfLines={1}>{sub}</T>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Amount text={hide ? '•••' : `${plus ? '+' : '−'}${item.amount}`} unit={item.unit} good={plus && !item.failed} />
          <T v="caption" dim>{item.time ? timeAgo(item.time) : 'Pending'}</T>
        </View>
      </Shell>
    </Animated.View>
  );
}

/** Something that happened in the app that is not a payment: a vault made, a shared account made, money added to the Apps wallet. */
export function EventRow({ item, i = 0, pos = 'only' }: { item: AppEvent; i?: number; pos?: Pos }) {
  const icon: IconName = item.kind === 'vault' ? 'lock' : item.kind === 'shared' ? 'people' : 'send';
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(i, 8) * 30).duration(DUR.base).easing(EASE_OUT)}>
      <Rule pos={pos} />
      <Shell pos={pos} onPress={() => router.push(item.kind === 'vault' ? '/vaults' : item.kind === 'shared' ? '/shared' : '/apps-wallet')}>
        <Badge icon={icon} />
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontFamily: F.medium, fontSize: 16 }} numberOfLines={1}>{item.title}</T>
          <T v="caption" dim numberOfLines={1}>{item.sub}</T>
        </View>
        <T v="caption" dim>{timeAgo(item.time)}</T>
      </Shell>
    </Animated.View>
  );
}
