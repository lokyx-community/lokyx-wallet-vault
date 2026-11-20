import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatUnits, isAddress, parseUnits, type Hex } from 'viem';
import { plainError } from '../../lib/plain-error';
import { T } from '../../ui/Text';
import { C } from '../../ui/theme';
import * as Clipboard from 'expo-clipboard';
import { Button, ErrorText, Note, Screen } from '../../ui/controls';
import { SendCompose, SendReview } from '../../ui/SendCompose';
import { LogoChips } from '../../ui/LogoChips';
import { SlideToPay } from '../../ui/SlideToPay';
import { WithdrawReceipt } from '../../ui/WithdrawReceipt';
import { flyCoin } from '../../ui/CoinFlight';
import type { SlipInput } from '../../lib/slip-core';
import { confirmIt } from '../../lib/auth';
import { useStore } from '../../lib/store';
import { useAsync } from '../../lib/multichain';
import { NETS, checkEthVaults, loadVaults, sendFromVault, snapshot, tokensOn, vaults, type Snapshot } from '../../lib/ethvault';
import { ETH, NATIVE, VAULT_NETS, describeCall, refuseQueue, refuseToBuild, sweepable, tokenTransferCall, type VaultNet } from '../../lib/ethvault-core';
import { shortAddr } from '../../lib/format';

