import { useMemo } from 'react';
import Svg, { Rect } from 'react-native-svg';
import { qrCells } from '../lib/qr-cells';

/** A QR code for an address or payment link (black on white so every scanner reads it). */
export function Qr({ value, size = 220 }: { value: string; size?: number }) {
  const cells = useMemo(() => {
    const { n, cells } = qrCells(value);
    return { n, out: cells };
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
