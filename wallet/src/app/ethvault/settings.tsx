import { useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { formatUnits, parseUnits } from 'viem';
import { plainError } from '../../lib/plain-error';
import { T } from '../../ui/Text';
import { View } from 'react-native';
import { C } from '../../ui/theme';
import { Button, ErrorText, Field, Group, Note, Row, Screen } from '../../ui/controls';
import { IntroHero } from '../../ui/Feature';
import { shortAddr } from '../../lib/format';
import { Segmented } from '../../ui/Segmented';
import { SlideToPay } from '../../ui/SlideToPay';
import { confirmIt } from '../../lib/auth';
import { useStore } from '../../lib/store';
import { NETS, allowanceChange, checkEthVaults, queueSettingChange, vaults, waitChange } from '../../lib/ethvault';
import { MIN_WAIT, VAULT_NETS, checkSettings, type VaultNet } from '../../lib/ethvault-core';

const WAITS: [string, number][] = [['24 hours', MIN_WAIT], ['2 days', 2 * 86400], ['7 days', 7 * 86400]];

/** Every change to the vault's rules waits, in the open, like a big withdrawal. Raising the allowance or shortening the wait is the risky direction. */
export default function EthVaultSettings() {
  const p = useLocalSearchParams<{ net?: VaultNet }>();
  const net: VaultNet = p.net && NETS.includes(p.net) ? p.net : NETS[0];
  const v = useStore(vaults)[net];
  const [what, setWhat] = useState<'allow' | 'wait'>('allow');
  const [coinIdx, setCoinIdx] = useState('0');
  const [amount, setAmount] = useState('');
  const [wait, setWait] = useState(1);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  if (!v) return <Screen title="Change settings"><Note>No vault on {VAULT_NETS[net].label} yet.</Note></Screen>;
  if (v.gated)
    return (
      <Screen title="Vault rules" large>
        <IntroHero icon="lock" title="Fixed when the vault was made" text="Nobody can change these rules now, not you, not a thief with your phone. That is what keeps them safe." />
        <Group>
          <Row title="Wait on bigger withdrawals" detail={`${Math.round(v.wait / 3600)} hours`} />
          {v.allowances.map((x) => <Row key={x.token} title={`Daily allowance ${x.symbol}`} detail={formatUnits(BigInt(x.amount), x.decimals)} />)}
          <Row title="Bigger withdrawals go to" sub="Your safe address" detail={shortAddr(v.sweepTo, 6, 4)} />
        </Group>
        <T v="caption" dim style={{ lineHeight: 18 }}>To change them, make a new vault with new rules and move your coins to it.</T>
        <Button title="Back to the vault" kind="line" onPress={() => router.replace(`/ethvault?net=${net}`)} />
      </Screen>
    );
  const a = v.allowances[Number(coinIdx)];
  const waitHours = (WAITS[wait][1] / 3600);
  const submit = async () => {
    setErr('');
    try {
      let to, data, apply = {};
      if (what === 'allow') {
        const raw = parseUnits(amount || '0', a.decimals);
        const t = { token: a.token, symbol: a.symbol, decimals: a.decimals, amount: raw };
        const bad = checkSettings({ wait: v.wait, allowances: [t] });
        if (bad) return setErr(bad), false;
        ({ to, data } = await allowanceChange(v, t));
        apply = { allowance: { token: a.token, amount: raw } };
      } else {
        ({ to, data } = await waitChange(v, WAITS[wait][1]));
        apply = { wait: WAITS[wait][1] };
      }
      if (!(await confirmIt('Queue a change to your vault settings'))) return false;
      await queueSettingChange(v, to, data, apply);
      setDone(`Queued. It waits ${Math.round(v.wait / 3600)} hours and you will get an alert on this phone. When it has run, open the vault and tap "Run it now".`);
      checkEthVaults().catch(() => {});
      return true;
    } catch (e) {
      setErr(plainError(e, VAULT_NETS[net].label));
      return false;
    }
  };
  return (
    <Screen title="Change settings" large>
      <T v="callout" dim style={{ lineHeight: 22 }}>{`A change to these rules waits ${Math.round(v.wait / 3600)} hours, like a big withdrawal. A thief with your phone cannot loosen them quickly, and you can cancel a change while it waits.`}</T>
      <Segmented<'allow' | 'wait'> value={what} onChange={setWhat} options={[['allow', 'Daily allowance'], ['wait', 'Wait']]} />
      {what === 'allow' ? (
        <>
          <Segmented value={coinIdx} onChange={setCoinIdx} options={v.allowances.map((x, i) => [String(i), x.symbol] as [string, string])} />
          <View style={{ backgroundColor: C.fill, borderRadius: 22, padding: 18, gap: 4 }}>
            <T v="sub" dim>{`New daily allowance in ${a.symbol}`}</T>
            <Field value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" style={{ backgroundColor: 'transparent', paddingHorizontal: 0, fontSize: 32, height: 52 }} />
          </View>
        </>
      ) : (
        <>
          <T v="sub" dim style={{ paddingHorizontal: 4 }}>New wait for bigger withdrawals</T>
          <Segmented value={String(wait)} options={WAITS.map(([l], i) => [String(i), l] as [string, string])} onChange={(k) => setWait(Number(k))} />
          <T v="caption" dim style={{ textAlign: "center" }}>{`${waitHours} hours`}</T>
        </>
      )}
      <ErrorText>{err}</ErrorText>
      {done ? (
        <>
          <Note>{done}</Note>
          <Button title="Back to the vault" onPress={() => router.replace(`/ethvault?net=${net}`)} />
        </>
      ) : (
        <SlideToPay label="Slide to queue the change" onSlide={submit} />
      )}
    </Screen>
  );
}
