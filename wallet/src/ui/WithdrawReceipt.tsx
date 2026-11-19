import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Button } from './controls';
import { Slip, shareSlip } from './Slip';
import type { SlipInput } from '../lib/slip-core';

/**
 * The black receipt for any withdrawal that has no screen of its own for it (vault sends, shared-account payments).
 * `done` says it is already in a block. Otherwise `poll` is asked every few seconds for the block number and the seal
 * turns green when it answers. `caption` replaces the default words under the amount, e.g. "Waiting" for a vault
 * withdrawal that waits before it goes out.
 */
export function WithdrawReceipt({ slip, done: doneProp = false, caption, poll, onDone, doneLabel = 'Done' }: {
  slip: SlipInput;
  done?: boolean;
  caption?: string;
  poll?: () => Promise<number | null>;
  onDone: () => void;
  doneLabel?: string;
}) {
  const [block, setBlock] = useState<number | null>(null);
  useEffect(() => {
    if (doneProp || !poll) return;
    let live = true;
    const tick = () => poll().then((b) => live && b != null && setBlock(b)).catch(() => {});
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [doneProp, poll]);
  const done = doneProp || block != null;
  const words = done ? (block != null ? `In block ${block.toLocaleString('en-US')}` : (caption ?? 'Confirmed')) : (caption ?? 'On its way · lands with the next block');
  return (
    <View style={{ gap: 18 }}>
      <Slip slip={slip} done={done} caption={words} />
      <Animated.View entering={FadeIn.delay(700)} style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button title="Share receipt" kind="line" onPress={() => shareSlip(slip, done)} /></View>
        <View style={{ flex: 1 }}><Button title={doneLabel} onPress={onDone} /></View>
      </Animated.View>
    </View>
  );
}
