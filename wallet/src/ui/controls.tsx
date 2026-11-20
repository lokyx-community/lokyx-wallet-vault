import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { DUR, EASE_IN_OUT, EASE_OUT, SPRING } from './motion';
import { KeyboardScroll } from './KeyboardScroll';
import { C, F } from './theme';
import { T } from './Text';
import { Icon, type IconName } from './Icon';
import { Glow } from './Glow';
import { PopCard } from './PopCard';
import { cardFor } from '../lib/problem-core';

const native = Platform.OS !== 'web';
export const tap = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
  if (native) Haptics.impactAsync(style).catch(() => {});
};
export const tick = () => {
  if (native) Haptics.selectionAsync().catch(() => {});
};
export const success = () => {
  if (native) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
};
export const failure = () => {
  if (native) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Springs down a little when pressed and back when released. */
export function Press({ style, children, haptic = true, onPress, scaleTo = 0.96, ...p }: PressableProps & { style?: StyleProp<ViewStyle>; haptic?: boolean; scaleTo?: number; children: ReactNode }) {
  const k = useSharedValue(1);
  const o = useSharedValue(1);
  const off = p.disabled ? 0.35 : 1;
  const a = useAnimatedStyle(() => ({ transform: [{ scale: k.value }], opacity: o.value * off }), [off]);
  return (
    <AnimatedPressable
      // a tap that drifts a little, or lands just outside the edge, still counts: a missed press feels like lag
      hitSlop={8}
      pressRetentionOffset={{ top: 28, bottom: 28, left: 28, right: 28 }}
      {...p}
      onPressIn={(e) => {
        // a quiet press-in: never more than 3%, and a slight dim
        k.value = withTiming(Math.max(scaleTo, 0.97), { duration: DUR.press, easing: EASE_OUT });
        o.value = withTiming(0.82, { duration: DUR.press, easing: EASE_OUT });
        p.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        k.value = withTiming(1, { duration: DUR.base, easing: EASE_OUT });
        o.value = withTiming(1, { duration: DUR.base, easing: EASE_OUT });
        p.onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) tap();
        onPress?.(e);
      }}
      style={[style as ViewStyle, a]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function Button({ title, onPress, kind = 'solid', icon, busy, disabled, style }: { title: string; onPress?: () => void; kind?: 'solid' | 'line' | 'plain'; icon?: IconName; busy?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const bg = kind === 'solid' ? C.ink : 'transparent';
  const fg = kind === 'solid' ? C.inkText : C.text;
  return (
    <Press
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[{ height: 56, paddingHorizontal: 24, borderRadius: 28, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: kind === 'line' ? 1 : 0, borderColor: C.line2 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={20} color={fg} width={2} /> : null}
      {!busy && <T v="headline" color={fg}>{title}</T>}
    </Press>
  );
}

export function IconButton({ name, onPress, size = 40, label, bg = C.fill }: { name: IconName; onPress?: () => void; size?: number; label: string; bg?: string }) {
  return (
    <Press onPress={onPress} accessibilityLabel={label} accessibilityRole="button" hitSlop={6} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }}>
      <Icon name={name} size={Math.round(size * 0.5)} color={C.text} width={2} />
    </Press>
  );
}

export function Field(p: TextInputProps & { big?: boolean; mono?: boolean }) {
  return (
    <TextInput
      placeholderTextColor={C.faint}
      selectionColor={C.text}
      keyboardAppearance="dark"
      {...p}
      style={[
        { minWidth: 0, fontFamily: p.mono ? F.mono : F.regular, fontSize: p.big ? 20 : 16, color: C.text, backgroundColor: C.fill, borderRadius: 18, paddingHorizontal: 18, paddingVertical: p.multiline ? 16 : 0, height: p.multiline ? undefined : 56, textAlignVertical: p.multiline ? 'top' : 'center' },
        Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
        p.style,
      ]}
    />
  );
}

/** A screen with a plain top bar: back, title, and something on the right. */
export function Screen({ title, children, right, scroll = true, back = true, close, large }: { title?: string; children: ReactNode; right?: ReactNode; scroll?: boolean; back?: boolean; close?: boolean; large?: boolean }) {
  const insets = useSafeAreaInsets();
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Glow />
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: insets.top + 56 }}>
        {back && !close && <IconButton name="back" label="Back" onPress={leave} />}
        <T v="headline" style={{ flex: 1, textAlign: close ? 'left' : 'center', marginRight: back && !close && !right ? 52 : 0 }} numberOfLines={1}>
          {large ? '' : title}
        </T>
        {right}
        {close && <IconButton name="close" label="Close" onPress={leave} />}
      </View>
      {scroll ? (
        <KeyboardScroll contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: insets.bottom + 48, gap: 16 }} indicatorStyle="white">
          {large && <T v="display" style={{ marginBottom: 4 }}>{title}</T>}
          {children}
        </KeyboardScroll>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
    </View>
  );
}

