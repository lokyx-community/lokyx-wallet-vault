import { useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { qrCells } from '../lib/qr-cells';
import { dotLayout } from '../lib/receive-core';

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

/**
 * The same code in a softer style: round dots, rounded corner squares, and room in the middle for the coin's mark.
 * Still dark on light, and the empty middle is a small part of the code, so every scanner reads it.
 * `centre` is drawn over the empty middle.
 */
export function QrDots({ value, size, ink = '#0B0B0D', paper = 'transparent', centre }: { value: string; size: number; ink?: string; paper?: string; centre?: (box: number) => ReactNode }) {
  const lay = useMemo(() => {
    const { n, cells } = qrCells(value);
    return dotLayout(n, cells, !!centre);
  }, [value, !!centre]);
  const pad = 1;
  const total = lay.n + pad * 2;
  const box = (lay.hole.size / total) * size;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${total} ${total}`} accessibilityLabel="QR code">
        {paper !== 'transparent' ? <Rect x={0} y={0} width={total} height={total} fill={paper} /> : null}
        {lay.dots.map(([x, y]) => (
          <Circle key={`${x}.${y}`} cx={x + pad + 0.5} cy={y + pad + 0.5} r={0.45} fill={ink} />
        ))}
        {lay.eyes.map(([x, y]) => [
          <Rect key={`o${x}.${y}`} x={x + pad + 0.5} y={y + pad + 0.5} width={6} height={6} rx={2} fill="none" stroke={ink} strokeWidth={1} />,
          <Rect key={`i${x}.${y}`} x={x + pad + 2} y={y + pad + 2} width={3} height={3} rx={1.1} fill={ink} />,
        ])}
      </Svg>
      {centre ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: (size - box) / 2, top: (size - box) / 2, width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
          {centre(box)}
        </View>
      ) : null}
    </View>
  );
}
