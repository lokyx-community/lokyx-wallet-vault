// One motion language for the whole app: calm, quick, no bounce. Things ease out and settle exactly where
// they belong (no overshoot, no wobble). Springs are only used where a finger drives the motion, and even
// there they are clamped so nothing rebounds.
import { Easing, type WithSpringConfig, type WithTimingConfig } from 'react-native-reanimated';

/** Ease-out with a long, soft tail (the "settle" curve used for everything that appears or moves). */
export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
/** Symmetric ease for things that move back and forth (segmented control, toggles). */
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

export const DUR = { press: 110, fast: 180, base: 300, slow: 460 } as const;

export const TIMING: WithTimingConfig = { duration: DUR.base, easing: EASE_OUT };
export const TIMING_FAST: WithTimingConfig = { duration: DUR.fast, easing: EASE_OUT };

/** Finger-driven motion (sheets, the slide knob): critically damped and clamped, so it never rebounds. */
export const SPRING: WithSpringConfig = { damping: 30, stiffness: 260, mass: 1, overshootClamping: true };
export const SNAPPY: WithSpringConfig = { damping: 34, stiffness: 420, mass: 1, overshootClamping: true };
export const SOFT: WithSpringConfig = { damping: 30, stiffness: 200, mass: 1, overshootClamping: true };
/** Kept for older call sites: now the same calm settle as SPRING. */
export const BOUNCY: WithSpringConfig = SPRING;
