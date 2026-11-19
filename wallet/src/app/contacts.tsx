import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Button, ErrorText, Field, Note, Press, Screen, success } from '../ui/controls';
import { Sheet } from '../ui/Sheet';
import { Avatar } from '../ui/RingCode';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/EmptyState';
import { C, F } from '../ui/theme';
import { contacts, useContacts, type Contact } from '../lib/data';
import { isAddress } from '../lib/lokyx';
import { shortAddr } from '../lib/format';
import { DUR, EASE_OUT } from '../ui/motion';

export default function Contacts() {
  const list = useContacts();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Contact | null>(null);
  const [name, setName] = useState('');
  const [addr, setAddr] = useState('');
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const f = q.trim().toLowerCase();
    const out: { letter: string; items: Contact[] }[] = [];
    for (const c of list.filter((x) => !f || x.name.toLowerCase().includes(f) || x.address.includes(f))) {
      const l = (c.name[0] ?? '#').toUpperCase();
      const g = out[out.length - 1];
      if (g && g.letter === l) g.items.push(c);
      else out.push({ letter: l, items: [c] });
    }
    return out;
  }, [list, q]);

  const start = (c?: Contact) => {
    setEdit(c ?? null);
    setName(c?.name ?? '');
    setAddr(c?.address ?? '');
    setErr('');
    setOpen(true);
  };
  const save = async () => {
    const a = addr.trim().toLowerCase();
    if (!name.trim()) return setErr('Give them a name');
    if (!isAddress(a)) return setErr("That isn't a LOKYX address");
    await contacts.save((x) => [...x.filter((c) => c.address !== a && c.address !== edit?.address), { name: name.trim(), address: a }].sort((p, q) => p.name.localeCompare(q.name)));
    success();
    setOpen(false);
  };

  return (
    <Screen title="People" large right={<Press onPress={() => start()} accessibilityLabel="Add someone" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={20} color={C.text} width={2} /></Press>}>
      {list.length === 0 && <EmptyState icon="people" title="No one saved yet" body="Save the people you pay, and you see their names instead of long addresses." />}
      {list.length > 4 && <Field value={q} onChangeText={setQ} placeholder="Search" autoCapitalize="none" autoCorrect={false} style={{ height: 46, borderRadius: 14 }} />}
      {groups.map((g) => (
        <View key={g.letter}>
          <T v="sub" dim style={{ paddingHorizontal: 6, paddingBottom: 6, fontFamily: F.medium }}>{g.letter}</T>
          <View style={{ borderRadius: 24, backgroundColor: C.fill, overflow: 'hidden' }}>
            {g.items.map((c, i) => (
              <Animated.View key={c.address} entering={FadeInDown.delay(i * 30).duration(DUR.base).easing(EASE_OUT)} exiting={FadeOut} layout={LinearTransition.duration(DUR.base).easing(EASE_OUT)}>
                <Press haptic={false} scaleTo={0.98} onPress={() => start(c)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: i ? 0.5 : 0, borderTopColor: C.line2 }}>
                  <Avatar address={c.address} size={48} name={c.name} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T style={{ fontFamily: F.semibold, fontSize: 16.5 }}>{c.name}</T>
                    <T v="caption" dim>{shortAddr(c.address)}</T>
                  </View>
                  <Press onPress={() => router.push(`/send?to=${c.address}`)} style={{ paddingHorizontal: 16, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center' }}>
                    <T style={{ fontFamily: F.semibold, fontSize: 14 }}>Pay</T>
                  </Press>
                </Press>
              </Animated.View>
            ))}
          </View>
        </View>
      ))}
      {list.length === 0 && <Button title="Add someone" icon="plus" kind="line" onPress={() => start()} />}

      <Sheet open={open} onClose={() => setOpen(false)}>
        <View style={{ gap: 14 }}>
          <T v="title">{edit ? edit.name : 'Add someone'}</T>
          <Field value={name} onChangeText={setName} placeholder="Name" autoFocus={!edit} maxLength={32} style={{ height: 56, borderRadius: 20 }} />
          <Field value={addr} onChangeText={setAddr} placeholder="lyx1…" autoCapitalize="none" autoCorrect={false} mono style={{ height: 56, borderRadius: 20 }} />
          <ErrorText>{err}</ErrorText>
          <Button title="Save" onPress={save} />
          {edit && (
            <Button
              title="Delete"
              kind="plain"
              onPress={async () => {
                await contacts.save((x) => x.filter((c) => c.address !== edit.address));
                setOpen(false);
              }}
            />
          )}
        </View>
      </Sheet>
    </Screen>
  );
}
