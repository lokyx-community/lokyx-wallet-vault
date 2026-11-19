import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Button, ErrorText, Field, Group, Note, Press, Row, Screen, success } from '../ui/controls';
import { IntroHero } from '../ui/Feature';
import { Segmented } from '../ui/Segmented';
import { Sheet } from '../ui/Sheet';
import { CoinLogo } from '../ui/CoinLogo';
import { Icon } from '../ui/Icon';
import { C } from '../ui/theme';
import { DUR, EASE_OUT } from '../ui/motion';
import { shortAddr, niceLyx } from '../lib/format';
import { usePoll, type Account } from '../lib/rpc';
import { activeNets, btcBalance, ethBalance, useAsync } from '../lib/multichain';
import { BTC_NETS, ETH_NETS, formatBtc, formatUnits } from '../lib/multichain-core';
import { loadWatched, unwatch, useWatched, watchAddress } from '../lib/watchonly';
import type { WatchChain, Watched } from '../lib/watchonly-core';

function Balance({ w }: { w: Watched }) {
  const lyx = usePoll<Account>('lyx_getAccount', w.chain === 'lyx' ? { address: w.address } : null, 20000).data;
  const other = useAsync(async () => {
    const n = activeNets();
    if (w.chain === 'btc') {
      const b = await btcBalance(n.btc, w.address);
      return `${formatBtc(b.confirmed)} ${BTC_NETS[n.btc].unit}`;
    }
    if (w.chain === 'eth') return `${formatUnits(await ethBalance(n.eth, w.address), 18, 6)} ${ETH_NETS[n.eth].unit}`;
    return '';
  }, [w.id], 30000).data;
  return <T v="callout">{w.chain === 'lyx' ? (lyx ? `${niceLyx(lyx.balanceLyx, 2)} LYX` : '') : other ?? ''}</T>;
}

/** Addresses you follow without a key. They can't be spent from here. */
export default function Watch() {
  const list = useWatched();
  const [adding, setAdding] = useState(false);
  const [chain, setChain] = useState<WatchChain>('lyx');
  const [addr, setAddr] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => void loadWatched(), []);

  return (
    <Screen title="Watching" large>
      <IntroHero icon="eye" text="Follow any address and see its balance, with no key and no way to spend. Good for a family wallet, a savings address or a tip jar." />
      {list.length > 0 && (
        <Group>
          {list.map((w, i) => (
            <Animated.View key={w.id} entering={FadeInDown.delay(i * 40).duration(DUR.base).easing(EASE_OUT)}>
              <Row title={w.name} sub={shortAddr(w.address, 10, 6)} right={<Balance w={w} />} icon={undefined} onPress={() => void unwatch(w.id)} />
            </Animated.View>
          ))}
        </Group>
      )}
      {list.length > 0 && <T v="caption" dim style={{ textAlign: 'center' }}>Tap an address to stop watching it.</T>}
      <Button title="Watch an address" onPress={() => { setErr(''); setAddr(''); setName(''); setAdding(true); }} />
      <Sheet open={adding} onClose={() => setAdding(false)}>
        <View style={{ gap: 12 }}>
          <T v="title">Watch an address</T>
          <Segmented<WatchChain> value={chain} onChange={setChain} options={[['lyx', 'LOKYX'], ['btc', 'Bitcoin'], ['eth', 'Ethereum']]} />
          <Field value={name} onChangeText={setName} placeholder="Name, like Mum's wallet" style={{ height: 56, borderRadius: 20 }} />
          <Field value={addr} onChangeText={setAddr} placeholder="Address" autoCapitalize="none" autoCorrect={false} mono style={{ height: 56, borderRadius: 20 }} />
          <ErrorText>{err}</ErrorText>
          <Button
            title="Start watching"
            disabled={!addr.trim()}
            onPress={async () => {
              try {
                await watchAddress(chain, addr, name);
                success();
                setAdding(false);
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
