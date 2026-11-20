import { useMemo } from 'react';
import { View } from 'react-native';
import { Linking } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { T } from '../ui/Text';
import { Screen, success } from '../ui/controls';
import { TxView, type TxStep } from '../ui/TxView';
import { toast } from '../ui/Toast';
import { activeNets, btcTxMore, ethTxMore, useAsync, type MoreAboutTx } from '../lib/multichain';
import { shortAddr } from '../lib/format';
import { BTC_NETS, ETH_NETS } from '../lib/multichain-core';
import { receiptText } from '../lib/slip-core';
import { CoinLogo } from '../ui/CoinLogo';
import { Logo } from '../ui/Logo';
import { isWaiting, nameIn, type FeedItem } from '../lib/feed-core';
import { useEthShared } from '../lib/ethms';
import { nameFor } from '../lib/format';

const NAMES = { btc: 'Bitcoin', eth: 'Ethereum', sol: 'Solana', trx: 'Tron', lyx: 'LOKYX' } as const;
const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Open the in-app page for a payment on Bitcoin, Ethereum, Solana or Tron. */
export const openPayment = (item: FeedItem) => router.push({ pathname: '/xtx', params: { item: JSON.stringify(item) } });

/** One payment, in full: what it was, whether it went through, the fee, and its id. The explorer is an extra, not the way in. */
export default function PaymentDetails() {
  const { item: raw } = useLocalSearchParams<{ item: string }>();
  const shared = useEthShared();
  const item = useMemo<FeedItem | null>(() => {
    try {
      return JSON.parse(String(raw)) as FeedItem;
    } catch {
      return null;
    }
  }, [raw]);
  const id = item ? item.id.split(':').pop() ?? '' : '';
  const more = useAsync<MoreAboutTx>(async () => {
    if (!item) return {};
    const n = activeNets();
    try {
      if (item.coin === 'btc') return await btcTxMore(n.btc, id);
      if (item.coin === 'eth') return await ethTxMore(n.eth, id);
    } catch {
      // the screen still has everything the list knew
    }
    return {};
  }, [raw], 5000);
  if (!item) return <Screen title="Payment"><T v="sub" dim>This payment can't be shown.</T></Screen>;

  const m = more.data;
  // the network's own answer beats the list: a payment in a block is not waiting, whatever the list says
  const pending = isWaiting(item, m);
  const time = item.time || m?.time || 0;
  const timeText = time ? when(time) : m?.block ? `In block ${m.block.toLocaleString('en-US')}` : 'Waiting for a block';
  const out = item.kind === 'sent';
  const self = item.kind === 'self';
  const conf = m?.confirmations ?? 0;
  const state = item.failed ? 'failed' : pending ? 'pending' : conf >= 6 || (item.coin !== 'btc' && item.coin !== 'eth') ? 'settled' : 'block';
  // only plain coin payments can be repeated: a token or another coin has its own send screen
  const nativeUnit = item.coin === 'btc' ? BTC_NETS[activeNets().btc].unit : item.coin === 'eth' ? ETH_NETS[activeNets().eth].unit : '';
  const again = out && other && (item.coin === 'btc' || item.coin === 'eth') && item.unit === nativeUnit ? () => router.push(`/chain/send?chain=${item.coin}&to=${other}&amount=${item.amount.replace(/,/g, '')}`) : undefined;
  const other = item.other || (out ? m?.to : m?.from) || '';
  const known = nameFor(other) ?? nameIn(shared, other);
  const line = self ? 'To yourself' : other ? `${out ? 'to' : 'from'} ${known ?? shortAddr(other, 8, 6)}` : out ? 'Sent' : 'Received';
  const copyId = async () => {
    await Clipboard.setStringAsync(id);
    success();
    toast('Copied');
  };
  const steps: TxStep[] = item.failed
    ? [{ title: 'Sent', sub: timeText, state: 'done' }, { title: 'Did not go through', sub: 'Only the network fee was spent', state: 'failed' }]
    : [
        { title: out || self ? 'Sent' : 'Seen', sub: pending ? 'Just now' : timeText, state: 'done' },
        { title: 'In a block', sub: m?.block ? `Block ${m.block.toLocaleString('en-US')}` : pending ? 'Waiting for the next block' : undefined, state: pending ? 'now' : 'done' },
        { title: 'Settled', sub: m?.confirmations ? `${m.confirmations.toLocaleString('en-US')} blocks on top` : undefined, state: state === 'settled' ? 'done' : pending ? 'next' : 'now' },
      ];
  const verb = item.kind === 'sent' ? 'Sent' : item.kind === 'self' ? 'Moved' : item.kind === 'mined' ? 'Mined' : 'Received';
  const network = `${NAMES[item.coin]} · ${item.net}`;
  const mark = item.coin === 'sol' || item.coin === 'trx' ? <Logo id={item.coin} size={34} /> : <CoinLogo chain={item.coin === 'btc' ? 'btc' : item.coin === 'lyx' ? 'lyx' : 'eth'} size={34} />;
  const shareText = receiptText(`${verb} ${item.amount} ${item.unit}`, [...(other ? ([[out ? 'To' : 'From', other]] as [string, string][]) : []), ['Network', network], ...(m?.fee ? ([['Network fee', m.fee]] as [string, string][]) : []), ['Time', timeText]], id, item.url);
  const rows: [string, string, boolean?][] = [['Network', network], ...(m?.fee ? [['Network fee', m.fee] as [string, string]] : []), ['Time', timeText]];
  if (other) rows.push([out ? 'To' : 'From', known ? `${known} · ${shortAddr(other, 6, 4)}` : shortAddr(other, 10, 8), !known]);
  return (
    <Screen title="Payment">
      <TxView state={state} sign={out ? '−' : self ? '' : '+'} amount={item.amount} unit={item.unit} line={line} mark={mark} label={`${verb} · ${item.net}`} hash={id} qrUrl={item.url} shareText={shareText} steps={steps} rows={rows} onCopy={copyId} onAgain={again} onExplorer={item.url ? () => Linking.openURL(item.url!).catch(() => {}) : undefined} />
    </Screen>
  );
}
