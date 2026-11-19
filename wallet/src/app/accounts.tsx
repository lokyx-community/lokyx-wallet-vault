import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Button, ErrorText, Field, Note, Press, Screen, success, tick } from '../ui/controls';
import { Sheet } from '../ui/Sheet';
import { Avatar } from '../ui/RingCode';
import { Icon } from '../ui/Icon';
import { C } from '../ui/theme';
import { usePoll, type Account } from '../lib/rpc';
import { addAccount, renameAccount, switchAccount, useWallet, type AccountRef } from '../lib/wallet';
import { niceLyx, shortAddr } from '../lib/format';
import { DUR, EASE_OUT } from '../ui/motion';

function AccountRow({ a, on, onEdit }: { a: AccountRef; on: boolean; onEdit: () => void }) {
  const bal = usePoll<Account>('lyx_getAccount', { address: a.address }, 15000).data;
  return (
    <Press
      haptic={false}
      scaleTo={0.98}
      onPress={async () => {
        tick();
        await switchAccount(a.index);
        router.back();
      }}
      onLongPress={onEdit}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16 }}
    >
      <Avatar address={a.address} size={46} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="headline">{a.name}</T>
        <T v="caption" dim>{shortAddr(a.address)}</T>
      </View>
      <T v="callout">{bal ? `${niceLyx(bal.balanceLyx, 2)} LYX` : ''}</T>
      {on && <Icon name="check" size={18} color={C.good} width={2.6} />}
    </Press>
  );
}

export default function Accounts() {
  const w = useWallet();
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<AccountRef | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  return (
    <Screen title="Accounts" large>
      <T v="callout" dim style={{ lineHeight: 22 }}>Every account comes from your 24 words, so one backup covers all of them. Tap one to use it, or press and hold to rename.</T>
      <Animated.View layout={LinearTransition.duration(DUR.base).easing(EASE_OUT)} style={{ borderRadius: 24, backgroundColor: C.fill, overflow: 'hidden' }}>
        {w.accounts.map((a, i) => (
          <Animated.View key={a.index} entering={FadeInDown.delay(i * 40).duration(DUR.base).easing(EASE_OUT)} style={{ borderTopWidth: i ? 0.5 : 0, borderTopColor: C.line2 }}>
            <AccountRow
              a={a}
              on={a.index === w.current}
              onEdit={() => {
                setName(a.name);
                setEdit(a);
              }}
            />
          </Animated.View>
        ))}
      </Animated.View>
      <Button title="New account" icon="plus" kind="line" onPress={() => (setName(''), setAdding(true))} />
      <Sheet open={adding || !!edit} onClose={() => (setAdding(false), setEdit(null))}>
        <View style={{ gap: 16 }}>
          <T v="title">{edit ? 'Rename' : 'New account'}</T>
          <Field value={name} onChangeText={setName} placeholder={edit ? edit.name : 'Like Savings, or Shop'} autoFocus maxLength={24} style={{ height: 56, borderRadius: 20 }} />
          <ErrorText>{err}</ErrorText>
          <Button
            title={edit ? 'Save' : 'Make it'}
            busy={busy}
            onPress={async () => {
              setErr('');
              setBusy(true);
              try {
                if (edit) await renameAccount(edit.index, name);
                else await addAccount(name);
                success();
                setAdding(false);
                setEdit(null);
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
