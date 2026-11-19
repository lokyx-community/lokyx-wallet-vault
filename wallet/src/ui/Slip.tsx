import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AccessibilityInfo, Share, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { T } from './Text';
import { Press, tick } from './controls';
import { Icon } from './Icon';
import { C, F } from './theme';
import { EASE_OUT } from './motion';
import { shortAddr } from '../lib/format';
import { b64ToBytes, receiptImage, slipQrValue, slipRows, slipText, type ImgItem, type SlipInput } from '../lib/slip-core';
import { qrCells } from '../lib/qr-cells';
import { Qr } from './Qr';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const TOOTH = 14;
/** The receipt is black paper: a touch lighter than the screen so its edge reads, with a hairline. */
const PAPER = '#121214';

/** The green seal: the ring draws, then the tick. Waiting shows a quiet ring in the waiting colour instead. */
function Seal({ done }: { done: boolean }) {
  const ring = useSharedValue(0);
  const mark = useSharedValue(0);
  useEffect(() => {
    ring.value = withDelay(250, withTiming(1, { duration: 600, easing: EASE_OUT }));
    mark.value = done ? withDelay(750, withTiming(1, { duration: 350, easing: EASE_OUT })) : withTiming(0, { duration: 150 });
  }, [done, ring, mark]);
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: 151 * (1 - ring.value) }));
  const markProps = useAnimatedProps(() => ({ strokeDashoffset: 30 * (1 - mark.value) }));
  const tint = done ? C.good : C.wait;
  return (
    <Svg width={52} height={52} viewBox="0 0 54 54">
      <Circle cx={27} cy={27} r={24} fill={done ? 'rgba(61,214,140,0.12)' : 'rgba(245,184,61,0.10)'} />
      <AnimatedCircle cx={27} cy={27} r={24} fill="none" stroke={tint} strokeWidth={2.5} strokeDasharray="151" animatedProps={ringProps} transform="rotate(-90 27 27)" strokeLinecap="round" />
      <AnimatedPath d="M17 28l7 7 13-14" fill="none" stroke={C.good} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="30" animatedProps={markProps} />
      {done ? null : <Path d="M27 17v10l6 4" fill="none" stroke={C.wait} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />}
    </Svg>
  );
}

/** A torn bottom edge: a row of small triangles in the slip's own colour. */
function Torn({ width }: { width: number }) {
  const n = Math.max(1, Math.round(width / TOOTH));
  const w = width / n;
  let d = `M0 0`;
  for (let i = 0; i < n; i++) d += `L${i * w + w / 2} ${TOOTH * 0.55}L${(i + 1) * w} 0`;
  return (
    <Svg width={width} height={TOOTH * 0.55} style={{ marginTop: -1 }}>
      <Path d={`${d}Z`} fill={PAPER} />
    </Svg>
  );
}

const Dash = () => <View style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#34343A', marginVertical: 10 }} />;

/** A label and its value with a dotted leader between them, like a till receipt. */
function Leader({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7 }}>
      <T v="sub" dim style={{ fontSize: 14 }}>{label}</T>
      <View style={{ flex: 1, height: 1, marginHorizontal: 8, marginTop: 6, borderBottomWidth: 1.5, borderStyle: 'dotted', borderColor: '#3A3A41' }} />
      {children}
    </View>
  );
}

/**
 * The slip you get after a payment: a green seal, the amount, and the plain facts of the payment. It feels like a till
 * receipt in the app's own dark glass. Share sends the same facts as text, with the full address and transaction id.
 */
