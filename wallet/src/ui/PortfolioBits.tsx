import { View } from 'react-native';
import { Press } from './controls';
import { Logo } from './Logo';
import { TokenLogo } from './CoinLogo';
import { Spark } from './Spark';
import { T } from './Text';
import { C, F } from './theme';
import { changeText, money, type Currency, type Line, type Portfolio } from '../lib/prices-core';

const up = (p: Portfolio) => p.change >= 0;

/** The last card in the Home deck: the total, today's change and the week. */
export function PortfolioCard({ p, cur, width, height, hide }: { p: Portfolio; cur: Currency; width: number; height: number; hide: boolean }) {
  return (
    <View style={{ width, height, borderRadius: 26, backgroundColor: '#0D0D10', borderWidth: 0.5, borderColor: '#2A2A31', overflow: 'hidden' }}>
      <View style={{ padding: 20, gap: 4 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 12, letterSpacing: 1.6, color: C.sub }}>PORTFOLIO</T>
        <T style={{ fontFamily: F.semibold, fontSize: 32, letterSpacing: -1, marginTop: 6 }}>{hide ? '••••' : money(p.total, cur)}</T>
        {!hide ? <T style={{ fontFamily: F.medium, fontSize: 13.5, color: up(p) ? C.good : C.bad }}>{changeText(p.change, p.pct, cur)}</T> : null}
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Spark data={p.series} width={width} height={Math.round(height * 0.38)} color={up(p) ? '#8FD9B0' : '#FF8A8A'} fill={up(p) ? 'rgba(143,217,176,0.12)' : 'rgba(255,138,138,0.12)'} />
      </View>
    </View>
  );
}

/** The "Your coins" row under the buttons on Home. */
export function CoinsRow({ p, cur, hide, onPress }: { p: Portfolio; cur: Currency; hide: boolean; onPress: () => void }) {
  const shown = p.lines.slice(0, 4);
  return (
    <Press onPress={onPress} haptic={false} scaleTo={0.985} accessibilityLabel="Your coins" style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 24, backgroundColor: '#0B0B0E', borderWidth: 0.5, borderColor: '#1F1F25' }}>
      <View style={{ flexDirection: 'row' }}>
        {shown.map((l, i) => (
          <View key={l.symbol} style={{ marginLeft: i ? -9 : 0 }}>
            <LineLogo l={l} size={30} />
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }}>
        <T style={{ fontFamily: F.medium, fontSize: 15 }}>Your coins</T>
        <T v="caption" dim>{p.lines.length === 1 ? '1 coin' : `${p.lines.length} coins`}</T>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <T style={{ fontFamily: F.semibold, fontSize: 16, fontVariant: ['tabular-nums'] }}>{hide ? '••••' : money(p.total, cur)}</T>
        {!hide ? <T style={{ fontFamily: F.medium, fontSize: 12.5, color: up(p) ? C.good : C.bad }}>{`${up(p) ? '▲' : '▼'} ${Math.abs(p.pct).toFixed(1)}%`}</T> : null}
      </View>
    </Press>
  );
}

export function LineLogo({ l, size }: { l: Line; size: number }) {
  return l.logo ? <Logo id={l.logo} size={size} /> : <TokenLogo symbol={l.symbol} seed={l.id} size={size} />;
}
