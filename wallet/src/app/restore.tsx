import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { T } from '../ui/Text';
import { Button, ErrorText, Field, Note, Screen, success } from '../ui/controls';
import { C } from '../ui/theme';
import { isMnemonic, normalizeMnemonic } from '../lib/lokyx';
import { createFromPhrase } from '../lib/wallet';
import { askVaultFirst } from '../lib/vaultfirst';

import { markNewDevice } from '../lib/guard';
import { ScreenGuard } from '../ui/ScreenGuard';
import { PhraseEntry } from '../ui/PhraseEntry';
import * as Clipboard from 'expo-clipboard';
import { OpenBackup } from '../ui/BackupSheets';

export default function Restore() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [bk, setBk] = useState(false);
  const n = normalizeMnemonic(text).split(' ').filter(Boolean).length;

  const go = async () => {
    setErr('');
    if (!isMnemonic(text)) return setErr(n === 12 || n === 24 ? "One of those words is wrong, or they're out of order." : 'Enter all 12 or 24 words, with spaces between them.');
    setBusy(true);
    try {
      await createFromPhrase(text);
      await markNewDevice();
      await askVaultFirst();
      success();
      router.replace('/secure');
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Screen title="" back>
      <ScreenGuard />
      <View style={{ gap: 10, paddingTop: 8 }}>
        <T v="display">Bring your wallet back</T>
        <T v="callout" dim style={{ lineHeight: 22 }}>Type or paste your 12 or 24 words, in order.</T>
      </View>
      <PhraseEntry value={text} onChange={setText} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button title="Paste" kind="line" onPress={async () => setText((await Clipboard.getStringAsync()).trim())} /></View>
        <View style={{ flex: 1 }}><Button title="Encrypted backup" kind="line" onPress={() => setBk(true)} /></View>
      </View>
      <OpenBackup open={bk} onClose={() => setBk(false)} kind="wallet" onSecret={setText} />
      <T v="caption" dim style={{ lineHeight: 18 }}>Your words stay on this phone. Nobody, including LOKYX, can see them.</T>
      <ErrorText>{err}</ErrorText>
      <Button title={busy ? 'Opening…' : 'Continue'} busy={busy} disabled={n < 12} onPress={go} />
    </Screen>
  );
}
