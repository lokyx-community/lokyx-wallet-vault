import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { T } from '../../ui/Text';
import { Field, Screen, success, ErrorText } from '../../ui/controls';
import { Label, Panel, GRow, Primary, Secondary } from '../../ui/Glass';
import { Segmented } from '../../ui/Segmented';
import { toast } from '../../ui/Toast';
import { C } from '../../ui/theme';
import { confirmIt } from '../../lib/auth';
import { useChain } from '../../lib/chain';
import { resolveDeploy, tokenLocks, useTokenLocks, useTokens } from '../../lib/data';
import { currentAddress } from '../../lib/wallet';
import { isAddress } from '../../lib/lokyx';
import { labelFor } from '../../lib/format';
import { callMethod, deploy } from '../../lib/wcontracts';

const SPANS: [string, string, number][] = [
  ['1m', '1 month', 30 * 86400],
  ['3m', '3 months', 90 * 86400],
  ['6m', '6 months', 180 * 86400],
  ['1y', '1 year', 365 * 86400],
];

/**
 * Lock part of a token you made until a date: the team's share, or a promise to holders that you won't sell
 * before then. Two steps: make the lock, then move the tokens into it. Nobody can take them out early.
 */
export default function TokenLocks() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const t = useTokens().find((x) => x.address === token);
  const chain = useChain();
  const height = chain.info?.height ?? 0;
  const blockSecs = chain.info?.targetBlockTime ?? 60;
  const list = useTokenLocks().filter((l) => l.token === token);
  const [amt, setAmt] = useState('');
  const [to, setTo] = useState('');
  const [span, setSpan] = useState('6m');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    const go = async () => {
      for (const l of tokenLocks.get().filter((x) => !x.address)) {
        const a = await resolveDeploy(l.tx);
        if (a) await tokenLocks.save((x) => x.map((y) => (y.tx === l.tx ? { ...y, address: a } : y)));
        if (a === '') await tokenLocks.save((x) => x.filter((y) => y.tx !== l.tx));
      }
    };
    go();
    const i = setInterval(go, 6000);
    return () => clearInterval(i);
  }, []);

  if (!t) return <Screen title="Lock tokens"><T v="sub" dim>That token isn't in your list.</T></Screen>;
  const who = to.trim() ? to.trim().toLowerCase() : currentAddress();
  const secs = SPANS.find((s) => s[0] === span)![2];

  const make = async () => {
    if (!(await confirmIt(`Lock ${amt} ${t.symbol}`, { keyFollows: true }))) return;
    setBusy('make');
    try {
      const unlock = height + Math.ceil(secs / blockSecs);
      const tx = await deploy('tokenlock', [t.address, who, unlock], 0n, `${amt} ${t.symbol} lock`);
      await tokenLocks.save((x) => [{ token: t.address, symbol: t.symbol, amount: amt.trim(), to: who, unlock, tx, address: '', funded: false, at: Date.now() }, ...x]);
      setAmt('');
      toast('The lock is being made. Then move the tokens in.', 'info');
    } catch (e) {
      toast((e as Error).message, 'info');
    } finally {
      setBusy('');
    }
  };
  const fund = async (l: (typeof list)[number]) => {
    if (!(await confirmIt(`Move ${l.amount} ${l.symbol} into the lock`))) return;
    setBusy(l.tx);
    try {
      await callMethod(l.token, 'transfer', [l.address, l.amount], 0n, `${l.amount} ${l.symbol}`);
      await tokenLocks.save((x) => x.map((y) => (y.tx === l.tx ? { ...y, funded: true } : y)));
      success();
    } catch (e) {
      toast((e as Error).message, 'info');
    } finally {
      setBusy('');
    }
  };
  const release = async (l: (typeof list)[number]) => {
    setBusy(l.tx);
    try {
      await callMethod(l.address, 'release', [], 0n, `${l.amount} ${l.symbol}`);
      success();
      toast(`${l.symbol} on its way to ${labelFor(l.to)}`, 'receive');
    } catch (e) {
      toast((e as Error).message, 'info');
    } finally {
      setBusy('');
    }
  };
  const when = (l: (typeof list)[number]) => {
    const left = (l.unlock - height) * blockSecs;
    return left <= 0 ? 'Unlocked' : left > 2 * 86400 ? `Unlocks in ${Math.ceil(left / 86400)} days` : `Unlocks in ${Math.ceil(left / 3600)} hours`;
  };

  return (
    <Screen title={`Lock ${t.symbol}`} large>
      <T v="sub" dim style={{ lineHeight: 20 }}>Put part of {t.symbol} out of reach until a date, for your team or as a promise to holders. Anyone can check the lock on the explorer, and nobody can open it early, not even you.</T>
      <Field value={amt} onChangeText={setAmt} placeholder={`How many ${t.symbol}`} keyboardType="decimal-pad" />
      <Field value={to} onChangeText={setTo} placeholder="Goes to: you (or paste lyx1…)" autoCapitalize="none" autoCorrect={false} mono />
      <Segmented value={span} onChange={setSpan} options={SPANS.map(([k, l]) => [k, l] as [string, string])} />
      <ErrorText>{to.trim() && !isAddress(to.trim().toLowerCase()) ? "That isn't a LOKYX address." : ''}</ErrorText>
      <Primary title="Make the lock" busy={busy === 'make'} disabled={!amt || !height || (!!to.trim() && !isAddress(to.trim().toLowerCase()))} onPress={make} />
      {list.length > 0 && (
        <View>
          <Label>Locks</Label>
          <Panel>
            {list.map((l) => (
              <View key={l.tx}>
                <GRow icon="lock" title={`${l.amount} ${l.symbol} for ${labelFor(l.to) === labelFor(currentAddress()) ? 'you' : labelFor(l.to)}`} sub={!l.address ? 'Being made…' : !l.funded ? 'Made. Move the tokens in to lock them.' : when(l)} />
                {l.address && !l.funded ? <View style={{ paddingBottom: 12 }}><Primary title={`Move ${l.amount} ${l.symbol} in`} busy={busy === l.tx} onPress={() => fund(l)} /></View> : null}
                {l.address && l.funded && height >= l.unlock ? <View style={{ paddingBottom: 12 }}><Secondary title="Release them" onPress={() => release(l)} /></View> : null}
              </View>
            ))}
          </Panel>
        </View>
      )}
    </Screen>
  );
}
