import { useEffect, useRef, useState } from 'react';
import { ScrollView, Share, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { IconButton, Press, success } from '../ui/controls';
import { ActionRow } from '../ui/ActionRow';
import { ChainRing } from '../ui/ChainRing';
import { Aurora } from '../ui/Aurora';
import { Qr } from '../ui/Qr';
import { Sheet } from '../ui/Sheet';
import { Keypad, typeAmount } from '../ui/Keypad';
import { requestUri, tokenRequestUri } from '../lib/scan-core';
import { tapSupported, useTapReceive } from '../lib/tap';
import { tapTokenRequest } from '../lib/tap-core';
import { TapPill, TapWaves } from '../ui/TapPill';
import { Logo } from '../ui/Logo';
import { TokenLogo } from '../ui/CoinLogo';
import { activeNets } from '../lib/multichain';
import { ETH_NETS } from '../lib/multichain-core';
import { SOL_NETS } from '../lib/sol-core';
import { TRON_NETS } from '../lib/tron-core';
import { toast } from '../ui/Toast';
import { C, F } from '../ui/theme';
import { chainToSun } from '../lib/chain-sun';
import { useCoins } from '../lib/coins';
import { DUR, EASE_OUT } from '../ui/motion';

/** Receive Bitcoin or Ethereum: the address as a LOKYX sun on a dark disc, or a square QR for wallets that can't read the sun. */
export default function Receive() {
  const { coin, token } = useLocalSearchParams<{ coin?: 'btc' | 'eth' | 'sol' | 'trx'; token?: string }>();
  const chain: 'btc' | 'eth' | 'sol' | 'trx' = coin === 'sol' || coin === 'trx' ? coin : coin === 'eth' || token ? 'eth' : 'btc';
  const evm = chain === 'eth';
  const plain = chain === 'sol' || chain === 'trx';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const coins = useCoins();
  const tok = token ? coins.tokens.find((t) => t.contract.toLowerCase() === token.toLowerCase()) : undefined;
  // a token arrives at the same 0x address as Ether; only the name, the mark and the request differ
  const c = tok ? { ...coins.eth, title: tok.symbol, unit: tok.symbol } : coins[chain];
  const addr = coins[chain].address ?? '';
  const nets = activeNets();
  const netLabel = chain === 'sol' ? SOL_NETS[nets.sol].label : chain === 'trx' ? TRON_NETS[nets.trx].label : ETH_NETS[nets.eth].label;
  const sun = !!addr && !!chainToSun(chain, addr);
  const [view, setView] = useState<'ring' | 'qr'>('ring');
  const [ask, setAsk] = useState(false);
  const [amt, setAmt] = useState('');
  const [req, setReq] = useState('');
  const chainId = ETH_NETS[activeNets().eth].chainId;
  const uri = plain ? addr : tok ? tokenRequestUri({ contract: tok.contract, decimals: tok.decimals, to: addr, amount: req || undefined, chainId }) : requestUri(chain as 'btc' | 'eth', addr, req || undefined, chain === 'eth' ? chainId : undefined);
  const canTap = useRef(tapSupported()).current;
  const [tapOn, setTapOn] = useState(false);
  const tapText = tok && !req ? tapTokenRequest(tok.contract, addr, chainId) : uri;
  const tapState = useTapReceive(tapText, tapOn);
  useEffect(() => {
    if (tapState.state !== 'read') return;
    const id = setTimeout(() => setTapOn(false), 2600);
    return () => clearTimeout(id);
  }, [tapState.state]);
  const disc = Math.min(width - 48, 360);
  const ring = Math.round(disc * 0.95);
  const groups = addr.match(/.{1,4}/g) ?? [];

  const copy = async () => {
    await Clipboard.setStringAsync(addr);
    success();
    toast('Address copied', 'copy');
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Aurora width={width} height={380} strength={0.7} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 52 }}>
          <View style={{ flex: 1, paddingLeft: 4 }}>
            <T style={{ fontFamily: F.semibold, fontSize: 19, letterSpacing: -0.3 }}>Receive {c.title}</T>
            <T v="caption" dim>{chain === 'btc' ? c.tag || 'Mainnet' : netLabel}</T>
          </View>
          <IconButton name="close" label="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </View>

        {!addr ? (
          <View style={{ paddingTop: 80, alignItems: 'center', gap: 14 }}>
            <T v="callout" dim style={{ textAlign: 'center', paddingHorizontal: 24 }}>{coins.addressError || 'Making your address…'}</T>
            {coins.addressError ? (
              <Press onPress={coins.retry} style={{ height: 48, paddingHorizontal: 24, borderRadius: 24, backgroundColor: C.ink, justifyContent: 'center' }}>
                <T style={{ fontFamily: F.semibold, fontSize: 16, color: C.inkText }}>Try again</T>
              </Press>
            ) : null}
          </View>
        ) : (
          <Animated.View entering={FadeInDown.duration(DUR.slow).easing(EASE_OUT)} style={{ alignItems: 'center', paddingTop: 12 }}>
            <TapWaves on={tapOn} sent={tapOn && tapState.state === 'read'} size={disc}>
            <Press haptic={false} scaleTo={0.99} disabled={!sun || !!req} onPress={() => setView((v) => (v === 'ring' ? 'qr' : 'ring'))} accessibilityLabel={view === 'ring' ? 'Show the QR code for other wallets' : 'Show the LOKYX ring'}>
            {view === 'ring' && sun && !req ? (
              <View style={{ width: disc, height: disc, borderRadius: disc / 2, backgroundColor: '#07070A', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', shadowColor: '#fff', shadowOpacity: 0.08, shadowRadius: 30, shadowOffset: { width: 0, height: 0 } }}>
                <ChainRing chain={chain} address={addr} size={ring} color="#FFFFFF" centre={tok ? (tok.logo ? <Logo id={tok.logo} size={ring * 0.36} /> : <TokenLogo symbol={tok.symbol} seed={tok.contract} size={ring * 0.36} />) : evm ? <Logo id={coins.eth.logo} size={ring * 0.36} /> : plain ? <Logo id={chain} size={ring * 0.36} /> : undefined} />
              </View>
            ) : (
              <View style={{ padding: 14, backgroundColor: '#fff', borderRadius: 24 }}>
                <Qr value={uri} size={Math.round(disc * 0.78)} />
              </View>
            )}
            </Press>
            </TapWaves>
            {sun && !req ? <T v="caption" dim style={{ paddingTop: 14 }}>{view === 'ring' ? 'The LOKYX wallet reads the ring. Tap it for a QR any wallet can read.' : 'Any wallet can scan this. Tap it to go back to the ring.'}</T> : null}

            {req ? (
              <Press onPress={() => setReq('')} style={{ marginTop: 18, height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <T style={{ fontFamily: F.semibold, fontSize: 14.5 }}>{`Asking for ${req} ${c.unit}`}</T>
                <T v="caption" dim>Clear</T>
              </Press>
            ) : null}
            <Press haptic={false} onPress={copy} accessibilityLabel="Copy address" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 8, paddingHorizontal: 14, paddingTop: 22 }}>
              {groups.map((g, i) => (
                <T key={i} v="mono" color={i < 2 || i >= groups.length - 2 ? C.text : C.sub} style={{ fontSize: 15, lineHeight: 23 }}>{g}</T>
              ))}
            </Press>

            {canTap ? (
              <View style={{ paddingTop: 20, alignSelf: 'stretch' }}>
                <TapPill on={tapOn} state={tapState.state} problem={tapState.problem} onPress={() => setTapOn((v) => !v)} />
                <Press haptic={false} onPress={() => router.push('/tap')} accessibilityLabel="How tap to pay works"><T v="caption" dim>How tap to pay works</T></Press>
              </View>
            ) : null}

            <ActionRow
              items={[
                { icon: 'copy', label: 'Copy', onPress: copy },
                { icon: 'share', label: 'Share', onPress: () => Share.share({ message: req ? `Please send me ${req} ${c.unit}\n${uri}` : addr }) },
                ...(plain ? [] : [{ icon: 'plus' as const, label: req ? 'Clear the amount' : 'Ask for an amount', onPress: () => (req ? setReq('') : (setAmt(''), setAsk(true))) }]),
                ...(sun && !req ? [{ icon: 'qr' as const, label: view === 'ring' ? 'Show QR' : 'Show ring', onPress: () => setView((v) => (v === 'ring' ? 'qr' : 'ring')) }] : []),
              ]}
            />

            <View style={{ alignSelf: 'stretch', marginTop: 18, padding: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)' }}>
              <T v="sub" dim style={{ lineHeight: 19 }}>
                {`${tok ? `Only send ${tok.symbol} on ${netLabel} to this address. The same address takes Ether, which pays the fees for moving tokens.` : plain ? `Only send ${c.title} (${netLabel}) to this address. Coins from another blockchain sent here are lost.` : `Only send ${c.title}${c.tag ? ` (${c.tag.toLowerCase()})` : ''} to this address.`} ${req ? 'A request with an amount is a QR code, so any wallet can read it.' : view === 'ring' && sun ? 'The LOKYX wallet reads the ring. For any other wallet, switch to the QR.' : 'Any wallet can scan this.'}`}
              </T>
            </View>
          </Animated.View>
        )}
      </ScrollView>
      <Sheet open={ask} onClose={() => setAsk(false)}>
        <View style={{ gap: 18 }}>
          <T v="headline" style={{ textAlign: 'center' }}>How much are you asking for?</T>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8, height: 66 }}>
            <T style={{ fontFamily: F.semibold, fontSize: 48, letterSpacing: -2, color: amt ? C.text : C.faint }}>{amt || '0'}</T>
            <T style={{ fontFamily: F.medium, fontSize: 20, color: C.sub }}>{c.unit}</T>
          </View>
          <Keypad round onKey={(k) => setAmt((a) => typeAmount(a, k, tok ? tok.decimals : chain === 'btc' ? 8 : 18))} extra="." />
          <Press
            disabled={!amt || Number(amt) === 0}
            onPress={() => (setAsk(false), setReq(amt.replace(/\.$/, '')))}
            style={{ height: 56, borderRadius: 28, backgroundColor: C.ink, opacity: !amt || Number(amt) === 0 ? 0.35 : 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <T style={{ fontFamily: F.semibold, fontSize: 17, color: C.inkText }}>Show request</T>
          </Press>
        </View>
      </Sheet>
    </View>
  );
}
