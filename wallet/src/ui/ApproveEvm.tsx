import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { formatEther } from "viem";
import { T } from './Text';
import { Button, ErrorText, Press, failure, success } from './controls';
import { Sheet } from './Sheet';
import { SlideToPay } from './SlideToPay';
import { Avatar } from './RingCode';
import { Icon } from './Icon';
import { C, F } from './theme';
import { confirmIt } from '../lib/auth';
import { shortAddr } from '../lib/format';
import { plainError } from '../lib/plain-error';
import { activeNets, ensurePrimary as ensureAddresses, sendEthCall } from '../lib/multichain';
import { ETH_NETS } from '../lib/multichain-core';
import { evmSites } from '../lib/data';
import { signPersonal, signTyped } from '../lib/evm-dapp';
import { describeData, messageText } from '../lib/evm-dapp-core';
import { checkTransaction, failedCheck, type ContractCheck } from '../lib/contract-check';
import { ContractCheckCard } from './ContractCheckCard';
import { SignRequest } from './SignRequest';
import { judgeRequest } from '../lib/signing';
import { useWallet } from '../lib/wallet';
import { ensureApps, useApps } from '../lib/appswallet';
import type { Assessment, Request } from '../lib/signing-core';

type Site = { origin: string; name: string };
export type EvmAsk =
  | { kind: 'connect'; id: number; site: Site }
  | { kind: 'send'; id: number; site: Site; to: string | null; value: bigint; data: string; index: number }
  | { kind: 'sign'; id: number; site: Site; message: string; index: number }
  | { kind: 'typed'; id: number; site: Site; json: string; primaryType: string; index: number };
type Err = { code: number; message: string };

