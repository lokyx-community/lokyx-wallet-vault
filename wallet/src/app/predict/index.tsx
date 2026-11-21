import { useEffect, useMemo, useState } from 'react';
import { PageHero } from '../../ui/AppCard';
import { View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Button, IconButton, Note, Screen } from '../../ui/controls';
import { Segmented } from '../../ui/Segmented';
import { Tutorial, HowItWorks } from '../../ui/Tutorial';
import { MarketCard, coinText } from '../../ui/PredictParts';
import { C, F } from '../../ui/theme';
import { DUR, EASE_OUT } from '../../ui/motion';
import { FEATURES } from '../../lib/features';
import { useTutorial } from '../../lib/tutorial';
import { useAsync } from '../../lib/multichain';
import { deployment, headBlock, listMarkets, myAddress, myFree, myShares, readBook, readTrades, type Market } from '../../lib/predict';
import { closesText, ladder, parseBook, series, stageOf, type Ladder } from '../../lib/predict-core';
import { stageLabel } from '../../lib/predict-screen-core';

const now = () => Math.floor(Date.now() / 1000);
const LOOKBACK = 40_000n; // about a day and a half of blocks: enough for a card's sparkline without scanning the chain

export function NotOn() {
  const [open, setOpen] = useState(false);
  return (
    <Screen title="Markets" large>
      <Note>Prediction markets are built but not switched on yet. They will run on a test network with play money first.</Note>
      <Button title="See how it works" kind="line" onPress={() => setOpen(true)} />
      <Tutorial id="predict" open={open} onClose={() => setOpen(false)} />
    </Screen>
  );
}

/** One card: reads its own book and a short history, so the list shows up at once and fills in. */
function Item({ m }: { m: Market }) {
  const book = useAsync<Ladder>(async () => ladder(await readBook(m.id)), [m.id], 15_000);
  const trades = useAsync(async () => series(await readTrades(m.id, (await headBlock()) - LOOKBACK), '1W', now(), 24).map((p) => p.price), [m.id], 60_000);
  const stage = stageOf(m.state, m.close, m.res, now());
  return <MarketCard m={m} ladder={book.data ?? null} spark={trades.data ?? []} line={stageLabel(stage, m.state, closesText(m.close, now()))} onPress={() => router.push(`/predict/${m.id}`)} />;
}

export default function Markets() {
  if (!FEATURES.predict) return <NotOn />;
  return <MarketsOn />;
}

function MarketsOn() {
  const tut = useTutorial('predict');
  const d = deployment();
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const [who, setWho] = useState<string | null>(null);
  useEffect(() => {
    void myAddress().then(setWho).catch(() => {});
  }, []);
  const list = useAsync<Market[]>(() => listMarkets(30), [], 20_000);
  const free = useAsync<bigint>(() => (who ? myFree(who) : Promise.resolve(0n)), [who], 15_000);
  const held = useAsync<Record<number, bigint>>(async () => {
    if (!who || !list.data) return {};
    const rows = await Promise.all(
      list.data.map(async (m) => {
        const s = await myShares(m.id, who);
        return [m.id, s.yes + s.no] as const;
      }),
    );
    return Object.fromEntries(rows);
  }, [who, list.data?.length], 30_000);

  const shown = useMemo(() => {
    const t = now();
    const all = (list.data ?? []).slice().sort((a, b) => {
      const ta = a.state === 'open' && a.close > t ? 0 : 1;
      const tb = b.state === 'open' && b.close > t ? 0 : 1;
      return ta - tb || (ta === 0 ? a.close - b.close : b.id - a.id);
    });
    return tab === 'mine' ? all.filter((m) => (held.data?.[m.id] ?? 0n) > 0n) : all;
  }, [list.data, held.data, tab]);

  return (
    <Screen title="Markets" right={<IconButton name="plus" label="Make a market" onPress={() => router.push('/predict/new')} />}>
      <PageHero kind="markets" small="Bet on what happens next, with play money" />
      <Tutorial id="predict" open={tut.open} onClose={tut.close} />
      <T v="sub" dim style={{ marginTop: 2 }}>Bet on what happens next. Test network, play money.</T>
      <View style={{ borderRadius: 26, backgroundColor: C.fill, padding: 18, gap: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View style={{ gap: 2 }}>
            <T v="caption" dim>In markets</T>
            <T style={{ fontFamily: F.semibold, fontSize: 30, letterSpacing: -0.8 }}>{free.data === undefined ? '—' : coinText(free.data, d.decimals, d.symbol)}</T>
          </View>
          <View style={{ width: 120 }}><Button title="Add funds" kind="line" onPress={() => router.push('/predict/funds')} /></View>
        </View>
      </View>
      <Segmented value={tab} options={[['all', 'All'], ['mine', 'Mine']]} onChange={setTab} />
      {list.error && !list.data ? <Note>{list.error}</Note> : null}
      {list.data && shown.length === 0 ? (
        <Note center>{tab === 'mine' ? 'You hold nothing yet. Open a market and buy Yes or No.' : 'No markets yet. Make the first one with the plus button.'}</Note>
      ) : null}
      {!list.data && !list.error ? <Note center>Loading markets…</Note> : null}
      <View style={{ gap: 12 }}>
        {shown.map((m, i) => (
          <Animated.View key={m.id} entering={FadeInDown.delay(i * 50).duration(DUR.base).easing(EASE_OUT)}>
            <Item m={m} />
          </Animated.View>
        ))}
      </View>
      <HowItWorks onPress={tut.replay} />
    </Screen>
  );
}
