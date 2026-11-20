import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { formatUnits, parseUnits, type Hex } from 'viem';
import { T } from '../../ui/Text';
import { Button, ErrorText, Group, Note, Screen } from '../../ui/controls';
import { Keypad, typeAmount } from '../../ui/Keypad';
import { LeadRow } from '../../ui/LeadRow';
import { CoinMark } from '../../ui/CoinMark';
import { CoinDrop } from '../../ui/CoinDrop';
import { LogoChips, VAULT_MARK } from '../../ui/LogoChips';
import { Icon } from '../../ui/Icon';
import { SlideToPay } from '../../ui/SlideToPay';
import { logoFor } from '../../ui/Logo';
import { C, F } from '../../ui/theme';
import { confirmIt } from '../../lib/auth';
import { logEvent } from '../../lib/events';
import { plainError } from '../../lib/plain-error';
import { useStore } from '../../lib/store';
import { ensureApps, useApps } from '../../lib/appswallet';
import { arrivalText, refillPlan } from '../../lib/appswallet-core';
import { activeNets, broadcastEth, ensureAddresses, ethBalance, prepareEth, tokenBalance, tokensFor, useAsync, useChainSettings } from '../../lib/multichain';
import { ETH_NETS, ethNetChoices, presetsFor, tokenId, type EthNet } from '../../lib/multichain-core';
import { netLogoId } from '../../ui/CoinMark';
import { NETS, checkEthVaults, loadVaults, sendFromVault, snapshot, tokensOn, vaults, type Snapshot } from '../../lib/ethvault';
import { ETH, NATIVE, VAULT_NETS, refuseQueue, sweepable, tokenTransferCall, type VaultNet } from '../../lib/ethvault-core';

type Source = 'main' | VaultNet;

