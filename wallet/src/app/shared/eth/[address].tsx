import { useEffect, useState } from 'react';
import { Share, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { T } from '../../../ui/Text';
import { Button, ErrorText, Field, Group, Press, Screen, success } from '../../../ui/controls';
import { ActionRow } from '../../../ui/ActionRow';
import { WalletCard, type CardKind } from '../../../ui/WalletCards';
import { CoinMark, netLogoId } from '../../../ui/CoinMark';
import { LeadRow } from '../../../ui/LeadRow';
import { Icon } from '../../../ui/Icon';
import { Qr } from '../../../ui/Qr';
import { Sheet } from '../../../ui/Sheet';
import { WithdrawReceipt } from '../../../ui/WithdrawReceipt';
import { flyCoin } from '../../../ui/CoinFlight';
import type { SlipInput } from '../../../lib/slip-core';
import { toast } from '../../../ui/Toast';
import { C } from '../../../ui/theme';
import { confirmIt } from '../../../lib/auth';
import { ensurePrimary as ensureAddresses, ethTxBlock, lookupToken, tokensFor, useAsync } from '../../../lib/multichain';
import { ETH_NETS, EVM_FAMILIES, evmOf, formatUnits, type EthToken } from '../../../lib/multichain-core';
import { decodePay, describePay, encodePay, netOfChainId, payHash, validSigners, type Pay, type PayView, type Pending } from '../../../lib/ethms-core';
import { dismissPay, sendToGroup } from '../../../lib/relay';
import { addSharedToken, incomingPays, readEthShared, readSharedTokens, removeEthShared, sendEthPay, signEthPay, startEthPay, useEthShared } from '../../../lib/ethms';

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;
const radio = (on: boolean) => (
  <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.ink : 'transparent', borderWidth: on ? 0 : 1.5, borderColor: C.line2 }}>
    {on ? <Icon name="check" size={15} color={C.inkText} width={2.6} /> : null}
  </View>
);

