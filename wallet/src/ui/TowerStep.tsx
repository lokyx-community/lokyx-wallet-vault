import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Group, Note, Row } from './controls';
import { T } from './Text';
import { Icon } from './Icon';
import { C } from './theme';
import { useTowers } from '../lib/tower';

/**
 * The watchtower step of vault set-up, in plain words. LOKYX vaults can be watched by towers while the phone is off.
 * An Ethereum vault is watched by the phone itself, on every app open and in the background, so it says that instead
 * of promising a tower that does not watch Ethereum.
 */
export function TowerStep({ kind, onContinue, onBack }: { kind: 'lyx' | 'eth'; onContinue: () => void; onBack: () => void }) {
  const t = useTowers();
  const lyx = kind === 'lyx';
  return (
    <>
      <T v="headline">Who watches your vault</T>
      <Note>
        {lyx
          ? 'A watchtower is a small server that watches your vault while your phone is off. If someone queues a withdrawal you did not start, it alerts you on another device so you can cancel it. It holds no key and cannot move anything.'
          : 'Your phone watches this vault every time the app opens and in the background. If someone queues a withdrawal you did not start, you are told and can cancel it while it waits. Watchtower servers cover LOKYX vaults today, not Ethereum ones yet.'}
      </Note>
      <Group title="Watching for">
        <Row title="Withdrawals" sub="Queued, sent and cancelled" right={<Icon name="check" size={18} color={C.good} width={2.4} />} />
        <Row title="Rule changes" sub="Any change to the limit or the wait" right={<Icon name="check" size={18} color={C.good} width={2.4} />} />
      </Group>
      {lyx ? (
        <Group title="Towers">
          <Row title={t.urls.length ? `${t.urls.length} ${t.urls.length === 1 ? 'tower' : 'towers'} added` : 'No tower yet'} sub={t.urls.length ? 'Open to add or remove' : 'You can add one now or later'} onPress={() => router.push('/towers')} right={<Icon name="chevron" size={16} color={C.faint} width={2} />} />
        </Group>
      ) : null}
      <View style={{ height: 4 }} />
      <Button title="Continue" onPress={onContinue} />
      <Button title="Back" kind="plain" onPress={onBack} />
    </>
  );
}
