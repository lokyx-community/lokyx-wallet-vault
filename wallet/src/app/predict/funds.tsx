import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { T } from '../../ui/Text';
import { Button, Note, Screen } from '../../ui/controls';
import { Logo } from '../../ui/Logo';
import { coinText } from '../../ui/PredictParts';
import { usePredictAct } from '../../ui/usePredictAct';
import { C, F } from '../../ui/theme';
import { FEATURES } from '../../lib/features';
import { useAsync } from '../../lib/multichain';
import { allowMarket, depositCoins, deployment, mintPlayMoney, myAddress, myFree, waitFor, walletToken, withdrawCoins } from '../../lib/predict';
import { NotOn } from './index';

export default function Funds() {
  if (!FEATURES.predict) return <NotOn />;
  return <FundsOn />;
}

/** Sends one step and stops the whole action if the network did not take it. */
async function mined(hash: string, who: string) {
  const r = await waitFor(hash, who);
  if (!r.mined) throw new Error('The network is slow. Check again in a minute.');
  if (!r.ok) throw new Error('The network refused it: nothing changed.');
}

function FundsOn() {
  const d = deployment();
  const [who, setWho] = useState<string | null>(null);
  useEffect(() => {
    void myAddress().then(setWho).catch(() => {});
  }, []);
  const tok = useAsync(() => (who ? walletToken(who) : Promise.resolve({ balance: 0n, allowance: 0n })), [who], 10_000);
  const free = useAsync(() => (who ? myFree(who) : Promise.resolve(0n)), [who], 10_000);
  const act = usePredictAct(() => {
    tok.refresh();
    free.refresh();
  });
  const unit = 10n ** BigInt(d.decimals);
  const wallet = tok.data?.balance ?? 0n;
  const inMarkets = free.data ?? 0n;

  const add = (n: bigint) =>
    act.run(
      `Add ${n / unit} ${d.symbol} to markets`,
      async () => {
        const me = who ?? (await myAddress());
        const t = await walletToken(me);
        if (t.allowance < n) await mined(await allowMarket(n), me); // lets the market take the coins, once
        return depositCoins(n);
      },
      'Added to your market balance',
    );

  return (
    <Screen title="Market funds" large>
      <T v="sub" dim style={{ marginTop: -8 }}>{`${d.label}. These are test coins with no value.`}</T>

      <View style={{ borderRadius: 26, backgroundColor: C.fill, padding: 18, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Logo id="usdt" size={36} />
          <View style={{ gap: 2 }}>
            <T v="caption" dim>In your wallet</T>
            <T style={{ fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.6 }}>{coinText(wallet, d.decimals, d.symbol)}</T>
          </View>
        </View>
        {d.playToken ? (
          <Button title={`Get ${1000} play ${d.symbol}`} kind="line" disabled={!!act.busy} busy={act.busy.startsWith('Get')} onPress={() => act.run(`Get 1000 play ${d.symbol}`, () => mintPlayMoney(1000n * unit), 'Play money added to your wallet')} />
        ) : null}
      </View>

      <View style={{ borderRadius: 26, backgroundColor: C.fill, padding: 18, gap: 14 }}>
        <View style={{ gap: 2 }}>
          <T v="caption" dim>In markets</T>
          <T style={{ fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.6 }}>{coinText(inMarkets, d.decimals, d.symbol)}</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[10n, 100n, 1000n].map((n) => (
            <View key={String(n)} style={{ flex: 1 }}>
              <Button title={`+${n}`} kind="line" disabled={!!act.busy || wallet < n * unit} onPress={() => add(n * unit)} />
            </View>
          ))}
        </View>
        {wallet === 0n && d.playToken ? <Note>Get play money above first, then add it to markets.</Note> : null}
        <Button title="Take everything back" kind="plain" disabled={!!act.busy || inMarkets === 0n} onPress={() => act.run('Take your coins out of markets', () => withdrawCoins(inMarkets), 'Back in your wallet')} />
      </View>

      <Note center>Coins in orders that are still waiting stay locked until the order fills or you cancel it.</Note>
      {act.busy ? <T v="sub" dim style={{ textAlign: 'center' }}>{`${act.busy}…`}</T> : null}
      {act.sheet}
    </Screen>
  );
}
