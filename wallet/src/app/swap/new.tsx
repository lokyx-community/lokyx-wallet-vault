import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { T } from '../../ui/Text';
import { Button, ErrorText, Field, Group, Note, Press, Row, Screen } from '../../ui/controls';
import { CoinLogo } from '../../ui/CoinLogo';
import { Icon } from '../../ui/Icon';
import { C, F } from '../../ui/theme';
import { confirmIt } from '../../lib/auth';
import { parseLyx } from '../../lib/lokyx';
import { parseBtc, parseUnits } from '../../lib/multichain-core';
import { makeOffer, swapId, sw, useSwapSettings } from '../../lib/swaps';

/** A new offer: what you give, what you get, and how long the refund waits if someone stops halfway. */
export default function NewSwap() {
  const cfg = useSwapSettings();
  const [dir, setDir] = useState<sw.Direction>('sell-lyx');
  const [asset, setAsset] = useState<sw.Asset>('btc');
  const [lyx, setLyx] = useState('');
  const [other, setOther] = useState('');
  const [speed, setSpeed] = useState<sw.Speed>('fast');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const sym = asset === 'btc' ? 'BTC' : 'ETH';
  const h = sw.LOCK_HOURS[speed];

  const make = async () => {
    setErr('');
    try {
      const l = parseLyx(lyx);
      const o = asset === 'btc' ? parseBtc(other) : parseUnits(other, 18);
      if (l <= 0n) throw new Error('Enter how much LYX');
      if (o <= 0n) throw new Error(`Enter how much ${sym}`);
      if (!(await confirmIt('Make a swap offer', { keyFollows: true }))) return;
      setBusy(true);
      const r = await makeOffer({ dir, asset, lyx: l, other: o, speed });
      router.replace(`/swap/${encodeURIComponent(swapId(r))}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const lyxCard = (label: string) => (
    <Side label={label} chain="lyx" sym="LYX" value={lyx} onChange={setLyx} />
  );
  const otherCard = (label: string) => (
    <Side label={label} chain={asset} sym={sym} value={other} onChange={setOther} onPick={() => setAsset(asset === 'btc' ? 'eth' : 'btc')} />
  );
  const give = dir === 'sell-lyx';
  let price = '';
  try {
    const l = Number(lyx);
    const o = Number(other);
    if (l > 0 && o > 0) price = `1 ${sym} = ${(l / o).toLocaleString('en-US', { maximumFractionDigits: 2 })} LYX`;
  } catch {}
  return (
    <Screen title="Swap" large>
      <T v="sub" dim style={{ marginTop: -8 }}>Trade with a person, not an exchange.</T>
      <View style={{ gap: 4 }}>
        {give ? lyxCard('You give') : otherCard('You give')}
        <View style={{ alignItems: 'center', height: 0, zIndex: 2 }}>
          <Press onPress={() => setDir(give ? 'buy-lyx' : 'sell-lyx')} accessibilityLabel="Flip give and get" style={{ position: 'absolute', top: -20, width: 40, height: 40, borderRadius: 20, backgroundColor: C.bg, borderWidth: 4, borderColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="swap" size={16} color={C.text} width={2.2} />
            </View>
          </Press>
        </View>
        {give ? otherCard('You get') : lyxCard('You get')}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6 }}>
        <T v="sub" dim>Your price</T>
        <T v="sub">{price || 'You and the other person agree it'}</T>
      </View>
      <Group>
        <Row title="Open offers" sub="Find someone to swap with" onPress={() => router.push('/swap/board')} />
        <Row title="I have a code" sub="Take an offer someone sent you" onPress={() => router.push('/swap/take')} />
      </Group>
      <Group title="If someone stops halfway">
        <Row title="Fast" sub={`Refunds after ${h.first === 12 ? 12 : sw.LOCK_HOURS.fast.first} h and ${sw.LOCK_HOURS.fast.second} h. Stay around for a couple of hours.`} right={speed === 'fast' ? <Icon name="check" size={18} color={C.blue} width={2.4} /> : <View />} onPress={() => setSpeed('fast')} />
        <Row title="Standard" sub={`Refunds after ${sw.LOCK_HOURS.standard.first} h and ${sw.LOCK_HOURS.standard.second} h.`} right={speed === 'standard' ? <Icon name="check" size={18} color={C.blue} width={2.4} /> : <View />} onPress={() => setSpeed('standard')} />
      </Group>
      {asset === 'btc' ? <Note>{`Bitcoin ${cfg.btcNet}. The website swaps on testnet4.`}</Note> : !cfg.ethContract ? <Note>Ethereum swaps need the swap contract on Sepolia. Set it up once in Swap settings.</Note> : null}
      <ErrorText>{err}</ErrorText>
      <Button title="Make offer" busy={busy} onPress={make} />
    </Screen>
  );
}

/** One side of the trade: the coin, the amount typed big, and (for the other coin) a chip to switch Bitcoin or Ethereum. */
function Side({ label, chain, sym, value, onChange, onPick }: { label: string; chain: 'lyx' | 'btc' | 'eth'; sym: string; value: string; onChange: (t: string) => void; onPick?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 26, backgroundColor: C.fill, paddingHorizontal: 16, height: 96 }}>
      <CoinLogo chain={chain} size={44} />
      <View style={{ flex: 1 }}>
        <T v="caption" dim>{label}</T>
        <Field value={value} onChangeText={onChange} placeholder="0" keyboardType="decimal-pad" style={{ backgroundColor: 'transparent', paddingHorizontal: 0, fontSize: 30, height: 44 }} />
      </View>
      <Press onPress={onPick} disabled={!onPick} haptic={!!onPick} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: C.fill2 }}>
        <T style={{ fontFamily: F.medium, fontSize: 14 }}>{sym}</T>
        {onPick ? <Icon name="chevron" size={11} color={C.sub} width={2.4} /> : null}
      </Press>
    </View>
  );
}
