import { useEffect } from 'react';
import { Modal, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { faceState, bioName } from '../lib/auth';
import { useStore } from '../lib/store';
import { Icon } from './Icon';
import { T } from './Text';
import { C } from './theme';
import { DUR, EASE_OUT } from './motion';

const APath = Animated.createAnimatedComponent(Path);

/** The face glyph with a scan line moving over it, as long as the phone is checking. */
export function FaceScan({ size = 96, kind = 'face' as 'face' | 'finger' }) {
  const k = useSharedValue(0);
  const corners = useSharedValue(0);
  useEffect(() => {
    k.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }), -1, true);
    corners.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0, { duration: 700 })), -1);
  }, [k, corners]);
  const line = useAnimatedStyle(() => ({ transform: [{ translateY: (k.value - 0.5) * size * 0.62 }], opacity: 0.25 + 0.75 * Math.sin(k.value * Math.PI) }));
  const box = useAnimatedStyle(() => ({ transform: [{ scale: 1 + corners.value * 0.04 }] }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={box}>
        <Icon name={kind} size={size} color={C.text} width={1.4} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: size * 0.16, right: size * 0.16, height: 2, borderRadius: 1, backgroundColor: C.text, shadowColor: '#fff', shadowOpacity: 1, shadowRadius: 6 }, line]} />
    </View>
  );
}

function Tick({ size }: { size: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) });
  }, [t]);
  const p = useAnimatedProps(() => ({ strokeDashoffset: 40 * (1 - t.value) }));
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <APath d="M5.5 12.5l4 4L18.5 7.5" stroke={C.inkText} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="40 40" animatedProps={p} />
    </Svg>
  );
}

/** Shown over everything while Face ID or a fingerprint is being checked. */
export function FaceCheckHost() {
  const s = useStore(faceState);
  return (
    <Modal visible={!!s} transparent animationType="none" statusBarTranslucent>
      {s && (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(200)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' }}>
          <View style={{ width: 168, height: 168, borderRadius: 40, backgroundColor: 'rgba(28,28,31,0.96)', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            {s.phase === 'look' ? (
              <FaceScan size={72} kind={s.kind === 'finger' ? 'finger' : 'face'} />
            ) : (
              <Animated.View entering={FadeIn.duration(DUR.base).easing(EASE_OUT)} style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.text, alignItems: 'center', justifyContent: 'center' }}>
                <Tick size={44} />
              </Animated.View>
            )}
            <T v="sub" color={C.soft}>{s.phase === 'ok' ? 'Verified' : bioName(s.kind)}</T>
          </View>
        </Animated.View>
      )}
    </Modal>
  );
}
