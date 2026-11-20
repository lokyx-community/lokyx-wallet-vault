import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Sheet } from './Sheet';
import { T } from './Text';
import { Button, Press } from './controls';
import { Icon } from './Icon';
import { SCENES, Stage } from './TutorialScenes';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';
import { TUTORIALS, nextStep, type TutorialId } from '../lib/tutorial-core';
import { STEP } from '../lib/tutorial-motion';

const STAGE_W = 342;
const STAGE_H = 250;

/** One step's picture: its own clock, looping every STEP seconds. A new step mounts a fresh one (see the key). */
function StepScene({ id, k }: { id: TutorialId; k: number }) {
  const u = useSharedValue(0);
  const { width } = useWindowDimensions();
  useEffect(() => {
    u.value = 0;
    u.value = withRepeat(withTiming(STEP, { duration: STEP * 1000, easing: Easing.linear }), -1, false);
  }, [u]);
  const S = SCENES[id];
  // The sheet has 24px of padding each side; on a narrow phone the picture shrinks to fit rather than being cut off.
  const sc = Math.min(1, (width - 48) / STAGE_W);
  return (
    <View style={{ width: STAGE_W * sc, height: STAGE_H * sc, alignSelf: 'center' }}>
      <View style={{ position: 'absolute', left: -(STAGE_W - STAGE_W * sc) / 2, top: -(STAGE_H - STAGE_H * sc) / 2, width: STAGE_W, height: STAGE_H, transform: [{ scale: sc }] }}>
        <Stage u={u}>
          <S k={k} u={u} />
        </Stage>
      </View>
    </View>
  );
}

/**
 * The first-time walk-through for a feature: a branded picture that plays on a loop and one plain line per step, three
 * steps. Skip is always there. Finishing, skipping and dragging it away all call onClose.
 */
export function Tutorial({ id, open, onClose }: { id: TutorialId; open: boolean; onClose: () => void }) {
  const t = TUTORIALS[id];
  const [i, setI] = useState(0);
  useEffect(() => {
    if (open) setI(0);
  }, [open]);
  const step = t.steps[i];
  const last = i === t.steps.length - 1;
  return (
    <Sheet open={open} onClose={onClose}>
      <View style={{ gap: 16, paddingBottom: 6 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.7, lineHeight: 31 }}>{t.title}</T>
        {open ? <StepScene key={`${id}-${i}`} id={id} k={i} /> : null}
        <View style={{ minHeight: 70 }}>
          <Animated.View key={i} entering={FadeIn.duration(DUR.base).easing(EASE_OUT)} exiting={FadeOut.duration(DUR.fast)}>
            <T v="callout" dim style={{ lineHeight: 23 }}>{step.line}</T>
          </Animated.View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          {t.steps.map((_, n) => (
            <View key={n} style={{ width: n === i ? 20 : 7, height: 7, borderRadius: 4, backgroundColor: n === i ? C.text : C.line2 }} />
          ))}
        </View>
        <View style={{ gap: 10 }}>
          <Button
            title={last ? 'Got it' : 'Next'}
            onPress={() => {
              const n = nextStep(i, t.steps.length);
              if (n.done) onClose();
              else setI(n.i);
            }}
          />
          {last ? null : <Button title="Skip" kind="plain" onPress={onClose} />}
        </View>
      </View>
    </Sheet>
  );
}

/** A quiet "How it works" link to put on a feature screen so the tutorial can be seen again. */
export function HowItWorks({ onPress }: { onPress: () => void }) {
  return (
    <Press onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel="How it works" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: 8 }}>
      <Icon name="info" size={16} color={C.sub} width={2} />
      <T v="sub" dim>How it works</T>
    </Press>
  );
}
