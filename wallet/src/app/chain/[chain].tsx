import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { T } from '../../ui/Text';
import { Button, Group, Note, Row, Screen, Press, success } from '../../ui/controls';
import { Qr } from '../../ui/Qr';
import { ChainRing } from '../../ui/ChainRing';
import { Segmented } from '../../ui/Segmented';
import { chainToSun } from '../../lib/chain-sun';
import { C, F } from '../../ui/theme';
import { CoinLogo } from '../../ui/CoinLogo';
import { ensureAddresses, btcBalance, btcHistory, ethBalance, tokenBalance, tokensFor, useAsync, useChainSettings, activeNets } from '../../lib/multichain';
import { BTC_NETS, ETH_NETS, formatBtc, formatUnits } from '../../lib/multichain-core';
import { shortAddr } from '../../lib/format';

/** One chain: its address with a QR code, balance, history, and Send. */
export default function Chain() {
  const { chain } = useLocalSearchParams<{ chain: 'btc' | 'eth' }>();
  useChainSettings();
  const nets = activeNets();
  const isBtc = chain === 'btc';
  const a = useAsync(() => ensureAddresses(), []);
  const addr = a.data ? (isBtc ? a.data.btc[nets.btc] : a.data.eth) : '';
  const meta = isBtc ? BTC_NETS[nets.btc] : ETH_NETS[nets.eth];
  const bal = useAsync(async () => {
    if (!addr) return null;
    if (isBtc) return { main: (await btcBalance(nets.btc, addr)).confirmed, tokens: [] as { symbol: string; contract: string; v: string }[] };
    const main = await ethBalance(nets.eth, addr);
    const tokens = await Promise.all(tokensFor(nets.eth).map(async (t) => ({ symbol: t.symbol, contract: t.contract, v: formatUnits(await tokenBalance(nets.eth, t, addr), t.decimals) })));
    return { main, tokens };
  }, [addr, chain], 20_000);
  const hist = useAsync(async () => (isBtc && addr ? btcHistory(nets.btc, addr) : []), [addr, chain], 30_000);
  const [view, setView] = useState<'ring' | 'qr'>('ring');
  const ringable = !!addr && !!chainToSun(isBtc ? 'btc' : 'eth', addr);
  const copy = async () => {
    await Clipboard.setStringAsync(addr);
    success();
  };

  const shown = bal.data ? (isBtc ? formatBtc(bal.data.main) : formatUnits(bal.data.main, 18, 6)) : '…';
  return (
    <Screen title={meta.label}>
      <View style={{ alignItems: 'center', gap: 6, paddingTop: 4 }}>
        <CoinLogo chain={isBtc ? 'btc' : 'eth'} size={56} />
        <T style={{ fontFamily: F.regular, fontSize: shown.length > 9 ? 40 : 52, letterSpacing: -2, lineHeight: 60 }}>{shown}</T>
        <T v="sub" dim>{`${meta.unit} · ${meta.real ? 'Real money' : 'Test network, no value'}`}</T>
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Button title="Send" disabled={!addr} onPress={() => router.push(`/chain/send?chain=${chain}`)} /></View>
        <View style={{ flex: 1 }}><Button title="Receive" kind="line" disabled={!addr} onPress={() => router.push(`/receive?coin=${chain}`)} /></View>
      </View>
      {bal.data && bal.data.tokens.length > 0 && (
        <Group title="Tokens">
          {bal.data.tokens.map((t) => (
            <Row key={t.contract} title={t.symbol} sub={shortAddr(t.contract, 8, 6)} detail={t.v} onPress={() => router.push(`/chain/send?chain=eth&token=${t.contract}`)} />
          ))}
        </Group>
      )}
      {bal.error ? <Note>{bal.error}</Note> : null}
      {addr ? (
        <View style={{ backgroundColor: C.fill, borderRadius: 26, padding: 18, alignItems: 'center', gap: 14 }}>
          {ringable && view === 'ring' ? (
            <ChainRing chain={isBtc ? 'btc' : 'eth'} address={addr} size={240} />
          ) : (
            <View style={{ padding: 10, backgroundColor: '#fff', borderRadius: 18 }}>
              <Qr value={isBtc ? `bitcoin:${addr}` : addr} />
            </View>
          )}
          {ringable && (
            <View style={{ alignSelf: 'stretch' }}>
              <Segmented<'ring' | 'qr'> value={view} onChange={setView} options={[['ring', 'Ring'], ['qr', 'QR for other wallets']]} />
            </View>
          )}
          <Press onPress={copy}>
            <T v="mono" color={C.soft} selectable style={{ textAlign: 'center', fontSize: 13 }}>{addr}</T>
          </Press>
          <T v="caption" dim style={{ textAlign: 'center', lineHeight: 18 }}>{`Made from your 24 words, so the same words bring it back. ${view === 'ring' && ringable ? 'The LOKYX wallet reads the ring; other wallets need the QR.' : ''} Tap the address to copy it.`}</T>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Note>{a.error ? 'Your address needs your fingerprint, face or passcode once. Then it is remembered.' : 'Preparing your address…'}</Note>
          {a.error ? <Button title="Try again" onPress={() => a.refresh()} /> : null}
        </View>
      )}
      {!isBtc && <Group>
        <Row icon="plus" title="Add a token" sub="By its contract address" onPress={() => router.push('/add-token?chain=eth')} />
        <Row icon="shield" title="Vault protection" sub="Experimental" onPress={() => router.push('/ethvault')} />
      </Group>}
      {isBtc && hist.data && hist.data.length > 0 && (
        <Group title="Recent">
          {hist.data.slice(0, 8).map((t) => (
            <Row key={t.txid} title={t.delta >= 0n ? 'Received' : 'Sent'} sub={`${t.confirmed ? 'Confirmed' : 'Waiting for a block'} · ${shortAddr(t.txid, 8, 6)}`} detail={`${t.delta >= 0n ? '+' : ''}${formatBtc(t.delta < 0n ? -t.delta : t.delta)}`} />
          ))}
        </Group>
      )}
    </Screen>
  );
}