/** Add money to the Apps wallet from the main wallet or a vault. From the main wallet it arrives at once. From a vault, inside today's allowance there is no wait; above it the vault's wait applies. */
export default function Refill() {
  const settings = useChainSettings();
  const [chainSel, setChainSel] = useState<EthNet | null>(null);
  const [source, setSource] = useState<Source>('main');
  const [picking, setPicking] = useState(false);
  const mainNet = chainSel ?? activeNets().eth;
  const mainUnit = mainNet === 'sepolia' ? 'ETH' : ETH_NETS[mainNet].unit;
  const isMain = source === 'main';
  const vnet: VaultNet = isMain ? NETS[0] : source;
  const dest = (useApps().address ?? '0x0000000000000000000000000000000000000001') as Hex;
  const all = useStore(vaults);
  const v = all[vnet];
  const [coin, setCoin] = useState<string>('NATIVE');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  // ---- vault side
  const snap = useAsync<Snapshot | null>(async () => { if (isMain) return null; if (!v) await loadVaults(); const x = vaults.get()[vnet]; return x ? snapshot(x) : null; }, [source, !!v]);
  const s = snap.data;
  const vtok = isMain ? undefined : tokensOn(vnet).find((t) => t.symbol === coin);
  // ---- main wallet side
  const mtoks = [...tokensFor(mainNet), ...presetsFor(ETH_NETS[mainNet].chainId)].filter((t, i, a) => a.findIndex((x) => tokenId(x) === tokenId(t)) === i);
  const mtok = isMain ? mtoks.find((t) => t.symbol === coin) : undefined;
  const bal = useAsync<bigint | null>(async () => {
    if (!isMain) return null;
    const a = await ensureAddresses();
    return mtok ? tokenBalance(mainNet, mtok, a.eth) : ethBalance(mainNet, a.eth);
  }, [source, coin, mainNet], 15000);

  const dec = isMain ? (mtok ? mtok.decimals : 18) : vtok ? vtok.decimals : 18;
  const token: Hex = vtok ? vtok.address : ETH;
  let raw: bigint | null = null;
  try { raw = amount && amount !== '.' ? parseUnits(amount, dec) : null; } catch { raw = null; }
  const left = s?.today.find((t) => t.token.toLowerCase() === token.toLowerCase())?.left ?? 0n;
  const held = isMain ? bal.data : vtok ? s?.tokens.find((t) => t.token.address.toLowerCase() === token.toLowerCase())?.amount : s?.eth;
  const plan = !isMain && raw != null && raw > 0n ? refillPlan(raw, left, Number(s?.live.delay.cooldown ?? 0n), Date.now()) : null;
  const short = raw != null && held != null && raw > held;
  const call = !isMain && raw != null && raw > 0n ? (vtok ? { ...tokenTransferCall(token, dest, raw), value: 0n, operation: 0 } : { to: dest, value: raw, data: '0x' as Hex, operation: 0 }) : null;
  const noQueue = v?.gated && call && plan && !plan.instant ? refuseQueue(call, v.sweepTo, sweepable({ allowances: v.allowances })) : null;
  const unit = isMain ? (mtok ? mtok.symbol : mainUnit) : vtok ? vtok.symbol : NATIVE[vnet];
  const where = isMain ? ETH_NETS[mainNet].label : VAULT_NETS[vnet].label;
  const problem = noQueue ? noQueue : short ? `${isMain ? 'Your main wallet' : 'The vault'} holds ${formatUnits(held!, dec)} ${unit} on ${where}.` : '';
  const ready = isMain ? raw != null && raw > 0n && held != null : !!plan && !!s;

  const pick = (x: Source) => { setSource(x); setCoin('NATIVE'); setAmount(''); setPicking(false); setErr(''); };

  const go = async () => {
    setErr('');
    if (raw == null || !ready) return false;
    if (!(await confirmIt(isMain ? 'Add to your Apps wallet now' : plan?.instant ? 'Add to your Apps wallet now' : 'Start a top-up that waits'))) return false;
    try {
      const to = (await ensureApps()) as Hex;
      if (isMain) {
        const p = await prepareEth(to, raw, 'normal', mtok, mainNet);
        await broadcastEth(p.net, p.signed.raw);
        logEvent('apps', 'Added to Apps wallet', `${amount} ${unit} from Main wallet`);
        setDone('Added. It shows in your Apps wallet in a moment.');
        return true;
      }
      if (!v || !s) return false;
      const r = await sendFromVault(v, s, token, to, raw);
      logEvent('apps', r.how === 'instant' ? 'Added to Apps wallet' : 'Top-up waiting', `${amount} ${unit} from ${VAULT_MARK[vnet].name} vault`);
      setDone(r.how === 'instant' ? 'Added.' : 'Started. It waits in the open, and you can cancel it until then.');
      checkEthVaults().catch(() => {});
      return true;
    } catch (e) {
      setErr(plainError(e, where));
      return false;
    }
  };

  if (done)
    return (
      <Screen title="Add money">
        <CoinDrop symbol={unit} amount={amount} note={done} />
        <Button title="Back to Apps wallet" onPress={() => router.replace('/apps-wallet')} />
      </Screen>
    );

  const haveVault = (n: VaultNet) => !!all[n];
  const chipItems = isMain
    ? [{ key: 'NATIVE', label: mainUnit, logo: logoFor(mainUnit) ?? logoFor(ETH_NETS[mainNet].unit) }, ...mtoks.map((t) => ({ key: t.symbol, label: t.symbol, logo: logoFor(t.symbol) }))]
    : [{ key: 'NATIVE', label: NATIVE[vnet], logo: VAULT_MARK[vnet].logo }, ...tokensOn(vnet).map((t) => ({ key: t.symbol, label: t.symbol, logo: logoFor(t.symbol) }))];
  const srcTitle = isMain ? 'Main wallet' : `${VAULT_MARK[vnet].name} vault`;
  const srcLogo = isMain ? (logoFor(mainUnit) ?? 'eth') : VAULT_MARK[vnet].logo;

  return (
    <Screen title="Add money">
      <Group>
        <LeadRow
          lead={<CoinMark symbol={mainUnit} seed={source} logo={srcLogo} size={40} />}
          title={`From ${srcTitle}`}
          sub={isMain ? where : `${where} · left today without waiting`}
          right={<Icon name="chevron" size={16} color={C.faint} width={2} />}
          onPress={() => setPicking((p) => !p)}
        />
      </Group>
      {picking ? (
        <Group title="Add from">
          <LeadRow lead={<CoinMark symbol={mainUnit} seed="main" logo={logoFor(mainUnit) ?? 'eth'} size={36} />} title="Main wallet" sub={ETH_NETS[mainNet].label} right={isMain ? <Icon name="check" size={18} color={C.good} width={2.4} /> : undefined} onPress={() => pick('main')} />
          {NETS.filter(haveVault).map((n) => (
            <LeadRow key={n} lead={<CoinMark symbol={NATIVE[n]} seed={n} logo={VAULT_MARK[n].logo} size={36} />} title={`${VAULT_MARK[n].name} vault`} sub={VAULT_NETS[n].label} right={source === n ? <Icon name="check" size={18} color={C.good} width={2.4} /> : undefined} onPress={() => pick(n)} />
          ))}
        </Group>
      ) : null}
      {!isMain && !v && snap.data === undefined && !snap.error ? <Note>Looking for your vault…</Note> : null}
      {!isMain && !v && (snap.data !== undefined || snap.error) ? (
        <>
          <Note>No vault on {VAULT_NETS[vnet].label} yet. Pick another source, or make a vault first.</Note>
          <Button title="Open vaults" kind="line" onPress={() => router.push('/vaults')} />
        </>
      ) : (
        <>
          {isMain ? (
            <LogoChips<EthNet>
              value={mainNet}
              onChange={(n) => { setChainSel(n); setCoin('NATIVE'); setAmount(''); setErr(''); }}
              items={ethNetChoices(settings.allowMainnet).map((n) => ({ key: n, label: ETH_NETS[n].short, logo: netLogoId(n), seed: n }))}
            />
          ) : null}
          <LogoChips<string> value={coin} onChange={(c) => { setCoin(c); setAmount(''); }} items={chipItems} />
          <View style={{ alignItems: 'center', paddingVertical: 8, gap: 4 }}>
            <T style={{ fontFamily: F.semibold, fontSize: 48, letterSpacing: -1.5 }}>{amount || '0'}</T>
            <T v="sub" dim>{isMain ? `${unit} · in your main wallet: ${held != null ? formatUnits(held, dec) : '…'}` : `${unit} · left today without waiting: ${formatUnits(left, dec)}`}</T>
          </View>
          <Keypad round extra="." onKey={(k) => setAmount((a) => typeAmount(a, k, dec))} />
          {plan ? (
            <View style={{ gap: 4, padding: 16, borderRadius: 20, backgroundColor: C.fill }}>
              <T v="callout">{plan.instant ? 'No wait' : `This one waits ${Math.round(plan.waitSecs / 3600)} hours`}</T>
              <T v="sub" dim>{plan.instant ? "Within today's allowance." : `Above today's allowance. ${arrivalText(plan.arrivesAt, Date.now())}. You can cancel it until then.`}</T>
            </View>
          ) : null}
          <ErrorText>{problem || err || snap.error}</ErrorText>
          <SlideToPay label={plan && !plan.instant ? 'Slide to start the wait' : 'Slide to add'} disabled={!ready || !!problem} onSlide={go} />
        </>
      )}
    </Screen>
  );
}
