import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { T } from './Text';
import { Field } from './controls';
import { C, F } from './theme';
import { addressBlocks, addressRisk, tailMatches, TAIL } from '../lib/guard-core';

/** An address in groups of four, with the groups that differ from `other` picked out. */
function Blocks({ addr, other }: { addr: string; other?: string }) {
  const mine = addressBlocks(addr);
  const theirs = other ? addressBlocks(other) : [];
  return (
    <T v="mono" style={{ lineHeight: 22 }}>
      {mine.map((b, i) => (
        <T key={i} v="mono" color={other && theirs[i] !== b ? C.bad : C.text} style={other && theirs[i] !== b ? { fontFamily: F.semibold } : undefined}>
          {b}{' '}
        </T>
      ))}
    </T>
  );
}

/**
 * Sits under a destination. An address you have not paid before is named as that, once, and nothing more. One that
 * looks like an address you know but is different has to have its last characters typed back. Calls `onOk` with
 * whether sending may go on.
 */
export function DestGuard({ dest, known, onOk }: { dest: string; known: string[]; onOk: (ok: boolean) => void }) {
  const [typed, setTyped] = useState('');
  useEffect(() => setTyped(''), [dest]);

  const risk = addressRisk(dest, known);
  const needTail = risk.risk === 'lookalike';
  const ok = !needTail || tailMatches(dest, typed);
  useEffect(() => onOk(ok), [ok, onOk]);

  if (risk.risk === 'same') return null;

  return (
    <View style={{ gap: 12, padding: 14, borderRadius: 18, backgroundColor: C.fill, borderWidth: 0.5, borderColor: risk.risk === 'lookalike' ? C.bad : C.line2 }}>
      {risk.risk === 'lookalike' ? (
        <>
          <T v="callout" color={C.bad}>This looks like an address you know, but it is different</T>
          <T v="caption" dim>Scammers copy the start and end of an address you have used. The parts that differ are marked.</T>
          <T v="caption" dim>You are about to pay</T>
          <Blocks addr={dest} other={risk.imitates} />
          <T v="caption" dim>The one you know</T>
          <Blocks addr={risk.imitates} other={dest} />
        </>
      ) : (
        <>
          <T v="callout">{risk.risk === 'new' ? 'You are paying this address for the first time' : 'Check this address'}</T>
          <Blocks addr={dest} />
        </>
      )}

      {needTail && (
        <>
          <T v="sub" dim>To be sure it is the right one, type the last {TAIL} characters.</T>
          <Field value={typed} onChangeText={setTyped} placeholder={`Last ${TAIL} characters`} autoCapitalize="none" autoCorrect={false} spellCheck={false} mono maxLength={TAIL + 2} />
        </>
      )}
    </View>
  );
}
