import { useState } from 'react';
import { Share, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { plainError } from '../../lib/plain-error';
import { T } from '../../ui/Text';
import { Screen, success, ErrorText } from '../../ui/controls';
import { Primary, Secondary, Panel, GRow } from '../../ui/Glass';
import { WalletCard } from '../../ui/WalletCards';
import { Qr } from '../../ui/Qr';
import { toast } from '../../ui/Toast';
import { C } from '../../ui/theme';
import { confirmIt } from '../../lib/auth';
import { useAsync } from '../../lib/multichain';
import { closeGift, feeSettled, giftBalance, giftKey, sweepGift, useGifts } from '../../lib/gifts';
import { encodeGift } from '../../lib/gift-core';

const NAMES = { lyx: 'LOKYX', btc: 'Bitcoin', eth: 'Ethereum' } as const;
const KIND = { lyx: "lyx", btc: "btc", eth: "eth" } as const;

/** One card you made: what's on it, the code to hand over, and taking it back. */
export default function GiftCard() {
  const { address } = useLocalSearchParams<{ address: string }>();
  const g = useGifts().find((x) => x.address === address);
  const { width } = useWindowDimensions();
  const cw = Math.min(width - 40, 420);
  const bal = useAsync(async () => (g ? giftBalance(g.coin, g.address) : null), [g?.address], 15_000);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  if (!g) return <Screen title="Gift card"><T v="sub" dim>That card isn't on this phone.</T></Screen>;
  const empty = bal.data && bal.data.raw === 0n;

  const reveal = async () => {
    if (!(await confirmIt('Show the gift code'))) return;
    try {
      setCode(encodeGift(g.coin, await giftKey(g)));
    } catch (e) {
      toast(plainError(e), 'info');
    }
  };
  const share = async () => {
    const c = code || (await giftKey(g).then((k) => encodeGift(g.coin, k)));
    await Share.share({ message: `${g.note ? `${g.note}\n\n` : ''}A ${NAMES[g.coin]} gift card for you (${g.amount}). Open the LOKYX wallet, go to Apps › Gift cards › Claim, and paste this:\n\n${c}` });
  };
  const takeBack = async () => {
    if (!(await confirmIt('Take the coins back from this card'))) return;
    setBusy(true);
    try {
      await sweepGift(g.coin, await giftKey(g));
      await closeGift(g.address);
      success();
      toast('On its way back to your wallet', 'receive');
      bal.refresh();
    } catch (e) {
      toast(plainError(e), 'info');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={g.note || 'Gift card'}>
      <WalletCard c={{ kind: KIND[g.coin], logo: g.coin === 'lyx' ? undefined : g.coin, title: `Gift · ${NAMES[g.coin]}`, sub: g.note || undefined, balance: bal.data ? bal.data.text.split(' ')[0] : '', unit: bal.data ? bal.data.text.split(' ')[1] : '', address: g.address, tag: g.closed ? 'Closed' : empty ? 'Not funded yet' : 'Ready' }} width={cw} height={190} />
      {empty && !g.closed ? (
        <Panel>
          <GRow icon="send" title="Put the coins on it" sub={`You meant to add ${g.amount}`} onPress={() => router.push(g.coin === 'lyx' ? `/send?to=${g.address}&amount=${g.amount.split(' ')[0]}` : `/chain/send?chain=${g.coin}&to=${g.address}&amount=${g.amount.split(' ')[0]}`)} />
        </Panel>
      ) : null}
      {g.fee && !g.closed && !empty ? (
        <Panel>
          <GRow icon="send" title={`Pay the ${g.fee.text} fee`} sub="0.2% for making the card, in the same coin" onPress={() => {
            const f = g.fee!;
            feeSettled(g.address);
            router.push(g.coin === 'lyx' ? `/send?to=${f.to}&amount=${f.amount}` : `/chain/send?chain=${g.coin}&to=${f.to}&amount=${f.amount}`);
          }} />
        </Panel>
      ) : null}
      {code ? (
        <View style={{ alignItems: 'center', gap: 12 }}>
          <View style={{ padding: 12, backgroundColor: '#fff', borderRadius: 22 }}>
            <Qr value={code} size={Math.min(width - 120, 260)} />
          </View>
          <T v="caption" dim style={{ textAlign: 'center', lineHeight: 18 }}>Anyone who scans this or sees the code can take the coins. Only show it to the person it's for.</T>
        </View>
      ) : (
        <Secondary title="Show the QR to scan" onPress={reveal} disabled={g.closed} />
      )}
      <Primary title="Send the card" onPress={share} disabled={g.closed} />
      <Secondary title={busy ? 'Taking it back…' : 'Take it back'} onPress={takeBack} disabled={busy || g.closed || !!empty} />
      <ErrorText hint>{bal.error}</ErrorText>
    </Screen>
  );
}
