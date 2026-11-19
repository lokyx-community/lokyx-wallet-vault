import { useState } from 'react';
import { View } from 'react-native';
import { T } from '../ui/Text';
import { Button, ErrorText, Field, Note, Screen } from '../ui/controls';
import { C } from '../ui/theme';
import { Timeline } from '../ui/Timeline';
import { ConfirmOp } from '../ui/ConfirmOp';
import { currentAddress } from '../lib/wallet';
import { isAddress } from '../lib/lokyx';
import { inTime, KEY_THEFT_NOTICE } from '../lib/vault-core';
import { usePoll, type Account, type ChainInfo } from '../lib/rpc';
import { labelFor } from '../lib/format';

/** Hand this account to a new key after a wait. For planned key changes and lost devices, not for theft. */
export default function Rotate() {
  const me = currentAddress();
  const acct = usePoll<Account>('lyx_getAccount', { address: me }, 6000);
  const info = usePoll<ChainInfo>('lyx_chainInfo', {}, 6000);
  const bt = info.data?.targetBlockTime ?? 60;
  const height = info.data?.height ?? 0;
  const [to, setTo] = useState('');
  const [ready, setReady] = useState(false);
  const a = acct.data;
  const pending = a?.pendingRotation;
  const delay = a?.vault ? a.vault.settings.delayBlocks : Math.floor(86_400 / bt);
  const valid = isAddress(to.trim());

  return (
    <Screen title="Rotate key" large>
      <View style={{ padding: 18, borderRadius: 24, backgroundColor: C.fill }}>
        <T v="callout">{KEY_THEFT_NOTICE}</T>
      </View>
      <T v="callout" dim style={{ lineHeight: 22 }}>Hand this account to a new key. For planned changes and lost devices.</T>
      <Timeline steps={[['Today', 'You start the rotation'], [`The next ${inTime(delay, bt)}`, 'Your current key still works, and you can cancel'], ['Then', 'The new key takes over and the old key stops']]} />
      {pending ? (
        <>
          <T style={{ fontFamily: "Geist_600SemiBold", fontSize: 22 }}>A rotation is waiting</T>
          <Note>{labelFor(pending.newKey)} takes over in {inTime(pending.releaseHeight - height, bt)}. If you did not start this, cancel it now.</Note>
          <ConfirmOp op={{ kind: 'keyCancelRotate', account: me }} me={me} blockTime={bt} label="Slide to cancel" onDone={acct.refresh} />
        </>
      ) : (
        <>
          <Field value={to} onChangeText={(t) => { setTo(t); setReady(false); }} placeholder="lyx1… the new key's address" autoCapitalize="none" autoCorrect={false} mono style={{ height: 60, borderRadius: 22, fontSize: 14 }} />
          <ErrorText>{to && !valid ? 'That is not a valid lyx1 address.' : ''}</ErrorText>
          {ready && valid ? (
            <ConfirmOp op={{ kind: 'keyRotate', newKey: to.trim().toLowerCase() }} me={me} blockTime={bt} delayBlocks={delay} label="Slide to start rotation" onDone={acct.refresh} />
          ) : (
            <Button title="Review" disabled={!valid} onPress={() => setReady(true)} />
          )}
        </>
      )}
    </Screen>
  );
}
