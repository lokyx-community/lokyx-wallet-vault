import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { T } from './Text';
import { Button } from './controls';
import { Sheet } from './Sheet';
import { getItem, setItem } from '../lib/kv';
import { useWallet } from '../lib/wallet';

const KEY = 'w.betaSeen';

/** Shown once, the first time the wallet opens: this is a test network beta. */
export function BetaNotice() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!w.exists || w.locked) return;
    getItem(KEY).then((v) => !v && setOpen(true)).catch(() => {});
  }, [w.exists, w.locked]);
  const close = () => {
    setOpen(false);
    setItem(KEY, '1').catch(() => {});
  };
  return (
    <Sheet open={open} onClose={close} dismissable={false}>
      <View style={{ gap: 12, padding: 24 }}>
        <T v="display">Testnet beta</T>
        <T v="body">This wallet is in beta and runs on test networks. The LYX, Bitcoin, Ether, SOL and TRX in it are test coins: they are not real money and have no value.</T>
        <T v="sub" dim>Please don't send real money to any address shown here. Write down your 24 words anyway: they are the only way back into your wallet, and you should practise keeping them safe.</T>
        <Button title="I understand" onPress={close} />
      </View>
    </Sheet>
  );
}
