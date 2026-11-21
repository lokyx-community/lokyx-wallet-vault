import { useState } from 'react';
import { View } from 'react-native';
import { parseUnits } from 'viem';
import { Sheet } from './Sheet';
import { Segmented } from './Segmented';
import { SlideToPay } from './SlideToPay';
import { Press, Field, ErrorText } from './controls';
import { T } from './Text';
import { C, F } from './theme';
import { plainError } from '../lib/plain-error';
import { confirmIt } from '../lib/auth';
import type { Hex } from 'viem';
import { allowanceChange, checkEthVaults, queueSettingChange, vaults, waitChange, type NetVault } from '../lib/ethvault';
import { MIN_WAIT, VAULT_NETS, checkSettings, type VaultNet } from '../lib/ethvault-core';

export const WAITS: [string, number][] = [['24 hours', MIN_WAIT], ['2 days', 2 * 86400], ['7 days', 7 * 86400]];

/**
 * Edit the daily limit and the wait on bigger sends. Nothing changes at once: a change is queued and waits the vault's own
 * wait, in the open, so a thief with the phone cannot loosen the rules quickly. The wait can only be 24 hours or longer.
 */
export function VaultEditSheet({ open, onClose, v, net, symbol, onQueued }: { open: boolean; onClose: () => void; v: NetVault; net: VaultNet; symbol: string; onQueued: () => void }) {
  const a = v.allowances[0];
  const nowAmount = a ? Number(BigInt(a.amount)) / 10 ** a.decimals : 0;
  const [amount, setAmount] = useState('');
  const [wait, setWait] = useState(Math.max(0, WAITS.findIndex(([, s]) => s === v.wait)));
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const shown = amount === '' ? (nowAmount ? String(nowAmount) : '') : amount;
  const step = (dir: 1 | -1) => {
    const cur = Number(shown) || 0;
    const inc = cur >= 1 ? 0.5 : cur >= 0.1 ? 0.05 : 0.01;
    setAmount(String(Math.max(0, Math.round((cur + dir * inc) * 1e6) / 1e6)));
    setDone('');
  };
  const submit = async () => {
    setErr('');
    try {
      const jobs: { to: Hex; data: Hex; apply: { wait?: number; allowance?: { token: Hex; amount: bigint } } }[] = [];
      if (a && amount !== '' && Number(amount) !== nowAmount) {
        const raw = parseUnits(amount, a.decimals);
        const t = { token: a.token, symbol: a.symbol, decimals: a.decimals, amount: raw };
        const bad = checkSettings({ wait: v.wait, allowances: [t] });
        if (bad) return setErr(bad), false;
        const { to, data } = await allowanceChange(v, t);
        jobs.push({ to, data, apply: { allowance: { token: a.token, amount: raw } } });
      }
      if (WAITS[wait][1] !== v.wait) {
        const { to, data } = await waitChange(v, WAITS[wait][1]);
        jobs.push({ to, data, apply: { wait: WAITS[wait][1] } });
      }
      if (!jobs.length) return setErr('Nothing to change yet.'), false;
      if (!(await confirmIt('Queue a change to your vault settings'))) return false;
      // each queued change is saved on the vault, so the next one starts from the saved copy
      for (const j of jobs) await queueSettingChange(vaults.get()[net] ?? v, j.to, j.data, j.apply);
      setDone(`Queued. It waits ${Math.round(v.wait / 3600)} hours, and you will get an alert on this phone. When it has run, open the vault and tap "Run it now".`);
      checkEthVaults().catch(() => {});
      onQueued();
      return true;
    } catch (e) {
      setErr(plainError(e, VAULT_NETS[net].label));
      return false;
    }
  };
  const circle = (label: string, on: () => void) => (
    <Press onPress={on} accessibilityLabel={label === '−' ? 'Lower the limit' : 'Raise the limit'} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ fontSize: 24, lineHeight: 28, color: C.text }}>{label}</T>
    </Press>
  );
  return (
    <Sheet open={open} onClose={onClose}>
      <View style={{ padding: 20, gap: 14 }}>
        <T v="headline">Edit limit</T>
        <T v="caption" dim style={{ lineHeight: 18 }}>{`A change waits ${Math.round(v.wait / 3600)} hours before it applies, like a big withdrawal. You can cancel it while it waits.`}</T>
        {a ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.fill, borderRadius: 24, padding: 12 }}>
            {circle('−', () => step(-1))}
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Field value={shown} onChangeText={(t) => { setAmount(t); setDone(''); }} keyboardType="decimal-pad" style={{ backgroundColor: 'transparent', textAlign: 'center', fontSize: 30, height: 48, fontFamily: F.regular }} />
              <T v="caption" dim>{`${symbol} a day`}</T>
            </View>
            {circle('+', () => step(1))}
          </View>
        ) : null}
        <T v="sub" dim style={{ paddingHorizontal: 4 }}>Wait on bigger sends</T>
        <Segmented value={String(wait)} options={WAITS.map(([l], i) => [String(i), l] as [string, string])} onChange={(k) => { setWait(Number(k)); setDone(''); }} />
        <ErrorText>{err}</ErrorText>
        {done ? <T v="callout" style={{ lineHeight: 21 }}>{done}</T> : <SlideToPay label="Slide to queue the change" onSlide={submit} />}
      </View>
    </Sheet>
  );
}