/** A shared account: the network's coin and every token it holds, and passing a payment around until enough of you signed. */
export default function EthSharedScreen() {
  const { address, chain } = useLocalSearchParams<{ address: string; chain?: string }>();
  const s = useEthShared().find((x) => x.address.toLowerCase() === String(address).toLowerCase() && (!chain || String(x.chainId) === String(chain)));
  const { width } = useWindowDimensions();
  const net = s ? netOfChainId(s.chainId) : null;
  const info = useAsync(async () => (s ? readEthShared(s) : null), [address, chain], 20_000);
  const toks = useAsync(async () => (s ? readSharedTokens(s) : []), [address, chain], 30_000);
  const me = useAsync(async () => (await ensureAddresses()).eth, []);
  const [sheet, setSheet] = useState<'' | 'pay' | 'code' | 'recv' | 'coin' | 'receipt'>('');
  const [rcpt, setRcpt] = useState<SlipInput | null>(null);
  const [asset, setAsset] = useState('native');
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('');
  const [code, setCode] = useState('');
  const [contract, setContract] = useState('');
  const [busy, setBusy] = useState(false);
  let pay: Pay | null = null;
  let view: PayView | null = null;
  let err = '';
  try {
    pay = code.trim() ? decodePay(code) : null;
    view = pay ? describePay(pay) : null;
  } catch (e) {
    err = (e as Error).message;
  }
  const signers = useAsync(async () => (pay && s ? validSigners(pay, s.owners) : []), [code]);
  const knownTok = view?.kind === 'token' && net ? tokensFor(net).find((t) => t.contract.toLowerCase() === view!.token.toLowerCase()) : undefined;
  const lookedUp = useAsync<EthToken | null>(async () => (view?.kind === 'token' && net && !knownTok ? lookupToken(net, view.token).catch(() => null) : null), [code]);
  // payments the others left on the relay: the newest one opens by itself, and a newer copy with more signatures replaces the one on screen
  const inbox = useAsync<Pending[]>(async () => (s?.relay ? incomingPays(s, info.data?.nonce) : []), [address, chain, String(info.data?.nonce ?? '')], 8_000);
  useEffect(() => {
    const list = inbox.data ?? [];
    if (!list.length) return;
    if (!code.trim()) return setCode(list[0].code);
    try {
      const cur = decodePay(code);
      const m = list.find((x) => x.hash === payHash(cur));
      if (m && m.sigs > Object.keys(cur.sigs ?? {}).length) setCode(m.code);
    } catch {
      // a code typed by hand that is not a payment: leave it alone
    }
  }, [inbox.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s || !net) return <Screen title="Shared account"><T v="sub" dim>That account isn't on this phone.</T></Screen>;

  const unit = ETH_NETS[net].unit;
  const f = evmOf(net);
  const logo = netLogoId(net);
  const cardKind = (f ? EVM_FAMILIES[f].logo : logo === 'eth' ? 'eth' : 'gr') as CardKind;
  const n = signers.data?.length ?? 0;
  const iSigned = !!signers.data?.some((a) => a.toLowerCase() === me.data?.toLowerCase());
  const ready = n >= s.threshold;
  const chosen: EthToken | null = asset === 'native' ? null : (toks.data?.find((x) => x.token.contract === asset)?.token ?? null);
  const tokMeta = knownTok ?? lookedUp.data ?? null;

  const headline = (() => {
    if (!view) return '';
    if (view.kind === 'coin') return `${formatUnits(view.value, 18)} ${unit}`;
    if (view.kind === 'token') return tokMeta ? `${formatUnits(view.amount, tokMeta.decimals)} ${tokMeta.symbol}` : `${view.amount.toString()} units of a token`;
    return '';
  })();
  const recipient = view && view.kind !== 'other' ? (view.kind === 'coin' ? view.to : view.to) : '';

  const run = async (reason: string, fn: () => Promise<void>) => {
    if (!(await confirmIt(reason))) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'info');
    } finally {
      setBusy(false);
    }
  };
  const bal = info.data ? formatUnits(info.data.balance, 18, 4) : '';

  return (
    <Screen title={s.name}>
      <WalletCard c={{ kind: cardKind, logo: logo ?? undefined, title: s.name, sub: `${ETH_NETS[net].label} · ${s.threshold} of ${s.owners.length} approve`, balance: bal, unit, address: s.address }} width={width - 40} />
      <ActionRow items={[
        { icon: 'send', label: 'Send', onPress: () => setSheet('pay') },
        { icon: 'receive', label: 'Receive', onPress: () => setSheet('recv') },
        { icon: 'share', label: 'Send the setup to the others', onPress: () => Share.share({ message: `Add our shared account in LOKYX (Apps › Shared accounts › Ethereum › I've been added).\nNetwork: ${ETH_NETS[net].label}\nPeople:\n${s.owners.join('\n')}\nApprovals needed: ${s.threshold}\nAddress: ${s.address}${s.relay ? `\nRelay key: ${s.relay}` : ''}` }) },
      ]} />
      {info.data && !info.data.exists ? <ErrorText>This account has not been created on {ETH_NETS[net].label} yet. Ask whoever made it, or make it again with the same people.</ErrorText> : null}

      {pay && view && view.kind !== 'other' && sheet !== 'code' ? (
        <Press onPress={() => setSheet('code')} scaleTo={0.985} style={{ borderRadius: 20, backgroundColor: 'rgba(245,184,61,0.07)', borderWidth: 0.5, borderColor: 'rgba(245,184,61,0.22)', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(245,184,61,0.16)', alignItems: 'center', justifyContent: 'center' }}><Icon name="clock" size={19} color={C.wait} width={1.9} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="callout" style={{ fontSize: 16 }}>{`A payment of ${headline} is waiting`}</T>
            <T v="caption" dim>{`${n} of ${s.threshold} approved · tap to open`}</T>
          </View>
          <Icon name="chevron" size={16} color={C.faint} width={2} />
        </Press>
      ) : null}

      <Group title="Coins">
        <LeadRow lead={<CoinMark symbol={unit} seed={net} logo={logo} size={40} />} title={unit} sub={ETH_NETS[net].label} detail={bal} />
        {(toks.data ?? []).map((x) => (
          <LeadRow key={x.token.contract} lead={<CoinMark symbol={x.token.symbol} seed={x.token.contract} size={40} />} title={x.token.symbol} sub={short(x.token.contract)} detail={formatUnits(x.balance, x.token.decimals, 4)} />
        ))}
        <LeadRow lead={<View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={19} color={C.text} width={1.9} /></View>} title="Add a coin" sub="Paste its contract address" onPress={() => setSheet('coin')} />
      </Group>

      <Group title={`People · any ${s.threshold} of ${s.owners.length}`}>
        {s.owners.map((o, i) => (
          <LeadRow key={o} lead={<View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}><Icon name="person" size={19} color={C.soft} width={1.9} /></View>} title={o.toLowerCase() === me.data?.toLowerCase() ? 'You' : `Person ${i + 1}`} sub={short(o)} />
        ))}
      </Group>
      <Button title="I have a payment code" kind="line" onPress={() => setSheet('code')} />
      <Button title="Remove from this phone" kind="plain" onPress={async () => { await removeEthShared(s.address, s.chainId); router.back(); }} />

      <Sheet open={sheet === 'receipt'} onClose={() => { setSheet(''); setRcpt(null); }}>
        {rcpt ? <WithdrawReceipt slip={rcpt} poll={() => ethTxBlock(net, rcpt.hash)} onDone={() => { setSheet(''); setRcpt(null); }} /> : null}
      </Sheet>
      <Sheet open={sheet === 'recv'} onClose={() => setSheet('')}>
        <View style={{ gap: 14, alignItems: 'center' }}>
          <T v="title">Receive</T>
          <T v="sub" dim style={{ textAlign: 'center' }}>{`Send ${unit} or any token on ${ETH_NETS[net].label} to this address. Nothing from another network.`}</T>
          <View style={{ padding: 12, backgroundColor: '#fff', borderRadius: 20 }}><Qr value={s.address} size={220} /></View>
          <T v="mono" selectable style={{ fontSize: 13, textAlign: 'center' }}>{s.address}</T>
          <Button title="Copy address" kind="line" onPress={async () => { await Clipboard.setStringAsync(s.address); success(); }} style={{ alignSelf: 'stretch' }} />
        </View>
      </Sheet>

      <Sheet open={sheet === 'coin'} onClose={() => setSheet('')}>
        <View style={{ gap: 12 }}>
          <T v="title">Add a coin</T>
          <T v="sub" dim>{`Its name and decimals are read from ${ETH_NETS[net].label}. Check the address with whoever told you about it.`}</T>
          <Field value={contract} onChangeText={setContract} placeholder="Token contract: 0x…" autoCapitalize="none" autoCorrect={false} mono />
          <Button title="Add it" busy={busy} disabled={!contract.trim()} onPress={async () => {
            setBusy(true);
            try {
              const t = await addSharedToken(s, contract);
              toast(`${t.symbol} added`, 'info');
              setContract('');
              setSheet('');
              toks.refresh();
            } catch (e) {
              toast("That isn't a token on this network", 'info');
            } finally {
              setBusy(false);
            }
          }} />
        </View>
      </Sheet>

      <Sheet open={sheet === 'pay'} onClose={() => setSheet('')}>
        <View style={{ gap: 12 }}>
          <T v="title">Start a payment</T>
          <Group>
            <LeadRow lead={<CoinMark symbol={unit} seed={net} logo={logo} size={36} />} title={unit} sub={bal ? `${bal} available` : ''} right={radio(asset === 'native')} onPress={() => setAsset('native')} />
            {(toks.data ?? []).map((x) => (
              <LeadRow key={x.token.contract} lead={<CoinMark symbol={x.token.symbol} seed={x.token.contract} size={36} />} title={x.token.symbol} sub={`${formatUnits(x.balance, x.token.decimals, 4)} available`} right={radio(asset === x.token.contract)} onPress={() => setAsset(x.token.contract)} />
            ))}
          </Group>
          <Field value={to} onChangeText={setTo} placeholder="To: 0x…" autoCapitalize="none" autoCorrect={false} mono />
          <Field value={amt} onChangeText={setAmt} placeholder={`Amount in ${chosen ? chosen.symbol : unit}`} keyboardType="decimal-pad" />
          <Button title="Sign and share" busy={busy} disabled={!to.trim() || !amt} onPress={() => run(`Sign a payment of ${amt} ${chosen ? chosen.symbol : unit}`, async () => {
            const p = await startEthPay(s, to, amt, chosen ?? undefined);
            const c = encodePay(p);
            setCode(c);
            setSheet('code');
            if (await sendToGroup(s.relay, c)) toast('Sent to the others', 'send');
            else await Share.share({ message: `Please approve this payment from "${s.name}" in LOKYX (Shared accounts › ${s.name} › I have a payment code):\n\n${c}` });
          })} />
        </View>
      </Sheet>

      <Sheet open={sheet === 'code'} onClose={() => setSheet('')}>
        <View style={{ gap: 12 }}>
          <T v="title">A payment to approve</T>
          <Field value={code} onChangeText={setCode} placeholder="lokyx-eth-safe:…" autoCapitalize="none" autoCorrect={false} mono multiline />
          {!code ? <Button title="Paste" kind="line" onPress={async () => setCode((await Clipboard.getStringAsync()).trim())} /> : null}
          <ErrorText>{err}</ErrorText>
          {pay && pay.chainId !== s.chainId ? <ErrorText>This payment is for a different network, so it can't be signed here.</ErrorText> : null}
          {view?.kind === 'other' ? <ErrorText>This payment does something other than send a coin or a token. It can't be signed here.</ErrorText> : null}
          {pay && view && view.kind !== 'other' ? (
            <Group>
              <LeadRow lead={view.kind === 'token' ? <CoinMark symbol={tokMeta?.symbol ?? '?'} seed={view.token} size={40} /> : <CoinMark symbol={unit} seed={net} logo={logo} size={40} />} title={`Pays ${headline}`} sub={`to ${recipient}`} />
              {view.kind === 'token' ? <LeadRow lead={<View style={{ width: 40 }} />} title={tokMeta ? `Token ${tokMeta.symbol}` : 'A token you have not added'} sub={view.token} subColor={tokMeta ? undefined : C.wait} /> : <></>}
              <LeadRow lead={<View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}><Icon name="people" size={19} color={C.text} width={1.9} /></View>} title={`${n} of ${s.threshold} approved`} sub={iSigned ? 'Yours is on it' : 'You have not signed'} />
            </Group>
          ) : null}
          {pay && view && view.kind !== 'other' && ready ? <Button title="Send it (you pay the network fee)" busy={busy} onPress={() => run('Send this payment', async () => {
            const txh = await sendEthPay(s, pay!);
            const slipFor: SlipInput | null = view && view.kind === 'coin'
              ? { amount: formatUnits(view.value, 18), unit, to: view.to, network: ETH_NETS[net].label, from: s.address, fromName: s.name, at: Date.now(), hash: txh, testnet: !ETH_NETS[net].real, url: `${ETH_NETS[net].explorer}/tx/${txh}` }
              : view && view.kind === 'token' && tokMeta
                ? { amount: formatUnits(view.amount, tokMeta.decimals), unit: tokMeta.symbol, to: view.to, network: ETH_NETS[net].label, from: s.address, fromName: s.name, at: Date.now(), hash: txh, testnet: !ETH_NETS[net].real, url: `${ETH_NETS[net].explorer}/tx/${txh}` }
                : null;
            await dismissPay(payHash(pay!)); success(); setCode(''); info.refresh(); toks.refresh();
            if (slipFor) { setRcpt(slipFor); setSheet('receipt'); flyCoin('out', netLogoId(net) ?? 'eth'); } else { toast(`Sent on ${ETH_NETS[net].label}`, 'send'); setSheet(''); }
          })} /> : null}
          {pay && view && view.kind !== 'other' && !ready && !iSigned ? <Button title="Approve" busy={busy} onPress={() => run(`Approve a payment of ${headline}`, async () => { const next = encodePay(await signEthPay(s, pay!)); setCode(next); success(); if (await sendToGroup(s.relay, next)) toast('Sent to the others', 'send'); })} /> : null}
          {pay && !ready && iSigned ? <Button title="Share it with the next person" kind="line" onPress={() => Share.share({ message: code })} /> : null}
          {pay ? <Button title="Decline" kind="plain" onPress={async () => { await dismissPay(payHash(pay!)); setCode(''); setSheet(''); inbox.refresh(); }} /> : null}
        </View>
      </Sheet>
    </Screen>
  );
}
