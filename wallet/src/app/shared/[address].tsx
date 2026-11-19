import { useState } from 'react';
import { Share, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { T } from '../../ui/Text';
import { Field, Press, Screen, success, ErrorText } from '../../ui/controls';
import { Label, Panel, GRow, Primary, Secondary } from '../../ui/Glass';
import { ApprovalRing } from '../../ui/ApprovalRing';
import { Avatar } from '../../ui/RingCode';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/Toast';
import { C, F } from '../../ui/theme';
import { confirmIt } from '../../lib/auth';
import { useAsync } from '../../lib/multichain';
import { useShared } from '../../lib/data';
import { currentAddress } from '../../lib/wallet';
import { isAddress } from '../../lib/lokyx';
import { labelFor, shortAddr } from '../../lib/format';
import { approve, cancel, deposit, execute, propose, readShared, revoke, type Payment } from '../../lib/shared';

const who = (a: string, me: string) => (a === me ? 'You' : labelFor(a));

/** One shared account: its card, who can approve, payments waiting, and proposing a new one. */
export default function SharedAccount() {
  const { address } = useLocalSearchParams<{ address: string }>();
  const me = currentAddress();
  const acct = useShared().find((s) => s.address === address);
  const { width } = useWindowDimensions();
  const info = useAsync(() => readShared(address), [address], 8000);
  const [sheet, setSheet] = useState<'' | 'propose' | 'deposit'>('');
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const d = info.data;

  const act = async (label: string, reason: string, f: () => Promise<string>) => {
    if (!(await confirmIt(reason))) return;
    setBusy(label);
    try {
      await f();
      success();
      toast('Sent. It shows here after the next block.', 'info');
      setSheet('');
      setTo('');
      setAmt('');
      setNote('');
      setTimeout(() => info.refresh(), 4000);
    } catch (e) {
      toast((e as Error).message, 'info');
    } finally {
      setBusy('');
    }
  };

  const waiting = d?.payments.filter((p) => p.state === 'waiting') ?? [];
  const done = d?.payments.filter((p) => p.state !== 'waiting') ?? [];

  const PaymentRow = ({ p }: { p: Payment }) => {
    const mine = p.approvals.includes(me);
    const enough = d ? p.approvals.length >= d.threshold : false;
    return (
      <View style={{ paddingVertical: 14, gap: 10, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.07)' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <T style={{ fontFamily: F.semibold, fontSize: 16 }}>{`Send ${p.amount} LYX`}</T>
            <T v="caption" dim>{`to ${labelFor(p.to)} · from ${who(p.by, me)}${p.note ? ` · ${p.note}` : ''}`}</T>
          </View>
          <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)' }}>
            <T style={{ fontFamily: F.semibold, fontSize: 13 }}>{`${p.approvals.length} of ${d?.threshold ?? '?'}`}</T>
          </View>
        </View>
        <T v="caption" dim>{`Approved by ${p.approvals.map((a) => who(a, me)).join(', ')}`}</T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {enough ? (
            <Press onPress={() => act(`x${p.id}`, `Send ${p.amount} LYX from the shared account`, () => execute(address, p.id))} style={{ flex: 1, height: 42, borderRadius: 21, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ fontFamily: F.semibold, fontSize: 14.5, color: C.inkText }}>{busy === `x${p.id}` ? '…' : 'Send it now'}</T>
            </Press>
          ) : !mine ? (
            <Press onPress={() => act(`a${p.id}`, `Approve sending ${p.amount} LYX`, () => approve(address, p.id))} style={{ flex: 1, height: 42, borderRadius: 21, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ fontFamily: F.semibold, fontSize: 14.5, color: C.inkText }}>{busy === `a${p.id}` ? '…' : 'Approve'}</T>
            </Press>
          ) : (
            <Press onPress={() => act(`r${p.id}`, 'Take back your approval', () => revoke(address, p.id))} style={{ flex: 1, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ fontFamily: F.semibold, fontSize: 14.5 }}>{busy === `r${p.id}` ? '…' : 'Take back'}</T>
            </Press>
          )}
          {p.by === me && (
            <Press onPress={() => act(`c${p.id}`, 'Cancel this payment', () => cancel(address, p.id))} style={{ height: 42, paddingHorizontal: 16, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ fontFamily: F.semibold, fontSize: 14.5 }}>Cancel</T>
            </Press>
          )}
        </View>
      </View>
    );
  };

  return (
    <Screen title={acct?.name ?? 'Shared account'}>
      <View style={{ alignItems: 'center', gap: 6, paddingTop: 4 }}>
        <ApprovalRing n={d ? d.owners.length : 3} have={d ? d.threshold : 0} need={d ? d.threshold : 99} size={176} stroke={10}>
          <T style={{ fontFamily: F.regular, fontSize: 40, letterSpacing: -1.4 }}>{d ? d.threshold : '·'}<T style={{ fontSize: 18, color: C.sub }}>{d ? ` of ${d.owners.length}` : ''}</T></T>
          <T v="caption" dim>must agree</T>
        </ApprovalRing>
        <T style={{ fontFamily: F.regular, fontSize: 36, letterSpacing: -1.2, marginTop: 8 }}>{d ? d.balance : '…'}<T style={{ fontSize: 16, color: C.sub }}> LYX</T></T>
        <T v="caption" dim>{shortAddr(address)}</T>
      </View>
      <ErrorText>{info.error}</ErrorText>
      {d && (
        <>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Primary title="Propose a payment" onPress={() => setSheet('propose')} /></View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Secondary title="Add money" onPress={() => setSheet('deposit')} /></View>
            <View style={{ flex: 1 }}><Secondary title="Share address" onPress={() => Share.share({ message: `Our shared LOKYX account (${acct?.name ?? ''}). Add it in the wallet under Apps › Shared accounts:\n${address}` })} /></View>
          </View>
          <Label>{`Who can approve · any ${d.threshold} of ${d.owners.length}`}</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingHorizontal: 6 }}>
            {d.owners.map((o) => (
              <View key={o} style={{ alignItems: 'center', gap: 6, width: 60 }}>
                <Avatar address={o} size={50} />
                <T v="caption" dim numberOfLines={1}>{who(o, me)}</T>
              </View>
            ))}
          </View>
          <Label>Waiting for approval</Label>
          {waiting.length ? waiting.map((p) => <View key={p.id} style={{ borderRadius: 22, backgroundColor: C.fill, paddingHorizontal: 16, marginBottom: 10 }}><PaymentRow p={p} /></View>) : <T v="sub" dim style={{ paddingVertical: 10, paddingHorizontal: 6 }}>Nothing waiting</T>}
          {done.length > 0 && (
            <>
              <Label>Earlier</Label>
              <Panel>
                {done.map((p) => <GRow key={p.id} title={`${p.state === 'sent' ? 'Sent' : 'Cancelled'} ${p.amount} LYX`} sub={`to ${labelFor(p.to)}${p.note ? ` · ${p.note}` : ''} · approved by ${p.approvals.map((a) => who(a, me)).join(', ')}`} />)}
              </Panel>
            </>
          )}
        </>
      )}
      <Sheet open={sheet === 'propose'} onClose={() => setSheet('')}>
        <View style={{ gap: 12 }}>
          <T v="headline">Propose a payment</T>
          <T v="sub" dim>{d ? `It goes out once ${d.threshold} of you approve. Your approval counts as the first.` : ''}</T>
          <Field value={to} onChangeText={setTo} placeholder="To: lyx1…" autoCapitalize="none" autoCorrect={false} mono />
          <Field value={amt} onChangeText={setAmt} placeholder="Amount in LYX" keyboardType="decimal-pad" />
          <Field value={note} onChangeText={setNote} placeholder="What it's for (everyone sees this)" maxLength={140} />
          <Primary title="Propose" busy={busy === 'p'} disabled={!isAddress(to.trim().toLowerCase()) || !amt} onPress={() => act('p', `Propose sending ${amt} LYX`, () => propose(address, to.trim().toLowerCase(), amt.trim(), note.trim()))} />
        </View>
      </Sheet>
      <Sheet open={sheet === 'deposit'} onClose={() => setSheet('')}>
        <View style={{ gap: 12 }}>
          <T v="headline">Add money</T>
          <Field value={amt} onChangeText={setAmt} placeholder="Amount in LYX" keyboardType="decimal-pad" autoFocus />
          <Primary title="Add it" busy={busy === 'd'} disabled={!amt} onPress={() => act('d', `Put ${amt} LYX in the shared account`, () => deposit(address, amt.trim()))} />
        </View>
      </Sheet>
    </Screen>
  );
}
