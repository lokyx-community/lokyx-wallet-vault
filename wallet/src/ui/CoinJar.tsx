import { useMemo } from 'react';
import Svg, { ClipPath, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop, Text as SText } from 'react-native-svg';

const JAR = 'M26 44h98a14 14 0 0 1 14 14v104a18 18 0 0 1-18 18H30a18 18 0 0 1-18-18V58a14 14 0 0 1 14-14z';

// a tiny seeded generator, so a jar always shows the same pile
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function Coin({ cx, cy, rot, mark, id }: { cx: number; cy: number; rot: number; mark: boolean; id: string }) {
  const rx = 25;
  const ry = 9;
  const th = 6;
  return (
    <G rotation={rot} originX={cx} originY={cy}>
      <Ellipse cx={cx} cy={cy + th + 1.5} rx={rx} ry={ry} fill="#000" opacity={0.35} />
      <Path d={`M${cx - rx} ${cy}v${th}a${rx} ${ry} 0 0 0 ${rx * 2} 0v-${th}z`} fill={`url(#rim${id})`} />
      <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#top${id})`} stroke="#fff" strokeOpacity={0.9} strokeWidth={0.9} />
      <Ellipse cx={cx} cy={cy} rx={rx * 0.74} ry={ry * 0.74} fill="none" stroke="#8d8e98" strokeWidth={0.9} opacity={0.8} />
      {mark ? <SText x={cx} y={cy + ry * 0.42} textAnchor="middle" fontWeight="700" fontSize={ry * 1.35} fill="#8a8b95">L</SText> : null}
      <Path d={`M${cx - rx * 0.6} ${cy - ry * 0.45}q${rx * 0.5} ${-ry * 0.5} ${rx * 1.1} ${-ry * 0.1}`} stroke="#fff" strokeWidth={1.4} fill="none" opacity={0.85} strokeLinecap="round" />
    </G>
  );
}

/** A glass jar with silver coins piled in it. `coins` is how many; the newest one carries the L. */
export function CoinJar({ coins, size = 200, id = 'j' }: { coins: number; size?: number; id?: string }) {
  const pile = useMemo(() => {
    const r = rng(coins * 7 + 11);
    const out: { x: number; y: number; rot: number }[] = [];
    let row = 0;
    while (out.length < coins && 178 - row * 8 > 66) {
      const per = row % 2 === 0 ? 3 : 2;
      for (let j = 0; j < per && out.length < coins; j++) out.push({ x: (per === 3 ? 46 + j * 29 : 60 + j * 29) + (r() * 6 - 3), y: 178 - row * 8 + (r() * 2.5 - 1), rot: r() * 12 - 6 });
      row++;
    }
    return out;
  }, [coins]);
  return (
    <Svg width={size} height={size * 1.3} viewBox="0 -14 150 206">
      <Defs>
        <LinearGradient id={`top${id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#ffffff" />
          <Stop offset="0.5" stopColor="#d5d6dd" />
          <Stop offset="1" stopColor="#a3a4ae" />
        </LinearGradient>
        <LinearGradient id={`rim${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#8e8f99" />
          <Stop offset="0.4" stopColor="#e6e7ec" />
          <Stop offset="1" stopColor="#7b7c85" />
        </LinearGradient>
        <LinearGradient id={`gl${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#fff" stopOpacity={0.3} />
          <Stop offset="0.25" stopColor="#fff" stopOpacity={0.02} />
          <Stop offset="0.8" stopColor="#fff" stopOpacity={0.02} />
          <Stop offset="1" stopColor="#fff" stopOpacity={0.14} />
        </LinearGradient>
        <ClipPath id={`cj${id}`}>
          <Path d={JAR} />
        </ClipPath>
      </Defs>
      <Path d={JAR} fill={`url(#gl${id})`} />
      <G clipPath={`url(#cj${id})`}>{pile.map((c, i) => <Coin key={i} cx={c.x} cy={c.y} rot={c.rot} mark={i === pile.length - 1} id={id} />)}</G>
      <Path d={JAR} fill="none" stroke="#fff" strokeOpacity={0.8} strokeWidth={2} />
      <Rect x={38} y={16} width={74} height={22} rx={8} fill="#0b0b0e" stroke="#fff" strokeOpacity={0.8} strokeWidth={2} />
      <Path d="M21 58v96" stroke="#fff" strokeOpacity={0.45} strokeWidth={4} strokeLinecap="round" />
    </Svg>
  );
}