const host = (o: string) => o.replace(/^https?:\/\//, '');

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

/** What an Ethereum website is asking for, in plain words. Nothing moves or is signed without a yes. */
export function ApproveEvm({ ask, onDone, rejected }: { ask: EvmAsk | null; onDone: (id: number, result: unknown, error?: Err) => void; rejected: Err }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [me, setMe] = useState('');
  const [chk, setChk] = useState<ContractCheck | null | 'busy'>(null);
  const [read, setRead] = useState(false);
  const [ass, setAss] = useState<Assessment | null>(null);
  const [details, setDetails] = useState(false);
  const [pick, setPick] = useState<'apps' | 'main'>('apps');
  const appsAddr = useApps().address;
  const w = useWallet();
  const net = activeNets().eth;
  const label = ETH_NETS[net].label;
  const unit = ETH_NETS[net].unit;
  useEffect(() => {
    setRead(false);
    setChk(null);
    if (ask?.kind !== 'send') return;
    let live = true;
    setChk('busy');
    checkTransaction(activeNets().eth, ask.to, ask.data, ask.value).then((c) => live && setChk(c), () => live && setChk(failedCheck(ask.to, ask.data, ask.value)));
    return () => { live = false; };
  }, [ask]);
  useEffect(() => {
    setAss(null);
    setDetails(false);
    if (!ask || (ask.kind !== 'send' && ask.kind !== 'typed')) return;
    const req: Request = ask.kind === 'send' ? { kind: 'send', to: ask.to, data: ask.data, value: ask.value } : { kind: 'typed', json: ask.json };
    let live = true;
    judgeRequest(req, activeNets().eth, [...w.accounts.map((a) => a.address), me, appsAddr ?? ''].filter(Boolean)).then((a) => live && setAss(a)).catch(() => live && setAss({ level: 'review', skipped: false, headline: "We couldn't finish checking this", sub: 'Only continue if you know this site well.', reasons: [], token: '', amountText: '', endsText: '', why: 'The check did not complete.' }));
    return () => { live = false; };
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setErr('');
    setBusy(false);
    if (ask) ensureAddresses().then((a) => setMe(a.eth)).catch((e) => setErr(plainError(e, label)));
  }, [ask, label]);
  if (!ask) return null;
  const reject = () => onDone(ask.id, null, rejected);
  const data = ask.kind === 'send' ? describeData(ask.data) : null;

  const approve = async (override?: string): Promise<boolean> => {
    setErr('');
    try {
      if (ask.kind === 'connect') {
        if (!me) return false;
        const who = pick === 'apps' ? await ensureApps() : me;
        await evmSites.save((s) => [{ origin: ask.site.origin, name: ask.site.name, address: who, at: Date.now() }, ...s.filter((x) => x.origin !== ask.site.origin)]);
        success();
        onDone(ask.id, [who]);
        return true;
      }
      if (!(await confirmIt(ask.kind === 'send' ? `Approve for ${host(ask.site.origin)}` : `Sign for ${host(ask.site.origin)}`, { keyFollows: true }))) return false;
      setBusy(true);
      if (ask.kind === 'send') {
        const h = await sendEthCall(ask.to, (override ?? ask.data) as `0x${string}`, ask.value, undefined, ask.index);
        success();
        onDone(ask.id, h);
        return true;
      }
      const sig = ask.kind === 'sign' ? await signPersonal(ask.message, ask.index) : await signTyped(ask.json, ask.index);
      if (!sig) throw new Error("That request wasn't in a form the wallet can sign.");
      success();
      onDone(ask.id, sig);
      return true;
    } catch (e) {
      failure();
      setErr(plainError(e, label));
      setBusy(false);
      return false;
    }
  };

  const title = ask.kind === 'connect' ? 'wants to connect' : ask.kind === 'send' ? (data?.kind === 'approve' ? 'wants to spend your tokens' : data?.kind === 'other' ? 'wants you to use a contract' : 'wants you to send') : 'wants you to sign a message';
  const msg = ask.kind === 'sign' ? messageText(ask.message) : null;
  const judged = ask.kind === 'send' || ask.kind === 'typed';
  const guarded = judged && !!ass && !ass.skipped && (ass.level !== 'allow' || !!ass.main);
  const stopped = guarded && ass!.level === 'stop';
  const verdictOnly = guarded && ass!.level !== 'review' && !details;
  const checking = judged && !ass;

  if (ask.kind === 'send' || ask.kind === 'typed') {
    return (
      <Sheet open={!!ask} onClose={reject}>
        <SignRequest ask={ask} chk={ask.kind === 'send' ? chk : null} ass={ass} unit={unit} explorer={`${ETH_NETS[net].explorer}/address/`} busy={busy} onApprove={approve} onReject={reject} />
        <ErrorText>{err}</ErrorText>
      </Sheet>
    );
  }

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
            <T style={{ fontFamily: F.semibold, fontSize: 28, letterSpacing: -0.8, lineHeight: 34 }}>Which account can this site see?</T>
            {([
              ['apps', 'Apps wallet', 'Recommended for websites. It holds only what you add.', appsAddr ?? 'Made for you when you connect'],
              ['main', 'Main wallet', 'The site could ask for everything here.', me],
            ] as const).map(([id, name, line, addr]) => (
              <Press key={id} onPress={() => setPick(id)} haptic={false} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: C.fill, borderWidth: 1, borderColor: pick === id ? C.soft : 'transparent' }}>
                {addr && addr.startsWith('0x') ? <Avatar address={addr} size={40} /> : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.fill2 }} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="callout">{name}</T>
                  <T v="caption" dim>{line}</T>
                </View>
                {pick === id ? <Icon name="check" size={18} color={C.text} width={2.4} /> : null}
              </Press>
            ))}
            <T v="sub" dim>Vaults never connect to websites. The site can ask you to approve payments and signatures, and can't move anything without you saying yes each time.</T>
          </>
        )}

        {ask.kind === 'send' && !verdictOnly && (
          <>
            {data?.kind === 'approve' ? (
              <>
                <T style={{ fontFamily: F.semibold, fontSize: 28, letterSpacing: -0.8, lineHeight: 34 }}>{data.unlimited ? 'Let this contract spend ALL of one of your tokens?' : 'Let this contract spend some of your tokens?'}</T>
                <Rows rows={[['Contract (token)', ask.to ? shortAddr(ask.to, 10, 6) : '–'], ['Allowed to spend', shortAddr(data.spender ?? '', 10, 6)], ['Amount', data.unlimited ? 'Unlimited' : String(data.amount)]]} />
                {data.unlimited ? <T v="sub" color={C.wait}>An unlimited approval lets that address take every one of these tokens, now and later, until you cancel it. Only approve a site you trust.</T> : null}
              </>
            ) : (
              <>
                <T style={{ fontFamily: F.semibold, fontSize: 30, letterSpacing: -0.9, lineHeight: 38 }}>
                  {data?.kind === 'other' ? `Use a contract${ask.value > 0n ? ` and send ${formatEther(ask.value)} ${unit}` : ''}` : `Send ${formatEther(ask.value)} ${unit}`}
                </T>
                <Rows rows={[['To', ask.to ? shortAddr(ask.to, 10, 6) : 'A new contract'], ['Network', label], ...(data?.kind === 'other' ? ([['Contract data', `${data.bytes} bytes`]] as [string, string][]) : [])]} />
              </>
            )}
            <ContractCheckCard check={chk} read={read} onRead={setRead} explorer={`${ETH_NETS[net].explorer}/address/`} />
            <T v="sub" dim>{label} is a test network. The network fee comes out of your {unit}.</T>
          </>
        )}

        {ask.kind === 'sign' && msg && (
          <>
            <T style={{ fontFamily: F.semibold, fontSize: 28, letterSpacing: -0.8, lineHeight: 34 }}>Sign this message?</T>
            <ScrollView style={{ maxHeight: 180, borderRadius: 18, backgroundColor: C.fill }} contentContainerStyle={{ padding: 16 }}>
              <T v="mono" color={C.soft}>{msg.text}</T>
            </ScrollView>
            {!msg.plain ? <T v="sub" color={C.wait}>This isn't readable text. Only sign it if you know exactly what it is.</T> : <T v="sub" dim>Signing proves this address is yours. It doesn't send anything or cost a fee.</T>}
          </>
        )}

        {ask.kind === 'typed' && !verdictOnly && (
          <>
            <T style={{ fontFamily: F.semibold, fontSize: 28, letterSpacing: -0.8, lineHeight: 34 }}>Sign {ask.primaryType}?</T>
            <ScrollView style={{ maxHeight: 200, borderRadius: 18, backgroundColor: C.fill }} contentContainerStyle={{ padding: 16 }}>
              <T v="mono" color={C.soft}>{prettyMessage(ask.json)}</T>
            </ScrollView>
            <T v="sub" dim>Signing proves this address is yours and can approve something off-chain (an order, a permit). Read it before you agree.</T>
          </>
        )}

        <ErrorText>{err}</ErrorText>
        {stopped ? (
          <View style={{ gap: 6 }}>
            <Button title="Reject" onPress={reject} disabled={busy} />
            <Button title={details ? 'Hide details' : 'Show details'} kind="plain" onPress={() => setDetails(!details)} />
          </View>
        ) : checking ? (
          <T v="sub" dim style={{ textAlign: 'center' }}>Checking this request…</T>
        ) : ask.kind === 'send' ? (
          <View style={{ gap: 6 }}>
            {chk === 'busy' ? (
              <T v="sub" dim style={{ textAlign: 'center' }}>Checking the contract…</T>
            ) : (chk && chk.verdict.review && !read) ? (
              <T v="sub" color={C.wait} style={{ textAlign: 'center' }}>Read the details above and tick the box to unlock approve.</T>
            ) : (
              <SlideToPay label="Slide to approve" onSlide={approve} busy={busy} />
            )}
            <Button title="Reject" kind="plain" onPress={reject} disabled={busy} />
            {guarded && ass!.level === 'allow' ? <Button title={details ? 'Hide details' : 'Show details'} kind="plain" onPress={() => setDetails(!details)} /> : null}
          </View>
        ) : ask.kind === 'typed' && guarded && ass!.level === 'allow' ? (
          <View style={{ gap: 6 }}>
            <SlideToPay label="Slide to sign" onSlide={approve} busy={busy} />
            <Button title="Reject" kind="plain" onPress={reject} disabled={busy} />
            <Button title={details ? 'Hide details' : 'Show details'} kind="plain" onPress={() => setDetails(!details)} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Reject" kind="line" onPress={reject} style={{ flex: 1 }} disabled={busy} />
            <Button title={ask.kind === 'connect' ? 'Connect' : 'Sign'} onPress={approve} busy={busy} disabled={ask.kind === 'connect' && !me} style={{ flex: 1 }} />
          </View>
        )}
      </View>
    </Sheet>
  );
}

function prettyMessage(json: string): string {
  try {
    const t = JSON.parse(json);
    const m = t.message ?? {};
    return Object.entries(m).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('\n') || json;
  } catch {
    return json;
  }
}
