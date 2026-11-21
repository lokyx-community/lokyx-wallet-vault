import { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { plainError } from '../../lib/plain-error';
import { T } from '../../ui/Text';
import { Field, Press, Screen, ErrorText } from '../../ui/controls';
import { Keypad, typeAmount } from '../../ui/Keypad';
import { Primary } from '../../ui/Glass';
import { Logo } from '../../ui/Logo';
import { CoinLogo } from '../../ui/CoinLogo';
import { GiftCardFace } from '../../ui/GiftCardFace';
import { C, F } from '../../ui/theme';
import { makeGift } from '../../lib/gifts';
import { FEE_ADDRESS, FEE_CHARGED, GIFT_BPS, fromUnits, giftFee, percentText, toUnits } from '../../lib/swap-fees';
import type { GiftCoin } from '../../lib/gift-core';

const UNIT = { lyx: 'LYX', btc: 'BTC', eth: 'ETH' } as const;
const NAME = { lyx: 'LOKYX', btc: 'Bitcoin', eth: 'Ethereum' } as const;
const DEC = { lyx: 18, btc: 8, eth: 18 } as const;

/** Pick a coin and an amount while watching the card take shape. The coins go on it with an ordinary send, so Face ID and your limits apply. */
export default function NewGift() {
  const { width } = useWindowDimensions();
  const [coin, setCoin] = useState<GiftCoin>('lyx');
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const units = toUnits(amt.replace(/\.$/, ''), DEC[coin]);
  const feeUnits = units ? giftFee(coin, units) : 0n;
  const feeText = feeUnits > 0n ? `${fromUnits(feeUnits, DEC[coin])} ${UNIT[coin]}` : '';
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      const a = amt.replace(/\.$/, '');
      const fee = feeText ? { amount: fromUnits(feeUnits, DEC[coin]), text: feeText, to: FEE_ADDRESS[coin] ?? '' } : undefined;
      const { gift } = await makeGift(coin, `${a} ${UNIT[coin]}`, note, fee);
      router.replace(`/gift/${gift.address}`);
      router.push(coin === 'lyx' ? `/send?to=${gift.address}&amount=${a}` : `/chain/send?chain=${coin}&to=${gift.address}&amount=${a}`);
    } catch (e) {
      setErr(plainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="New gift card" large>
      <View style={{ alignItems: 'center' }}>
        <GiftCardFace coin={coin} width={Math.min(width - 40, 340)} note={note || undefined} balance={amt || '0'} unit={UNIT[coin]} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center' }}>
        {(['lyx', 'btc', 'eth'] as GiftCoin[]).map((k) => {
          const on = coin === k;
          return (
            <Press key={k} onPress={() => (setCoin(k), setAmt(''))} scaleTo={0.95} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: on ? C.ink : 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: on ? C.ink : 'rgba(255,255,255,0.14)' }}>
              {k === 'lyx' ? <CoinLogo chain="lyx" size={22} /> : <Logo id={k} size={22} />}
              <T style={{ fontFamily: F.semibold, fontSize: 14.5, color: on ? C.inkText : C.text }}>{UNIT[k]}</T>
            </Press>
          );
        })}
      </View>
      <Keypad round onKey={(k) => setAmt((a) => typeAmount(a, k, coin === 'btc' ? 8 : 18))} extra="." />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6 }}>
        <T v="sub" dim>Fee {percentText(GIFT_BPS)}, in {UNIT[coin]}</T>
        <T v="sub" color={feeText ? C.text : C.good}>{feeText || (FEE_CHARGED ? 'None for this card' : 'Not charged on the test network')}</T>
      </View>
      <Field value={note} onChangeText={setNote} placeholder="A note, like Happy birthday, Maya" maxLength={60} />
      <ErrorText>{err}</ErrorText>
      <Primary title="Make the card and fund it" disabled={!amt || Number(amt) === 0} busy={busy} onPress={go} />
      <T v="caption" dim style={{ textAlign: 'center', lineHeight: 18 }}>The next screen is a normal send to the card. The network fee to claim it comes out of the gift.</T>
    </Screen>
  );
}
