import { useEffect, useMemo, useRef } from 'react';
import { Share, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { F } from './theme';
import { SURFACE, type CardKind } from './WalletCards';
import { b64ToBytes } from '../lib/slip-core';
import { qrCells } from '../lib/qr-cells';
import { dotLayout } from '../lib/receive-core';

export interface AddressCardReq {
  id: number;
  kind: CardKind;
  title: string;
  net: string;
  address: string;
  qr: string;
  /** Set when one token was chosen: the card says only that token should be sent. */
  token?: string;
}

const W = 360;
const H = 470;

/**
 * A clean picture of an address to share: the coin's colour, the QR, the address and one line saying what to send.
 * It is drawn off screen and read back as a picture, so it never contains whatever else was on the phone's screen.
 */
export function AddressCardImage({ req, onDone }: { req: AddressCardReq; onDone: () => void }) {
  const ref = useRef<Svg>(null);
  const s = SURFACE[req.kind];
  const lay = useMemo(() => {
    try {
      const { n, cells } = qrCells(req.qr);
      return dotLayout(n, cells, false);
    } catch {
      return null;
    }
  }, [req.qr]);
  const text = () => Share.share({ message: `${req.title} address${req.token ? ` (${req.token})` : ''}\n${req.address}` }).catch(() => {});

  useEffect(() => {
    let live = true;
    const run = async (b64: string) => {
      try {
        const f = new File(Paths.cache, `lokyx-address-${req.id}.png`);
        if (f.exists) f.delete();
        f.create();
        f.write(b64ToBytes(b64));
        if (!(await Sharing.isAvailableAsync())) throw new Error('no sharing');
        await Sharing.shareAsync(f.uri, { mimeType: 'image/png', dialogTitle: 'Share address', UTI: 'public.png' });
      } catch {
        await text();
      } finally {
        if (live) onDone();
      }
    };
    const h = setTimeout(() => {
      try {
        ref.current?.toDataURL((b64: string) => void run(b64), { width: W * 3, height: H * 3 });
      } catch {
        void text().then(() => live && onDone());
      }
    }, 150);
    return () => {
      live = false;
      clearTimeout(h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.id]);

  const plate = 280;
  const total = lay ? lay.n + 2 : 1;
  const cell = (plate - 40) / total;
  const ox = (W - plate) / 2 + 20;
  const oy = 100 + 20;
  const a = req.address;
  const half = Math.ceil(a.length / 2);
  const lines = a.length > 30 ? [a.slice(0, half), a.slice(half)] : [a];
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: -5000, top: 0, width: W, height: H }}>
      <Svg ref={ref} width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            {s.stops.map(([c, o]) => <Stop key={o} offset={o} stopColor={c} />)}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={H} fill="url(#g)" />
        <SvgText x={28} y={54} fill={s.ink} fontSize={22} fontFamily={F.semibold}>{req.token ?? req.title}</SvgText>
        <SvgText x={28} y={74} fill={s.sub} fontSize={11} fontFamily={F.medium} letterSpacing={1.8}>{req.token ? `ON ${req.net.toUpperCase()}` : req.net.toUpperCase()}</SvgText>
        <Rect x={(W - plate) / 2} y={100} width={plate} height={plate} rx={70} fill="#F7F5F0" />
        {lay ? lay.dots.map(([x, y]) => <Circle key={`${x}.${y}`} cx={ox + (x + 1.5) * cell} cy={oy + (y + 1.5) * cell} r={cell * 0.45} fill="#0B0B0D" />) : null}
        {lay ? lay.eyes.map(([x, y]) => [
          <Rect key={`o${x}.${y}`} x={ox + (x + 1.5) * cell} y={oy + (y + 1.5) * cell} width={6 * cell} height={6 * cell} rx={2 * cell} fill="none" stroke="#0B0B0D" strokeWidth={cell} />,
          <Rect key={`i${x}.${y}`} x={ox + (x + 3) * cell} y={oy + (y + 3) * cell} width={3 * cell} height={3 * cell} rx={1.1 * cell} fill="#0B0B0D" />,
        ]) : null}
        {lines.map((l, i) => <SvgText key={i} x={W / 2} y={414 + i * 18} fill={s.ink} fontSize={12.5} fontFamily={F.mono} textAnchor="middle">{l}</SvgText>)}
        <SvgText x={W / 2} y={H - 18} fill={s.sub} fontSize={10.5} fontFamily={F.medium} textAnchor="middle">{`Only send ${req.token ?? req.title} on ${req.net} to this address.`}</SvgText>
      </Svg>
    </View>
  );
}
