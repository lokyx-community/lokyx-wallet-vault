import { StyleSheet, Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { C, F } from './theme';

// the aurora moves behind the words, so small grey words get a faint dark halo to stay readable on any colour
const SHADOW: TextStyle = { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 } };

type Variant = 'hero' | 'display' | 'title' | 'headline' | 'body' | 'callout' | 'sub' | 'caption' | 'mono';

const styles: Record<Variant, TextStyle> = {
  hero: { fontFamily: F.semibold, fontSize: 60, letterSpacing: -2.6, lineHeight: 74, fontVariant: ['tabular-nums'] },
  display: { fontFamily: F.semibold, fontSize: 34, letterSpacing: -1, lineHeight: 42 },
  title: { fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.7, lineHeight: 33 },
  headline: { fontFamily: F.semibold, fontSize: 17, letterSpacing: -0.25, lineHeight: 22 },
  body: { fontFamily: F.regular, fontSize: 16, lineHeight: 23, letterSpacing: -0.1 },
  callout: { fontFamily: F.medium, fontSize: 15.5, lineHeight: 21, letterSpacing: -0.1 },
  sub: { fontFamily: F.regular, fontSize: 14, lineHeight: 19, ...SHADOW },
  caption: { fontFamily: F.regular, fontSize: 13, lineHeight: 17, ...SHADOW },
  mono: { fontFamily: F.mono, fontSize: 13.5, lineHeight: 19, letterSpacing: -0.2 },
};

/**
 * A line must be tall enough for its font, or Android crops the tops and bottoms of digits. When a screen
 * makes the text bigger than its variant without giving a line height, the line grows with it.
 */
export function lineFor(fontSize: number) {
  return Math.ceil(fontSize * (fontSize >= 28 ? 1.22 : 1.36));
}

export function T({ v = 'body', dim, color, style, ...p }: TextProps & { v?: Variant; dim?: boolean; color?: string }) {
  const own = StyleSheet.flatten(style) as TextStyle | undefined;
  const fix = own?.fontSize != null && own.lineHeight == null ? { lineHeight: lineFor(own.fontSize) } : null;
  return <RNText {...p} style={[styles[v], { color: color ?? (dim ? C.sub : C.text) }, style, fix]} />;
}