/** Rows grouped on one rounded card, iOS style. */
export function Group({ children, title, style }: { children: ReactNode; title?: string; style?: StyleProp<ViewStyle> }) {
  const kids = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return (
    <View style={style}>
      {title && (
        <T style={{ fontFamily: F.semibold, fontSize: 13, letterSpacing: 0.2, color: C.sub, paddingHorizontal: 8, paddingBottom: 8 }}>
          {title}
        </T>
      )}
      <View style={{ borderRadius: 24, backgroundColor: C.fill, overflow: 'hidden' }}>
        {kids.map((k, i) => (
          <View key={i}>
            {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.line2, marginLeft: (kids[i] as { props?: { icon?: unknown; lead?: unknown } })?.props?.lead ? 70 : (kids[i] as { props?: { icon?: unknown } })?.props?.icon ? 64 : 16 }} />}
            {k}
          </View>
        ))}
      </View>
    </View>
  );
}

export function Row({ icon, title, detail, onPress, danger, right, sub }: { icon?: IconName; title: string; detail?: string; onPress?: () => void; danger?: boolean; right?: ReactNode; sub?: string }) {
  const c = danger ? C.bad : C.text;
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 10, paddingHorizontal: 16 }}>
      {icon && (
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} color={c} size={19} width={1.9} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <T v="callout" color={c} style={{ fontSize: 16 }} numberOfLines={1}>
          {title}
        </T>
        {!!sub && <T v="caption" dim numberOfLines={3} style={{ lineHeight: 17 }}>{sub}</T>}
      </View>
      {!!detail && <T v="sub" dim numberOfLines={1} style={{ maxWidth: '55%' }}>{detail}</T>}
      {right}
      {onPress && !right && <Icon name="chevron" size={16} color={C.faint} width={2} />}
    </View>
  );
  return onPress ? (
    <Press onPress={onPress} haptic={false} scaleTo={0.985}>
      {body}
    </Press>
  ) : (
    body
  );
}

/** Label on the left, value on the right: for receipts and reviews. */
export function Line({ label, value, mono, children }: { label: string; value?: string; mono?: boolean; children?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, paddingVertical: 14, paddingHorizontal: 16 }}>
      <T v="sub" dim style={{ fontSize: 15 }}>
        {label}
      </T>
      {children ?? (
        <T v={mono ? 'mono' : 'callout'} numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right' }}>
          {value}
        </T>
      )}
    </View>
  );
}

export function Note({ children, center }: { children: ReactNode; center?: boolean }) {
  return (
    <T v="sub" dim style={{ paddingHorizontal: 6, lineHeight: 21, fontSize: 14.5, textAlign: center ? 'center' : 'left' }}>
      {children}
    </T>
  );
}

/** A problem, said calmly: a soft card with a small mark, not a line of red text. */
/**
 * A failure. By default it pops up as a card in the middle of the screen with a title that says what kind of trouble it
 * is and the sentence you pass as the body. Pass `hint` for a quiet note that sits in the page, such as "That isn't an
 * address" while someone is still typing; those never pop up.
 */
export function ErrorText({ children, hint }: { children: ReactNode; hint?: boolean }) {
  const text = typeof children === 'string' ? children : '';
  const [seen, setSeen] = useState('');
  // When the message clears, forget it, so the same message popping up again is shown again.
  useEffect(() => {
    if (!text) setSeen('');
  }, [text]);
  if (!children) return null;
  if (hint || typeof children !== 'string') {
    return (
      <Animated.View entering={FadeIn.duration(DUR.base)} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: 18, backgroundColor: 'rgba(255,92,92,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,92,92,0.22)' }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,92,92,0.16)', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
          <Icon name="info" size={13} color={C.bad} width={2.2} />
        </View>
        <T v="sub" style={{ flex: 1, lineHeight: 20, color: C.soft }}>
          {children}
        </T>
      </Animated.View>
    );
  }
  // The sentence passed in is already in plain words; the classifier only chooses the title.
  const { title, tone } = cardFor(text);
  return <PopCard open={seen !== text} tone={tone} title={title} body={text} options={[{ label: 'OK', main: true, onPress: () => setSeen(text) }]} onClose={() => setSeen(text)} />;
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  const x = useSharedValue(on ? 1 : 0);
  x.value = withTiming(on ? 1 : 0, { duration: DUR.fast + 40, easing: EASE_IN_OUT });
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 20 }] }));
  const track = useAnimatedStyle(() => ({ backgroundColor: x.value > 0.5 ? C.ink : C.line2 }));
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={() => (tick(), onChange(!on))} hitSlop={8}>
      <Animated.View style={[{ width: 50, height: 30, borderRadius: 15, padding: 3 }, track]}>
        <Animated.View style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: on ? C.inkText : C.text }, knob]} />
      </Animated.View>
    </Pressable>
  );
}

/** A switch with its words beside it. The whole row can be tapped. Use this when nothing else on screen says what the switch is for. */
export function SwitchRow({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={() => (tick(), onChange(!on))} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 }}>
      <View pointerEvents="none">
        <Switch on={on} onChange={() => {}} label={label} />
      </View>
      <T v="sub" style={{ flex: 1, lineHeight: 21, color: C.soft }}>{label}</T>
    </Pressable>
  );
}
