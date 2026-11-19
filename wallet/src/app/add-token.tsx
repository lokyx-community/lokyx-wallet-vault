import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { T } from '../ui/Text';
import { Button, ErrorText, Field, Press, Screen, success } from '../ui/controls';
import { CoinLogo } from '../ui/CoinLogo';
import { Logo } from '../ui/Logo';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { ContractsOnly } from '../ui/ContractsOnly';
import { WalletCard } from '../ui/WalletCards';
import { toast } from '../ui/Toast';
import { C, F } from '../ui/theme';
import { useChainSettings } from '../lib/multichain';
import { plainError } from '../lib/plain-error';
import { CHAIN_NAME, TOKEN_CHAINS, asChain, canAdd, cardKindFor, guessChain, shortId, verdictFor, type TokenChain } from '../lib/add-token-core';
import { lookupFor, netLabel, type Looked } from '../lib/add-token';

const WIDTH = 300;

function Disc({ chain, on, onPress }: { chain: TokenChain; on: boolean; onPress: () => void }) {
  const size = 54;
  return (
    <Press onPress={onPress} accessibilityLabel={CHAIN_NAME[chain]} style={{ opacity: on ? 1 : 0.55, transform: [{ scale: on ? 1.08 : 1 }] }}>
      <View style={{ width: size + 8, height: size + 8, borderRadius: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: on ? '#fff' : 'transparent', shadowColor: '#fff', shadowOpacity: on ? 0.35 : 0, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } }}>
        {chain === 'lyx' ? <CoinLogo chain="lyx" size={size} /> : <Logo id={chain} size={size} />}
      </View>
    </Press>
  );
}

function Body() {
  const { chain: raw, address } = useLocalSearchParams<{ chain?: string; address?: string }>();
  useChainSettings();
  const [chain, setChain] = useState<TokenChain>(asChain(raw));
  const [text, setText] = useState('');
  const [found, setFound] = useState<Looked | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [checked, setChecked] = useState(false);
  const [copied, setCopied] = useState('');
  const run = useRef(0);

  const look = async (v: string, c: TokenChain) => {
    const mine = ++run.current;
    setFound(null); setErr(''); setChecked(false);
    if (!guessChain(v)) return;
    setBusy(true);
    try {
      const r = await lookupFor(c, v);
      if (mine === run.current) setFound(r);
    } catch (e) {
      if (mine === run.current) setErr(plainError(e));
    } finally {
      if (mine === run.current) setBusy(false);
    }
  };
  const change = (v: string) => {
    setText(v);
    const g = guessChain(v);
    const c = g ?? chain;
    if (g && g !== chain) setChain(g);
    look(v, c);
  };
  const pick = (c: TokenChain) => { setChain(c); look(text, c); };

  useEffect(() => {
    if (address) change(String(address));
    Clipboard.getStringAsync().then((s) => { const t = (s ?? '').trim(); if (t && guessChain(t) && t !== address) setCopied(t); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const v = found ? verdictFor(found.known, found.lookalike) : null;
  const ok = canAdd(!!found, found?.known ?? null, checked);
  const add = async () => {
    if (!found || !ok) return;
    await found.save();
    success();
    toast(`${found.symbol} added`, 'receive');
    router.back();
  };

  return (
    <Screen title="Add a token" large>
      <T v="callout" dim>Pick the network, then paste the token's address.</T>
      <View style={{ alignItems: 'center', gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>{TOKEN_CHAINS.map((c) => <Disc key={c} chain={c} on={c === chain} onPress={() => pick(c)} />)}</View>
        <T v="caption" dim>{`${CHAIN_NAME[chain]} · ${netLabel(chain)}`}</T>
      </View>

      <View style={{ alignItems: 'center', minHeight: Math.round(WIDTH / 1.586) }}>
        {found ? (
          <WalletCard c={{ kind: cardKindFor(found.known, found.symbol), logo: undefined, title: found.symbol, sub: found.name, balance: '0', unit: found.symbol, address: found.id, tag: CHAIN_NAME[chain] }} width={WIDTH} />
        ) : busy ? (
          <Skeleton w={WIDTH} h={Math.round(WIDTH / 1.586)} r={26} />
        ) : (
          <View style={{ width: WIDTH, height: Math.round(WIDTH / 1.586), borderRadius: 26, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
            <T v="callout" dim>Your card appears here</T>
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 30, paddingLeft: 20, paddingRight: 8, height: 60, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
        <Field value={text} onChangeText={change} placeholder="Token address" autoCapitalize="none" autoCorrect={false} mono style={{ flex: 1, backgroundColor: 'transparent', paddingHorizontal: 0, fontSize: 14 }} />
        <Press onPress={async () => change((await Clipboard.getStringAsync()).trim())} accessibilityLabel="Paste" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="copy" size={20} color={C.text} width={2} />
        </Press>
      </View>
      {copied && !text ? (
        <Press onPress={() => { change(copied); setCopied(''); }} style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
          <T v="caption" style={{ color: C.text }}>{`Use the address you copied: ${shortId(copied)}`}</T>
        </Press>
      ) : null}
      <ErrorText>{err}</ErrorText>

      {v ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: v.tone === 'good' ? C.good : v.tone === 'bad' ? C.bad : '#F5A524' }} />
            <View style={{ flex: 1 }}>
              <T style={{ fontFamily: F.semibold, fontSize: 15, color: v.tone === 'good' ? C.good : v.tone === 'bad' ? C.bad : '#F5A524' }}>{v.title}</T>
              <T v="caption" dim style={{ lineHeight: 18 }}>{v.text}</T>
            </View>
          </View>
          {v.tone !== 'good' ? (
            <Press onPress={() => setChecked(!checked)} accessibilityLabel="I checked the address" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: checked ? '#fff' : 'rgba(255,255,255,0.3)', backgroundColor: checked ? '#fff' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {checked ? <Icon name="check" size={14} color="#000" width={2.5} /> : null}
              </View>
              <T style={{ fontFamily: F.medium, fontSize: 15 }}>I checked the address</T>
            </Press>
          ) : null}
        </View>
      ) : null}

      <Button title={found ? `Add ${found.symbol}` : 'Add token'} onPress={add} disabled={!ok} />
    </Screen>
  );
}

/** One place to add a token on any network: LOKYX, Ethereum, Solana or Tron. */
export default function AddToken() {
  const { chain } = useLocalSearchParams<{ chain?: string }>();
  return chain === 'lyx' ? <ContractsOnly><Body /></ContractsOnly> : <Body />;
}
