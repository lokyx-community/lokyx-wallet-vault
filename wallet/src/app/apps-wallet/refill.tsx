import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { formatUnits, parseUnits, type Hex } from 'viem';
import { T } from '../../ui/Text';
import { Button, ErrorText, Note, Screen } from '../../ui/controls';
import { Keypad, typeAmount } from '../../ui/Keypad';
import { Segmented } from '../../ui/Segmented';
import { SlideToPay } from '../../ui/SlideToPay';
import { C, F } from '../../ui/theme';
import { confirmIt } from '../../lib/auth';
import { plainError } from '../../lib/plain-error';
import { useStore } from '../../lib/store';
import { useAsync } from '../../lib/multichain';
import { ensureApps, useApps } from '../../lib/appswallet';
import { arrivalText, refillPlan } from '../../lib/appswallet-core';
import { NETS, checkEthVaults, loadVaults, sendFromVault, snapshot, tokensOn, vaults, type Snapshot } from '../../lib/ethvault';
import { ETH, NATIVE, VAULT_NETS, refuseQueue, sweepable, tokenTransferCall, type VaultNet } from '../../lib/ethvault-core';

/** Add money to the Apps wallet from a vault. Inside today's allowance there is no wait; above it the vault's wait applies. */
export default function Refill() {
  const [net, setNet] = useState<VaultNet>(NETS[0]);
  const dest = (useApps().address ?? '0x0000000000000000000000000000000000000001') as Hex;
  const v = useStore(vaults)[net];
  const coins = [NATIVE[net], ...tokensOn(net).map((t) => t.symbol)];
  const [coin, setCoin] = useState<string>(NATIVE[NETS[0]]);
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const snap = useAsync<Snapshot | null>(async () => { if (!v) await loadVaults(); const x = vaults.get()[net]; return x ? snapshot(x) : null; }, [net, !!v]);
  const s = snap.data;
  const tok = tokensOn(net).find((t) => t.symbol === coin);
  const token: Hex = tok ? tok.address : ETH;
  const dec = tok ? tok.decimals : 18;
  let raw: bigint | null = null;
  try { raw = amount && amount !== '.' ? parseUnits(amount, dec) : null; } catch { raw = null; }
  const left = s?.today.find((t) => t.token.toLowerCase() === token.toLowerCase())?.left ?? 0n;
  const held = tok ? s?.tokens.find((t) => t.token.address.toLowerCase() === token.toLowerCase())?.amount : s?.eth;
  const plan = raw != null && raw > 0n ? refillPlan(raw, left, Number(s?.live.delay.cooldown ?? 0n), Date.now()) : null;
  const short = raw != null && held != null && raw > held;
  const call = raw != null && raw > 0n ? (tok ? { ...tokenTransferCall(token, dest, raw), value: 0n, operation: 0 } : { to: dest, value: raw, data: '0x' as Hex, operation: 0 }) : null;
  const noQueue = v?.gated && call && plan && !plan.instant ? refuseQueue(call, v.sweepTo, sweepable({ allowances: v.allowances })) : null;
  const problem = noQueue ? noQueue : short ? `The vault holds ${formatUnits(held!, dec)} ${coin} on ${VAULT_NETS[net].label}.` : '';

  const go = async () => {
    setErr('');
    if (!v || !s || raw == null || !plan) return false;
    if (!(await confirmIt(plan.instant ? 'Add to your Apps wallet now' : 'Start a top-up that waits'))) return false;
    try {
      const to = (await ensureApps()) as Hex;
      const r = await sendFromVault(v, s, token, to, raw);
      setDone(r.how === 'instant' ? 'Added.' : 'Started. It waits in the open, and you can cancel it until then.');
      checkEthVaults().catch(() => {});
      return true;
    } catch (e) {
      setErr(plainError(e, VAULT_NETS[net].label));
      return false;
    }
  };

  if (done)
    return (
      <Screen title="Add money">
        <Note>{done}</Note>
        <Button title="Back to Apps wallet" onPress={() => router.replace('/apps-wallet')} />
      </Screen>
    );
  if (!v && snap.data === undefined && !snap.error)
    return <Screen title="Add money"><Note>Looking for your vault…</Note></Screen>;
  if (!v)
    return (
      <Screen title="Add money">
        <Segmented<VaultNet> value={net} onChange={setNet} options={NETS.map((n) => [n, VAULT_NETS[n].label.replace(' Sepolia', '')] as [VaultNet, string])} />
        <Note>No vault on {VAULT_NETS[net].label} yet. Pick another network, or make a vault first.</Note>
        <Button title="Open vaults" kind="line" onPress={() => router.push('/vaults')} />
      </Screen>
    );

  return (
    <Screen title="Add money">
      <Segmented<VaultNet> value={net} onChange={(n) => { setNet(n); setCoin(NATIVE[n]); setAmount(''); }} options={NETS.map((n) => [n, VAULT_NETS[n].label.replace(' Sepolia', '')] as [VaultNet, string])} />
      <Segmented<string> value={coin} onChange={(c) => { setCoin(c); setAmount(''); }} options={coins.map((c) => [c, c] as [string, string])} />
      <View style={{ alignItems: 'center', paddingVertical: 8, gap: 4 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 48, letterSpacing: -1.5 }}>{amount || '0'}</T>
        <T v="sub" dim>{`${coin} · left today without waiting: ${formatUnits(left, dec)}`}</T>
      </View>
      <Keypad onKey={(k) => setAmount((a) => typeAmount(a, k, dec))} />
      {plan ? (
        <View style={{ gap: 4, padding: 16, borderRadius: 20, backgroundColor: C.fill }}>
          <T v="callout">{plan.instant ? 'No wait' : `This one waits ${Math.round(plan.waitSecs / 3600)} hours`}</T>
          <T v="sub" dim>{plan.instant ? "Within today's allowance." : `Above today's allowance. ${arrivalText(plan.arrivesAt, Date.now())}. You can cancel it until then.`}</T>
        </View>
      ) : null}
      <ErrorText>{problem || err || snap.error}</ErrorText>
      <SlideToPay label={plan && !plan.instant ? 'Slide to start the wait' : 'Slide to add'} disabled={!plan || !!problem || !s} onSlide={go} />
    </Screen>
  );
}
