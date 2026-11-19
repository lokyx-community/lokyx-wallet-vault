import { useState } from 'react';
import { View } from 'react-native';
import { T } from './Text';
import { ErrorText, Note, failure, success } from './controls';
import { SlideToPay } from './SlideToPay';
import { C } from './theme';
import { confirmIt } from '../lib/auth';
import { sendOp } from '../lib/wallet';
import { describeOp, type Ctx } from '../lib/vault-core';
import type { Op } from '../lib/lokyx';
import { labelFor } from '../lib/format';
import { toast } from './Toast';

/**
 * Clear signing: what the transaction will do, in words, then slide to sign. `as` signs with another key
 * (the recovery key), and `delayBlocks` is the vault wait that applies to this action.
 */
export function ConfirmOp({ op, me, blockTime, delayBlocks, as, label = 'Slide to confirm', onDone, warn }: {
  op: Op; me: string; blockTime: number; delayBlocks?: number; as?: { sk: Uint8Array; from?: string }; label?: string; onDone?: (hash: string) => void; warn?: string;
}) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ctx: Ctx = { blockTime, me, label: (a) => (a === me ? 'this account' : labelFor(a)) };
  const d = describeOp(op, ctx, delayBlocks);
  const go = async () => {
    setErr('');
    if (!(await confirmIt(d.title, { keyFollows: !as }))) return false;
    setBusy(true);
    try {
      const hash = await sendOp(op, as);
      success();
      toast('Sent');
      onDone?.(hash);
      return true;
    } catch (e) {
      failure();
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 14 }}>
      <View style={{ borderRadius: 20, backgroundColor: C.fill, padding: 16, gap: 8 }}>
        <T v="callout">{d.title}</T>
        {d.lines.map((l, i) => (
          <T key={i} v="sub" dim style={{ lineHeight: 20 }}>{l}</T>
        ))}
      </View>
      {warn ? <Note>{warn}</Note> : null}
      <ErrorText>{err}</ErrorText>
      <SlideToPay label={busy ? 'Sending' : label} busy={busy} onSlide={go} />
    </View>
  );
}
