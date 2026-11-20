import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { T } from '../../ui/Text';
import { Button, Field, Group, Line, Note, Press, Screen } from '../../ui/controls';
import { Segmented } from '../../ui/Segmented';
import { SlideToPay } from '../../ui/SlideToPay';
import { Slip, shareSlip, useReveal } from '../../ui/Slip';
import { Logo } from '../../ui/Logo';
import { Icon } from '../../ui/Icon';
import { coinText } from '../../ui/PredictParts';
import { ProblemSheet } from '../../ui/ProblemSheet';
import { C, F } from '../../ui/theme';
import { confirmIt } from '../../lib/auth';
import { FEATURES } from '../../lib/features';
import { problemFrom, type OptionId, type Problem } from '../../lib/problem-core';
import { useAsync } from '../../lib/multichain';
import { deployment, myAddress, myFree, myShares, placeOrder, readBook, readMarket, waitFor, type Result } from '../../lib/predict';
import { chance, ladder, type Outcome, type Side } from '../../lib/predict-core';
import { parseQty, receiptFacts, startPrice, tradeView } from '../../lib/predict-screen-core';
import { NotOn } from './index';

export default function Trade() {
  if (!FEATURES.predict) return <NotOn />;
  return <TradeOn />;
}

/** A ring that draws round the coin while the order is on its way. */
function Sending() {
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear }), -1, false);
  }, [spin]);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={{ alignItems: 'center', gap: 20 }}>
      <View style={{ width: 120, height: 120, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ position: 'absolute' }, st]}>
          <Svg width={120} height={120} viewBox="0 0 120 120">
            <Circle cx={60} cy={60} r={54} stroke={C.line2} strokeWidth={4} fill="none" />
            <Circle cx={60} cy={60} r={54} stroke="#C9A057" strokeWidth={4} fill="none" strokeLinecap="round" strokeDasharray="90 260" />
          </Svg>
        </Animated.View>
        <Logo id="usdt" size={54} />
      </View>
      <T style={{ fontFamily: F.semibold, fontSize: 22, letterSpacing: -0.5 }}>Sending your order</T>
    </Animated.View>
  );
}

interface Sent {
  hash: string;
  at: number;
  outcome: Outcome;
  side: Side;
  qty: bigint;
  limit: number;
  cost: string;
}

