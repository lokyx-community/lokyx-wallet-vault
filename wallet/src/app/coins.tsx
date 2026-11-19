import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { T } from '../ui/Text';
import { Icon } from '../ui/Icon';
import { Press, Screen } from '../ui/controls';
import { Logo, logoFor } from '../ui/Logo';
import { CoinLogo, TokenLogo } from '../ui/CoinLogo';
import { C, F } from '../ui/theme';
import { activeNets, tokensFor, useTokensStore } from '../lib/multichain';
import { ETH_NETS, searchKnown, type EthToken } from '../lib/multichain-core';
import { useWatchedX } from '../lib/xchains';
import { useCoins } from '../lib/coins';
import { guessChain, CHAIN_NAME } from '../lib/add-token-core';
import { searchChains } from '../lib/blockchains-core';
import { ChainMark } from './blockchains';

const Box = ({ children }: { children: React.ReactNode }) => (
  <View style={{ borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>{children}</View>
);
const Head = ({ children }: { children: string }) => <T style={{ fontFamily: F.medium, fontSize: 13, color: C.faint, paddingHorizontal: 6, paddingTop: 4 }}>{children}</T>;

function Row({ mark, title, sub, right, onPress, first }: { mark: React.ReactNode; title: string; sub: string; right?: React.ReactNode; onPress?: () => void; first?: boolean }) {
  return (
    <Press onPress={onPress} disabled={!onPress} haptic={false} scaleTo={0.99} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11, paddingHorizontal: 16, borderTopWidth: first ? 0 : 0.5, borderColor: 'rgba(255,255,255,0.07)' }}>
      {mark}
      <View style={{ flex: 1 }}>
        <T style={{ fontFamily: F.medium, fontSize: 15.5 }}>{title}</T>
        <T v="caption" dim numberOfLines={1}>{sub}</T>
      </View>
      {right}
    </Press>
  );
}
const Tick = () => <Icon name="check" size={17} color={C.good} width={2.4} />;
const More = () => <Icon name="chevron" size={14} color={C.faint} width={2.2} />;
const Plus = () => (
  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
    <Icon name="plus" size={18} color={C.text} width={1.9} />
  </View>
);
const TokMark = ({ t }: { t: EthToken }) => {
  const l = logoFor(t.symbol);
  return l ? <Logo id={l} size={36} /> : <TokenLogo symbol={t.symbol} seed={t.contract} size={36} />;
};

/** Add: what is already in the wallet, then a token or a blockchain. Typing a name finds a listed token; pasting an address opens the token screen. */
export default function AddCoin() {
  const coins = useCoins();
  useTokensStore();
  const watched = useWatchedX();
  const nets = activeNets();
  const [text, setText] = useState('');
  const q = text.trim();
  const guess = guessChain(q);
  const chainId = ETH_NETS[nets.eth].chainId;
  const held = tokensFor(nets.eth);
  const heldX = watched.filter((x) => (x.chain === 'sol' ? x.net === nets.sol : x.net === nets.trx));
  const found = q && !guess ? searchKnown(chainId, q) : [];
  const chainHits = q && !guess ? searchChains(q).slice(0, 3) : [];
  const empty = !!q && !guess && found.length === 0 && chainHits.length === 0;

  return (
    <Screen title="Add" close back={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderRadius: 24, paddingLeft: 16, paddingRight: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)' }}>
        <Icon name="search" size={18} color={C.sub} width={1.9} />
        <TextInput value={text} onChangeText={setText} placeholder="Search or paste an address" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} selectionColor={C.text} keyboardAppearance="dark" style={{ flex: 1, fontFamily: guess ? F.mono : F.regular, fontSize: guess ? 13.5 : 15.5, color: C.text, height: 48 }} />
        {text ? (
          <Press onPress={() => setText('')} accessibilityLabel="Clear" style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={15} color={C.text} width={2.2} />
          </Press>
        ) : (
          <Press onPress={async () => setText((await Clipboard.getStringAsync()).trim())} style={{ height: 36, paddingHorizontal: 15, borderRadius: 18, backgroundColor: C.ink, justifyContent: 'center' }}>
            <T style={{ fontFamily: F.semibold, fontSize: 13.5, color: C.inkText }}>Paste</T>
          </Press>
        )}
      </View>

      {guess ? (
        <Box>
          <Row first mark={<Plus />} title="Add this token" sub={`${CHAIN_NAME[guess]} address`} right={<More />} onPress={() => router.replace(`/add-token?chain=${guess}&address=${encodeURIComponent(q)}`)} />
        </Box>
      ) : q ? (
        <>
          {found.length > 0 ? (
            <Box>
              {found.map((t, i) => <Row key={t.contract} first={!i} mark={<TokMark t={t} />} title={t.name ?? t.symbol} sub={`${t.symbol} · ${ETH_NETS[nets.eth].label}`} right={<More />} onPress={() => router.replace(`/add-token?chain=eth&address=${t.contract}`)} />)}
            </Box>
          ) : null}
          {chainHits.length > 0 ? (
            <Box>
              {chainHits.map((b, i) => <Row key={b.id} first={!i} mark={<ChainMark b={b} />} title={b.name} sub={b.note} right={<T v="caption" dim>Coming</T>} onPress={() => router.replace('/blockchains')} />)}
            </Box>
          ) : null}
          {empty ? <T v="callout" dim style={{ paddingHorizontal: 6 }}>{`Nothing called "${q}". To add another token, paste its address.`}</T> : null}
        </>
      ) : (
        <>
          <Head>In your wallet</Head>
          <Box>
            <Row first mark={<CoinLogo chain="lyx" size={36} />} title="LOKYX" sub={coins.lyx?.sub ?? 'Main chain'} right={<Tick />} />
            <Row mark={<Logo id="btc" size={36} />} title="Bitcoin" sub={coins.btc.sub ?? ''} right={<Tick />} />
            <Row mark={<Logo id="eth" size={36} />} title="Ethereum" sub={coins.eth.sub ?? ''} right={<Tick />} />
            <Row mark={<Logo id="sol" size={36} />} title="Solana" sub={coins.sol.sub ?? ''} right={<Tick />} />
            <Row mark={<Logo id="trx" size={36} />} title="Tron" sub={coins.trx.sub ?? ''} right={<Tick />} />
            {held.map((t) => <Row key={t.contract} mark={<TokMark t={t} />} title={t.name ?? t.symbol} sub={`${t.symbol} · ${ETH_NETS[nets.eth].label}`} right={<Tick />} />)}
            {heldX.map((t) => <Row key={`${t.chain}${t.id}`} mark={<TokenLogo symbol={t.symbol} seed={t.id} size={36} />} title={t.name} sub={`${t.symbol} · ${CHAIN_NAME[t.chain]}`} right={<Tick />} />)}
          </Box>
          <Head>Add more</Head>
          <Box>
            <Row first mark={<Plus />} title="A token" sub="By its address" right={<More />} onPress={() => router.push('/add-token?chain=eth')} />
            <Row mark={<Plus />} title="A blockchain" sub="Dogecoin, Monero and more" right={<More />} onPress={() => router.push('/blockchains')} />
          </Box>
        </>
      )}
    </Screen>
  );
}
