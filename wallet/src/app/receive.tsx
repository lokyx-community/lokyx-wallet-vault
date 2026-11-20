import { Aurora } from '../ui/Aurora';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Share, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as ScreenCapture from 'expo-screen-capture';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { IconButton, Press, success } from '../ui/controls';
import { ActionRow } from '../ui/ActionRow';
import { Aurora } from '../ui/Aurora';
import { Sheet } from '../ui/Sheet';
import { Keypad, typeAmount } from '../ui/Keypad';
import { TapPill } from '../ui/TapPill';
import { Logo } from '../ui/Logo';
import { Icon } from '../ui/Icon';
import { TokenLogo } from '../ui/CoinLogo';
import { ReceiveCard } from '../ui/ReceiveCard';
import { AddressCardImage, type AddressCardReq } from '../ui/AddressCardImage';
import type { CardKind } from '../ui/WalletCards';
import type { LogoId } from '../ui/logos';
import { tapSupported, useTapReceive } from '../lib/tap';
import { activeNets } from '../lib/multichain';
import { BTC_NETS, ETH_NETS } from '../lib/multichain-core';
import { SOL_NETS } from '../lib/sol-core';
import { TRON_NETS } from '../lib/tron-core';
import { toast } from '../ui/Toast';
import { C, F } from '../ui/theme';
import { chainToSun } from '../lib/chain-sun';
import { useCoins } from '../lib/coins';
import { useAccountRef } from '../lib/wallet';
import { getItem, setItem } from '../lib/kv';
import { qrValue, shortCard, tapValue, wantedId, type RecvChain } from '../lib/receive-core';
import { DUR, EASE_OUT } from '../ui/motion';

interface RecvTok {
  id: string;
  symbol: string;
  name: string;
  contract?: string;
  decimals?: number;
  logo?: LogoId | null;
}
interface RecvCard {
  id: RecvChain;
  kind: CardKind;
  logo?: LogoId;
  title: string;
  net: string;
  unit: string;
  address: string;
  sunOk: boolean;
  tokens: RecvTok[];
}

const GAP = 14;

function Slot({ i, x, step, children }: { i: number; x: SharedValue<number>; step: number; children: React.ReactNode }) {
  const st = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs(x.value / step - i));
    return { opacity: 1 - d * 0.5, transform: [{ scale: 1 - d * 0.08 }] };
  });
  return <Animated.View style={st}>{children}</Animated.View>;
}

function Dot({ i, x, step }: { i: number; x: SharedValue<number>; step: number }) {
  const st = useAnimatedStyle(() => {
    const k = 1 - Math.min(1, Math.abs(x.value / step - i));
    return { width: 6 + 12 * k, backgroundColor: k > 0.5 ? '#C9A057' : '#34343A' };
  });
  return <Animated.View style={[{ height: 6, borderRadius: 3 }, st]} />;
}

