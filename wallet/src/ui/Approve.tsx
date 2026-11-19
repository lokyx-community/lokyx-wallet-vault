import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { T } from './Text';
import { Button, ErrorText, failure, success } from './controls';
import { Sheet } from './Sheet';
import { SlideToPay } from './SlideToPay';
import { Avatar } from './RingCode';
import { Icon } from './Icon';
import { C, F } from './theme';
import { rpc, type GasEstimate } from '../lib/rpc';
import { formatLyx, hexToBytes, isAddress } from '../lib/lokyx';
import { currentAddress, sendContract, sendLyx, signMessage, transferFee } from '../lib/wallet';
import { addPending, sites } from '../lib/data';
import { confirmIt } from '../lib/auth';
import { labelFor, niceLyx, shortAddr } from '../lib/format';

type Site = { origin: string; name: string };
export type Ask =
  | { kind: 'connect'; id: number; site: Site }
  | { kind: 'send'; id: number; site: Site; to: string; value: string }
  | { kind: 'call'; id: number; site: Site; to: string; method: string; args: unknown[]; value: string }
  | { kind: 'sign'; id: number; site: Site; message: string };

type Err = { code: number; message: string };

const host = (o: string) => o.replace(/^https?:\/\//, '');
const big = (s: string) => {
  try {
    return BigInt(s);
  } catch {
    return -1n;
  }
};

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <View style={{ borderRadius: 20, backgroundColor: C.fill }}>
      {rows.map(([l, v], i) => (
        <View key={l} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderColor: C.line2 }}>
          <T v="sub" dim style={{ fontSize: 15 }}>{l}</T>
          <T v="callout" numberOfLines={2} style={{ flexShrink: 1, textAlign: 'right' }}>{v}</T>
        </View>
      ))}
    </View>
  );
}

