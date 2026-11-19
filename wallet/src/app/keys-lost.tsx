import { useState } from 'react';
import { View } from 'react-native';
import { T } from '../ui/Text';
import { Button, ErrorText, Field, Note, Screen, success } from '../ui/controls';
import { C } from '../ui/theme';
import { normalizeMnemonic } from '../lib/lokyx';
import { restoreKeys, retryKeys } from '../lib/wallet';
import { ScreenGuard } from '../ui/ScreenGuard';
import { PhraseEntry } from '../ui/PhraseEntry';
import { IntroHero } from '../ui/Feature';
import { OpenBackup } from '../ui/BackupSheets';

/**
 * The phone could not open the stored keys. That can be permanent (fingerprint or face settings changed) or a
 * passing Android error, so the first thing offered is "Try again". Restoring asks for the words first and
 * only replaces the stored keys if they match this wallet's address. Nothing is erased on this screen.
 */
export default function KeysLost() {
  const [mode, setMode] = useState<'start' | 'words'>('start');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [bk, setBk] = useState(false);
  const n = normalizeMnemonic(text).split(' ').filter(Boolean).length;

  const again = async () => {
    setErr('');
    setBusy(true);
    const r = await retryKeys();
    setBusy(false);
    if (r === 'ok') return success(); // the layout lets the wallet through once the state clears
    setErr(r === 'cancelled' ? 'Cancelled. Nothing was changed.' : r === 'still-lost' ? "Still can't open them. If this keeps happening, restore from your 24 words." : 'Something went wrong reading the keys. Nothing was changed. Try again in a moment.');
  };

  const restore = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await restoreKeys(text);
      if (r.ok) return success();
      setErr(
        r.reason === 'bad-words'
          ? n === 12 || n === 24 ? "One of those words is wrong, or they're out of order. Nothing was changed." : 'Enter all 12 or 24 words, with spaces between them. Nothing was changed.'
          : r.reason === 'mismatch'
            ? "Those words belong to a different wallet, not this one. Nothing was changed."
            : 'There is no wallet on this phone to restore into.',
      );
    } catch (e) {
      setErr(`${(e as Error).message} Nothing about your wallet was erased; try again.`);
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'words') {
    return (
      <Screen title="" large>
        <ScreenGuard />
        <View style={{ gap: 10, paddingTop: 8 }}>
          <T v="display">Restore your keys</T>
          <T v="callout" dim style={{ lineHeight: 22 }}>Type your 24 words. They are checked against this wallet first, and only if they match are the keys put back.</T>
        </View>
        <PhraseEntry value={text} onChange={setText} />
        <Button title="Use an encrypted backup instead" kind="line" onPress={() => setBk(true)} />
        <OpenBackup open={bk} onClose={() => setBk(false)} kind="wallet" onSecret={setText} />
        <ErrorText>{err}</ErrorText>
        <Button title={busy ? 'Checking…' : 'Check and restore'} busy={busy} disabled={n < 12} onPress={restore} />
        <Button title="Back" kind="plain" onPress={() => { setErr(''); setMode('start'); }} />
      </Screen>
    );
  }

  return (
    <Screen title="" large>
      <IntroHero icon="key" title="Your keys can't be opened" text="The phone couldn't open the keys it stores for LOKYX. That is sometimes a passing error, so try again first. If your Face ID or fingerprint settings changed, the phone removes the keys on purpose, and you restore from your words." />
      <T v="callout" style={{ textAlign: 'center' }}>Your money is safe either way. Nothing on this phone has been erased.</T>
      <ErrorText>{err}</ErrorText>
      <Button title={busy ? 'Trying…' : 'Try again'} busy={busy} onPress={again} />
      <Button title="Restore from my 24 words" kind="line" onPress={() => { setErr(''); setMode('words'); }} />
      <T v="caption" dim style={{ lineHeight: 18, textAlign: "center" }}>If you don't have your words and the keys stay locked, the money cannot be recovered. Nobody, including LOKYX, can reset this.</T>
    </Screen>
  );
}
