import { View, useWindowDimensions } from 'react-native';
import { Screen } from '../ui/controls';
import { Segmented } from '../ui/Segmented';
import { Spark } from '../ui/Spark';
import { LineLogo } from '../ui/PortfolioBits';
import { T } from '../ui/Text';
import { C, F } from '../ui/theme';
import { useCoins } from '../lib/coins';
import { useWallet } from '../lib/wallet';
import { useCurrency, usePortfolio } from '../lib/prices';
import { changeText, money } from '../lib/prices-core';

export default function Portfolio() {
  const sw = useWindowDimensions().width;
  const coins = useCoins();
  const hide = useWallet().settings.hideBalance;
  const { p, cur } = usePortfolio(coins);
  const [, setCur] = useCurrency();
  const good = (p?.change ?? 0) >= 0;
  return (
    <Screen title="Portfolio" large>
      <Segmented value={cur} options={[['usd', 'Dollars'], ['inr', 'Rupees']]} onChange={setCur} />
      {p ? (
        <>
          <View style={{ gap: 4, paddingHorizontal: 4 }}>
            <T style={{ fontFamily: F.semibold, fontSize: 38, letterSpacing: -1.3 }}>{hide ? '••••' : money(p.total, cur)}</T>
            {!hide ? <T style={{ fontFamily: F.medium, fontSize: 14.5, color: good ? C.good : C.bad }}>{changeText(p.change, p.pct, cur)}</T> : null}
          </View>
          {p.series.length > 1 && !hide ? (
            <View style={{ borderRadius: 22, overflow: 'hidden', backgroundColor: '#0B0B0E', borderWidth: 0.5, borderColor: '#1F1F25', paddingTop: 14 }}>
              <T v="caption" dim style={{ paddingHorizontal: 16, paddingBottom: 8 }}>Last 7 days</T>
              <Spark data={p.series} width={Math.min(sw - 40, 480)} height={90} color={good ? '#8FD9B0' : '#FF8A8A'} fill={good ? 'rgba(143,217,176,0.12)' : 'rgba(255,138,138,0.12)'} />
            </View>
          ) : null}
          <View style={{ borderRadius: 24, backgroundColor: '#0B0B0E', borderWidth: 0.5, borderColor: '#1F1F25', overflow: 'hidden' }}>
            {p.lines.map((l, i) => (
              <View key={l.symbol} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: i ? 0.5 : 0, borderTopColor: '#1D1D22' }}>
                <LineLogo l={l} size={38} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T style={{ fontFamily: F.medium, fontSize: 16 }}>{l.name}</T>
                  <T v="caption" dim>{hide ? '•••' : `${+l.amount.toFixed(6)} ${l.symbol}`}</T>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <T style={{ fontFamily: F.medium, fontSize: 16, fontVariant: ['tabular-nums'] }}>{hide ? '•••' : money(l.value, cur)}</T>
                  {!hide ? <T style={{ fontFamily: F.medium, fontSize: 12.5, color: Math.abs(l.pct) < 0.05 ? C.sub : l.pct > 0 ? C.good : C.bad }}>{Math.abs(l.pct) < 0.05 ? '0.0%' : `${l.pct > 0 ? '▲' : '▼'} ${Math.abs(l.pct).toFixed(1)}%`}</T> : null}
                </View>
              </View>
            ))}
          </View>
          <T v="caption" dim style={{ paddingHorizontal: 4 }}>LOKYX and test coins are not counted. Prices come from CoinGecko, and gains are estimates from the last 24 hours.</T>
        </>
      ) : (
        <T v="body" dim>Nothing to total yet. Coins you hold on real-money networks show here with their value. Test coins and LOKYX have no market value.</T>
      )}
    </Screen>
  );
}