export function Slip({ slip, done, caption }: { slip: SlipInput; done: boolean; caption?: string }) {
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  const [copied, setCopied] = useState(false);
  const rows = slipRows(slip);
  const big = slip.amount.length > 9;
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Animated.View entering={FadeInDown.duration(760).easing(EASE_OUT)} style={{ paddingHorizontal: 4 }}>
      <View onLayout={(e) => { setW(e.nativeEvent.layout.width); setH(e.nativeEvent.layout.height); }} style={{ backgroundColor: PAPER, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 0.5, borderBottomWidth: 0, borderColor: 'rgba(255,255,255,0.14)', overflow: 'hidden', paddingHorizontal: 22, paddingTop: 24, paddingBottom: 18 }}>
        <Shine w={w} h={h} run={done} />
        <View style={{ alignItems: 'center' }}>
          <Seal done={done} />
          <T style={{ fontFamily: F.semibold, fontSize: big ? 32 : 42, lineHeight: big ? 40 : 50, letterSpacing: -1.4, color: C.text, marginTop: 10 }} numberOfLines={1} adjustsFontSizeToFit>
            {slip.amount}
            <T style={{ fontFamily: F.medium, fontSize: 16, color: C.sub }}>{`  ${slip.unit}`}</T>
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: done ? C.good : C.wait }} />
            <T v="caption" dim style={{ textAlign: 'center' }}>
              {caption ?? (slip.testnet ? 'Test network · no market value' : done ? 'Confirmed' : 'On its way')}
            </T>
          </View>
        </View>
        <Dash />
        {rows.map((r, i) => (
          <Animated.View key={r.label} entering={FadeIn.delay(450 + i * 90).duration(320)}>
            <Leader label={r.label}>
              <T style={{ fontFamily: F.mono, fontSize: 13, color: C.text, flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>{r.value}</T>
            </Leader>
          </Animated.View>
        ))}
        <Dash />
        <Animated.View entering={FadeIn.delay(450 + rows.length * 90).duration(320)}>
          <Press
            onPress={() => {
              Clipboard.setStringAsync(slip.hash).catch(() => {});
              tick();
              setCopied(true);
            }}
            accessibilityLabel="Copy the transaction id"
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7 }}
          >
            <T v="sub" dim style={{ fontSize: 14 }}>Transaction</T>
            <View style={{ flex: 1, height: 1, marginHorizontal: 8, marginTop: 6, borderBottomWidth: 1.5, borderStyle: 'dotted', borderColor: '#3A3A41' }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
              <T style={{ fontFamily: F.mono, fontSize: 13, color: copied ? C.good : C.text }} numberOfLines={1}>{copied ? 'Copied' : shortAddr(slip.hash, 6, 4)}</T>
              <Icon name={copied ? 'check' : 'copy'} size={15} color={copied ? C.good : C.faint} />
            </View>
          </Press>
        </Animated.View>
        <Animated.View entering={FadeIn.delay(600 + rows.length * 90).duration(360)} style={{ alignItems: 'center', paddingTop: 14, paddingBottom: 4 }}>
          <View style={{ borderRadius: 10, overflow: 'hidden' }}>
            <Qr value={slipQrValue(slip)} size={92} />
          </View>
          <T v="caption" dim style={{ marginTop: 8 }}>Scan to look this payment up</T>
        </Animated.View>
      </View>
      {w > 0 ? <Torn width={w} /> : null}
    </Animated.View>
  );
}

/** One soft sweep of light across the paper once it has landed, like glass catching it. Skipped when the phone asks for less motion. */
function Shine({ w, h, run }: { w: number; h: number; run: boolean }) {
  const x = useSharedValue(-120);
  useEffect(() => {
    if (!run || w <= 0) return;
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((still) => live && !still && (x.value = withDelay(900, withTiming(w + 120, { duration: 1100, easing: EASE_OUT }))));
    return () => {
      live = false;
    };
  }, [run, w, x]);
  const st = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { skewX: '-16deg' }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -20, width: 80, height: h + 40, backgroundColor: 'rgba(255,255,255,0.07)' }, st]} />;
}

// ---------- sharing the receipt as a picture ----------
// shareSlip(slip, done) draws the receipt into an off-screen SVG, turns it into a PNG and opens the share sheet with it.
// If anything on the way fails, it shares the same facts as text instead, so Share receipt never does nothing.

