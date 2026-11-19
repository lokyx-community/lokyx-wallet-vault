import { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { T } from '../../../ui/Text';
import { Field, Press, Screen } from '../../../ui/controls';
import { Label, Panel, GRow, Primary, Secondary } from '../../../ui/Glass';
import { Icon } from '../../../ui/Icon';
import { toast } from '../../../ui/Toast';
import { C, F } from '../../../ui/theme';
import { Stepper } from '../../../ui/Stepper';
import { groupKeyOk, newGroupKey } from '../../../lib/relay-seal';
import { activeNets } from '../../../lib/multichain';
import { KEY_PREFIX, msAddress, parseKey } from '../../../lib/btcms-core';
import { addBtcShared, myMsPub } from '../../../lib/btcms';
import { logEvent } from '../../../lib/events';

/**
 * A shared Bitcoin account. Nothing goes on chain to make one: everyone puts in the same keys and number,
 * and every phone works out the same address. So each person shares their key, then everyone adds the rest.
 */
export default function NewBtcShared() {
  const net = activeNets().btc;
  const [mine, setMine] = useState('');
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [others, setOthers] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [need, setNeed] = useState(2);
  const [relayKey, setRelayKey] = useState(() => newGroupKey());
  useEffect(() => {
    myMsPub(net).then(setMine, (e) => setErr((e as Error).message));
  }, [net]);
  const keys = mine ? [mine, ...others] : others;
  const n = keys.length;
  const t = Math.min(Math.max(1, need), Math.max(1, n));
  const add = (text: string) => {
    const k = parseKey(text);
    if (!k) return toast("That isn't a shared-account key", 'info');
    if (keys.includes(k)) return toast('Already on the list', 'info');
    setOthers((o) => [...o, k]);
    setTyped('');
  };
  let preview = '';
  try {
    preview = n >= 2 ? msAddress({ m: t, keys, net }) : '';
  } catch {}

  return (
    <Screen title="Shared Bitcoin account" large>
      <T v="callout" dim style={{ lineHeight: 22 }}>Everyone shares their key, then everyone adds the others' keys and the same number of approvals. Each phone then shows the same address: check the last characters match before anyone sends to it.</T>
      <Label>Your key</Label>
      <Panel style={{ paddingVertical: 12, gap: 10 }}>
        <T v="mono" color={C.soft} selectable style={{ fontSize: 12.5 }}>{mine || err || 'Unlock to see your key…'}</T>
        {mine ? <Secondary title="Share my key" onPress={() => Share.share({ message: `${KEY_PREFIX}${mine}` })} /> : null}
      </Panel>
      <Field value={name} onChangeText={setName} placeholder="Name, like Family savings" maxLength={30} style={{ height: 56, borderRadius: 20 }} />
      <Label>The others' keys</Label>
      <Panel>
        {others.length ? others.map((k) => (
          <GRow key={k} icon="key" title={`${k.slice(0, 10)}…${k.slice(-8)}`} right={<Press onPress={() => setOthers((o) => o.filter((x) => x !== k))} hitSlop={10}><Icon name="close" size={16} color={C.sub} /></Press>} />
        )) : <T v="sub" dim style={{ paddingVertical: 16 }}>None yet</T>}
      </Panel>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field value={typed} onChangeText={setTyped} placeholder="lokyx-btckey:…" autoCapitalize="none" autoCorrect={false} mono />
        </View>
        <Press onPress={async () => (typed ? add(typed) : add(await Clipboard.getStringAsync()))} style={{ height: 52, paddingHorizontal: 20, borderRadius: 26, backgroundColor: C.ink, justifyContent: 'center' }}>
          <T style={{ fontFamily: F.semibold, fontSize: 15, color: C.inkText }}>{typed ? 'Add' : 'Paste'}</T>
        </Press>
      </View>
      <Label>Automatic approvals</Label>
      <Panel style={{ paddingVertical: 12, gap: 10 }}>
        <T v="caption" dim style={{ lineHeight: 18 }}>One person shares this key, everyone else pastes it here. It lets your phones pass payments to each other without copying codes.</T>
        <Field value={relayKey} onChangeText={setRelayKey} autoCapitalize="none" autoCorrect={false} mono />
        <Secondary title="Share the relay key" onPress={() => Share.share({ message: `Relay key for our shared Bitcoin account: ${relayKey}` })} />
      </Panel>
      <Label>Approvals needed</Label>
      <Stepper t={t} n={n} onChange={setNeed} />
      {preview ? (
        <Panel style={{ paddingVertical: 12 }}>
          <T v="caption" dim>The address everyone should see</T>
          <T v="mono" selectable style={{ fontSize: 13, paddingTop: 4 }}>{preview}</T>
        </Panel>
      ) : null}
      <T v="caption" dim style={{ lineHeight: 18 }}>Each person's key comes from their own 24 words, so a lost phone is fixed by restoring the words. If more than {Math.max(0, n - t)} people lose their words for good, the money is stuck.</T>
      <Primary
        title="Add this account"
        disabled={!mine || n < 2}
        onPress={async () => {
          try {
            if (!groupKeyOk(relayKey)) throw new Error("That relay key isn't valid. Copy it again.");
            const s = await addBtcShared({ name: name.trim() || 'Shared Bitcoin', net, m: t, keys }, relayKey);
            logEvent('shared', 'Shared account made', `${name.trim() || 'Shared Bitcoin'} · ${t} of ${n}`);
            router.replace(`/shared/btc/${s.address}`);
          } catch (e) {
            toast((e as Error).message, 'info');
          }
        }}
      />
    </Screen>
  );
}
