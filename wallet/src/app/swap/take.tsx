import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { T } from '../../ui/Text';
import { Button, ErrorText, Field, Group, Note, Row, Screen } from '../../ui/controls';
import { confirmIt } from '../../lib/auth';
import { formatLyx } from '../../lib/lokyx';
import { currentAddress } from '../../lib/wallet';
import { acceptOffer, otherText, readOffer, swapId, sw } from '../../lib/swaps';
import { answerOffer } from '../../lib/board';
import { toast } from '../../ui/Toast';
import { useEffect } from 'react';

/** Paste an offer code someone sent you, see exactly what it says, and accept it. */
export default function TakeSwap() {
  const q = useLocalSearchParams<{ code?: string; board?: string }>();
  const [code, setCode] = useState(q.code ?? '');
  const [offer, setOffer] = useState<sw.Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const read = async (c: string) => {
    setErr('');
    setOffer(null);
    if (!c.trim()) return;
    try {
      setOffer(await readOffer(c, currentAddress()));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    if (q.code) void read(q.code);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const accept = async () => {
    if (!offer) return;
    setErr('');
    try {
      if (!(await confirmIt('Accept this swap', { keyFollows: true }))) return;
      setBusy(true);
      const r = await acceptOffer(offer);
      if (q.board && r.accept) {
        // answer on the board, so the maker picks it up without anyone copying codes
        await answerOffer(Number(q.board), sw.acceptCode(r.accept)).then(
          () => toast('Answer posted on the board. The maker locks first.', 'info'),
          (e) => toast(`Couldn't post your answer: ${(e as Error).message}. Send the acceptance code instead.`, 'info'),
        );
      }
      router.replace(`/swap/${encodeURIComponent(swapId(r))}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  // the offer is written from the maker's side: they sell LYX, so you get LYX
  const youGive = offer ? (offer.dir === 'sell-lyx' ? otherText(offer) : `${formatLyx(offer.lyx, 6)} LYX`) : '';
  const youGet = offer ? (offer.dir === 'sell-lyx' ? `${formatLyx(offer.lyx, 6)} LYX` : otherText(offer)) : '';

  return (
    <Screen title="Accept an offer" large>
      <Note>Paste the offer code the other person sent you. Nothing moves until you both lock.</Note>
      <Field value={code} onChangeText={(t) => (setCode(t), void read(t))} placeholder="lokyx-swap-offer:…" autoCapitalize="none" autoCorrect={false} multiline mono />
      <Button
        title="Paste"
        kind="line"
        onPress={async () => {
          const t = await Clipboard.getStringAsync();
          setCode(t);
          void read(t);
        }}
      />
      {offer && (
        <View style={{ gap: 14 }}>
          <Group title="The deal">
            <Row title="You give" detail={youGive} />
            <Row title="You get" detail={youGet} />
            <Row title="Network" detail={sw.assetOf(offer) === 'btc' ? `Bitcoin ${offer.btcNet}` : 'Ethereum Sepolia'} />
          </Group>
          <T v="caption" dim>If either of you stops halfway, the locks run out and both get their coins back.</T>
          <Button title="Accept" busy={busy} onPress={accept} />
        </View>
      )}
      <ErrorText>{err}</ErrorText>
    </Screen>
  );
}
