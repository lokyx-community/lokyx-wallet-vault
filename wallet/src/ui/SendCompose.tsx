import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Icon } from './Icon';
import { Keypad, typeAmount } from './Keypad';
import { Button, ErrorText, Field, Press, Screen } from './controls';
import { T } from './Text';
import { C, F } from './theme';
import { shortAddr } from '../lib/format';

/** The first step of sending on any chain: who, how much on a number pad, then Review. */
export function SendCompose(p: {
  title: string;
  unit: string;
  to: string;
  onTo: (t: string) => void;
  placeholder: string;
  onScan?: () => void;
  onPaste: () => void;
  amt: string;
  onAmt: (a: string) => void;
  decimals: number;
  badTo?: string;
  guard?: ReactNode;
  below?: ReactNode;
  err?: string;
  busy?: boolean;
  disabled?: boolean;
  onReview: () => void;
  /** What the wallet holds, as text. With `onMax` the line is tappable and fills the amount. */
  have?: string;
  onMax?: () => void;
  /** One quiet line under the speed control: the fee and how long it takes. */
  feeNote?: string;
}) {
  const big = p.amt.length > 9;
  return (
    <Screen title={p.title}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.fill, borderRadius: 22, paddingLeft: 18, paddingRight: 8, height: 60 }}>
        <T v="sub" dim style={{ fontSize: 15 }}>To</T>
        <Field value={p.to} onChangeText={p.onTo} placeholder={p.placeholder} autoCapitalize="none" autoCorrect={false} mono style={{ flex: 1, backgroundColor: 'transparent', paddingHorizontal: 0, fontSize: 14 }} />
        {p.onScan ? (
          <Press onPress={p.onScan} accessibilityLabel="Scan a QR code" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="scan" size={19} color={C.text} width={2} />
          </Press>
        ) : null}
        <Press onPress={p.onPaste} accessibilityLabel="Paste an address" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="copy" size={18} color={C.text} width={1.9} />
        </Press>
      </View>
      {p.to && p.badTo ? <ErrorText>{p.badTo}</ErrorText> : p.to ? <T v="caption" dim style={{ marginTop: -8, paddingHorizontal: 6 }}>{shortAddr(p.to.trim(), 10, 6)}</T> : null}
      {p.guard}
      <View style={{ alignItems: 'center', paddingTop: 8, gap: 2 }}>
        <T style={{ fontFamily: F.regular, fontSize: big ? 46 : 64, lineHeight: big ? 54 : 72, letterSpacing: -2.4, color: p.amt ? C.text : C.faint }}>{p.amt || '0'}</T>
        {p.have ? (
          <Press onPress={p.onMax} disabled={!p.onMax} haptic={!!p.onMax} accessibilityLabel={p.onMax ? 'Use the most you can send' : undefined}>
            <T style={{ fontFamily: F.regular, fontSize: 17, color: C.sub }}>{`${p.unit} · ${p.onMax ? 'Max' : 'You have'} ${p.have}`}</T>
          </Press>
        ) : (
          <T style={{ fontFamily: F.regular, fontSize: 17, color: C.sub }}>{p.unit}</T>
        )}
      </View>
      {p.below}
      {p.feeNote ? <T v="caption" dim style={{ textAlign: 'center', marginTop: -6 }}>{p.feeNote}</T> : null}
      <ErrorText>{p.err ?? ''}</ErrorText>
      <Keypad onKey={(k) => p.onAmt(typeAmount(p.amt, k, Math.min(p.decimals, 8)))} extra="." />
      <Button title="Review" busy={p.busy} disabled={p.disabled} onPress={p.onReview} />
    </Screen>
  );
}

/** The last look before sending: the amount, who gets it, and what the lines say. */
export function SendReview({ amount, unit, to, lines, children }: { amount: string; unit: string; to: string; lines: string[]; children?: ReactNode }) {
  return (
    <>
      <View style={{ alignItems: 'center', gap: 2, paddingTop: 12 }}>
        <T style={{ fontFamily: F.regular, fontSize: amount.length > 9 ? 46 : 62, lineHeight: amount.length > 9 ? 54 : 70, letterSpacing: -2.4 }}>{amount}</T>
        <T style={{ fontFamily: F.regular, fontSize: 18, color: C.sub }}>{unit}</T>
        <T v="mono" dim style={{ fontSize: 13.5, marginTop: 8 }}>{`to ${shortAddr(to, 10, 6)}`}</T>
      </View>
      <View style={{ borderRadius: 22, backgroundColor: C.fill, paddingHorizontal: 18, marginTop: 8 }}>
        {lines.map((l, i) => (
          <View key={i} style={{ paddingVertical: 14, borderTopWidth: i ? 0.5 : 0, borderColor: C.line }}>
            <T v="sub" dim style={{ lineHeight: 20, fontSize: 15 }}>{l}</T>
          </View>
        ))}
      </View>
      {children}
    </>
  );
}
