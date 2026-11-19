import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { T } from '../../ui/Text';
import { Field, Press, Screen } from '../../ui/controls';
import { Primary } from '../../ui/Glass';
import { Avatar } from '../../ui/RingCode';
import { ApprovalRing } from '../../ui/ApprovalRing';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/Toast';
import { C, F } from '../../ui/theme';
import { confirmIt } from '../../lib/auth';
import { useContacts } from '../../lib/data';
import { currentAddress } from '../../lib/wallet';
import { isAddress } from '../../lib/lokyx';
import { labelFor, shortAddr } from '../../lib/format';
import { makeShared } from '../../lib/shared';

/** Name it, add the people, pick how many must approve. You are always one of the owners. */
export default function NewShared() {
  const me = currentAddress();
  const people = useContacts();
  const [name, setName] = useState('');
  const [owners, setOwners] = useState<string[]>([me]);
  const [typed, setTyped] = useState('');
  const [need, setNeed] = useState(2);
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState(false);
  const add = (a: string) => {
    const x = a.trim().toLowerCase();
    if (!isAddress(x)) return toast("That isn't a LOKYX address", 'info');
    if (owners.includes(x)) return toast('Already on the list', 'info');
    if (owners.length >= 10) return toast('Up to 10 people', 'info');
    setOwners((o) => [...o, x]);
    setTyped('');
  };
  const n = owners.length;
  const t = Math.min(Math.max(1, need), n);
  const create = async () => {
    if (!(await confirmIt('Make the shared account', { keyFollows: true }))) return;
    setBusy(true);
    try {
      await makeShared(name, owners, t, start);
      toast('Being made. It shows up in about a minute.', 'info');
      router.replace('/shared');
    } catch (e) {
      toast((e as Error).message, 'info');
      setBusy(false);
    }
  };
  const lost = t === n ? 'If any one person loses their phone and words, the money is stuck. Pick fewer approvals than people.' : `If ${n - t === 1 ? 'one person loses' : `up to ${n - t} people lose`} their phone and words, the rest can still spend. ${t === 1 ? 'Any one person alone can spend, too.' : `Fewer than ${t} together can't.`}`;
  const [step, setStep] = useState(0);
  const titles = ['Who is in?', 'How many must agree?', 'Put some in now?'];
  const next = () => (step < 2 ? setStep(step + 1) : create());
  return (
    <Screen title={titles[step]} large>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: -8 }}>
        {[0, 1, 2].map((i) => <View key={i} style={{ height: 4, width: i === step ? 22 : 6, borderRadius: 2, backgroundColor: i <= step ? C.text : 'rgba(255,255,255,0.2)' }} />)}
      </View>
      {step === 0 && (
        <>
          <Field value={name} onChangeText={setName} placeholder="Name, like Family fund" maxLength={30} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18, paddingVertical: 8 }}>
            {owners.map((a) => (
              <Press key={a} onPress={a === me ? undefined : () => setOwners((o) => o.filter((x) => x !== a))} scaleTo={0.95} style={{ alignItems: 'center', gap: 6, width: 64 }}>
                <Avatar address={a} size={56} />
                <T v="caption" dim numberOfLines={1}>{a === me ? 'You' : shortAddr(a, 4, 3)}</T>
              </Press>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Field value={typed} onChangeText={setTyped} placeholder="Their lyx1… address" autoCapitalize="none" autoCorrect={false} mono />
            </View>
            <Press onPress={async () => (typed ? add(typed) : setTyped((await Clipboard.getStringAsync()).trim()))} style={{ height: 52, paddingHorizontal: 16, borderRadius: 16, backgroundColor: C.ink, justifyContent: 'center' }}>
              <T style={{ fontFamily: F.semibold, fontSize: 15, color: C.inkText }}>{typed ? 'Add' : 'Paste'}</T>
            </Press>
          </View>
          {people.filter((p) => !owners.includes(p.address)).length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {people.filter((p) => !owners.includes(p.address)).slice(0, 8).map((p) => (
                <Press key={p.address} onPress={() => add(p.address)} style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)', justifyContent: 'center' }}>
                  <T v="sub">{`+ ${p.name}`}</T>
                </Press>
              ))}
            </View>
          )}
          <Primary title="Next" disabled={n < 2} onPress={next} />
          {n < 2 ? <T v="caption" dim style={{ textAlign: 'center' }}>Add at least one more person.</T> : null}
        </>
      )}
      {step === 1 && (
        <>
          <View style={{ alignItems: 'center', paddingVertical: 14, gap: 14 }}>
            <ApprovalRing n={n} have={t} need={t} size={170} stroke={10}>
              <T style={{ fontFamily: F.regular, fontSize: 44, letterSpacing: -1.5 }}>{t}<T style={{ fontSize: 20, color: C.sub }}>{` of ${n}`}</T></T>
            </ApprovalRing>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Press onPress={() => setNeed(Math.max(1, t - 1))} accessibilityLabel="Fewer" style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}><T style={{ fontSize: 26 }}>−</T></Press>
              <Press onPress={() => setNeed(Math.min(n, t + 1))} accessibilityLabel="More" style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}><T style={{ fontSize: 26 }}>+</T></Press>
            </View>
          </View>
          <T v="callout" dim style={{ lineHeight: 22, textAlign: 'center' }}>{lost}</T>
          <T v="caption" dim style={{ textAlign: 'center', lineHeight: 18 }}>The people and the number can't be changed later. You'd make a new account.</T>
          <Primary title="Next" onPress={next} />
          <Press onPress={() => setStep(0)} style={{ alignItems: 'center', padding: 10 }}><T v="callout" dim>Back</T></Press>
        </>
      )}
      {step === 2 && (
        <>
          <Field value={start} onChangeText={setStart} placeholder="LYX to put in now (optional)" keyboardType="decimal-pad" />
          <T v="caption" dim style={{ lineHeight: 18 }}>{`${name.trim() || 'Your shared account'} · ${t} of ${n} must agree. You can add money any time.`}</T>
          <Primary title="Make it" busy={busy} onPress={next} />
          <Press onPress={() => setStep(1)} style={{ alignItems: 'center', padding: 10 }}><T v="callout" dim>Back</T></Press>
        </>
      )}
    </Screen>
  );
}
