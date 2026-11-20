import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { T } from '../../ui/Text';
import { Button, Note, Screen } from '../../ui/controls';
import { Segmented } from '../../ui/Segmented';
import { Tutorial, HowItWorks } from '../../ui/Tutorial';
import { BookLadder, ChanceChart, YesNo, centsText, coinText } from '../../ui/PredictParts';
import { usePredictAct } from '../../ui/usePredictAct';
import { C, F } from '../../ui/theme';
import { FEATURES } from '../../lib/features';
import { useTutorial } from '../../lib/tutorial';
import { useAsync } from '../../lib/multichain';
import { claimWinnings, deployment, disputeAnswer, expireMarket, finalizeAnswer, myAddress, myFree, myShares, proposeAnswer, readBook, readMarket, readTrades } from '../../lib/predict';
import { bestAsk, bestBid, bondOf, buyPrice, canSellNow, challengeLeft, challengeUsed, change, chance, clockText, closesText, ladder, positionValue, series, stageOf, type Point, type Range } from '../../lib/predict-core';
import { stageLabel } from '../../lib/predict-screen-core';
import { NotOn } from './index';

const now = () => Math.floor(Date.now() / 1000);
const ago = (s: number) => (s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86_400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86_400)} d ago`);
const ANSWER = ['Yes', 'No', 'Invalid'];

export default function MarketScreen() {
  if (!FEATURES.predict) return <NotOn />;
  return <MarketOn />;
}

function Card({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <View style={{ borderRadius: 26, backgroundColor: C.fill, padding: 18, gap: 12 }}>
      {title ? <T style={{ fontFamily: F.semibold, fontSize: 13, letterSpacing: 0.2, color: C.sub }}>{title}</T> : null}
      {children}
    </View>
  );
}

function MarketOn() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const mid = Number(id);
  const d = deployment();
  const tut = useTutorial('predict');
  const [who, setWho] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('1D');
  const [scrub, setScrub] = useState<Point | null>(null);
  useEffect(() => {
    void myAddress().then(setWho).catch(() => {});
  }, []);

  const mk = useAsync(() => readMarket(mid), [mid], 10_000);
  const book = useAsync(async () => ladder(await readBook(mid)), [mid], 8_000);
  const trades = useAsync(() => readTrades(mid), [mid], 30_000);
  const mine = useAsync(() => (who ? myShares(mid, who) : Promise.resolve({ yes: 0n, no: 0n })), [mid, who], 8_000);
  const free = useAsync(() => (who ? myFree(who) : Promise.resolve(0n)), [who], 8_000);
  const refresh = () => {
    mk.refresh();
    book.refresh();
    trades.refresh();
    mine.refresh();
    free.refresh();
  };
  const act = usePredictAct(refresh);

  const m = mk.data;
  const l = book.data ?? { asks: [], bids: [] };
  const t = now();
  const stage = m ? stageOf(m.state, m.close, m.res, t) : null;
  const points = useMemo(() => series(trades.data ?? [], range, t, 48), [trades.data, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const ch = chance(l);
  const last = points.length ? points[points.length - 1].price : null;
  const headline = scrub ? scrub.price : ch ?? last;
  const delta = change(points);
  const myBond = m ? bondOf(m.unit) : 0n;
  const enoughForBond = (free.data ?? 0n) >= myBond;

  if (!m) return <Screen title="Market" large>{mk.error ? <Note>{mk.error}</Note> : <Note center>Loading…</Note>}</Screen>;

  const holds = (mine.data?.yes ?? 0n) + (mine.data?.no ?? 0n) > 0n;
  const positionRows = (['yes', 'no'] as const)
    .map((o) => ({ o, qty: mine.data?.[o] ?? 0n }))
    .filter((p) => p.qty > 0n);

  return (
    <Screen title="Market" large={false} right={undefined}>
      <Tutorial id="predict" open={tut.open} onClose={tut.close} />
      <T style={{ fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.7, lineHeight: 31 }}>{m.title}</T>
      <T v="sub" dim style={{ marginTop: -8 }}>{stageLabel(stage!, m.state, closesText(m.close, t))}</T>

      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 44, letterSpacing: -1.4, lineHeight: 48 }}>{headline === null ? '—' : `${Math.round(headline)}%`}</T>
          <T v="callout" dim style={{ paddingBottom: 6 }}>chance of Yes</T>
        </View>
        <T v="sub" style={{ color: scrub ? C.soft : delta === null ? C.sub : delta >= 0 ? C.good : C.bad }}>
          {scrub ? `${Math.round(scrub.price)}¢ · ${ago(t - scrub.at)}` : delta === null ? 'Not enough trades for a trend' : `${delta >= 0 ? '+' : ''}${Math.round(delta * 10) / 10}¢ over ${range === 'ALL' ? 'its life' : range === '1H' ? 'the hour' : range === '1D' ? 'the day' : 'the week'}`}
        </T>
      </View>

      <ChanceChart points={points} onScrub={setScrub} />
      <Segmented value={range} options={[['1H', '1H'], ['1D', '1D'], ['1W', '1W'], ['ALL', 'All']]} onChange={setRange} />

      {stage === 'trading' ? (
        <YesNo
          yes={buyPrice(l, 'yes')}
          no={buyPrice(l, 'no')}
          unit={m.unit}
          decimals={d.decimals}
          symbol={d.symbol}
          onYes={() => router.push({ pathname: '/predict/trade', params: { id: String(mid), outcome: 'yes', side: 'buy' } })}
          onNo={() => router.push({ pathname: '/predict/trade', params: { id: String(mid), outcome: 'no', side: 'buy' } })}
        />
      ) : null}

      {holds ? (
        <Card title="Your shares">
          {positionRows.map(({ o, qty }) => {
            const p = { outcome: o, qty };
            const value = positionValue(p, l, m.unit);
            return (
              <View key={o} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ gap: 2 }}>
                  <T style={{ fontFamily: F.semibold, fontSize: 18, color: o === 'yes' ? C.good : C.bad }}>{`${qty.toString()} ${o === 'yes' ? 'Yes' : 'No'}`}</T>
                  <T v="caption" dim>{stage === 'trading' ? `Worth ${coinText(value, d.decimals, d.symbol)} if sold now` : `Pays ${coinText(qty * m.unit, d.decimals, d.symbol)} if ${o === 'yes' ? 'Yes' : 'No'} wins`}</T>
                </View>
                {stage === 'trading' && canSellNow(p, l) ? (
                  <View style={{ width: 100 }}>
                    <Button title="Sell" kind="line" onPress={() => router.push({ pathname: '/predict/trade', params: { id: String(mid), outcome: o, side: 'sell' } })} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
      ) : null}

      {stage === 'needs-answer' ? (
        <Card title="Trading has ended">
          <T v="sub" dim style={{ lineHeight: 20 }}>{`Anyone can propose what happened. You put up a bond of ${coinText(myBond, d.decimals, d.symbol)} and get it back if nobody proves you wrong.`}</T>
          {!enoughForBond ? <Note>{`Your market balance is under the bond. Add funds first.`}</Note> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[0, 1, 2].map((a) => (
              <View key={a} style={{ flex: 1 }}>
                <Button title={ANSWER[a]} kind="line" disabled={!!act.busy || !enoughForBond} onPress={() => act.run(`Propose the answer ${ANSWER[a]}`, () => proposeAnswer(mid, a as 0 | 1 | 2), 'Answer proposed')} />
              </View>
            ))}
          </View>
          {!enoughForBond ? <Button title="Add funds" onPress={() => router.push('/predict/funds')} /> : null}
        </Card>
      ) : null}

      {stage === 'answer-waiting' && m.res.proposed !== null ? (
        <Card title="Answer proposed">
          <T style={{ fontFamily: F.semibold, fontSize: 24, letterSpacing: -0.5 }}>{ANSWER[m.res.proposed]}</T>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: C.line2, overflow: 'hidden' }}>
            <View style={{ height: 6, width: `${Math.round(challengeUsed(m.res, t) * 100)}%`, backgroundColor: C.text, borderRadius: 3 }} />
          </View>
          <T v="sub" dim>{challengeLeft(m.res, t) > 0 ? `Anyone can dispute for ${clockText(challengeLeft(m.res, t))}.` : 'The dispute time is over.'}</T>
          {challengeLeft(m.res, t) > 0 ? (
            <Button title={`Dispute (bond ${coinText(myBond, d.decimals, d.symbol)})`} kind="line" disabled={!!act.busy || !enoughForBond} onPress={() => act.run('Dispute the proposed answer', () => disputeAnswer(mid), 'Disputed: the panel decides')} />
          ) : (
            <Button title="Make it final" disabled={!!act.busy} busy={act.busy.startsWith('Make')} onPress={() => act.run('Make the answer final', () => finalizeAnswer(mid), 'The answer is final')} />
          )}
        </Card>
      ) : null}

      {stage === 'disputed' ? (
        <Card title="Answer disputed">
          <T v="sub" dim style={{ lineHeight: 20 }}>{`The ${m.panel.length} people on this market's panel decide. If they do not agree in time, the market ends and everyone gets their coins back.`}</T>
        </Card>
      ) : null}

      {stage === 'expired' ? (
        <Card title="This market ran out of time">
          <T v="sub" dim style={{ lineHeight: 20 }}>Nobody settled it in time. End it to give everyone their coins back.</T>
          <Button title="End it and return coins" disabled={!!act.busy} onPress={() => act.run('End the market and return coins', () => expireMarket(mid), 'Market ended')} />
        </Card>
      ) : null}

      {stage === 'decided' ? (
        <Card title="Result">
          <T style={{ fontFamily: F.semibold, fontSize: 24, letterSpacing: -0.5 }}>{m.state === 'yes' ? 'Yes won' : m.state === 'no' ? 'No won' : 'Called invalid'}</T>
          {holds ? <Button title="Collect" disabled={!!act.busy} busy={act.busy.startsWith('Collect')} onPress={() => act.run('Collect your winnings', () => claimWinnings(mid), 'Collected into your market balance')} /> : <T v="sub" dim>You held nothing in this market.</T>}
        </Card>
      ) : null}

      <Card title="Offers waiting">
        <BookLadder l={l} />
        <T v="caption" dim>{`Best price for Yes: ${centsText(bestAsk(l))} to buy, ${centsText(bestBid(l))} to sell.`}</T>
      </Card>

      <Card title="About this market">
        <T v="sub" dim>{`Each winning share pays ${coinText(m.unit, d.decimals, d.symbol)}. A ${(d.feeBps / 100).toString()}% fee is taken on what you buy or sell right away, not on offers that wait.`}</T>
      </Card>
      <HowItWorks onPress={tut.replay} />
      {act.sheet}
    </Screen>
  );
}
