import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { T } from '../ui/Text';
import { Button, Note, Screen } from '../ui/controls';
import { SaveBackup } from '../ui/BackupSheets';
import { Icon } from '../ui/Icon';
import { C } from '../ui/theme';
import { readPhrase } from '../lib/wallet';
import { confirmIt } from '../lib/auth';
import { WordGrid } from '../ui/WordGrid';
import { ScreenGuard } from '../ui/ScreenGuard';

export default function Backup() {
  const [words, setWords] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    // hide them again whenever the screen is left
    return () => setWords(null);
  }, []);
  const show = async () => {
    if (!(await confirmIt('Show your recovery words', { keyFollows: true }))) return;
    const p = await readPhrase();
    setWords(p ? p.split(' ') : []);
  };
  return (
    <Screen title="Recovery words" large>
      <ScreenGuard />
      <Note>These words bring your wallet back on any phone. Anyone who sees them can take everything, so only look somewhere private. LOKYX will never ask you for them.</Note>
      {words ? (
        <>
          <WordGrid words={words} />
          <Button title="Save an encrypted backup (QR or text)" kind="line" onPress={() => setSaving(true)} />
          <SaveBackup open={saving} onClose={() => setSaving(false)} secret={words.join(' ')} kind="wallet" />
          <Button title="Done" kind="line" onPress={() => router.back()} />
        </>
      ) : (
        <View style={{ alignItems: 'center', gap: 18, paddingVertical: 40 }}>
          <View style={{ width: 84, height: 84, borderRadius: 28, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="words" size={38} color={C.text} width={1.6} />
          </View>
          <Button title="Show my words" onPress={show} style={{ alignSelf: 'stretch' }} />
        </View>
      )}
    </Screen>
  );
}
