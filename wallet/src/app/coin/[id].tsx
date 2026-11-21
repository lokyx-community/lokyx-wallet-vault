import { Aurora } from '../../ui/Aurora';
import { useEffect, useState } from 'react';
import { Linking, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
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
import { LiftCard } from '../../ui/LiftCard';
import { PriceGraph } from '../../ui/PriceGraph';
import { AboutCard, KvPanel, LinkChips, MarketBlock, NoMarket, SafetyList, SectionHead } from '../../ui/CoinSections';
import { useCoinInfo } from '../../lib/coininfo';
import { aboutFrom, factsFor } from '../../lib/coinfacts';
import { CoinLogo } from '../../ui/CoinLogo';
import { useCurrency, usePortfolio } from '../../lib/prices';
import { PRICED, money } from '../../lib/prices-core';

function Action({ icon: _i, label, onPress }: { icon: IconName; label: string; onPress: () => void; solid?: boolean }) {
  return (
    <Press onPress={onPress} accessibilityLabel={label} scaleTo={0.95} style={{ flex: 1, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)' }}>
      <T style={{ fontFamily: F.medium, fontSize: 14, color: C.text }}>{label}</T>
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
  const [cur] = useCurrency();
  const { p: port } = usePortfolio(coins);
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
    note: (() => { const l = port?.lines.find((x) => x.symbol === (tok ? tok.symbol.toUpperCase() : card.unit.toUpperCase())); return l ? `${money(l.value, cur)} · ${l.pct >= 0 ? '+' : '−'}${Math.abs(l.pct).toFixed(1)}%` : ''; })() || (card.tag && card.tag !== 'Tap to open' ? 'Testnet · no market value' : coin === 'lyx' ? 'Testnet · no market value' : ''),
    mark: coin === 'lyx' ? { kind: 'lyx' } : tok && !tok.logo ? { kind: 'token', symbol: tok.symbol, seed: tok.contract } : { kind: 'logo', id: (tok?.logo ?? (coin === 'btc' ? 'btc' : (coins.eth.logo as LogoId))) as LogoId },
  };
  // the market id for the graph; LOKYX and unlisted tokens have none
  const marketId = tok ? PRICED[tok.symbol.toUpperCase()]?.id : coin === 'btc' ? 'bitcoin' : coin === 'eth' ? PRICED[card.unit.toUpperCase()]?.id ?? 'ethereum' : undefined;
  const { info } = useCoinInfo(marketId, cur);
  const ab = aboutFrom(info, factsFor(coin === 'lyx' ? 'lyx' : marketId));
  const priced = port?.lines.find((x) => x.symbol === (tok ? tok.symbol.toUpperCase() : card.unit.toUpperCase()));
  // true only on a real-money network; every test coin says so plainly
  const real = coin === 'lyx' ? false : coin === 'btc' && !tok ? !coins.btc.tag : ethNet.real;
  const sy = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { sy.value = e.contentOffset.y; });
  const titleFade = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(1, 1 - (sy.value - 150) / 40)) }));
  const miniFade = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(1, (sy.value - 190) / 50)), transform: [{ translateY: 6 * (1 - Math.max(0, Math.min(1, (sy.value - 190) / 50))) }] }));
  const barFade = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(0.94, (sy.value - 110) / 90)) }));
  const copyAddr = async () => {
    if (!card.address) return;
    await Clipboard.setStringAsync(card.address);
    success();
    toast('Address copied', 'copy');
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
    router.push(tok ? `/receive?coin=eth&token=${tok.contract}` : `/receive?coin=${coin}`);
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
      <Aurora />
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingTop: insets.top + 68, paddingBottom: insets.bottom + 48, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        <View style={{ marginTop: 10 }}>
          <LiftCard c={neon} width={cw} hide={hide} />
        </View>

        <Animated.View entering={FadeInDown.delay(110).duration(DUR.slow).easing(EASE_OUT)} style={{ flexDirection: 'row', gap: 8, paddingTop: 18 }}>
          <Action icon="send" label="Send" onPress={send} />
          <Action icon="receive" label="Receive" onPress={receive} />
          <Action icon="scan" label="Scan" onPress={() => router.push('/ring?mode=scan')} />
          {!tok && <Action icon="swap" label="Swap" onPress={() => router.push('/swap')} />}
          {coin === 'lyx' ? <Action icon="drop" label="Test LYX" onPress={faucet} /> : null}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(40).duration(DUR.slow).easing(EASE_OUT)} style={{ marginTop: 18 }}>
          {marketId ? (
            <PriceGraph coinId={marketId} cur={cur} width={cw - 8} />
          ) : (
            <NoMarket text={coin === 'lyx' ? 'LOKYX is a test coin for now, so it has no market price.' : 'The price feed does not list this token, so there is no market price to show.'} />
          )}
        </Animated.View>

        <SectionHead title={`YOUR ${card.title.toUpperCase()}`} />
        <KvPanel
          rows={[
            { k: 'Balance', v: hide ? '••••' : `${card.balance || '0'} ${card.unit}` },
            ...(priced && !hide ? [{ k: 'Value', v: money(priced.value, cur) }] : []),
            { k: 'Network', v: tok ? ethNet.label : card.sub || card.title },
            ...(card.address ? [{ k: 'Address', v: shortAddr(card.address, 6, 4), onPress: copyAddr, icon: 'copy' as const }] : []),
            ...(tok ? [{ k: 'Contract', v: shortAddr(tok.contract, 6, 4), onPress: copyContract, icon: 'copy' as const }] : []),
          ]}
        />

        <View style={{ marginTop: 10, gap: 10 }}>
          {tok && (
            <Panel>
              <Row icon="trash" title={`Hide ${tok.symbol}`} sub="Removes it from Home. The coins stay yours." onPress={remove} />
            </Panel>
          )}
          {coin === 'lyx' && contractsOn && tokens.length > 0 && (
            <Panel>
              {tokens.map((t) => <LyxToken key={t.address} t={t} owner={address} hide={hide} />)}
            </Panel>
          )}
        </View>

        {!tok && (coin === 'eth' || (coin === 'lyx' && contractsOn)) ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 26, paddingBottom: 10, paddingHorizontal: 6 }}>
              <T style={{ fontFamily: F.semibold, fontSize: 12, letterSpacing: 1.6, color: C.sub }}>TOKENS</T>
              <Press onPress={() => router.push(`/add-token?chain=${coin}`)} accessibilityLabel="Add token" scaleTo={0.95} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: C.ink }}>
                <Icon name="plus" size={14} color={C.inkText} width={2.4} />
                <T style={{ fontFamily: F.semibold, fontSize: 13, color: C.inkText }}>Add token</T>
              </Press>
            </View>
            {coin === 'eth' ? (
              <Panel>
                {coins.tokens.length ? coins.tokens.map((t) => (
                  <Press key={t.contract} haptic={false} scaleTo={0.985} onPress={() => router.push(`/coin/${t.contract}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 }}>
                    {t.logo ? <Logo id={t.logo as LogoId} size={34} /> : <TokenLogo symbol={t.symbol} seed={t.contract} size={34} />}
                    <View style={{ flex: 1 }}>
                      <T style={{ fontFamily: F.medium, fontSize: 15.5 }}>{t.name}</T>
                      <T v="caption" dim>{t.symbol}</T>
                    </View>
                    <T style={{ fontFamily: F.medium, fontSize: 15.5, fontVariant: ['tabular-nums'] }}>{hide ? '•••' : t.balance}</T>
                  </Press>
                )) : <T v="sub" dim style={{ paddingVertical: 18, textAlign: 'center' }}>No tokens yet. Add USDC, USDT or paste a contract.</T>}
              </Panel>
            ) : null}
          </>
        ) : null}

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

        {ab.about || marketId ? <SectionHead title={`ABOUT ${card.title.toUpperCase()}`} /> : null}
        {ab.about ? <AboutCard text={ab.about} /> : marketId ? <NoMarket text="Needs a connection to load. It shows here once you are online." /> : null}

        {info ? <SectionHead title="MARKET" /> : null}
        {info ? <MarketBlock info={info} cur={cur} /> : null}

        <SectionHead title="SAFETY" />
        <SafetyList
          lines={[
            coin === 'lyx'
              ? { title: 'The LOKYX test network', text: 'Test coins. They carry no money value, so nothing real is at risk.' }
              : real
                ? { title: `The real ${tok ? 'Ethereum' : card.title} network`, text: 'Sends go straight to the main network, nothing in between.' }
                : { title: 'A test network', text: 'Coins here have no money value. A good place to try things.' },
            { title: 'Your keys stay on this phone', text: 'LOKYX never sees your 24 words or your keys.' },
            { title: 'The address is checked before every send', text: 'A wrong chain or a look-alike address is stopped first.' },
            ...(tok ? [{ title: onList ? 'On the checked token list' : 'Added by contract', text: onList ? 'The real contract, checked by the app.' : 'You added this one yourself. Check the contract before you send a lot.', onPress: copyContract }] : []),
            ...(coin === 'lyx' ? [{ title: 'Vault', text: 'A daily allowance and a delay on big sends.', onPress: () => router.push('/vault') }] : []),
            ...(coin === 'eth' && !tok ? [{ title: 'Vault protection', text: 'Experimental, test ETH only.', onPress: () => router.push('/ethvault') }] : []),
          ]}
        />

        {ab.links.length ? <SectionHead title="LINKS" /> : null}
        <LinkChips links={ab.links} />
      </Animated.ScrollView>

      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: insets.top + 8, paddingHorizontal: 16, height: insets.top + 60 }}>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.bg }, barFade]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 52 }}>
          <IconButton name="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <View style={{ flex: 1, height: 44, justifyContent: 'center' }}>
            <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }, titleFade]}>
              <T style={{ fontFamily: F.semibold, fontSize: 17 }} numberOfLines={1}>{card.title}</T>
            </Animated.View>
            <Animated.View pointerEvents="none" style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingLeft: 6, paddingRight: 14, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.16)' }, miniFade]}>
              {neon.mark.kind === 'lyx' ? <CoinLogo chain="lyx" size={28} /> : neon.mark.kind === 'logo' ? <Logo id={neon.mark.id} size={28} /> : <TokenLogo symbol={neon.mark.symbol} seed={neon.mark.seed} size={28} />}
              <T style={{ fontFamily: F.medium, fontSize: 14.5, flex: 1 }} numberOfLines={1}>{hide ? '••••' : `${card.balance || '0'} ${card.unit}`}</T>
              {priced && !hide ? <T style={{ fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] }}>{money(priced.value, cur)}</T> : null}
            </Animated.View>
          </View>
          <View style={{ width: 40 }} />
        </View>
      </View>
    </View>
  );
}
