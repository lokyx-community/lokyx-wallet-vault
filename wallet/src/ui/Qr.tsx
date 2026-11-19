import { useMemo } from 'react';
import Svg, { Rect } from 'react-native-svg';
import qrcode from 'qrcode-generator';

/** A QR code for an address or payment link (black on white so every scanner reads it). */
export function Qr({ value, size = 220 }: { value: string; size?: number }) {
  const cells = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(value);
    q.make();
    const n = q.getModuleCount();
    const out: [number, number][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) out.push([x, y]);
    return { n, out };
  }, [value]);
  const pad = 2;
  const total = cells.n + pad * 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${total} ${total}`} accessibilityLabel="QR code">
      <Rect x={0} y={0} width={total} height={total} fill="#fff" />
      {cells.out.map(([x, y]) => (
        <Rect key={`${x}.${y}`} x={x + pad} y={y + pad} width={1.02} height={1.02} fill="#000" />
      ))}
    </Svg>
  );
}