/** What a website is asking for, in plain words, with Approve and Reject. */
export function Approve({ ask, onDone, rejected }: { ask: Ask | null; onDone: (id: number, result: unknown, error?: Err) => void; rejected: Err }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [gas, setGas] = useState<GasEstimate | null>(null);
  const me = currentAddress();

  useEffect(() => {
    setErr('');
    setBusy(false);
    setGas(null);
    if (ask?.kind === 'call')
      rpc<GasEstimate>('lyx_estimateGas', { from: me, to: ask.to, method: ask.method, args: ask.args, value: ask.value })
        .then(setGas)
        .catch((e) => setErr(e.message));
  }, [ask, me]);

  if (!ask) return null;
  const reject = () => onDone(ask.id, null, rejected);

  const approve = async (): Promise<boolean> => {
    setErr('');
    try {
      if (ask.kind === 'connect') {
        await sites.save((s) => [{ origin: ask.site.origin, name: ask.site.name, address: me, at: Date.now() }, ...s.filter((x) => !(x.origin === ask.site.origin && x.address === me))]);
        success();
        onDone(ask.id, [me]);
        return true;
      }
      const what = ask.kind === 'sign' ? `Sign for ${host(ask.site.origin)}` : `Approve for ${host(ask.site.origin)}`;
      if (!(await confirmIt(what, { keyFollows: true }))) return false;
      setBusy(true);
      if (ask.kind === 'sign') {
        const sig = await signMessage(ask.message);
        success();
        onDone(ask.id, { address: me, signature: sig });
        return true;
      }
      if (ask.kind === 'send') {
        const h = await sendLyx(ask.to, big(ask.value));
        await addPending({ hash: h, from: me, to: ask.to, amount: `${niceLyx(formatLyx(big(ask.value)))} LYX`, what: 'send', at: Date.now() });
        success();
        onDone(ask.id, h);
        return true;
      }
      const input = await rpc<string>('lyx_encodeCall', { to: ask.to, method: ask.method, args: ask.args });
      const h = await sendContract({ kind: 'call', input: hexToBytes(input.replace(/^0x/, '')), gas: BigInt(gas?.gasLimit ?? 300_000) }, ask.to, big(ask.value));
      await addPending({ hash: h, from: me, to: ask.to, amount: big(ask.value) > 0n ? `${niceLyx(formatLyx(big(ask.value)))} LYX` : '', what: 'call', at: Date.now() });
      success();
      onDone(ask.id, h);
      return true;
    } catch (e) {
      failure();
      setErr((e as Error).message);
      setBusy(false);
      return false;
    }
  };

  const bad = (ask.kind === 'send' || ask.kind === 'call') && (!isAddress(ask.to) || big(ask.value) < 0n);
  const title =
    ask.kind === 'connect'
      ? 'wants to connect'
      : ask.kind === 'send'
        ? 'wants you to send'
        : ask.kind === 'call'
          ? 'wants you to use a contract'
          : 'wants you to sign a message';

  return (
    <Sheet open={!!ask} onClose={reject}>
      <View style={{ gap: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ fontFamily: F.semibold, fontSize: 15 }}>{host(ask.site.origin).replace(/^www\./, '').slice(0, 2).toUpperCase()}</T>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="headline" numberOfLines={1}>{host(ask.site.origin)}</T>
            <T v="sub" dim>{title}</T>
          </View>
          {!ask.site.origin.startsWith('https://') && <Icon name="info" size={20} color={C.wait} />}
        </View>

        {ask.kind === 'connect' && (
          <>
            <T style={{ fontFamily: F.semibold, fontSize: 28, letterSpacing: -0.8, lineHeight: 34 }}>Let this site see your address?</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: C.fill }}>
              <Avatar address={me} size={40} />
              <T v="mono" color={C.soft}>{shortAddr(me, 12, 6)}</T>
            </View>
            <T v="sub" dim>It can see your address and balance, and ask you to approve payments. It can't move anything without you saying yes each time.</T>
          </>
        )}

        {ask.kind === 'send' && (
          <>
            <T style={{ fontFamily: F.semibold, fontSize: 30, letterSpacing: -0.9, lineHeight: 38 }}>Send {niceLyx(formatLyx(big(ask.value) < 0n ? 0n : big(ask.value)), 6)} LYX to {labelFor(ask.to)}</T>
            <Rows rows={[['To', shortAddr(ask.to, 10, 6)], ['Network fee', `${formatLyx(transferFee(), 6)} LYX`]]} />
          </>
        )}

        {ask.kind === 'call' && (
          <>
            <T style={{ fontFamily: F.semibold, fontSize: 28, letterSpacing: -0.8, lineHeight: 34 }}>
              Call <T style={{ fontFamily: F.mono, fontSize: 24 }}>{ask.method}()</T>
            </T>
            <Rows
              rows={[
                ['Contract', labelFor(ask.to)],
                ...(big(ask.value) > 0n ? ([['You send', `${niceLyx(formatLyx(big(ask.value)), 6)} LYX`]] as [string, string][]) : []),
                ...(ask.args.length ? ([['With', ask.args.map((a) => (typeof a === 'string' && a.startsWith('lyx1') ? shortAddr(a) : String(a))).join(', ')]] as [string, string][]) : []),
                ['Fee, at most', gas ? `${niceLyx(gas.maxGasFeeLyx, 6)} LYX` : '…'],
                ['Tried first', gas ? (gas.ok ? 'Works' : `Fails: ${gas.error ?? 'reverted'}`) : 'Checking…'],
              ]}
            />
            <T v="sub" dim>The wallet ran this against the chain before showing it. If it fails when it's mined, nothing changes and you only pay the gas it used.</T>
          </>
        )}

        {ask.kind === 'sign' && (
          <>
            <T style={{ fontFamily: F.semibold, fontSize: 28, letterSpacing: -0.8, lineHeight: 34 }}>Sign this message?</T>
            <ScrollView style={{ maxHeight: 180, borderRadius: 18, backgroundColor: C.fill }} contentContainerStyle={{ padding: 16 }}>
              <T v="mono" color={C.soft}>{ask.message}</T>
            </ScrollView>
            <T v="sub" dim>Signing proves this address is yours. It doesn't send anything or cost a fee.</T>
          </>
        )}

        <ErrorText>{bad ? 'This request has a bad address or amount.' : err}</ErrorText>
        {ask.kind === 'send' || ask.kind === 'call' ? (
          <View style={{ gap: 6 }}>
            <SlideToPay label={ask.kind === 'send' ? 'Slide to pay' : 'Slide to approve'} onSlide={approve} busy={busy} disabled={bad || (ask.kind === 'call' && (!gas || !gas.ok))} />
            <Button title="Reject" kind="plain" onPress={reject} disabled={busy} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Reject" kind="line" onPress={reject} style={{ flex: 1 }} disabled={busy} />
            <Button title={ask.kind === 'connect' ? 'Connect' : 'Sign'} onPress={approve} busy={busy} disabled={bad} style={{ flex: 1 }} />
          </View>
        )}
      </View>
    </Sheet>
  );
}
