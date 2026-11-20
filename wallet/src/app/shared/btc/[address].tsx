import { useEffect, useState } from 'react';
import { Share, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { T } from '../../../ui/Text';
import { Field, Screen, success, ErrorText } from '../../../ui/controls';
import { Label, Panel, GRow, Primary, Secondary } from '../../../ui/Glass';
import { ApprovalRing } from '../../../ui/ApprovalRing';
import { Qr } from '../../../ui/Qr';
import { Sheet } from '../../../ui/Sheet';
import { toast } from '../../../ui/Toast';
import { C, F } from '../../../ui/theme';
import { confirmIt } from '../../../lib/auth';
import { useAsync } from '../../../lib/multichain';
import { formatBtc, parseBtc } from '../../../lib/multichain-core';
import { readSpend } from '../../../lib/btcms-core';
import { dismissPay, sendToGroup } from '../../../lib/relay';
import { incomingSpends, myMsPub, removeBtcShared, spendId, type IncomingSpend, sendFinished, sharedBalance, signWithMine, startPayment, useBtcShared } from '../../../lib/btcms';

/** A shared Bitcoin account: balance, its address to receive, and passing a payment around until it has enough signatures. */
export default function BtcSharedScreen() {
  const { address } = useLocalSearchParams<{ address: string }>();
  const s = useBtcShared().find((x) => x.address === address);
  const { width } = useWindowDimensions();
  const bal = useAsync(async () => (s ? sharedBalance(s) : null), [address], 20_000);
  const mine = useAsync(async () => (s ? myMsPub(s.net) : ''), [address]);
  const [sheet, setSheet] = useState<'' | 'pay' | 'code' | 'recv'>('');
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // payments the others left on the relay: the newest opens by itself, and a copy with more signatures replaces the one on screen
  const inbox = useAsync<IncomingSpend[]>(async () => (s?.relay ? incomingSpends(s) : []), [address], 8_000);
  useEffect(() => {
    const list = inbox.data ?? [];
    if (!s || !list.length) return;
    if (!code.trim()) return setCode(list[0].code);
    try {
      const cur = readSpend(s, code);
      const m = list.find((x) => x.id === spendId(s.address, cur));
      if (m && m.signatures > cur.signatures) setCode(m.code);
    } catch {
      // a code typed by hand that is not a payment: leave it alone
    }
  }, [inbox.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <Screen title="Shared Bitcoin"><T v="sub" dim>That account isn't on this phone.</T></Screen>;

  let reading: ReturnType<typeof readSpend> | null = null;
  let readErr = '';
  if (code.trim()) {
    try {
      reading = readSpend(s, code);
    } catch (e) {
      readErr = (e as Error).message;
    }
  }
  const iSigned = !!(reading && mine.data && reading.signedByKey(mine.data));

  const start = async () => {
    if (!(await confirmIt(`Start a payment of ${amt} BTC`))) return;
    setBusy(true);
    try {
      const d = await startPayment(s, to.trim(), parseBtc(amt));
      setCode(d.psbt);
      setSheet('code');
      if (s.m > 1) {
        if (await sendToGroup(s.relay, d.psbt)) toast('Sent to the others', 'send');
        else await Share.share({ message: `Please approve this payment from "${s.name}": open LOKYX › Apps › Shared accounts › ${s.name} › I have a payment code, and paste:\n\n${d.psbt}` });
      }
    } catch (e) {
      toast((e as Error).message, 'info');
    } finally {
      setBusy(false);
    }
  };
  const sign = async () => {
    if (!reading || !(await confirmIt('Sign this payment'))) return;
    setBusy(true);
    try {
      const next = await signWithMine(s, code);
      setCode(next);
      success();
      const r = readSpend(s, next);
      if (!r.ready) {
        if (await sendToGroup(s.relay, next)) toast('Sent to the others', 'send');
        else await Share.share({ message: `Signed (${r.signatures} of ${r.needed}). Next person, paste this in LOKYX:\n\n${next}` });
      } else await sendToGroup(s.relay, next);
    } catch (e) {
      toast((e as Error).message, 'info');
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!(await confirmIt('Send this payment'))) return;
    setBusy(true);
    try {
      const done = readSpend(s, code);
      await sendFinished(s, code);
      await dismissPay(spendId(s.address, done));
      success();
      toast('Sent to the Bitcoin network', 'send');
      setCode('');
      setSheet('');
      bal.refresh();
    } catch (e) {
      toast((e as Error).message, 'info');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={s.name}>
      <View style={{ alignItems: 'center', gap: 6, paddingTop: 4 }}>
        <ApprovalRing n={s.keys.length} have={s.m} need={s.m} size={168} stroke={10}>
          <T style={{ fontFamily: F.regular, fontSize: 38, letterSpacing: -1.4 }}>{s.m}<T style={{ fontSize: 17, color: C.sub }}>{` of ${s.keys.length}`}</T></T>
          <T v="caption" dim>must agree</T>
        </ApprovalRing>
        <T style={{ fontFamily: F.regular, fontSize: 34, letterSpacing: -1.2, marginTop: 8 }}>{bal.data != null ? formatBtc(bal.data) : '…'}<T style={{ fontSize: 16, color: C.sub }}> BTC</T></T>
        <T v="caption" dim>Test network</T>
      </View>
      <Primary title="Start a payment" onPress={() => setSheet('pay')} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Secondary title="I have a payment code" onPress={() => setSheet('code')} /></View>
        <View style={{ flex: 1 }}><Secondary title="Receive" onPress={() => setSheet('recv')} /></View>
      </View>
      <Label>{`Keys · any ${s.m} of ${s.keys.length} sign`}</Label>
      <Panel>
        {s.keys.map((k) => <GRow key={k} icon="key" title={k === mine.data ? 'You' : `${k.slice(0, 10)}…${k.slice(-8)}`} />)}
      </Panel>
      <Secondary title="Remove from this phone" onPress={async () => { await removeBtcShared(s.address); router.back(); }} />
      <T v="caption" dim style={{ lineHeight: 18 }}>Removing it only forgets it here. The coins stay, and adding the same keys and number brings it back.</T>

      <Sheet open={sheet === 'recv'} onClose={() => setSheet('')}>
        <View style={{ gap: 14, alignItems: 'center' }}>
          <T v="headline">Receive into the shared account</T>
          <View style={{ padding: 12, backgroundColor: '#fff', borderRadius: 20 }}><Qr value={`bitcoin:${s.address}`} size={220} /></View>
          <T v="mono" selectable style={{ fontSize: 13, textAlign: 'center' }}>{s.address}</T>
          <Secondary title="Copy address" onPress={async () => { await Clipboard.setStringAsync(s.address); success(); }} />
        </View>
      </Sheet>
      <Sheet open={sheet === 'pay'} onClose={() => setSheet('')}>
        <View style={{ gap: 12 }}>
          <T v="headline">Start a payment</T>
          <T v="sub" dim>{`You sign first. Then ${s.m - 1} more ${s.m - 1 === 1 ? 'person signs' : 'people sign'} and it can be sent.`}</T>
          <Field value={to} onChangeText={setTo} placeholder="To: tb1…" autoCapitalize="none" autoCorrect={false} mono />
          <Field value={amt} onChangeText={setAmt} placeholder="Amount in BTC" keyboardType="decimal-pad" />
          <Primary title="Sign and share" busy={busy} disabled={!to.trim() || !amt} onPress={start} />
        </View>
      </Sheet>
      <Sheet open={sheet === 'code'} onClose={() => setSheet('')}>
        <View style={{ gap: 12 }}>
          <T v="headline">A payment to approve</T>
          <Field value={code} onChangeText={setCode} placeholder="lokyx-btc-psbt:…" autoCapitalize="none" autoCorrect={false} mono multiline />
          {!code ? <Secondary title="Paste" onPress={async () => setCode((await Clipboard.getStringAsync()).trim())} /> : null}
          <ErrorText hint>{readErr}</ErrorText>
          {reading ? (
            <Panel style={{ paddingVertical: 10 }}>
              {reading.pays.map((p, i) => <GRow key={i} title={`Pays ${formatBtc(p.amount)} BTC`} sub={`to ${p.to}`} />)}
              <GRow title={`Network fee ${formatBtc(reading.fee)} BTC`} sub={`${reading.signatures} of ${reading.needed} signatures${iSigned ? ' · yours is on it' : ''}`} />
            </Panel>
          ) : null}
          {reading && reading.ready ? <Primary title="Send it" busy={busy} onPress={send} /> : null}
          {reading && !reading.ready && !iSigned ? <Primary title="Sign it" busy={busy} onPress={sign} /> : null}
          {reading && !reading.ready && iSigned ? <Secondary title="Share it with the next person" onPress={() => Share.share({ message: code })} /> : null}
        </View>
      </Sheet>
    </Screen>
  );
}
