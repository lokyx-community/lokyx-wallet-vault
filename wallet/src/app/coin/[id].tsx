import { useEffect, useState } from 'react';
import { Linking, ScrollView, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, Keyframe } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Icon, type IconName } from '../../ui/Icon';
import { Press, IconButton, success } from '../../ui/controls';
import { kindFor, type CardData } from '../../ui/WalletCards';
import { NeonCard, type NeonData } from '../../ui/NeonCard';
import { TokenLogo } from '../../ui/CoinLogo';
import { Logo } from '../../ui/Logo';
import type { LogoId } from '../../ui/logos';
import { ActivityRow, PendingRow } from '../../ui/ActivityRow';
import { C, F } from '../../ui/theme';
import { usePoll, faucetUrl, type History } from '../../lib/rpc';
import { useAccountRef, useWallet } from '../../lib/wallet';
import { formatUnits, tokenBalance, usePending, useTokens, type Token } from '../../lib/data';
import { useContractsOn } from '../../lib/chain';
import { openPayment } from '../xtx';
import { btcItems, ethItems } from '../../lib/feed-core';
import { activeNets, btcHistory, ethHistory, removeToken, useAsync } from '../../lib/multichain';
import { ETH_NETS, KNOWN_TOKENS, formatBtc, tokenId } from '../../lib/multichain-core';
import { shortAddr, niceLyx, timeAgo } from '../../lib/format';
import { toast } from '../../ui/Toast';
import { useCoins, type CoinId } from '../../lib/coins';
import { DUR, EASE_OUT } from '../../ui/motion';

