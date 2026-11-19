import { useState, type ReactNode } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Icon } from './Icon';
import { Press, tick } from './controls';
import { Qr } from './Qr';
import { T } from './Text';
import { SURFACE, type CardKind } from './WalletCards';
import { EASE_OUT } from './motion';
import { C, F } from './theme';
import { shortAddr } from '../lib/format';

export interface TxStep { title: string; sub?: string; state: 'done' | 'now' | 'next' | 'failed' }
export interface TxViewProps {
  state: 'pending' | 'block' | 'settled' | 'failed';
  sign: string;
  amount: string;
  unit: string;
  /** "to TLxs2g…JA9nX3" */
  line: string;
  /** the coin's card colour */
  kind: CardKind;
  /** the coin's mark, about 34 wide */
  mark: ReactNode;
  /** "Sent · Tron Nile" */
  label: string;
  /** the transaction id, shown (and copied) at the foot of the receipt */
  hash: string;
  steps: TxStep[];
  rows: [string, string, boolean?][];
  failMsg?: string;
  /** a link to the payment on a block explorer; when there is one the receipt carries a QR for it */
  qrUrl?: string;
  /** the whole receipt as text, with full addresses */
  shareText?: string;
  onCopy: () => void;
  onExplorer?: () => void;
  extra?: ReactNode;
}

const STATE_WORD = { failed: 'Failed', pending: 'On its way', block: 'In a block', settled: 'Settled' } as const;
const TOOTH = 14;

function Torn({ width }: { width: number }) {
  const n = Math.max(1, Math.round(width / TOOTH));
  const w = width / n;
  let d = 'M0 0';
  for (let i = 0; i < n; i++) d += `L${i * w + w / 2} ${TOOTH * 0.55}L${(i + 1) * w} 0`;
  return (
    <Svg width={width} height={TOOTH * 0.55} style={{ marginTop: -1 }}>
      <Path d={`${d}Z`} fill={C.fill2} />
    </Svg>
  );
}

const Dash = () => <View style={{ borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: C.line2, marginVertical: 6 }} />;

/**
 * One payment on any chain. A slim card in the coin's colour, one line for where it is (Sent, In a block, Settled), and the
 * receipt tucked underneath as a stub. Tap the stub and the card folds up to a bar while the receipt opens: the plain details,
 * the transaction id, and a QR for the block explorer.
 */
