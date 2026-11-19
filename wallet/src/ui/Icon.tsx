import type { ReactElement } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

// 24px grid, drawn with round caps at 1.8 stroke unless told otherwise.
const P: Record<string, string[]> = {
  home: ['M4 11.5 12 5l8 6.5V20H4z'],
  activity: ['M5 7h14M5 12h14M5 17h9'],
  apps: [],
  you: ['M5 20c1-3.5 3.8-5.5 7-5.5s6 2 7 5.5'],
  send: ['M7 17 17 7', 'M9 7h8v8'],
  receive: ['M17 7 7 17', 'M15 17H7V9'],
  qr: ['M4 5.2A1.2 1.2 0 0 1 5.2 4h3.6A1.2 1.2 0 0 1 10 5.2v3.6A1.2 1.2 0 0 1 8.8 10H5.2A1.2 1.2 0 0 1 4 8.8z', 'M14 5.2A1.2 1.2 0 0 1 15.2 4h3.6A1.2 1.2 0 0 1 20 5.2v3.6A1.2 1.2 0 0 1 18.8 10h-3.6A1.2 1.2 0 0 1 14 8.8z', 'M4 15.2A1.2 1.2 0 0 1 5.2 14h3.6A1.2 1.2 0 0 1 10 15.2v3.6A1.2 1.2 0 0 1 8.8 20H5.2A1.2 1.2 0 0 1 4 18.8z', 'M14 14h2.5v2.5H14z', 'M18.5 14H20', 'M14 19h2', 'M18 18.5V20'],
  scan: ['M4 9V6.5A2.5 2.5 0 0 1 6.5 4H9', 'M15 4h2.5A2.5 2.5 0 0 1 20 6.5V9', 'M20 15v2.5a2.5 2.5 0 0 1-2.5 2.5H15', 'M9 20H6.5A2.5 2.5 0 0 1 4 17.5V15'],
  back: ['M15 5l-7 7 7 7'],
  close: ['M6.5 6.5l11 11M17.5 6.5l-11 11'],
  check: ['M5.5 12.5l4 4L18.5 7.5'],
  copy: ['M9 9h10v11H9z', 'M5.5 15.5V4h10'],
  share: ['M12 14.5V4', 'M7.5 8.5 12 4l4.5 4.5', 'M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13'],
  chevron: ['M9.5 5.5 16 12l-6.5 6.5'],
  down: ['M6 9.5l6 6 6-6'],
  plus: ['M12 5v14M5 12h14'],
  search: ['M20 20l-4.2-4.2'],
  lock: ['M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5', 'M5.5 10.5h13v9.5h-13z'],
  face: ['M4 8.5V6.5A2.5 2.5 0 0 1 6.5 4h2', 'M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2', 'M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2', 'M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2', 'M9 9.5v1.5M15 9.5v1.5', 'M12 9.5v3.5h-1', 'M9.5 15.5c1.5 1.2 3.5 1.2 5 0'],
  finger: ['M7.5 18.5c1-2 1.5-4 1.5-6.5a3 3 0 0 1 6 0c0 1.5-.2 3-.6 4.5', 'M12 12c0 3-.8 5.6-2.2 8', 'M5.5 14.5c.4-1 .5-1.8.5-2.5a6 6 0 0 1 11.2-3', 'M17.9 12c0 2.6-.5 5-1.4 7.2', 'M8 5.2A7.5 7.5 0 0 1 19 8'],
  key: ['M14.5 9.5 4.5 19.5M7 17l2.5 2.5M9.5 14.5l2 2'],
  globe: ['M3.5 12h17', 'M12 3.5c2.5 2.7 3.5 5.5 3.5 8.5s-1 5.8-3.5 8.5c-2.5-2.7-3.5-5.5-3.5-8.5s1-5.8 3.5-8.5z'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'],
  eyeOff: ['M4 4l16 16', 'M10 6.2c.6-.1 1.3-.2 2-.2 6 0 9.5 6 9.5 6a17 17 0 0 1-2.7 3.4', 'M6.6 7.6C3.9 9.3 2.5 12 2.5 12S6 18 12 18c1.6 0 3-.4 4.3-1', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  chip: ['M8 8h8v8H8z', 'M10 4.5V6.5M14 4.5V6.5M10 17.5v2M14 17.5v2M4.5 10h2M4.5 14h2M17.5 10h2M17.5 14h2', 'M6.5 6.5h11v11h-11z'],
  pick: ['M5 19.5 14.5 10', 'M9 5.5c3.5-1.6 7.8-1.1 10.5 1.5-1.2-.2-2.6 0-3.7.5', 'M18.5 15c1.6-3.5 1.1-7.8-1.5-10.5.2 1.2 0 2.6-.5 3.7'],
  person: ['M4.5 19.5c.9-3 3.9-5 7.5-5s6.6 2 7.5 5'],
  people: ['M3 19c.7-2.6 3-4.3 6-4.3s5.3 1.7 6 4.3', 'M16 14.8c2.3.2 4.2 1.7 4.8 4.2'],
  words: ['M5 4.5h10.5L19 8v11.5H5z', 'M8.5 10h7M8.5 13.5h7M8.5 17h4'],
  server: ['M4.5 5h15v6h-15zM4.5 13h15v6h-15z'],
  trash: ['M5 7h14', 'M9.5 7V4.5h5V7', 'M6.5 7l1 13h9l1-13'],
  refresh: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4.5v4h-4'],
  coin: ['M9.5 9.5h3.6a1.7 1.7 0 0 1 0 3.4H10m0 0h3.6a1.7 1.7 0 0 1 0 3.4H9.5M10.5 8v1.5M10.5 16.3v1.5'],
  jar: ['M7 4h10v3a5 5 0 0 1-10 0z', 'M6 20h12l-1.5-8h-9z'],
  drop: ['M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z'],
  cube: ['M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z', 'M4 7.5 12 11l8-3.5M12 11v9'],
  clock: ['M12 7.5V12l3 2'],
  shield: ['M12 3.5 5 6.2v5.6c0 4.3 3 7.6 7 8.7 4-1.1 7-4.4 7-8.7V6.2z', 'm9.2 12 2 2 3.6-3.8'],
  bolt: ['M13 3.5 5.5 13.5H12L11 20.5l7.5-10H12z'],
  info: ['M12 11v5.5', 'M12 7.8v.2'],
  more: [],
  flash: ['M13 3.5 6.5 13H11l-1 7.5L17.5 11H13z'],
  image: ['M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z', 'm4.5 16 4.5-4.5 4 4 2.5-2.5 4 4'],
  swap: ['M5 8h13M15 5l3 3-3 3', 'M19 16H6M9 13l-3 3 3 3'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  forward: ['M9 5l7 7-7 7'],
  backspace: ['M9 5.5h10.5v13H9L3.5 12z', 'M12.5 9.5l5 5M17.5 9.5l-5 5'],
  pen: ['M4 20h4L19 9l-4-4L4 16z', 'm13.5 6.5 4 4'],
  logout: ['M14 4.5H6.5v15H14', 'M10.5 12H20M16.5 8.5 20 12l-3.5 3.5'],
  bell: ['M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5z', 'M10 20.5a2 2 0 0 0 4 0'],
  star: ['M12 4.5l2.3 4.8 5.2.7-3.8 3.6.9 5.2-4.6-2.5-4.6 2.5.9-5.2L4.5 10l5.2-.7z'],
};

const extra: Record<string, (c: string, w: number) => ReactElement[]> = {
  apps: (c, w) => [
    [4, 4],
    [13, 4],
    [4, 13],
    [13, 13],
  ].map(([x, y]) => <Rect key={`${x}${y}`} x={x} y={y} width={7} height={7} rx={2} stroke={c} strokeWidth={w} fill="none" />),
  you: (c, w) => [<Circle key="c" cx={12} cy={9} r={3.5} stroke={c} strokeWidth={w} fill="none" />],
  person: (c, w) => [<Circle key="c" cx={12} cy={8.5} r={3.5} stroke={c} strokeWidth={w} fill="none" />],
  people: (c, w) => [<Circle key="a" cx={9} cy={9} r={3.2} stroke={c} strokeWidth={w} fill="none" />, <Path key="b" d="M15 5.8a3.2 3.2 0 0 1 0 6.3" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />],
  search: (c, w) => [<Circle key="c" cx={11} cy={11} r={6.5} stroke={c} strokeWidth={w} fill="none" />],
  globe: (c, w) => [<Circle key="c" cx={12} cy={12} r={8.5} stroke={c} strokeWidth={w} fill="none" />],
  key: (c, w) => [<Circle key="c" cx={16.5} cy={7.5} r={3.5} stroke={c} strokeWidth={w} fill="none" />],
  eye: (c, w) => [<Circle key="c" cx={12} cy={12} r={3} stroke={c} strokeWidth={w} fill="none" />],
  coin: (c, w) => [<Circle key="c" cx={12} cy={12} r={8.5} stroke={c} strokeWidth={w} fill="none" />],
  clock: (c, w) => [<Circle key="c" cx={12} cy={12} r={8.5} stroke={c} strokeWidth={w} fill="none" />],
  info: (c, w) => [<Circle key="c" cx={12} cy={12} r={8.5} stroke={c} strokeWidth={w} fill="none" />],
  server: (c) => [<Circle key="a" cx={8} cy={8} r={1} fill={c} />, <Circle key="b" cx={8} cy={16} r={1} fill={c} />],
  more: (c) => [5, 12, 19].map((x) => <Circle key={x} cx={x} cy={12} r={1.7} fill={c} />),
  lock: (c) => [<Rect key="r" x={11.2} y={13.8} width={1.6} height={3} rx={0.8} fill={c} />],
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 22, color, width = 1.8 }: { name: IconName; size?: number; color: string; width?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {P[name].map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
      {extra[name]?.(color, width)}
    </Svg>
  );
}

/** The LOKYX mark: an open ring with a dot in the gap. */
export function Mark({ size = 28, color }: { size?: number; color: string }) {
  const w = size <= 18 ? 18 : size <= 24 ? 16 : 14;
  const r = size <= 18 ? 9 : size <= 24 ? 8.5 : 7.5;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Path d="M50 16A34 34 0 1 0 84 50" stroke={color} strokeWidth={w} strokeLinecap="round" />
      <Circle cx={74} cy={26} r={r} fill={color} />
    </Svg>
  );
}
