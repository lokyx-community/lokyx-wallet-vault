import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { T } from '../ui/Text';
import { Button, ErrorText, Note, Press, Screen, failure, success, tick } from '../ui/controls';
import { C, F } from '../ui/theme';
import { DUR, EASE_OUT } from '../ui/motion';
import { WordChoices } from '../ui/WordChoices';
import { IntroHero } from '../ui/Feature';
import { ScreenGuard } from '../ui/ScreenGuard';
import { confirmIt } from '../lib/auth';
import { readPhrase } from '../lib/wallet';
import { choices, pickChecks } from '../lib/backup-check-core';
import { markBackupChecked } from '../lib/backup-check';

/** "Do you still have your words?" Three questions, nothing shown on screen but the choices. */
export default function BackupCheck() {
  const [words, setWords] = useState<string[] | null>(null);
  const [at, setAt] = useState(0);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const checks = useMemo(() => (words ? pickChecks(words.length) : []), [words]);
  const options = useMemo(() => (words ? choices(words[checks[at]], words, wordlist) : []), [words, checks, at]);

  useEffect(() => {
    void (async () => {
      if (!(await confirmIt('Check your recovery words'))) return router.back();
      const p = await readPhrase();
      if (!p) return router.back();
      setWords(p.split(' '));
    })();
  }, []);

  const choose = async (w: string) => {
    if (!words) return;
    if (w !== words[checks[at]]) {
      failure();
      setErr(`That's not word ${checks[at] + 1}. Look at your paper copy and try again.`);
      return;
    }
    setErr('');
    tick();
    if (at < 2) return setAt(at + 1);
    await markBackupChecked();
    success();
    setDone(true);
  };

  return (
    <Screen title="Backup check" large>
      <ScreenGuard />
      {done ? (
        <View style={{ gap: 18 }}>
          <IntroHero icon="check" title="Your backup works" text="You still have your words. I'll ask again in a month." />
          <Button title="Done" onPress={() => router.back()} />
        </View>
      ) : words ? (
        <>
          <T v="callout" dim style={{ lineHeight: 22 }}>Look at the paper you wrote your words on.</T>
          <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 4 }}>
            {checks.map((c, i) => <View key={c} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= at ? C.text : C.line2 }} />)}
          </View>
          <WordChoices n={checks[at] + 1} options={options} onPick={choose} />
          <ErrorText>{err}</ErrorText>
          <T v="caption" dim style={{ lineHeight: 18, textAlign: "center" }}>Can't find them? Open Security, then Recovery words, and write them down again.</T>
        </>
      ) : null}
    </Screen>
  );
}