type ShareReq = { id: number; slip: SlipInput; done: boolean };
let pending: ShareReq | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
const finish = (id: number) => {
  if (pending?.id === id) {
    pending = null;
    emit();
  }
};

export function shareSlip(slip: SlipInput, done = false) {
  pending = { id: Date.now() + Math.random(), slip, done };
  emit();
}

const FONT = { regular: F.regular, medium: F.medium, semibold: F.semibold } as const;

function drawItem(it: ImgItem, i: number) {
  switch (it.k) {
    case 'rect':
      return <Rect key={i} x={it.x} y={it.y} width={it.w} height={it.h} rx={it.r} fill={it.fill} />;
    case 'circle':
      return <Circle key={i} cx={it.cx} cy={it.cy} r={it.r} fill={it.fill} />;
    case 'line':
      return <Line key={i} x1={it.x1} x2={it.x2} y1={it.y} y2={it.y} stroke={it.stroke} strokeWidth={it.w} strokeDasharray={it.dash} strokeLinecap="round" />;
    case 'path':
      return <Path key={i} d={it.d} fill={it.fill ?? 'none'} stroke={it.stroke} strokeWidth={it.w} strokeLinecap="round" strokeLinejoin="round" />;
    case 'text':
      return (
        <SvgText key={i} x={it.x} y={it.y} fill={it.fill} fontSize={it.size} fontFamily={it.mono ? F.mono : FONT[it.weight]} textAnchor={it.anchor}>
          {it.s}
        </SvgText>
      );
  }
}

function Capture({ req }: { req: ShareReq }) {
  const img = useRef(receiptImage(req.slip, req.done, (() => { try { return qrCells(slipQrValue(req.slip)); } catch { return undefined; } })())).current;
  const ref = useRef<Svg>(null);
  useEffect(() => {
    let live = true;
    const text = () => Share.share({ message: slipText(req.slip) }).catch(() => {});
    const run = async (b64: string) => {
      try {
        const f = new File(Paths.cache, `lokyx-receipt-${req.id.toString().replace('.', '')}.png`);
        if (f.exists) f.delete();
        f.create();
        f.write(b64ToBytes(b64));
        if (!(await Sharing.isAvailableAsync())) throw new Error('no sharing');
        await Sharing.shareAsync(f.uri, { mimeType: 'image/png', dialogTitle: 'Share receipt', UTI: 'public.png' });
      } catch {
        await text();
      } finally {
        if (live) finish(req.id);
      }
    };
    // one short beat so the off-screen picture has been laid out before it is read back
    const h = setTimeout(() => {
      try {
        ref.current?.toDataURL((b64: string) => void run(b64), { width: img.width * 3, height: img.height * 3 });
      } catch {
        void text().then(() => live && finish(req.id));
      }
    }, 150);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [req, img]);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: -5000, top: 0, width: img.width, height: img.height }}>
      <Svg ref={ref} width={img.width} height={img.height} viewBox={`0 0 ${img.width} ${img.height}`}>
        <Rect x={0} y={0} width={img.width} height={img.height} fill="#000" />
        {img.items.map(drawItem)}
      </Svg>
    </View>
  );
}

/** Mounted once at the top of the app (next to the coin flight): draws a receipt picture only while one is being shared. */
export function ReceiptImageHost() {
  const r = useSyncExternalStore((s) => (listeners.add(s), () => listeners.delete(s)), () => pending);
  return r ? <Capture key={r.id} req={r} /> : null;
}

/** True a moment after `active` turns on (after the whole coin animation has played: fold, flight, check, words), at once if the phone asks for less motion. */
export function useReveal(active: boolean, ms = 6800): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) return;
    let live = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((still) => {
        if (!live) return;
        if (still) setOn(true);
        else t = setTimeout(() => live && setOn(true), ms);
      });
    return () => {
      live = false;
      if (t) clearTimeout(t);
    };
  }, [active, ms]);
  return active && on;
}
