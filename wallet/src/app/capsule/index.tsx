import { useEffect } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Button, IconButton, Press } from '../../ui/controls';
import { OrbitScene, PLANET } from '../../ui/Orbit';
import { Icon } from '../../ui/Icon';
import { C } from '../../ui/theme';
import { capsuleTitle, settleCapsules, untilText, dateText, useCapsules, type Capsule } from '../../lib/capsules';
import { currentAddress } from '../../lib/wallet';
import { niceLyx } from '../../lib/format';
import { ContractsOnly } from '../../ui/ContractsOnly';
import { DUR, EASE_OUT } from '../../ui/motion';

const progress = (c: Capsule, now = Date.now() / 1000) => Math.min(1, Math.max(0, (now - c.sealed) / Math.max(1, c.opens - c.sealed)));

function Dial({ p, ready }: { p: number; ready: boolean }) {
  const R = 19;
  const L = 2 * Math.PI * R;
  return (
    <View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={46} height={46} style={{ position: 'absolute' }}>
        <Circle cx={23} cy={23} r={R} stroke={C.fill2} strokeWidth={3} fill="none" />
        <Circle cx={23} cy={23} r={R} stroke={ready ? PLANET.light : C.soft} strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={`${L * Math.max(0.02, p)} ${L}`} rotation={-90} origin="23,23" />
      </Svg>
      <Icon name={ready ? 'star' : 'clock'} size={17} color={ready ? PLANET.light : C.text} width={2} />
    </View>
  );
}

function Capsules() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const list = useCapsules();
  const me = currentAddress();
  useEffect(() => {
    settleCapsules();
    const t = setInterval(settleCapsules, 5000);
    return () => clearInterval(t);
  }, []);
  const waiting = list.filter((c) => !c.opened);
  const done = list.filter((c) => c.opened);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 120 }}>
        <View style={{ paddingHorizontal: 16, flexDirection: 'row' }}>
          <IconButton name="back" label="Back" onPress={() => router.back()} />
        </View>
        <Animated.View entering={FadeIn.duration(700)} style={{ alignItems: 'center', marginTop: -6 }}>
          <OrbitScene size={Math.min(width, 440)} riders={waiting.length ? waiting.map((c) => progress(c)) : [0.18]} />
        </Animated.View>
        <View style={{ paddingHorizontal: 20, gap: 8, marginTop: -8 }}>
          <T v="display">Time capsules</T>
          <T v="body" dim>
            Seal LYX and a note for someone, or for yourself, and pick the day it opens. Until then it stays in orbit. Nobody can open it early, not even you.
          </T>
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 22, gap: 4 }}>
          {waiting.map((c, i) => {
            const ready = Date.now() / 1000 >= c.opens;
            return (
              <Animated.View key={c.address ?? c.tx} entering={FadeInDown.delay(i * 60).duration(DUR.base).easing(EASE_OUT)}>
                <Press haptic={false} scaleTo={0.98} disabled={!c.address} onPress={() => c.address && router.push(`/capsule/${c.address}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 }}>
                  <Dial p={progress(c)} ready={ready} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T v="callout" numberOfLines={1} style={{ fontSize: 16 }}>
                      {capsuleTitle(c, me)}
                    </T>
                    <T v="caption" color={ready ? PLANET.light : C.sub}>
                      {!c.address ? 'Going into orbit…' : ready ? 'Ready to open' : `Opens ${untilText(c.opens)} · ${dateText(c.opens)}`}
                    </T>
                  </View>
                  {!!c.amountLyx && c.amountLyx !== '0' && <T v="callout" style={{ fontVariant: ['tabular-nums'] }}>{niceLyx(c.amountLyx)} LYX</T>}
                </Press>
              </Animated.View>
            );
          })}
          {done.length > 0 && <T v="sub" dim style={{ paddingTop: 18, paddingBottom: 4 }}>Opened</T>}
          {done.map((c) => (
            <Press key={c.address} haptic={false} scaleTo={0.98} onPress={() => router.push(`/capsule/${c.address}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 }}>
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={18} color={C.text} width={2.2} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="callout" style={{ fontSize: 16 }}>{capsuleTitle(c, me)}</T>
                <T v="caption" dim>Opened {dateText(c.opened ?? c.opens)}</T>
              </View>
            </Press>
          ))}
          {list.length === 0 && (
            <T v="sub" color={C.faint} style={{ paddingVertical: 10 }}>
              Nothing in orbit yet. A birthday, an anniversary, a promise to yourself: seal it now and it arrives on the day.
            </T>
          )}
        </View>
      </ScrollView>
      <View style={{ position: 'absolute', left: 20, right: 20, bottom: insets.bottom + 16 }}>
        <Button title="Seal a capsule" icon="plus" onPress={() => router.push('/capsule/new')} />
      </View>
    </View>
  );
}

export default function CapsulesGate() {
  return (
    <ContractsOnly>
      <Capsules />
    </ContractsOnly>
  );
}
