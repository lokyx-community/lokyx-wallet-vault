import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, TextInput, type ScrollViewProps } from 'react-native';

/** Where the keyboard is: its height and the screen position of its top edge. Both 0 while it is closed. */
export function useKeyboard() {
  const [k, setK] = useState({ height: 0, top: 0 });
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setK({ height: e.endCoordinates.height, top: e.endCoordinates.screenY }));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setK({ height: 0, top: 0 }));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return k;
}

/**
 * A scroll view the keyboard can't cover. With the keyboard open it gets room underneath, and the box being
 * typed in is scrolled up until it is clear of the keyboard. Used by every screen that has a text box.
 */
export const KeyboardScroll = forwardRef<ScrollView, ScrollViewProps>(function KeyboardScroll({ contentContainerStyle, onScroll, children, ...p }, ref) {
  const inner = useRef<ScrollView | null>(null);
  const y = useRef(0);
  const kb = useKeyboard();
  const setRef = useCallback(
    (r: ScrollView | null) => {
      inner.current = r;
      if (typeof ref === 'function') ref(r);
      else if (ref) ref.current = r;
    },
    [ref],
  );
  useEffect(() => {
    if (!kb.height) return;
    // wait a beat: the field that was tapped is focused a moment before the keyboard finishes opening
    const t = setTimeout(() => {
      const field = (TextInput as unknown as { State?: { currentlyFocusedInput?: () => { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null } }).State?.currentlyFocusedInput?.();
      field?.measureInWindow((_x, fy, _w, fh) => {
        const over = fy + fh + 28 - kb.top;
        if (over > 0) inner.current?.scrollTo({ y: y.current + over, animated: true });
      });
    }, 60);
    return () => clearTimeout(t);
  }, [kb.height, kb.top]);
  const flat = StyleSheet.flatten(contentContainerStyle) ?? {};
  return (
    <ScrollView
      ref={setRef}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      scrollEventThrottle={16}
      {...p}
      onScroll={(e) => {
        y.current = e.nativeEvent.contentOffset.y;
        onScroll?.(e);
      }}
      contentContainerStyle={[flat, kb.height ? { paddingBottom: (typeof flat.paddingBottom === 'number' ? flat.paddingBottom : 0) + kb.height } : null]}
    >
      {children}
    </ScrollView>
  );
});