/** Send from the vault. Within today's allowance it goes straight away; more than that waits, and the text says which. */
export default function EthVaultSend() {
  const p = useLocalSearchParams<{ net?: VaultNet }>();
  const net: VaultNet = p.net && NETS.includes(p.net) ? p.net : NETS[0];
  const v = useStore(vaults)[net];
  const [coin, setCoin] = useState<string>('NATIVE');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const [receipt, setReceipt] = useState<{ slip: SlipInput; done: boolean; caption?: string } | null>(null);
  const [review, setReview] = useState(false);
  const snap = useAsync<Snapshot | null>(async () => { if (!v) await loadVaults(); const x = vaults.get()[net]; return x ? snapshot(x) : null; }, [net, !!v]);
  const s = snap.data;
  const tok = tokensOn(net).find((t) => t.symbol === coin);
  const isNative = !tok;
  const token: Hex = tok ? tok.address : ETH;
  const dec = tok ? tok.decimals : 18;
  const unit = tok ? tok.symbol : NATIVE[net];
  let raw: bigint | null = null;
  try { raw = amount ? parseUnits(amount, dec) : null; } catch { raw = null; }
  const okTo = isAddress(to.trim());
  const left = s?.today.find((t) => t.token.toLowerCase() === token.toLowerCase())?.left ?? 0n;
  const instant = raw != null && raw <= left;
  const call = raw != null && okTo ? (isNative ? { to: to.trim() as Hex, value: raw, data: '0x' as Hex, operation: 0 } : { ...tokenTransferCall(token, to.trim() as Hex, raw), value: 0n, operation: 0 }) : null;
  const words = call ? describeCall(call, tokensOn(net), { safe: s?.expected.safe }).line : '';
  const refused = call ? refuseToBuild(call) : null;
  const held = isNative ? s?.eth : s?.tokens.find((t) => t.token.address.toLowerCase() === token.toLowerCase())?.amount;
  const short = s != null && raw != null && raw > 0n && held != null && raw > held;
  const toVault = !!s && to.trim().toLowerCase() === s.expected.safe.toLowerCase();
  const noQueue = v?.gated && call && !instant ? refuseQueue(call, v.sweepTo, sweepable({ allowances: v.allowances })) : null;
  const problem = noQueue ? noQueue : toVault ? "That is the vault's own address. Pick where the coins should go." : short ? `The vault holds ${formatUnits(held!, dec)} ${unit} on ${VAULT_NETS[net].label}. Send some to the vault address first, then try again.` : '';
  const mine = to.trim().toLowerCase() === s?.expected.phone.toLowerCase();

  const go = async () => {
    setErr('');
    if (!v || !s || raw == null || !okTo) return false;
    if (!(await confirmIt(instant ? 'Send from your vault now' : 'Start a withdrawal that waits'))) return false;
    try {
      const r = await sendFromVault(v, s, token, to.trim() as Hex, raw);
      setReceipt({
        slip: { amount, unit, to: to.trim(), from: s.expected.safe, fromName: 'Vault', network: VAULT_NETS[net].label, at: Date.now(), hash: r.hash, testnet: !VAULT_NETS[net].real, url: `${VAULT_NETS[net].explorer}/tx/${r.hash}` },
        done: r.how === 'instant',
        caption: r.how === 'instant' ? undefined : 'Started · waits, and you can cancel it until then',
      });
      if (r.how === 'instant') flyCoin('out', net === 'bnb-testnet' ? 'bnb' : 'eth');
      checkEthVaults().catch(() => {});
      return true;
    } catch (e) {
      setErr(plainError(e, VAULT_NETS[net].label));
      return false;
    }
  };

  if (!v) return <Screen title="Send from vault"><Note>No vault on {VAULT_NETS[net].label} yet.</Note></Screen>;
  const info = call && !refused && !problem ? (
    <View style={{ gap: 6, padding: 16, borderRadius: 20, backgroundColor: C.fill }}>
      <T v="sub" dim style={{ lineHeight: 20 }}>{instant ? "Within today's allowance: it goes out straight away." : `More than today's allowance: it waits ${Math.round(Number(s?.live.delay.cooldown ?? 0n) / 3600)} hours first. You can cancel it until then.`}</T>
      {mine && <T v="sub" dim>This is your own everyday address.</T>}
      <T v="caption" dim>{`From the vault ${shortAddr(s?.expected.safe ?? '', 8, 6)} on ${VAULT_NETS[net].label}. The network fee is paid from your everyday address.`}</T>
    </View>
  ) : null;
  const badTo = refused || problem || (to && !okTo ? 'That is not a valid Ethereum address.' : '') || snap.error || '';

  if (review)
    return (
      <Screen title={receipt ? 'Sent' : 'Review'}>
        {receipt ? null : (
          <SendReview amount={amount} unit={unit} to={to.trim()} lines={[words]}>
            {info}
          </SendReview>
        )}
        <ErrorText title="Couldn't send from the vault" note="If you're not sure it went through, check Activity before trying again.">{err}</ErrorText>
        {receipt ? (
          <WithdrawReceipt slip={receipt.slip} done={receipt.done} caption={receipt.caption} onDone={() => router.replace(`/ethvault?net=${net}`)} doneLabel="Back to the vault" />
        ) : (
          <>
            <SlideToPay label={instant ? 'Slide to send' : 'Slide to start (it waits)'} disabled={!call || !!refused || !s || !!problem} onSlide={go} />
            <Button title="Change" kind="plain" onPress={() => setReview(false)} />
          </>
        )}
      </Screen>
    );
  return (
    <SendCompose
      title="Send from vault"
      unit={unit}
      network={VAULT_NETS[net].label}
      to={to}
      onTo={setTo}
      placeholder="0x…"
      onPaste={async () => setTo((await Clipboard.getStringAsync()).trim())}
      amt={amount}
      onAmt={setAmount}
      decimals={dec}
      badTo={badTo}
      below={
        <View style={{ gap: 12 }}>
          <LogoChips<string> value={coin} onChange={(c) => { setCoin(c); setAmount(''); }} items={[{ key: 'NATIVE', label: NATIVE[net] }, ...tokensOn(net).map((t) => ({ key: t.symbol, label: t.symbol }))]} />
          {s && <T v="caption" dim style={{ textAlign: 'center' }}>{`Left today without waiting: ${Number(left) / 10 ** dec} ${unit}`}</T>}
        </View>
      }
      disabled={!call || !!refused || !s || !!problem || !raw}
      onReview={() => setReview(true)}
    />
  );
}
