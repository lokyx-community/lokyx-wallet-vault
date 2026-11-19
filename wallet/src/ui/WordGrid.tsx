import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from './Text';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';

/** Lowercase Geist is about 0.6 em wide per letter; a little extra keeps the widest words clear of the edge. */
const PER_LETTER = 0.62;

/** The size that fits `word` in `room` pixels, never above 15.5 and never below 10. */
export function fitSize(word: string, room: number) {
  if (room <= 0) return 15.5;
  return Math.max(10, Math.min(15.5, room / (Math.max(1, word.length) * PER_LETTER)));
}

/**
 * The recovery words, numbered, three to a row. Every word is always shown whole: the size is worked out from
 * the cell's real width and the word's length (system font scaling is ignored here, it would cut words off).
 */
export function WordGrid({ words, shown = true }: { words: string[]; shown?: boolean }) {
  const [cell, setCell] = useState(0);
  const room = cell - 16 - 17 - 6; // padding, number column, gap
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {words.map((w, i) => (
        <Animated.View
          key={i}
          onLayout={i === 0 ? (e) => setCell(e.nativeEvent.layout.width) : undefined}
          entering={shown ? FadeInDown.delay(i * 22).duration(DUR.base).easing(EASE_OUT) : undefined}
          style={{ width: '31.5%', flexGrow: 1, height: 44, borderRadius: 12, backgroundColor: C.fill2, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 6 }}
        >
          <T v="caption" color={C.faint} allowFontScaling={false} style={{ width: 17, fontSize: 11.5, fontFamily: F.mono, textAlign: 'right' }}>{i + 1}</T>
          <T allowFontScaling={false} numberOfLines={1} ellipsizeMode="clip" style={{ flexShrink: 1, fontFamily: F.medium, color: C.text, fontSize: shown ? fitSize(w, room) : 15.5 }}>
            {shown ? w : '•••••'}
          </T>
        </Animated.View>
      ))}
    </View>
  );
}
