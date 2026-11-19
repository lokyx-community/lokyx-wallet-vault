import { useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Svg, { Path, Rect } from 'react-native-svg';
import { T } from '../ui/Text';
import { Button, Group, Press, Screen } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { CoinLogo } from '../ui/CoinLogo';
import { Logo } from '../ui/Logo';
import { TapWaves } from '../ui/TapPill';
import { C, F } from '../ui/theme';
import { useCoins } from '../lib/coins';
import { requestUri } from '../lib/scan-core';
import { askTapPermission, tapPermission, tapSupported, useTapReceive } from '../lib/tap';
import { tapRequest } from '../lib/tap-core';
import { TAP_HELP, TAP_SHARED, TAP_STEPS } from '../lib/tap-steps';

type For = 'lyx' | 'btc' | 'eth' | 'sol' | 'trx';
const LABEL: Record<For, string> = { lyx: 'LYX', btc: 'BTC', eth: 'ETH', sol: 'SOL', trx: 'TRX' };
const WORDS: Record<string, string> = { starting: 'Getting ready…', broadcasting: 'Hold the top of your phone to theirs', read: 'Sent to their phone' };

/** Two phones top to top, with a signal between them. */
function Phones() {
  const phone = (x: number, r: number) => <Rect key={x} x={x} y={22} width={62} height={118} rx={14} transform={`rotate(${r} ${x + 31} 140)`} fill="#101013" stroke="rgba(255,255,255,0.28)" strokeWidth={1.5} />;
  return (
    <Svg width={170} height={116} viewBox="0 0 220 150">
      {phone(34, 12)}
      {phone(124, -12)}
      {[12, 26, 40].map((d) => <Path key={d} d={`M${110 - d} ${36 - d / 3} Q110 ${18 - d / 2} ${110 + d} ${36 - d / 3}`} fill="none" stroke={`rgba(255,255,255,${0.5 - d / 70})`} strokeWidth={1.5} strokeLinecap="round" />)}
    </Svg>
  );
}

/** Receive with tap: pick a coin, hold the phone out, and the other phone reads the request. */
function ReceiveTap({ onStop }: { onStop: () => void }) {
  const coins = useCoins();
  const list = (['lyx', 'btc', 'eth', 'sol', 'trx'] as For[]).filter((c) => !!coins[c].address);
  const [coin, setCoin] = useState<For>(list.includes('eth') ? 'eth' : list[0] ?? 'lyx');
  const addr = coins[coin].address ?? '';
  const text = coin === 'lyx' ? tapRequest(addr) : coin === 'btc' || coin === 'eth' ? requestUri(coin, addr) : addr;
  const t = useTapReceive(text, true);
  const sent = t.state === 'read';
  return (
    <Screen title="Receive with tap" close back={false}>
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {list.map((c) => (
          <Press key={c} haptic={false} onPress={() => setCoin(c)} accessibilityLabel={`Be paid in ${LABEL[c]}`} style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: coin === c ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.07)' }}>
            <T style={{ fontFamily: F.medium, fontSize: 13.5, color: coin === c ? '#000' : C.sub }}>{LABEL[c]}</T>
          </Press>
        ))}
      </View>
      <View style={{ alignItems: 'center', paddingTop: 36, paddingBottom: 20 }}>
        <TapWaves on sent={sent} size={200}>
          <View style={{ width: 200, height: 200, borderRadius: 100, backgroundColor: '#07070A', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
            {coin === 'lyx' ? <CoinLogo chain="lyx" size={84} /> : <Logo id={coin} size={84} />}
          </View>
        </TapWaves>
      </View>
      <T style={{ textAlign: 'center', fontFamily: F.semibold, fontSize: 20, letterSpacing: -0.4 }}>{t.problem ? 'It did not start' : WORDS[t.state] ?? 'Hold the top of your phone to theirs'}</T>
      <T v="sub" dim color={t.problem ? C.bad : undefined} style={{ textAlign: 'center', lineHeight: 20 }}>{t.problem || (sent ? 'You can stop now.' : 'Waiting for the other phone')}</T>
      <Button title={sent ? 'Done' : 'Stop'} kind="line" onPress={onStop} style={{ marginTop: 8 }} />
    </Screen>
  );
}

const Row = ({ n, title, text, first }: { n?: number; title: string; text: string; first?: boolean }) => (
  <View style={{ flexDirection: 'row', gap: 14, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 0 }}>
    {n ? (
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 13 }}>{n}</T>
      </View>
    ) : null}
    <View style={{ flex: 1 }}>
      <T style={{ fontFamily: F.medium, fontSize: 15 }}>{title}</T>
      <T v="caption" dim style={{ lineHeight: 18, paddingTop: 2 }}>{text}</T>
    </View>
  </View>
);

const Check = ({ ok, text, onPress, first }: { ok: boolean; text: string; onPress?: () => void; first?: boolean }) => (
  <Press onPress={onPress} disabled={!onPress} haptic={false} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 0 }}>
    <T style={{ flex: 1, fontFamily: F.regular, fontSize: 15 }}>{text}</T>
    {ok ? <Icon name="check" size={17} color={C.good} width={2.4} /> : onPress ? <T v="caption" color={C.text}>Allow</T> : <T v="caption" dim>Not available</T>}
  </Press>
);

/** Tap to pay: how it works, whether this phone is ready, and where to start. */
export default function TapToPay() {
  const supported = useRef(tapSupported()).current;
  const [perm, setPerm] = useState(tapPermission());
  const [receiving, setReceiving] = useState(false);
  if (receiving) return <ReceiveTap onStop={() => setReceiving(false)} />;
  return (
    <Screen title="Tap to pay" close back={false}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Phones />
        <T style={{ fontFamily: F.semibold, fontSize: 22, letterSpacing: -0.5, textAlign: 'center' }}>Pay by touching phones</T>
        <T v="callout" dim style={{ textAlign: 'center' }}>No QR code and no typing.</T>
      </View>

      <Group>
        {TAP_STEPS.map((s, i) => <Row key={s.title} n={i + 1} title={s.title} text={s.text} first={!i} />)}
      </Group>

      <T style={{ fontFamily: F.medium, fontSize: 13, color: C.faint, paddingHorizontal: 6, paddingTop: 4 }}>This phone</T>
      <Group>
        <Check first ok={supported} text="Can tap (Android 12 or newer)" />
        <Check ok={supported && perm} text="Nearby devices allowed" onPress={supported && !perm ? async () => setPerm(await askTapPermission()) : undefined} />
      </Group>
      {!supported ? <T v="caption" dim style={{ paddingHorizontal: 6, lineHeight: 18 }}>This phone cannot tap. It needs Android 12 or newer with Bluetooth Low Energy.</T> : null}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button title="Receive with tap" disabled={!supported} onPress={() => setReceiving(true)} /></View>
        <View style={{ flex: 1 }}><Button title="Pay with tap" kind="line" disabled={!supported} onPress={() => router.replace('/ring?mode=tap')} /></View>
      </View>

      <T style={{ fontFamily: F.medium, fontSize: 13, color: C.faint, paddingHorizontal: 6, paddingTop: 10 }}>Not connecting?</T>
      <Group>
        {TAP_HELP.map((s, i) => <Row key={s.title} title={s.title} text={s.text} first={!i} />)}
      </Group>
      <View style={{ flexDirection: 'row', gap: 12, padding: 16, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)' }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.good, marginTop: 7 }} />
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 15 }}>Only a request is shared</T>
          <T v="caption" dim style={{ lineHeight: 18, paddingTop: 2 }}>{TAP_SHARED}</T>
        </View>
      </View>
    </Screen>
  );
}
