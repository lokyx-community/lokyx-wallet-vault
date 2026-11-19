import Svg, { Path } from 'react-native-svg';

/** A thin line of the last week with a soft fill under it. */
export function Spark({ data, width, height, color = '#8FD9B0', fill = 'rgba(143,217,176,0.12)' }: { data: number[]; width: number; height: number; color?: string; fill?: string }) {
  if (data.length < 2) return null;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const span = hi - lo || 1;
  const pad = 3;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, pad + (1 - (v - lo) / span) * (height - pad * 2)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <Svg width={width} height={height}>
      <Path d={`${line} L${width} ${height} L0 ${height} Z`} fill={fill} />
      <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}