export function TxView(p: TxViewProps) {
  const col = p.state === 'failed' ? C.bad : p.state === 'settled' ? C.good : C.wait;
  const s = SURFACE[p.kind];
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [w, setW] = useState(0);
  const o = useSharedValue(0);
  const bodyH = useSharedValue(0);
  const toggle = () => {
    const n = !open;
    setOpen(n);
    tick();
    o.value = withTiming(n ? 1 : 0, { duration: 420, easing: EASE_OUT });
  };
  const cardBox = useAnimatedStyle(() => ({ height: 132 - 72 * o.value }));
  const full = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - o.value * 2.2) }));
  const bar = useAnimatedStyle(() => ({ opacity: Math.max(0, o.value * 2.2 - 1.2) }));
  const prog = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - o.value * 2), maxHeight: 80 * (1 - o.value), marginTop: 18 * (1 - o.value) }));
  const body = useAnimatedStyle(() => ({ height: bodyH.value * o.value, opacity: o.value }));
  const chip = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.3)' }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: col }} />
      <T style={{ fontFamily: F.medium, fontSize: 12, color: '#fff' }}>{STATE_WORD[p.state]}</T>
    </View>
  );
  const now = p.steps.find((x) => x.state === 'now' || x.state === 'failed');
  const share = () => {
    tick();
    Share.share({ message: p.shareText ?? `${p.sign}${p.amount} ${p.unit}\n${p.line}\nTransaction: ${p.hash}` }).catch(() => {});
  };
  return (
    <>
      <Animated.View style={[{ borderRadius: 24, overflow: 'hidden', marginTop: 6 }, cardBox]}>
        <Svg width="100%" height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="tx" x1="0" y1="0" x2="1" y2="1">
              {s.stops.map(([c, off]) => <Stop key={off} offset={off} stopColor={c} />)}
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#tx)" />
        </Svg>
        <Animated.View style={[StyleSheet.absoluteFill, full]} pointerEvents="none">
          <View style={{ position: 'absolute', right: 16, top: 14 }}>{p.mark}</View>
          <T style={{ position: 'absolute', left: 18, top: 15, fontFamily: F.regular, fontSize: 12.5, color: s.sub }} numberOfLines={1}>{p.label}</T>
          <View style={{ position: 'absolute', left: 18, bottom: 34, flexDirection: 'row', alignItems: 'baseline', gap: 6, right: 120 }}>
            <T style={{ fontFamily: F.semibold, fontSize: p.amount.length > 8 ? 26 : 34, letterSpacing: -1.2, color: s.ink }} numberOfLines={1} adjustsFontSizeToFit>{`${p.sign}${p.amount}`}</T>
            <T style={{ fontFamily: F.medium, fontSize: 14, color: s.sub }}>{p.unit}</T>
          </View>
          <T style={{ position: 'absolute', left: 18, bottom: 14, right: 120, fontFamily: F.mono, fontSize: 11.5, color: s.sub }} numberOfLines={1}>{p.line}</T>
          <View style={{ position: 'absolute', right: 16, bottom: 12 }}>{chip}</View>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 }, bar]} pointerEvents="none">
          {p.mark}
          <View style={{ flex: 1 }}>
            <T style={{ fontFamily: F.semibold, fontSize: 19, letterSpacing: -0.4, color: s.ink }} numberOfLines={1}>{`${p.sign}${p.amount} ${p.unit}`}</T>
            <T style={{ fontFamily: F.regular, fontSize: 12, color: s.sub }} numberOfLines={1}>{p.line}</T>
          </View>
          {chip}
        </Animated.View>
      </Animated.View>

      {p.failMsg ? <T v="sub" color={C.bad} style={{ textAlign: 'center', marginTop: 12 }}>{p.failMsg}</T> : null}

      <Animated.View style={[{ overflow: 'hidden' }, prog]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6 }}>
          <View style={{ position: 'absolute', left: '16%', right: '16%', top: 6, height: 2, backgroundColor: 'rgba(255,255,255,0.12)' }} />
          {p.steps.map((st, i) => {
            const c = st.state === 'failed' ? C.bad : st.state === 'next' ? 'rgba(255,255,255,0.22)' : col;
            return (
              <View key={st.title} style={{ flex: 1, alignItems: 'center' }}>
                <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: c, backgroundColor: st.state === 'done' || st.state === 'failed' ? c : C.bg }} />
                <T style={{ fontFamily: F.medium, fontSize: 12.5, color: st.state === 'next' ? C.faint : C.soft, marginTop: 6, textAlign: 'center' }}>{st.title}</T>
              </View>
            );
          })}
        </View>
        {now?.sub ? <T v="caption" dim style={{ textAlign: 'center', marginTop: 8 }}>{now.sub}</T> : null}
      </Animated.View>

      <View style={{ marginTop: 16 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <View style={{ backgroundColor: C.fill2, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 0.5, borderBottomWidth: 0, borderColor: C.line2 }}>
          <Press onPress={toggle} scaleTo={0.99} accessibilityRole="button" accessibilityLabel={open ? 'Close the receipt' : 'Open the receipt'} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, height: 56 }}>
            <T style={{ fontFamily: F.semibold, fontSize: 14.5, color: C.soft }}>Receipt</T>
            <T v="caption" dim>{open ? 'Tap to close' : 'Tap to open'}</T>
          </Press>
          <Animated.View style={[{ overflow: 'hidden' }, body]}>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, paddingBottom: 18 }} onLayout={(e) => { bodyH.value = e.nativeEvent.layout.height; }}>
              <Dash />
              {p.rows.map(([l, v, mono]) => (
                <View key={l} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, gap: 16 }}>
                  <T v="sub" dim style={{ fontSize: 14 }}>{l}</T>
                  <T style={{ fontFamily: mono ? F.mono : F.medium, fontSize: mono ? 13 : 14, color: C.text, flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>{v}</T>
                </View>
              ))}
              <Dash />
              <Press
                onPress={() => {
                  p.onCopy();
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                accessibilityLabel="Copy the transaction id"
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, gap: 16 }}
              >
                <T v="sub" dim style={{ fontSize: 14 }}>Transaction</T>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
                  <T style={{ fontFamily: F.mono, fontSize: 13, color: copied ? C.good : C.text }} numberOfLines={1}>{copied ? 'Copied' : shortAddr(p.hash, 6, 4)}</T>
                  <Icon name={copied ? 'check' : 'copy'} size={15} color={copied ? C.good : C.faint} />
                </View>
              </Press>
              {p.qrUrl ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 }}>
                  <View style={{ borderRadius: 10, overflow: 'hidden' }}><Qr value={p.qrUrl} size={60} /></View>
                  <T v="caption" dim style={{ flex: 1, lineHeight: 18 }}>Scan to open this payment on the block explorer.</T>
                </View>
              ) : null}
            </View>
          </Animated.View>
        </View>
        {w > 0 ? <Torn width={w} /> : null}
      </View>

      {p.extra}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <Press onPress={open ? share : toggle} style={{ flex: 1, height: 52, borderRadius: 26, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ fontFamily: F.semibold, fontSize: 15.5 }}>{open ? 'Share receipt' : 'Receipt'}</T>
        </Press>
        {p.onExplorer ? (
          <Press onPress={p.onExplorer} style={{ flex: 1, height: 52, borderRadius: 26, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ fontFamily: F.semibold, fontSize: 15.5, color: C.inkText }}>Explorer</T>
          </Press>
        ) : null}
      </View>
    </>
  );
}
