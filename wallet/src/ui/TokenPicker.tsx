import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { T } from './Text';
import { Button, Field, Press, Screen, Switch, success } from './controls';
import { Logo, logoFor } from './Logo';
import { TokenLogo } from './CoinLogo';
import { Icon } from './Icon';
import { toast } from './Toast';
import { C, F } from './theme';
import { useCoins } from '../lib/coins';
import { activeNets, removeToken, useChainSettings } from '../lib/multichain';
import { ETH_NETS, presetsFor } from '../lib/multichain-core';
import { SOL_NETS } from '../lib/sol-core';
import { SOL_TOKENS, TRON_TOKENS, removeWatchedX } from '../lib/xchains';
import { CHAIN_NAME, guessChain, type TokenChain } from '../lib/add-token-core';
import { lookupFor, netLabel } from '../lib/add-token';

interface Item { id: string; name: string; symbol: string; decimals: number }

const SOL_MAIN = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);

/** The popular tokens this chain can really hold, from the app's own checked list. */
function itemsFor(chain: TokenChain): Item[] {
  const n = activeNets();
  if (chain === 'eth') return presetsFor(ETH_NETS[n.eth].chainId).map((t) => ({ id: t.contract, name: t.name ?? t.symbol, symbol: t.symbol, decimals: t.decimals }));
  if (chain === 'sol') {
    const main = SOL_NETS[n.sol].real;
    return Object.entries(SOL_TOKENS).filter(([id]) => SOL_MAIN.has(id) === main).map(([id, t]) => ({ id, name: t.name, symbol: t.symbol, decimals: 6 }));
  }
  if (chain === 'trx') return Object.entries(TRON_TOKENS[n.trx] ?? {}).map(([id, t]) => ({ id, name: t.name, symbol: t.symbol, decimals: t.decimals }));
  return [];
}

/** The Add token sheet: one chain's tokens with real logos. Off is grey, on is colour. Save adds what is on. */
export function TokenPicker({ chain, onCustom }: { chain: TokenChain; onCustom: (pasted?: string) => void }) {
  useChainSettings();
  const coins = useCoins();
  const items = itemsFor(chain);
  const held = (id: string) => (chain === 'eth' ? coins.tokens.some((t) => t.contract.toLowerCase() === id.toLowerCase()) : chain === 'lyx' ? false : coins.xTokens[chain].some((t) => t.id === id));
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map((i) => [i.id, held(i.id)])));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const t = q.trim().toLowerCase();
  const shown = items.filter((i) => !t || `${i.name} ${i.symbol}`.toLowerCase().split(/\s+/).some((w) => w.startsWith(t)));
  const changed = items.some((i) => !!on[i.id] !== held(i.id));

  const search = (v: string) => {
    if (guessChain(v)) return onCustom(v.trim());
    setQ(v);
  };
  const save = async () => {
    setBusy(true);
    try {
      for (const i of items) {
        const want = !!on[i.id];
        if (want === held(i.id)) continue;
        if (want) await (await lookupFor(chain, i.id)).save();
        else if (chain === 'eth') await removeToken({ chainId: ETH_NETS[activeNets().eth].chainId, contract: i.id, symbol: i.symbol, decimals: i.decimals });
        else if (chain === 'sol' || chain === 'trx') await removeWatchedX({ chain, net: String(activeNets()[chain]), id: i.id, symbol: i.symbol, name: i.name, decimals: i.decimals });
      }
      success();
      toast('Tokens saved', 'receive');
      router.back();
    } catch (e) {
      toast((e as Error).message || "Couldn't save just now", 'info');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Add token">
      <View style={{ alignItems: 'center', marginTop: -6 }}>
        <T v="caption" dim>{`on ${CHAIN_NAME[chain]} · ${netLabel(chain)}`}</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 18, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)' }}>
        <Icon name="search" size={16} color={C.faint} width={2} />
        <Field value={q} onChangeText={search} placeholder="Search tokens or paste a contract" autoCapitalize="none" autoCorrect={false} style={{ flex: 1, backgroundColor: 'transparent', paddingHorizontal: 0, fontSize: 15 }} />
      </View>
      <Press onPress={() => onCustom()} accessibilityLabel="Add a custom token" scaleTo={0.985} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, height: 60, paddingHorizontal: 14, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)' }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" size={16} color={C.text} width={2} />
        </View>
        <T style={{ fontFamily: F.medium, fontSize: 16 }}>Add a custom token</T>
      </Press>
      <View style={{ borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 16, paddingVertical: 4 }}>
        {shown.length ? shown.map((i, k) => {
          const lg = logoFor(i.symbol);
          const is = !!on[i.id];
          return (
            <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 64, borderTopWidth: k ? 0.5 : 0, borderTopColor: 'rgba(255,255,255,0.08)' }}>
              {lg ? <Logo id={lg} size={40} grey={!is} /> : <TokenLogo symbol={i.symbol} seed={i.id} size={40} />}
              <View style={{ flex: 1 }}>
                <T style={{ fontFamily: F.medium, fontSize: 16.5 }} numberOfLines={1}>{i.name} <T style={{ fontSize: 12, color: C.faint }}>{i.symbol}</T></T>
              </View>
              <Switch on={is} label={`${i.name} on ${CHAIN_NAME[chain]}`} onChange={(v) => setOn((s) => ({ ...s, [i.id]: v }))} />
            </View>
          );
        }) : <T v="sub" dim style={{ paddingVertical: 26, textAlign: 'center' }}>{items.length ? 'No token with that name' : `No popular tokens listed for ${CHAIN_NAME[chain]} yet. Add one with its contract.`}</T>}
      </View>
      <Button title="Save" onPress={save} busy={busy} disabled={!changed} />
    </Screen>
  );
}