function TradeOn() {
  const p = useLocalSearchParams<{ id: string; outcome: string; side: string }>();
  const mid = Number(p.id);
  const side: Side = p.side === 'sell' ? 'sell' : 'buy';
  const d = deployment();
  const [outcome, setOutcome] = useState<Outcome>(p.outcome === 'no' ? 'no' : 'yes');
  const [qtyText, setQtyText] = useState('10');
  const [limit, setLimit] = useState<number | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    void myAddress().then(setWho).catch(() => {});
  }, []);

  const mk = useAsync(() => readMarket(mid), [mid]);
  const book = useAsync(async () => ladder(await readBook(mid)), [mid], 6_000);
  const free = useAsync(() => (who ? myFree(who) : Promise.resolve(0n)), [who], 8_000);
  const mine = useAsync(() => (who ? myShares(mid, who) : Promise.resolve({ yes: 0n, no: 0n })), [mid, who], 8_000);
  const l = book.data ?? { asks: [], bids: [] };

  // the price starts where the book is, and moves again when the person flips Yes/No
  const fallback = chance(l);
  useEffect(() => {
    if (book.data) setLimit(startPrice(book.data, outcome, side, fallback));
  }, [outcome, side, book.data === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const qty = parseQty(qtyText);
  const view = useMemo(
    () => (mk.data && limit !== null ? tradeView({ ladder: l, outcome, side, limit, qty, unit: mk.data.unit, feeBps: d.feeBps, free: free.data ?? 0n, have: mine.data?.[outcome] ?? 0n }) : null),
    [mk.data, limit, l, outcome, side, qty, free.data, mine.data, d.feeBps],
  );
  const word = outcome === 'yes' ? 'Yes' : 'No';

  // once sent, wait for the network
  useEffect(() => {
    if (!sent || !who) return;
    let live = true;
    void waitFor(sent.hash, who).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, [sent, who]);
  const printed = useReveal(!!sent, 2600);

  const send = async (): Promise<boolean> => {
    if (!view?.q || limit === null || qty === null || !mk.data || view.why) return false;
    if (!(await confirmIt(`${side === 'buy' ? 'Buy' : 'Sell'} ${qty} ${word} share${qty === 1n ? '' : 's'}`, { keyFollows: true }))) return false;
    try {
      const hash = await placeOrder(mid, outcome, side, limit, qty);
      setSent({ hash, at: Date.now(), outcome, side, qty, limit, cost: coinText(side === 'buy' ? view.q.total : view.q.total, d.decimals, d.symbol) });
      return true;
    } catch (e) {
      setProblem(problemFrom(e, { where: d.label, symbol: 'BNB' }));
      return false;
    }
  };
  const pickProblem = async (id: OptionId) => {
    setProblem(null);
    if (id === 'retry' || id === 'check-again') await send();
  };

  if (!mk.data || limit === null || !view) return <Screen title={side === 'buy' ? 'Buy' : 'Sell'} large>{mk.error ? <Note>{mk.error}</Note> : <Note center>Loading…</Note>}</Screen>;

  // ----- after sending: the ring, then the receipt -----
  if (sent) {
    const done = !!result?.mined && result.ok;
    const facts = receiptFacts({ outcome: sent.outcome, side: sent.side, qty: sent.qty, limit: sent.limit, fills: result?.fills ?? [], ok: !result || result.ok, unit: mk.data.unit, decimals: d.decimals });
    const slip = {
      amount: sent.cost.split(' ')[0],
      unit: d.symbol,
      to: mk.data.title,
      from: who ?? undefined,
      network: d.label,
      at: sent.at,
      hash: sent.hash,
      testnet: true,
      url: `${d.explorer}/tx/${sent.hash}`,
      verb: result?.mined ? facts.verb : sent.side === 'buy' ? 'Buying' : 'Selling',
      sub: result?.mined ? facts.headline : `${sent.qty} ${sent.outcome === 'yes' ? 'Yes' : 'No'} · ${mk.data.title}`,
      rows: [
        { label: 'Market', value: mk.data.title },
        { label: 'Order', value: `${sent.side === 'buy' ? 'Buy' : 'Sell'} ${sent.qty} ${sent.outcome === 'yes' ? 'Yes' : 'No'} at up to ${sent.limit}¢` },
        ...(result?.mined ? [{ label: 'Result', value: facts.headline }] : []),
        { label: 'Network', value: d.label },
      ],
    };
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingHorizontal: 24, paddingTop: 80, paddingBottom: 40 }}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {printed ? <Slip slip={slip} done={done} caption={result?.mined ? facts.detail : 'On its way · lands with the next block'} /> : <Sending />}
        </View>
        {printed ? (
          <Animated.View entering={FadeIn.delay(500)} style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button title="Share receipt" kind="line" onPress={() => shareSlip(slip, done)} /></View>
              <View style={{ flex: 1 }}><Button title="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace('/predict'))} /></View>
            </View>
          </Animated.View>
        ) : null}
      </View>
    );
  }

  const step = (n: number) => setLimit(Math.min(99, Math.max(1, limit + n)));
  const q = view.q;
  const stepBtn = (label: string, on: () => void, a11y: string) => (
    <Press onPress={on} accessibilityRole="button" accessibilityLabel={a11y} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ fontFamily: F.semibold, fontSize: 26, color: C.text, lineHeight: 30 }}>{label}</T>
    </Press>
  );

  return (
    <Screen title={`${side === 'buy' ? 'Buy' : 'Sell'} ${word}`} large>
      <T v="sub" dim style={{ marginTop: -8 }} numberOfLines={2}>{mk.data.title}</T>
      {side === 'buy' ? <Segmented value={outcome} options={[['yes', 'Yes'], ['no', 'No']]} onChange={(o) => { setOutcome(o); }} /> : null}

      <View style={{ borderRadius: 26, backgroundColor: C.fill, padding: 18, gap: 16 }}>
        <View style={{ gap: 8 }}>
          <T v="caption" dim>Shares</T>
          <Field value={qtyText} onChangeText={(t) => setQtyText(t.replace(/[^0-9]/g, '').slice(0, 5))} keyboardType="number-pad" big accessibilityLabel="Number of shares" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[1, 5, 10, 50].map((n) => (
              <Press key={n} onPress={() => setQtyText(String((qty ?? 0n) + BigInt(n)))} style={{ paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: C.fill2, justifyContent: 'center' }}>
                <T v="sub">{`+${n}`}</T>
              </Press>
            ))}
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <T v="caption" dim>{side === 'buy' ? 'Most you will pay for a share' : 'Least you will accept for a share'}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {stepBtn('−', () => step(-1), 'Lower the price')}
            <T style={{ fontFamily: F.semibold, fontSize: 38, letterSpacing: -1 }}>{`${limit}¢`}</T>
            {stepBtn('+', () => step(1), 'Raise the price')}
          </View>
        </View>
      </View>

      {q ? (
        <Group>
          {side === 'buy' ? (
            <>
              <Line label="Buys right now" value={q.filledQty > 0n ? `${q.filledQty} at ${q.avgPrice}¢ avg` : 'None: waits for a seller'} />
              {q.restingQty > 0n ? <Line label="Waits in the book" value={`${q.restingQty} at ${limit}¢`} /> : null}
              <Line label="Fee" value={coinText(q.fee, d.decimals, d.symbol, 4)} />
              <Line label="Total" value={coinText(q.total, d.decimals, d.symbol)} />
              {view.pay ? <Line label="If you win" value={`${coinText(view.pay.ifWin, d.decimals, d.symbol)}${view.pay.profitPct !== null ? ` (+${view.pay.profitPct}%)` : ''}`} /> : null}
              <Line label="If you lose" value={`You lose what you paid`} />
            </>
          ) : (
            <>
              <Line label="Sells right now" value={q.filledQty > 0n ? `${q.filledQty} at ${q.avgPrice}¢ avg` : 'None: waits for a buyer'} />
              {q.restingQty > 0n ? <Line label="Waits in the book" value={`${q.restingQty} at ${limit}¢`} /> : null}
              <Line label="Fee" value={coinText(q.fee, d.decimals, d.symbol, 4)} />
              <Line label="You receive now" value={coinText(q.total, d.decimals, d.symbol)} />
            </>
          )}
        </Group>
      ) : null}

      <T v="caption" dim style={{ textAlign: 'center' }}>{`In your market balance: ${coinText(free.data ?? 0n, d.decimals, d.symbol)}`}</T>
      {view.short > 0n ? (
        <View style={{ gap: 10 }}>
          <Note center>{`You need ${coinText(view.short, d.decimals, d.symbol)} more.`}</Note>
          <Button title="Add funds" onPress={() => router.push('/predict/funds')} />
        </View>
      ) : view.why ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="info" size={16} color={C.sub} width={2} />
          <T v="sub" dim>{view.why}</T>
        </View>
      ) : null}
      <SlideToPay label={side === 'buy' ? `Slide to buy ${word}` : `Slide to sell ${word}`} disabled={!!view.why} onSlide={send} />
      <ProblemSheet problem={problem} onPick={pickProblem} onClose={() => setProblem(null)} />
    </Screen>
  );
}