function Action({ icon, label, onPress, solid }: { icon: IconName; label: string; onPress: () => void; solid?: boolean }) {
  return (
    <Press onPress={onPress} accessibilityLabel={label} scaleTo={0.94} style={{ alignItems: 'center', gap: 8, flex: 1 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: solid ? C.ink : 'rgba(255,255,255,0.07)', borderWidth: solid ? 0 : 0.5, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} color={solid ? C.inkText : C.text} width={2} />
      </View>
      <T style={{ fontFamily: F.medium, fontSize: 12.5, color: C.soft }}>{label}</T>
    </Press>
  );
}

const Panel = ({ children }: { children: React.ReactNode }) => (
  <View style={{ borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 16, overflow: 'hidden' }}>{children}</View>
);

function Row({ icon, title, sub, onPress }: { icon: IconName; title: string; sub?: string; onPress: () => void }) {
  return (
    <Press haptic={false} scaleTo={0.985} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={C.text} width={1.9} />
      </View>
      <View style={{ flex: 1 }}>
        <T style={{ fontFamily: F.medium, fontSize: 15.5 }}>{title}</T>
        {sub ? <T v="caption" dim>{sub}</T> : null}
      </View>
      <Icon name="chevron" size={14} color={C.faint} width={2.2} />
    </Press>
  );
}

function LyxToken({ t, owner, hide }: { t: Token; owner: string; hide: boolean }) {
  const [bal, setBal] = useState<bigint>();
  useEffect(() => {
    let live = true;
    const f = () => tokenBalance(t, owner).then((b) => live && setBal(b)).catch(() => {});
    f();
    const i = setInterval(f, 10000);
    return () => { live = false; clearInterval(i); };
  }, [t, owner]);
  return (
    <Press haptic={false} scaleTo={0.985} onPress={() => router.push(`/token/${t.address}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 }}>
      <TokenLogo symbol={t.symbol} seed={t.address} size={34} />
      <View style={{ flex: 1 }}>
        <T style={{ fontFamily: F.medium, fontSize: 15.5 }}>{t.name}</T>
        <T v="caption" dim>{t.symbol}</T>
      </View>
      <T style={{ fontFamily: F.medium, fontSize: 15.5, fontVariant: ['tabular-nums'] }}>{hide ? '•••' : bal === undefined ? '' : formatUnits(bal, t.decimals)}</T>
    </Press>
  );
}

/** One coin on its own screen: its card at the top, the four things you do with it, then what happened. */
// The card arrives from where it was on Home: slightly smaller and higher, then settles into place.
const CARD_IN = new Keyframe({
  0: { opacity: 0.4, transform: [{ translateY: -46 }, { scale: 0.9 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }], easing: EASE_OUT },
});

export default function CoinScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isToken = /^0x[0-9a-fA-F]{40}$/.test(id ?? '');
  const coin: CoinId = isToken || id === 'eth' ? 'eth' : id === 'btc' ? 'btc' : 'lyx';
  const insets = useSafeAreaInsets();
  const { width: sw } = useWindowDimensions();
  const cw = Math.min(sw - 32, 420);
  const me = useAccountRef();
  const address = me?.address ?? '';
  const hide = useWallet().settings.hideBalance;
  const coins = useCoins();
  const tok = isToken ? coins.tokens.find((t) => t.contract.toLowerCase() === id.toLowerCase()) : undefined;
  const ethNet = ETH_NETS[activeNets().eth];
  const onList = tok ? KNOWN_TOKENS.some((k) => tokenId(k) === tokenId({ chainId: ethNet.chainId, contract: tok.contract })) : false;
  // a token wears its own card: its name, its mark, its colour. Ether stays on the Ethereum card.
  const card: CardData = tok
    ? { kind: kindFor(tok.logo), logo: tok.logo ?? undefined, title: tok.name, sub: `${tok.symbol} on ${ethNet.label}`, unit: tok.symbol, balance: tok.balance, address: coins.eth.address, tag: ethNet.real ? '' : 'Test network' }
    : coins[coin];
  // the card it was on Home, with the coin's own mark
  const neon: NeonData = {
    rim: tok ? (tok.logo === 'usdc' || tok.logo === 'usdt' ? tok.logo : 'gr') : coin === 'eth' ? card.kind : coin,
    title: card.title,
    sub: card.sub,
    balance: card.balance,
    unit: card.unit,
    note: card.tag && card.tag !== 'Tap to open' ? 'Testnet · no market value' : coin === 'lyx' ? 'Testnet · no market value' : '',
    mark: coin === 'lyx' ? { kind: 'lyx' } : tok && !tok.logo ? { kind: 'token', symbol: tok.symbol, seed: tok.contract } : { kind: 'logo', id: (tok?.logo ?? (coin === 'btc' ? 'btc' : (coins.eth.logo as LogoId))) as LogoId },
  };
  const hist = usePoll<History>('lyx_getAddressHistory', coin === 'lyx' && address ? { address, limit: 20 } : null, 8000);
  const pend = usePending();
  const contractsOn = useContractsOn();
  const tokens = useTokens();
  const nets = activeNets();
  const btcH = useAsync(async () => (coin === 'btc' && coins.btc.address ? btcHistory(nets.btc, coins.btc.address) : []), [coin, coins.btc.address, nets.btc], 30_000);

  const ethH = useAsync(
    async () => (coin === 'eth' && coins.eth.address ? ethHistory(nets.eth, coins.eth.address, tok ? { chainId: ethNet.chainId, contract: tok.contract, symbol: tok.symbol, decimals: tok.decimals } : undefined) : []),
    [coin, coins.eth.address, nets.eth, tok?.contract],
    30_000,
  );

  const receive = () => {
    if (!card.address) return toast(coins.addressError || 'Your address is still being made', 'info');
    router.push(coin === 'lyx' ? '/ring' : tok ? `/receive?coin=eth&token=${tok.contract}` : `/receive?coin=${coin}`);
  };
  const send = () => router.push(coin === 'lyx' ? '/send' : tok ? `/chain/send?chain=eth&token=${tok.contract}` : `/chain/send?chain=${coin}`);
  const copyContract = async () => {
    if (!tok) return;
    await Clipboard.setStringAsync(tok.contract);
    success();
    toast('Contract copied', 'copy');
  };
  const remove = async () => {
    if (!tok) return;
    await removeToken({ chainId: ethNet.chainId, contract: tok.contract, symbol: tok.symbol, decimals: tok.decimals });
    toast(`${tok.symbol} is hidden. Coins stay at your address.`, 'info');
    router.back();
  };
  const explorer = ethNet.explorer;
  const faucet = async () => {
    try {
      const r = await fetch(`${faucetUrl()}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return toast(j.error ?? j.message ?? (typeof j === 'string' ? j : 'The faucet said no'), 'info');
      toast(`${j.amountLyx ?? 'Test'} LYX on the way`, 'drop');
    } catch {
      toast("Can't reach the faucet", 'info');
    }
  };
  const items = hist.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 48, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 52 }}>
          <IconButton name="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <T style={{ flex: 1, textAlign: 'center', fontFamily: F.semibold, fontSize: 17, marginRight: 52 }} numberOfLines={1}>{card.title}</T>
        </View>

        <Animated.View entering={CARD_IN.duration(520)} style={{ marginTop: 10 }}>
          <NeonCard c={neon} width={cw} hide={hide} />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(70).duration(DUR.slow).easing(EASE_OUT)} style={{ flexDirection: 'row', paddingTop: 24 }}>
          <Action icon="receive" label="Receive" solid onPress={receive} />
          <Action icon="send" label="Send" onPress={send} />
          {!tok && <Action icon="swap" label="Swap" onPress={() => router.push('/swap')} />}
          {coin === 'lyx' ? <Action icon="drop" label="Test LYX" onPress={faucet} /> : null}
        </Animated.View>

        <View style={{ marginTop: 22, gap: 10 }}>
          {coin === 'lyx' && (
            <Panel>
              <Row icon="lock" title="Vault" sub="A daily allowance, a delay on big sends" onPress={() => router.push('/vault')} />
            </Panel>
          )}
          {tok && (
            <Panel>
              <Row icon="copy" title="Token contract" sub={`${tok.contract.slice(0, 10)}…${tok.contract.slice(-8)}`} onPress={copyContract} />
              <Row icon="shield" title={onList ? 'On the token list' : 'Added by contract'} sub={onList ? 'The real contract, checked by the app' : 'You added this one yourself'} onPress={copyContract} />
              <Row icon="trash" title={`Hide ${tok.symbol}`} sub="Removes it from Home. The coins stay yours." onPress={remove} />
            </Panel>
          )}
          {coin === 'eth' && !tok && (
            <Panel>
              <Row icon="lock" title="Vault protection" sub="Experimental · test ETH only" onPress={() => router.push('/ethvault')} />
              <Row icon="plus" title="Add a token" sub="Paste a contract address" onPress={() => router.push('/coins')} />
            </Panel>
          )}
          {coin === 'lyx' && contractsOn && tokens.length > 0 && (
            <Panel>
              {tokens.map((t) => <LyxToken key={t.address} t={t} owner={address} hide={hide} />)}
            </Panel>
          )}
        </View>

        <T style={{ fontFamily: F.semibold, fontSize: 12, letterSpacing: 1.6, color: C.sub, paddingTop: 26, paddingBottom: 10, paddingHorizontal: 6 }}>ACTIVITY</T>
        <Panel>
          {coin === 'lyx' && (
            <>
              {pend.map((p) => <PendingRow key={p.hash} p={p} hide={hide} />)}
              {items.map((it, i) => <ActivityRow key={`${it.txHash ?? it.blockHash}${it.kind}`} item={it} i={i} hide={hide} />)}
              {hist.data && items.length === 0 && pend.length === 0 && <T v="sub" dim style={{ paddingVertical: 20, textAlign: 'center' }}>No payments yet. Tap Receive to get started.</T>}
            </>
          )}
          {coin === 'btc' &&
            (btcH.data && btcH.data.length > 0 ? (
              btcH.data.slice(0, 12).map((t) => (
                <Press key={t.txid} haptic={false} scaleTo={0.985} onPress={() => openPayment(btcItems(nets.btc, [t])[0])} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 12 }}>
                  <View style={{ flex: 1, gap: 1 }}>
                    <T style={{ fontFamily: F.medium, fontSize: 15.5 }}>{t.delta >= 0n ? 'Received' : 'Sent'}</T>
                    <T v="caption" dim>{`${t.confirmed ? 'Confirmed' : 'Waiting for a block'} · ${shortAddr(t.txid, 8, 6)}`}</T>
                  </View>
                  <T style={{ fontFamily: F.medium, fontSize: 15.5, fontVariant: ['tabular-nums'] }}>{hide ? '•••' : `${t.delta >= 0n ? '+' : '−'}${formatBtc(t.delta < 0n ? -t.delta : t.delta)}`}</T>
                </Press>
              ))
            ) : (
              <T v="sub" dim style={{ paddingVertical: 20, textAlign: 'center' }}>{btcH.error ? "Can't reach the Bitcoin network" : 'No payments yet'}</T>
            ))}
          {coin === 'eth' && (
            <>
              {ethH.data && ethH.data.length > 0 ? (
                ethH.data.slice(0, 12).map((t) => {
                  const n = t.delta < 0n ? -t.delta : t.delta;
                  return (
                    <Press key={t.hash} haptic={false} scaleTo={0.985} onPress={() => openPayment(ethItems(nets.eth, [t])[0])} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 12 }}>
                      <View style={{ flex: 1, gap: 1 }}>
                        <T style={{ fontFamily: F.medium, fontSize: 15.5 }}>{t.failed ? 'Failed' : t.delta === 0n ? 'To yourself' : t.delta > 0n ? 'Received' : 'Sent'}</T>
                        <T v="caption" dim>{`${t.time ? timeAgo(t.time) : 'Just now'} · ${shortAddr(t.hash, 8, 6)}`}</T>
                      </View>
                      <T style={{ fontFamily: F.medium, fontSize: 15.5, fontVariant: ['tabular-nums'] }}>{hide ? '•••' : `${t.delta > 0n ? '+' : t.delta < 0n ? '−' : ''}${formatUnits(n, t.decimals, 6)}`}</T>
                    </Press>
                  );
                })
              ) : (
                <T v="sub" dim style={{ paddingTop: 20, paddingBottom: 8, textAlign: 'center' }}>{ethH.error ? "Can't reach the explorer right now" : ethH.data ? 'No payments yet' : 'Loading…'}</T>
              )}
              <Press haptic={false} onPress={() => Linking.openURL(tok ? `${explorer}/token/${tok.contract}?a=${coins.eth.address}` : `${explorer}/address/${coins.eth.address}`)} style={{ paddingVertical: 14, alignItems: 'center' }}>
                <T style={{ fontFamily: F.semibold, fontSize: 14.5 }}>Open Etherscan</T>
              </Press>
            </>
          )}
        </Panel>
      </ScrollView>
    </View>
  );
}
