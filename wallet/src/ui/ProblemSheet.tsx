import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Sheet } from './Sheet';
import { T } from './Text';
import { Button } from './controls';
import { Icon } from './Icon';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';
import type { OptionId, Problem } from '../lib/problem-core';

const TINT: Record<Problem['kind'], { fg: string; bg: string }> = {
  offline: { fg: C.wait, bg: 'rgba(245,184,61,0.14)' },
  busy: { fg: C.wait, bg: 'rgba(245,184,61,0.14)' },
  pending: { fg: C.wait, bg: 'rgba(245,184,61,0.14)' },
  funds: { fg: C.wait, bg: 'rgba(245,184,61,0.14)' },
  'needs-check': { fg: C.wait, bg: 'rgba(245,184,61,0.14)' },
  refused: { fg: C.bad, bg: 'rgba(255,92,92,0.14)' },
  other: { fg: C.bad, bg: 'rgba(255,92,92,0.14)' },
};

/**
 * A problem as a card that rises from the bottom: what happened in one sentence, what it means for the person's money,
 * and the next steps as buttons to choose from. Replaces the line of red text.
 */
export function ProblemSheet({ problem, onPick, onClose }: { problem: Problem | null; onPick: (id: OptionId) => void; onClose: () => void }) {
  const t = problem ? TINT[problem.kind] : TINT.other;
  return (
    <Sheet open={!!problem} onClose={onClose}>
      {problem ? (
        <View style={{ gap: 18, paddingBottom: 6 }}>
          <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)} style={{ gap: 12 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="info" size={24} color={t.fg} width={2.2} />
            </View>
            <T style={{ fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.7, lineHeight: 31 }}>{problem.title}</T>
            <T v="callout" dim style={{ lineHeight: 22 }}>{problem.body}</T>
          </Animated.View>
          <View style={{ gap: 10 }}>
            {problem.options.map((o, i) => (
              <Animated.View key={o.id} entering={FadeInDown.delay(90 + i * 70).duration(DUR.base).easing(EASE_OUT)}>
                <Button title={o.label} kind={o.main ? 'solid' : o.id === 'close' ? 'plain' : 'line'} onPress={() => onPick(o.id)} />
              </Animated.View>
            ))}
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}
