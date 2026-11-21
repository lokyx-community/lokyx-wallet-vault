import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

export type GlyphName = 'gift' | 'lock' | 'vault' | 'shared' | 'jar' | 'token' | 'mining' | 'explorer' | 'capsule' | 'markets' | 'browser';

/** Hand-drawn two-tone marks for the Apps screen: a soft filled shape under a clean outline. */
export function AppGlyph({ name, size = 24, color = '#fff', fill = 0.22 }: { name: GlyphName; size?: number; color?: string; fill?: number }) {
  const s = { stroke: color, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const f = { fill: color, fillOpacity: fill, stroke: 'none' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'gift' && (
        <G>
          <Rect x={4} y={10} width={16} height={10} rx={2.2} {...f} />
          <Rect x={3} y={7} width={18} height={4} rx={1.6} {...s} />
          <Path d="M5 11v7.2A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8V11M12 7v13" {...s} />
          <Path d="M12 7c-1-3.2-4.6-3.6-4.6-1.5C7.4 7 9.5 7 12 7zm0 0c1-3.2 4.6-3.6 4.6-1.5C16.6 7 14.5 7 12 7z" {...s} />
        </G>
      )}
      {name === 'vault' && (
        <G>
          <Rect x={3.5} y={5} width={17} height={14} rx={3} {...f} />
          <Rect x={3.5} y={5} width={17} height={14} rx={3} {...s} />
          <Circle cx={12} cy={12} r={3.4} {...s} />
          <Path d="M12 9.8v-.1M12 14.3v-.1M9.8 12h-.1M14.3 12h.1M8 19v1.5M16 19v1.5" {...s} />
        </G>
      )}
      {name === 'lock' && (
        <G>
          <Rect x={5} y={10.5} width={14} height={10} rx={2.6} {...f} />
          <Rect x={5} y={10.5} width={14} height={10} rx={2.6} {...s} />
          <Path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7M12 14.6v2.2" {...s} />
        </G>
      )}
      {name === 'shared' && (
        <G>
          <Circle cx={9} cy={9} r={3.4} {...f} />
          <Circle cx={9} cy={9} r={3.4} {...s} />
          <Path d="M3.2 19.5c.4-3.3 2.9-5.2 5.8-5.2s5.4 1.9 5.8 5.2" {...s} />
          <Circle cx={17.2} cy={8.2} r={2.6} {...s} />
          <Path d="M17.4 13.3c2 .2 3.3 1.8 3.5 4.2" {...s} />
        </G>
      )}
      {name === 'jar' && (
        <G>
          <Path d="M6.5 8h11l.9 10.4A2 2 0 0 1 16.4 20.5H7.6a2 2 0 0 1-2-2.1z" {...f} />
          <Path d="M7 4h10v2.6a1.4 1.4 0 0 1-1.4 1.4H8.4A1.4 1.4 0 0 1 7 6.6z" {...s} />
          <Path d="M6.5 8l-.9 10.4A2 2 0 0 0 7.6 20.5h8.8a2 2 0 0 0 2-2.1L17.5 8" {...s} />
          <Circle cx={12} cy={14.2} r={2.4} {...s} />
        </G>
      )}
      {name === 'token' && (
        <G>
          <Circle cx={12} cy={12} r={8.2} {...f} />
          <Circle cx={12} cy={12} r={8.2} {...s} />
          <Circle cx={12} cy={12} r={5} {...s} strokeOpacity={0.55} />
          <Path d="M12 9v6M9 12h6" {...s} />
        </G>
      )}
      {name === 'mining' && (
        <G>
          <Rect x={6} y={6} width={12} height={12} rx={2.6} {...f} />
          <Rect x={6} y={6} width={12} height={12} rx={2.6} {...s} />
          <Rect x={9.4} y={9.4} width={5.2} height={5.2} rx={1.2} {...s} />
          <Path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3" {...s} />
        </G>
      )}
      {name === 'explorer' && (
        <G>
          <Path d="M12 3.2l7.6 4.1v8.6L12 20l-7.6-4.1V7.3z" {...f} />
          <Path d="M12 3.2l7.6 4.1v8.6L12 20l-7.6-4.1V7.3z" {...s} />
          <Path d="M4.6 7.4L12 11.6l7.4-4.2M12 11.6V20" {...s} />
        </G>
      )}
      {name === 'capsule' && (
        <G>
          <Circle cx={12} cy={12} r={5} {...f} />
          <Circle cx={12} cy={12} r={5} {...s} />
          <Path d="M3.5 14.5C6 9.5 15 6.5 20.5 9.5" {...s} />
        </G>
      )}
      {name === 'markets' && (
        <G>
          <Path d="M4 17.5l5-6 4 3 7-8.5" {...s} />
          <Path d="M15 6h5v5" {...s} />
          <Path d="M4 20.5h16" {...s} strokeOpacity={0.45} />
        </G>
      )}
      {name === 'browser' && (
        <G>
          <Circle cx={12} cy={12} r={8.2} {...f} />
          <Circle cx={12} cy={12} r={8.2} {...s} />
          <Path d="M3.8 12h16.4M12 3.8c2.6 2.7 2.6 13.7 0 16.4M12 3.8c-2.6 2.7-2.6 13.7 0 16.4" {...s} />
        </G>
      )}
    </Svg>
  );
}
