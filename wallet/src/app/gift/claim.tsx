import { useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { T } from '../../ui/Text';
import { Field, Group, Row, Screen, success, ErrorText } from '../../ui/controls';
import { Primary, Secondary } from '../../ui/Glass';
import { WalletCard } from '../../ui/WalletCards';
import { toast } from '../../ui/Toast';
import { C } from '../../ui/theme';
import { useAsync, activeNets } from '../../lib/multichain';
import { giftBalance, sweepGift } from '../../lib/gifts';
import { giftAddress, parseGift } from '../../lib/gift-core';
import { plainError } from '../../lib/plain-error';
import { ETH_NETS } from '../../lib/multichain-core';
import { useWindowDimensions } from 'react-native';

const NAMES = { lyx: 'LOKYX', btc: 'Bitcoin', eth: 'Ethereum' } as const;
const KIND = { lyx: 'lyx', btc: 'btc', eth: 'eth' } as const;

/** Someone gave you a card: paste or scan its code, see what's on it, move it into your wallet. */
export default function Claim() {
  const q = useLocalSearchParams<{ code?: string }>();
  const { width } = useWindowDimensions();
  const [text, setText] = useState(q.code ?? '');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [done, setDone] = useState(false);
  const g = useMemo(() => parseGift(text), [text]);
  const addr = g ? giftAddress(g.coin, g.sk, activeNets().btc) : '';
  const bal = useAsync(async () => (g ? giftBalance(g.coin, addr) : null), [addr], 15_000);

  const claim = async () => {
    if (!g) return;
    setBusy(true);
    try {
      await sweepGift(g.coin, g.sk, setStep);
      success();
      setDone(true);
      toast('Claimed. It lands in your wallet with the next block.', 'receive');
    } catch (e) {
      toast(plainError(e, g.coin === 'eth' ? ETH_NETS[activeNets().eth].label : 'the network'), 'info');
    } finally {
      setBusy(false);
      setStep('');
    }
  };

  return (
    <Screen title="Claim a gift card" large>
      <Field value={text} onChangeText={setText} placeholder="lokyx-gift:…" autoCapitalize="none" autoCorrect={false} mono multiline />
      {!g && <Secondary title="Paste" onPress={async () => setText((await Clipboard.getStringAsync()).trim())} />}
      <ErrorText hint>{text.length > 10 && !g ? "That isn't a LOKYX gift card code. It starts with lokyx-gift:" : ''}</ErrorText>
      {g ? (
        <>
          <WalletCard c={{ kind: KIND[g.coin], logo: g.coin === 'lyx' ? undefined : g.coin, title: `Gift · ${NAMES[g.coin]}`, balance: bal.data ? bal.data.text.split(' ')[0] : '', unit: bal.data ? bal.data.text.split(' ')[1] : '', address: addr, tag: done ? 'Claimed' : '' }} width={Math.min(width - 40, 420)} height={180} />
          {bal.data && bal.data.raw > 0n ? (
            <Group>
              <Row title="On the card" detail={bal.data.text} />
              <Row title="Network fee" detail="Taken from the gift" />
              <Row title="You receive" detail="What is left, in your wallet" />
            </Group>
          ) : null}
          {bal.data && bal.data.raw === 0n ? <T v="sub" dim>This card is empty. It may have been claimed already, or not funded yet.</T> : null}
          {done ? <Primary title="Done" onPress={() => router.back()} /> : <Primary title="Move it into my wallet" busy={busy} busyText={step || 'Starting…'} disabled={!bal.data || bal.data.raw === 0n} onPress={claim} />}
          <T v="caption" dim style={{ lineHeight: 18 }}>The network fee comes out of the gift. Whoever claims first gets it, so claim it as soon as you can.</T>
        </>
      ) : null}
    </Screen>
  );
}
