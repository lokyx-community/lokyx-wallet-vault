import { ScrollView, View } from 'react-native';
import { Press } from './controls';
import { CoinMark } from './CoinMark';
import { T } from './Text';
import { C, F } from './theme';
import type { LogoId } from './logos';
import type { VaultNet } from '../lib/ethvault-core';

/** The real logo and the plain name of each vault network. */
export const VAULT_MARK: Record<VaultNet, { logo: LogoId; name: string }> = {
  'base-sepolia': { logo: 'base', name: 'Base' },
  'arbitrum-sepolia': { logo: 'arb', name: 'Arbitrum' },
  sepolia: { logo: 'eth', name: 'Ethereum' },
  'op-sepolia': { logo: 'op', name: 'Optimism' },
  'bnb-testnet': { logo: 'bnb', name: 'BNB Chain' },
};

export interface ChipItem<K extends string> {
  key: K;
  label: string;
  /** The coin's real logo; letters on a quiet coin when it has none. */
  logo?: LogoId | null;
  seed?: string;
  /** A second line under the label, for example the balance. */
  sub?: string;
}

/** A row of coin chips: the real logo first, the name second. The chosen one gets a clear outline. */
export function LogoChips<K extends string>({ value, onChange, items }: { value: K; onChange: (k: K) => void; items: ChipItem<K>[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Press
            key={it.key}
            onPress={() => onChange(it.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={it.label}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingLeft: 6, paddingRight: 14, borderRadius: 24, backgroundColor: C.fill2, borderWidth: 1, borderColor: on ? C.text : C.line2 }}
          >
            <CoinMark symbol={it.label} seed={it.seed ?? it.key} logo={it.logo} size={28} />
            <View>
              <T style={{ fontFamily: F.medium, fontSize: 14, color: on ? C.text : C.soft }}>{it.label}</T>
              {it.sub ? <T v="caption" dim style={{ fontSize: 11 }}>{it.sub}</T> : null}
            </View>
          </Press>
        );
      })}
    </ScrollView>
  );
}