/** Receive: one card per coin you hold, sideways. Each card is a QR any wallet reads, or turns over to the LOKYX ring. Tokens of the coin sit below; picking one puts it on the card. */
export default function Receive() {
  const { coin, token: tokenParam } = useLocalSearchParams<{ coin?: string; token?: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const coins = useCoins();
  const me = useAccountRef();
  const nets = activeNets();
  const chainId = ETH_NETS[nets.eth].chainId;
  const lyxAddr = me?.address ?? '';

  const cards: RecvCard[] = useMemo(() => {
    const sunOk = (chain: 'btc' | 'eth' | 'sol' | 'trx', a: string) => !!a && !!chainToSun(chain, a);
    const out: RecvCard[] = [
      { id: 'lyx', kind: 'lyx', title: 'LOKYX', net: 'LOKYX Testnet', unit: 'LYX', address: lyxAddr, sunOk: !!lyxAddr, tokens: [] },
    ];
    if (coins.eth.address) {
      out.push({
        id: 'eth', kind: coins.eth.kind, logo: coins.eth.logo, title: coins.eth.title, net: ETH_NETS[nets.eth].label, unit: coins.eth.unit,
        address: coins.eth.address, sunOk: sunOk('eth', coins.eth.address),
        tokens: coins.tokens.map((t) => ({ id: t.contract, symbol: t.symbol, name: t.name, contract: t.contract, decimals: t.decimals, logo: t.logo })),
      });
    }
    if (coins.btc.address) {
      out.push({ id: 'btc', kind: coins.btc.kind, logo: coins.btc.logo, title: coins.btc.title, net: BTC_NETS[nets.btc].label, unit: coins.btc.unit, address: coins.btc.address, sunOk: sunOk('btc', coins.btc.address), tokens: [] });
    }
    if (coins.trx.address) {
      out.push({
        id: 'trx', kind: coins.trx.kind, logo: coins.trx.logo, title: coins.trx.title, net: TRON_NETS[nets.trx].label, unit: coins.trx.unit, address: coins.trx.address, sunOk: sunOk('trx', coins.trx.address),
        tokens: coins.xTokens.trx.map((t) => ({ id: t.id, symbol: t.symbol, name: t.name, contract: t.id, logo: t.logo ?? null })),
      });
    }
    if (coins.sol.address) {
      out.push({
        id: 'sol', kind: coins.sol.kind, logo: coins.sol.logo, title: coins.sol.title, net: SOL_NETS[nets.sol].label, unit: coins.sol.unit, address: coins.sol.address, sunOk: sunOk('sol', coins.sol.address),
        tokens: coins.xTokens.sol.map((t) => ({ id: t.id, symbol: t.symbol, name: t.name, contract: t.id, logo: t.logo ?? null })),
      });
    }
    return out;
  }, [coins, lyxAddr, nets.eth, nets.btc, nets.trx, nets.sol]);

  const cw = Math.min(width - 84, 320);
  const step = cw + GAP;
  const side = (width - cw) / 2;
  const [idx, setIdx] = useState(0);
  const [faceBy, setFaceBy] = useState<Record<string, 'qr' | 'ring'>>({});
  const [tokBy, setTokBy] = useState<Record<string, string | undefined>>(tokenParam ? { eth: tokenParam } : {});
  const [ask, setAsk] = useState(false);
  const [amt, setAmt] = useState('');
  const [req, setReq] = useState('');
  const [shot, setShot] = useState(false);
  const [cardReq, setCardReq] = useState<AddressCardReq | null>(null);
  const scroll = useRef<ScrollView>(null);
  const x = useSharedValue(0);

  const active = cards[Math.min(idx, cards.length - 1)];
  const tokOf = (c: RecvCard) => c.tokens.find((t) => t.id.toLowerCase() === (tokBy[c.id] ?? '').toLowerCase());
  const tok = active ? tokOf(active) : undefined;
  const amountFor = active && req ? req : undefined;
  const uriFor = (c: RecvCard, withAmount: boolean) => {
    const t = tokOf(c);
    return qrValue({ chain: c.id, address: c.address, token: t ? { id: t.id, symbol: t.symbol, contract: t.contract, decimals: t.decimals } : undefined, amount: withAmount ? amountFor : undefined, chainId });
  };
  const faceOf = (c: RecvCard): 'qr' | 'ring' => (c.id === active?.id && req ? 'qr' : faceBy[c.id] ?? 'qr');

  const canTap = useRef(tapSupported()).current;
  const [tapOn, setTapOn] = useState(false);
  const tapText = active ? tapValue({ chain: active.id, address: active.address, token: tok ? { id: tok.id, symbol: tok.symbol, contract: tok.contract, decimals: tok.decimals } : undefined, amount: amountFor, chainId }) : '';
  const tapState = useTapReceive(tapText, tapOn);
  useEffect(() => {
    if (tapState.state !== 'read') return;
    const t = setTimeout(() => setTapOn(false), 2600);
    return () => clearTimeout(t);
  }, [tapState.state]);

  // Open on the card that was asked for. Addresses can still be loading, so wait for that card to exist, once.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    const i = cards.findIndex((c) => c.id === wantedId(coin, tokenParam));
    if (i < 0) return;
    arrived.current = true;
    if (i === 0) return;
    setIdx(i);
    x.value = i * step;
    setTimeout(() => scroll.current?.scrollTo({ x: i * step, animated: false }), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  // A screenshot of this screen offers a clean card to share instead (unless turned off).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let sub: { remove: () => void } | undefined;
    let live = true;
    void (async () => {
      try {
        if ((await getItem('w.shotPrompt')) === 'off' || !live) return;
        sub = ScreenCapture.addScreenshotListener(() => setShot(true));
      } catch {}
    })();
    return () => {
      live = false;
      sub?.remove();
    };
  }, []);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      x.value = e.contentOffset.x;
    },
    onMomentumEnd: (e) => {
      runOnJS(settle)(Math.round(e.contentOffset.x / step));
    },
  });
  function settle(i: number) {
    setIdx(Math.max(0, Math.min(cards.length - 1, i)));
    setReq('');
    setTapOn(false);
  }

  if (!active) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  const addr = active.address;
  const unit = tok ? tok.symbol : active.unit;
  const plain = active.id === 'sol' || active.id === 'trx';

  const copy = async () => {
    await Clipboard.setStringAsync(addr);
    success();
    toast('Address copied', 'copy');
  };
  const flip = () => {
    if (!active.sunOk) return;
    setReq('');
    setFaceBy((f) => ({ ...f, [active.id]: faceOf(active) === 'ring' ? 'qr' : 'ring' }));
  };
  const pick = (t: RecvTok) => {
    setReq('');
    setTokBy((m) => ({ ...m, [active.id]: m[active.id]?.toLowerCase() === t.id.toLowerCase() ? undefined : t.id }));
  };
  const shareCard = () => {
    setShot(false);
    setCardReq({ id: Date.now(), kind: active.kind, title: active.title, net: active.net, address: addr, qr: uriFor(active, false), token: tok?.symbol });
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Aurora />
      <Aurora width={width} height={380} strength={0.6} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 52, paddingHorizontal: 20 }}>
          <View style={{ flex: 1 }}>
            <T style={{ fontFamily: F.semibold, fontSize: 19, letterSpacing: -0.3 }}>Receive</T>
            <T v="caption" dim>{req ? `Asking for ${req} ${unit}` : tok ? `${tok.symbol} on ${active.net}` : active.net}</T>
          </View>
          <IconButton name="close" label="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </View>

        <Animated.View entering={FadeInDown.duration(DUR.slow).easing(EASE_OUT)}>
          <Animated.ScrollView
            ref={scroll as never}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={step}
            decelerationRate="fast"
            disableIntervalMomentum
            scrollEventThrottle={16}
            onScroll={onScroll}
            contentContainerStyle={{ paddingHorizontal: side, paddingVertical: 14, gap: GAP }}
          >
            {cards.map((c, i) => {
              const t = tokOf(c);
              return (
                <Slot key={c.id} i={i} x={x} step={step}>
                  <ReceiveCard
                    chain={c.id}
                    kind={c.kind}
                    logo={c.logo}
                    title={c.title}
                    net={c.net}
                    address={c.address}
                    qr={uriFor(c, c.id === active.id)}
                    face={faceOf(c)}
                    token={t ? { symbol: t.symbol, logo: t.logo, contract: t.contract } : undefined}
                    width={cw}
                    sunOk={c.sunOk}
                    onFlip={c.id === active.id ? flip : () => {}}
                    onCopy={copy}
                  />
                </Slot>
              );
            })}
          </Animated.ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, paddingTop: 4 }}>
            {cards.map((c, i) => <Dot key={c.id} i={i} x={x} step={step} />)}
          </View>
        </Animated.View>

        {req ? (
          <View style={{ alignItems: 'center', paddingTop: 16 }}>
            <Press onPress={() => setReq('')} style={{ height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T style={{ fontFamily: F.semibold, fontSize: 14.5 }}>{`Asking for ${req} ${unit}`}</T>
              <T v="caption" dim>Clear</T>
            </Press>
          </View>
        ) : null}

        <View style={{ paddingHorizontal: 16 }}>
          <ActionRow
            items={[
              { icon: 'copy', label: 'Copy', onPress: copy },
              { icon: 'share', label: 'Share', onPress: () => Share.share({ message: req ? `Please send me ${req} ${unit}\n${uriFor(active, true)}` : addr }) },
              ...(plain ? [] : [{ icon: 'plus' as const, label: req ? 'Clear the amount' : 'Ask for an amount', onPress: () => (req ? setReq('') : (setAmt(''), setAsk(true))) }]),
              ...(active.sunOk && !req ? [{ icon: 'qr' as const, label: faceOf(active) === 'ring' ? 'Show QR' : 'Show ring', onPress: flip }] : []),
            ]}
          />
        </View>

        {canTap ? (
          <View style={{ paddingTop: 16, paddingHorizontal: 20 }}>
            <TapPill on={tapOn} state={tapState.state} problem={tapState.problem} onPress={() => setTapOn((v) => !v)} />
          </View>
        ) : null}

        <View style={{ paddingHorizontal: 24, paddingTop: 26 }}>
          <T style={{ fontSize: 11, letterSpacing: 1.8, color: C.sub, marginLeft: 4, marginBottom: 10 }}>{`TOKENS ON ${active.title.toUpperCase()}`}</T>
          {active.tokens.length ? (
            <View style={{ borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
              {active.tokens.map((t, i) => {
                const on = tok?.id === t.id;
                return (
                  <Press key={t.id} haptic={false} scaleTo={0.99} onPress={() => pick(t)} accessibilityLabel={`${on ? 'Stop showing' : 'Show'} ${t.symbol} on the card`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 16, borderTopWidth: i ? 0.5 : 0, borderTopColor: 'rgba(255,255,255,0.1)', backgroundColor: on ? 'rgba(255,255,255,0.06)' : 'transparent' }}>
                    {t.logo ? <Logo id={t.logo} size={32} /> : <TokenLogo symbol={t.symbol} seed={t.contract ?? t.symbol} size={32} />}
                    <View style={{ flex: 1 }}>
                      <T style={{ fontFamily: F.semibold, fontSize: 15 }}>{t.symbol}</T>
                      <T v="caption" dim numberOfLines={1}>{t.name}</T>
                    </View>
                    {t.contract ? <T v="mono" color={C.faint} style={{ fontSize: 11 }}>{shortCard(t.contract).replace(/ … /, '…')}</T> : null}
                    {on ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <T style={{ fontSize: 12, color: '#E5BE6A' }}>On card</T>
                        <Icon name="check" size={14} color="#E5BE6A" width={2.2} />
                      </View>
                    ) : (
                      <T style={{ fontSize: 12, color: C.faint }}>Same address</T>
                    )}
                  </Press>
                );
              })}
            </View>
          ) : (
            <View style={{ borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 18, height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <T v="sub" dim>{active.id === 'btc' ? 'Bitcoin has no tokens' : active.id === 'lyx' ? 'No tokens yet' : 'No tokens added yet'}</T>
              {active.id === 'lyx' || active.id === 'eth' ? (
                <Press haptic={false} onPress={() => router.push(active.id === 'lyx' ? '/make-token' : '/add-token')} accessibilityLabel={active.id === 'lyx' ? 'Make a token' : 'Add a token'}>
                  <T style={{ fontFamily: F.semibold, fontSize: 14, color: '#E5BE6A' }}>{active.id === 'lyx' ? 'Make a token ›' : 'Add a token ›'}</T>
                </Press>
              ) : null}
            </View>
          )}
        </View>

        <View style={{ marginHorizontal: 24, marginTop: 18, padding: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)' }}>
          <T v="sub" dim style={{ lineHeight: 19 }}>
            {tok
              ? `Only send ${tok.symbol} on ${active.net} to this address.${active.id === 'eth' ? ' The same address takes the coin itself, which pays the fees for moving tokens.' : ''}`
              : active.id === 'lyx' ? 'Only send LOKYX (LYX) to this address.' : `Only send ${active.title} on ${active.net} to this address. Coins from another blockchain sent here are lost.`}
            {req ? ' A request with an amount is a QR code, so any wallet can read it.' : ''}
          </T>
        </View>
      </ScrollView>

      <Sheet open={ask} onClose={() => setAsk(false)}>
        <View style={{ gap: 18 }}>
          <T v="headline" style={{ textAlign: 'center' }}>How much are you asking for?</T>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8, height: 66 }}>
            <T style={{ fontFamily: F.semibold, fontSize: 48, letterSpacing: -2, color: amt ? C.text : C.faint }}>{amt || '0'}</T>
            <T style={{ fontFamily: F.medium, fontSize: 20, color: C.sub }}>{unit}</T>
          </View>
          <Keypad round onKey={(k) => setAmt((a) => typeAmount(a, k, tok?.decimals ?? (active.id === 'btc' ? 8 : active.id === 'lyx' ? 8 : 18)))} extra="." />
          <Press
            disabled={!amt || Number(amt) === 0}
            onPress={() => (setAsk(false), setReq(amt.replace(/\.$/, '')))}
            style={{ height: 56, borderRadius: 28, backgroundColor: C.ink, opacity: !amt || Number(amt) === 0 ? 0.35 : 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <T style={{ fontFamily: F.semibold, fontSize: 17, color: C.inkText }}>Show request</T>
          </Press>
        </View>
      </Sheet>

      <Sheet open={shot} onClose={() => setShot(false)}>
        <View style={{ gap: 14 }}>
          <T v="headline" style={{ textAlign: 'center' }}>{`Share your ${tok ? tok.symbol : active.title} address?`}</T>
          <T v="sub" dim style={{ textAlign: 'center', lineHeight: 19 }}>A clean card with the QR and the address, not your whole screen.</T>
          <Press onPress={shareCard} style={{ height: 54, borderRadius: 27, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ fontFamily: F.semibold, fontSize: 16, color: C.inkText }}>Share card</T>
          </Press>
          <Press onPress={() => setShot(false)} style={{ height: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ fontFamily: F.semibold, fontSize: 15 }}>Not now</T>
          </Press>
          <Press haptic={false} onPress={() => (void setItem('w.shotPrompt', 'off'), setShot(false), toast('Won’t ask again', 'check'))} accessibilityLabel="Don't ask again" style={{ alignItems: 'center', paddingVertical: 6 }}>
            <T v="caption" dim>Don’t ask again</T>
          </Press>
        </View>
      </Sheet>

      {cardReq ? <AddressCardImage key={cardReq.id} req={cardReq} onDone={() => setCardReq(null)} /> : null}
    </View>
  );
}
