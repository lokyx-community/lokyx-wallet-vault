import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Button, ErrorText, Note, Press, Screen, failure, success, tick } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { C, F } from '../ui/theme';
import { newMnemonic } from '../lib/lokyx';
import { WordChoices } from '../ui/WordChoices';
import { SetupSteps } from '../ui/SetupSteps';
import { WordGrid } from '../ui/WordGrid';
import { BlurView } from 'expo-blur';
import { ScreenGuard } from '../ui/ScreenGuard';
import { createFromPhrase } from '../lib/wallet';
import { askVaultFirst } from '../lib/vaultfirst';

import { wordlist } from '@scure/bip39/wordlists/english.js';
import { DUR, EASE_OUT } from '../ui/motion';
import { choices, pickChecks } from '../lib/backup-check-core';

export default function Create() {
  const phrase = useMemo(() => newMnemonic(), []);
  const words = phrase.split(' ');
  const [step, setStep] = useState<'show' | 'check'>('show');
  const [shown, setShown] = useState(false);
  const checks = useMemo(() => pickChecks(words.length), [words.length]);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const options = useMemo(() => choices(words[checks[at]], words, wordlist), [at, checks, words]);

  const choose = async (w: string) => {
    if (w !== words[checks[at]]) {
      failure();
      setErr(`That's not word ${checks[at] + 1}. Have another look at your list.`);
      return;
    }
    setErr('');
    tick();
    if (at < 2) return setAt(at + 1);
    setBusy(true);
    try {
      await createFromPhrase(phrase);
      await askVaultFirst();
      success();
      router.replace('/secure');
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  if (step === 'check')
    return (
      <Screen title="" back>
      <ScreenGuard />
        <SetupSteps at={2} />
        <View style={{ gap: 10, paddingTop: 8 }}>
          <T v="display">Check your words</T>
          <T v="callout" dim style={{ lineHeight: 22 }}>{`Look at your paper. Question ${at + 1} of 3.`}</T>
        </View>
        <WordChoices n={checks[at] + 1} options={options} onPick={choose} disabled={busy} />
        <ErrorText>{err}</ErrorText>
        {busy && <Note center>Making your keys…</Note>}
      </Screen>
    );

  return (
    <Screen title="" back>
      <ScreenGuard />
      <SetupSteps at={shown ? 1 : 0} />
      <View style={{ gap: 10, paddingTop: 8 }}>
        <T v="display">Your 24 words</T>
        <T v="callout" dim style={{ lineHeight: 22 }}>These words are your wallet. Write them on paper, in order. Anyone with them can take your coins, and nobody can get them back for you.</T>
      </View>

      <View>
        <WordGrid words={words} shown={shown} />
        {!shown && (
          <Animated.View exiting={FadeOut.duration(200)} style={{ position: 'absolute', inset: 0, borderRadius: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }}>
            <BlurView intensity={40} tint="dark" experimentalBlurMethod="dimezisBlurView" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,8,10,0.55)' }} />
            <Animated.View entering={FadeIn.duration(DUR.base).easing(EASE_OUT)}>
              <Icon name="eyeOff" size={30} color={C.text} />
            </Animated.View>
            <T v="callout" style={{ textAlign: 'center' }}>Make sure nobody can see your screen</T>
            <Press onPress={() => setShown(true)} style={{ paddingHorizontal: 26, height: 48, borderRadius: 24, backgroundColor: C.ink, justifyContent: 'center' }}>
              <T style={{ fontFamily: F.semibold, fontSize: 15.5, color: C.inkText }}>Show my words</T>
            </Press>
          </Animated.View>
        )}
      </View>

      <View style={{ gap: 10, marginTop: 6 }}>
        {[
          ['Paper, not photos', 'Screenshots end up in cloud backups.'],
          ['Never type them into a website', 'LOKYX will never ask for them.'],
        ].map(([a, b]) => (
          <Animated.View entering={FadeIn.delay(300)} key={a} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <Icon name="check" size={13} color={C.text} width={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <T v="callout">{a}</T>
              <T v="sub" dim>{b}</T>
            </View>
          </Animated.View>
        ))}
      </View>

      <Button title="I've written them down" disabled={!shown} onPress={() => setStep('check')} style={{ marginTop: 8 }} />
    </Screen>
  );
}
