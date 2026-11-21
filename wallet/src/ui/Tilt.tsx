import { useEffect } from 'react';
import { Easing, SensorType, makeMutable, useAnimatedReaction, useAnimatedSensor, useSharedValue, withTiming } from 'react-native-reanimated';

/**
 * How the phone is tilted, as two numbers from -1 to 1 that the light behind every page follows.
 * tiltX is + when the phone's right edge goes down, tiltY is + when its top edge comes toward you.
 *
 * It is measured against how you are holding the phone: the "level" slowly follows your hand (about two seconds), so
 * only a real tilt moves the light, and lying in bed or sitting on a train does not push it to one side.
 * Each new reading eases in over a moment, so the light glides and never jumps.
 */
export const tiltX = makeMutable(0);
export const tiltY = makeMutable(0);

/** The two signs are the only part that depends on how each phone reports gravity. Flip one if the light moves the wrong way. */
const SIGN_X = -1;
const SIGN_Y = 1;
/** about 20 degrees of tilt moves the light all the way */
const RANGE = 0.35;
const EASE = Easing.out(Easing.cubic);

/** Mount once, near the root, and only while the motion is wanted. */
export function TiltDriver() {
  const s = useAnimatedSensor(SensorType.GRAVITY, { interval: 40 });
  const bx = useSharedValue(0);
  const by = useSharedValue(0);
  const seeded = useSharedValue(0);
  useAnimatedReaction(
    () => s.sensor.value,
    (v) => {
      const m = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      if (!(m > 0.5)) return;
      const gx = v.x / m;
      const gy = v.y / m;
      if (!seeded.value) {
        bx.value = gx;
        by.value = gy;
        seeded.value = 1;
      }
      bx.value += (gx - bx.value) * 0.02;
      by.value += (gy - by.value) * 0.02;
      const x = Math.max(-1, Math.min(1, ((gx - bx.value) / RANGE) * SIGN_X));
      const y = Math.max(-1, Math.min(1, ((gy - by.value) / RANGE) * SIGN_Y));
      tiltX.value = withTiming(x, { duration: 450, easing: EASE });
      tiltY.value = withTiming(y, { duration: 450, easing: EASE });
    },
  );
  useEffect(
    () => () => {
      tiltX.value = withTiming(0, { duration: 600, easing: EASE });
      tiltY.value = withTiming(0, { duration: 600, easing: EASE });
      s.unregister();
    },
    [],
  );
  return null;
}
