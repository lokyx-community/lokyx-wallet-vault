import { Aurora } from '../../ui/Aurora';
import { useState } from 'react';
import { Linking, ScrollView, Share, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../../ui/Text';
import { Icon, type IconName } from '../../ui/Icon';
import { IconButton, Press, success } from '../../ui/controls';
import Animated, { Keyframe } from 'react-native-reanimated';
import { EASE_OUT } from '../../ui/motion';
import { useLift } from '../../ui/useLift';
import { NeonCard } from '../../ui/NeonCard';
import { PriceGraph } from '../../ui/PriceGraph';
import { useCurrency } from '../../lib/prices';
import { Logo } from '../../ui/Logo';
import { TokenLogo } from '../../ui/CoinLogo';
import { Qr } from '../../ui/Qr';
import { ChainRing } from '../../ui/ChainRing';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/Toast';
import { C, F } from '../../ui/theme';
import { useWallet } from '../../lib/wallet';
import { useCoins, type XCoin } from '../../lib/coins';
import { activeNets, ensureExtraAddresses, useAsync, useChainSettings } from '../../lib/multichain';
import { formatUnits } from '../../lib/multichain-core';
import { SOL_DECIMALS, SOL_NETS } from '../../lib/sol-core';
import { openPayment } from '../xtx';
import { solItems, trxItems } from '../../lib/feed-core';
import { TRON_NETS, TRX_DECIMALS } from '../../lib/tron-core';
import { solAirdrop, solHistory, tronHistory } from '../../lib/xchains';
import { plainError } from '../../lib/plain-error';
import { shortAddr, timeAgo } from '../../lib/format';

function Action({ label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityLabel={label} scaleTo={0.95} style={{ flex: 1, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)' }}>
      <T style={{ fontFamily: F.medium, fontSize: 14, color: C.text }}>{label}</T>
    </Press>
  );
}

const Head = ({ title }: { title: string }) => <T style={{ fontFamily: F.semibold, fontSize: 12, letterSpacing: 1.6, color: C.sub, paddingTop: 26, paddingBottom: 8, paddingHorizontal: 6 }}>{title}</T>;

const CARD_UP = new Keyframe({
  0: { opacity: 0.6, transform: [{ translateY: 150 }, { scale: 1.08 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }], easing: EASE_OUT },
});

/** Solana or Tron on its own screen: the card, send / receive / test coins, its tokens, and what happened. */
export default function XCoinScreen() {
  const lift = useLift();
  const { chain: raw } = useLocalSearchParams<{ chain: string }>();
  const chain: XCoin = raw === 'trx' ? 'trx' : 'sol';
  const insets = useSafeAreaInsets();
  const { width: sw } = useWindowDimensions();
  const cw = Math.min(sw - 32, 420);
  const [cur] = useCurrency();
  const hide = useWallet().settings.hideBalance;
  useChainSettings();
  const nets = activeNets();
  const coins = useCoins();
  const c = coins[chain];
  const isSol = chain === 'sol';
  const netLabel = isSol ? SOL_NETS[nets.sol].label : TRON_NETS[nets.trx].label;
  const real = isSol ? SOL_NETS[nets.sol].real : TRON_NETS[nets.trx].real;
  const [busy, setBusy] = useState(false);
  const [recv, setRecv] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const hist = useAsync(
    async () => (!c.address ? [] : isSol ? (await solHistory(nets.sol, c.address)).map((r) => ({ ...r, other: '' })) : tronHistory(nets.trx, c.address)),
    [c.address, chain, nets.sol, nets.trx],
    30_000,
  );

  const setup = async () => {
    setBusy(true);
    try {
      await ensureExtraAddresses();
      success();
    } catch (e) {
      toast(plainError(e), 'info');
    } finally {
      setBusy(false);
    }
  };
  const faucet = async () => {
    if (!c.address) return;
    if (!isSol) {
      await Clipboard.setStringAsync(c.address);
      toast('Address copied. Paste it on the Nile faucet page.', 'copy');
      Linking.openURL('https://nileex.io/join/getJoinPage').catch(() => {});
      return;
    }
    setBusy(true);
    try {
      await solAirdrop(nets.sol, c.address);
      success();
      toast('1 test SOL is on its way', 'receive');
      setTimeout(() => coins.refresh(), 8000);
    } catch (e) {
      toast(`${plainError(e)} You can also use faucet.solana.com.`, 'info');
    } finally {
      setBusy(false);
    }
  };
  const explorer = (kind: 'tx' | 'address', id: string) =>
    Linking.openURL(isSol ? SOL_NETS[nets.sol].explorer(kind, id) : `${TRON_NETS[nets.trx].explorer}/${kind === 'tx' ? 'transaction' : 'address'}/${id}`).catch(() => {});
  const copy = async () => {
    await Clipboard.setStringAsync(c.address ?? '');
    success();
    toast('Address copied', 'copy');
  };
  const dec = isSol ? SOL_DECIMALS : TRX_DECIMALS;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Aurora />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 52 }}>
          <IconButton name="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <T style={{ flex: 1, textAlign: 'center', fontFamily: F.semibold, fontSize: 17 }}>{c.title}</T>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ alignItems: 'center', paddingTop: 6, zIndex: 2 }}>
          <Animated.View ref={lift.ref} collapsable={false} onLayout={lift.onLayout} entering={lift.lifted ? undefined : CARD_UP.duration(640)} style={lift.style}>
          <NeonCard
            c={{ rim: chain, title: c.title, sub: c.address ? netLabel : 'Not set up yet', balance: c.address ? c.balance : '—', unit: c.unit, note: real ? '' : 'Testnet · no market value', mark: { kind: 'logo', id: chain } }}
            width={cw - 24}
            hide={hide}
          />
          </Animated.View>
        </View>

        {c.address ? (
          <View style={{ paddingTop: 22 }}>
            <PriceGraph coinId={isSol ? 'solana' : 'tron'} cur={cur} width={cw - 8} />
          </View>
        ) : null}

        {!c.address ? (
          <View style={{ paddingTop: 26, gap: 12, paddingHorizontal: 6 }}>
            <T v="sub" dim style={{ lineHeight: 21 }}>{`Your ${c.title} address comes from the same 24 words, so nothing new to write down. The phone asks for your fingerprint once to make it.`}</T>
            <Press onPress={setup} disabled={busy} style={{ height: 52, borderRadius: 26, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ fontFamily: F.semibold, fontSize: 16, color: C.inkText }}>{busy ? 'Making it…' : `Set up ${c.title}`}</T>
            </Press>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 8, paddingTop: 16 }}>
              <Action icon="send" label="Send" onPress={() => router.push(`/xsend?chain=${chain}`)} />
              <Action icon="receive" label="Receive" onPress={() => router.push(`/receive?coin=${chain}`)} />
              {!real ? <Action icon="drop" label={isSol ? 'Test SOL' : 'Test TRX'} onPress={faucet} /> : null}
              <Action icon="link" label="Explorer" onPress={() => explorer('address', c.address!)} />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}><Head title={`TOKENS ON ${c.title.toUpperCase()}`} /></View>
              <Press onPress={() => router.push(`/add-token?chain=${chain}`)} style={{ paddingBottom: 8, paddingHorizontal: 6 }}><T style={{ fontFamily: F.semibold, fontSize: 14, color: C.text }}>+ Add token</T></Press>
            </View>
            {coins.xTokens[chain].length ? (
              coins.xTokens[chain].map((t) => (
                <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, height: 58, paddingHorizontal: 6 }}>
                  {t.logo ? <Logo id={t.logo} size={36} /> : <TokenLogo symbol={t.symbol} seed={t.id} size={36} />}
                  <View style={{ flex: 1 }}>
                    <T style={{ fontFamily: F.medium, fontSize: 15.5 }} numberOfLines={1}>{t.name}</T>
                    <T v="caption" dim>{t.symbol}</T>
                  </View>
                  <T style={{ fontFamily: F.medium, fontSize: 15.5, fontVariant: ['tabular-nums'] }}>{hide ? '•••' : t.balance}</T>
                </View>
              ))
            ) : (
              <T v="caption" dim style={{ paddingHorizontal: 6 }}>{isSol ? 'Tokens you hold on Solana show here.' : 'USDT and other tokens you hold on Tron show here.'}</T>
            )}

            <Head title="ACTIVITY" />
            {(hist.data ?? []).length ? (
              (hist.data ?? []).map((r) => (
                <Press key={r.id} haptic={false} onPress={() => openPayment((isSol ? solItems(nets.sol, [r as never]) : trxItems(nets.trx, [r as never]))[0])} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: C.line }}>
                  <View style={{ flex: 1 }}>
                    <T style={{ fontFamily: F.medium, fontSize: 15.5 }}>{r.failed ? 'Failed' : r.delta >= 0n ? (r.other ? `From ${shortAddr(r.other, 5, 4)}` : 'Received') : r.other ? `To ${shortAddr(r.other, 5, 4)}` : 'Sent'}</T>
                    <T v="caption" dim>{r.time ? timeAgo(r.time) : 'Pending'}</T>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <T style={{ fontFamily: F.medium, fontSize: 15.5, fontVariant: ['tabular-nums'], color: r.failed ? C.sub : r.delta >= 0n ? C.good : C.text }}>
                      {hide ? '•••' : `${r.delta >= 0n ? '+' : '−'}${formatUnits(r.delta < 0n ? -r.delta : r.delta, dec, 4)}`}
                    </T>
                    <T v="caption" dim>{c.unit}</T>
                  </View>
                </Press>
              ))
            ) : (
              <T v="caption" dim style={{ paddingHorizontal: 6 }}>{hist.error ? "Can't reach the network right now." : hist.data ? 'No payments yet.' : 'Loading…'}</T>
            )}
          </>
        )}
      </ScrollView>

      <Sheet open={recv} onClose={() => setRecv(false)}>
        <View style={{ alignItems: 'center', gap: 14 }}>
          <T v="headline">{`Receive ${c.unit}`}</T>
          <T v="caption" dim style={{ textAlign: 'center' }}>{`Only ${c.title} (${netLabel}) to this address. Coins from another blockchain sent here are lost.`}</T>
          {c.address && !showQr ? (
            <Press haptic={false} onPress={() => setShowQr(true)} accessibilityLabel="Show the QR code" scaleTo={0.99}>
              <ChainRing chain={chain} address={c.address} size={270} />
            </Press>
          ) : (
            <Press haptic={false} onPress={() => setShowQr(false)} accessibilityLabel="Show the ring" scaleTo={0.99} style={{ padding: 14, borderRadius: 24, backgroundColor: '#fff' }}>
              {c.address ? <Qr value={c.address} size={220} /> : null}
            </Press>
          )}
          {c.address ? <T v="caption" dim>{showQr ? 'Tap the code to show the ring' : 'Tap the ring to show a QR for other wallets'}</T> : null}
          <T v="mono" color={C.soft} style={{ textAlign: 'center', lineHeight: 22 }}>
            <T v="mono" style={{ fontFamily: F.semibold }}>{(c.address ?? '').slice(0, 5)}</T>
            {(c.address ?? '').slice(5, -5)}
            <T v="mono" style={{ fontFamily: F.semibold }}>{(c.address ?? '').slice(-5)}</T>
          </T>
          <View style={{ flexDirection: 'row', gap: 6, height: 64, paddingHorizontal: 8, alignItems: 'center', borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)' }}>
            <Press onPress={copy} style={{ height: 48, paddingHorizontal: 22, borderRadius: 24, backgroundColor: '#F4F4F6', alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ fontFamily: F.semibold, fontSize: 15, color: '#111' }}>Copy</T>
            </Press>
            <Press onPress={() => Share.share({ message: c.address ?? '' }).catch(() => {})} style={{ height: 48, paddingHorizontal: 22, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ fontFamily: F.semibold, fontSize: 15 }}>Share</T>
            </Press>
          </View>
        </View>
      </Sheet>
    </View>
  );
}
