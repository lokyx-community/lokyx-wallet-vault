import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { T } from '../../../ui/Text';
import { Button, Field, Group, Press, Screen } from '../../../ui/controls';
import { Segmented } from '../../../ui/Segmented';
import { Icon } from '../../../ui/Icon';
import { Sheet } from '../../../ui/Sheet';
import { toast } from '../../../ui/Toast';
import { NetMark } from '../../../ui/CoinMark';
import { LeadRow } from '../../../ui/LeadRow';
import { Stepper } from '../../../ui/Stepper';
import { C, F } from '../../../ui/theme';
import { confirmIt } from '../../../lib/auth';
import { activeNets, ensureAddresses, useChainSettings } from '../../../lib/multichain';
import { ETH_NETS, ethAddressOk, ethNetChoices, type EthNet } from '../../../lib/multichain-core';
import { sharedAddress } from '../../../lib/ethms-core';
import { groupKeyOk } from '../../../lib/relay-seal';
import { addEthShared, safeReady } from '../../../lib/ethms';

const avatar = (t: string) => (
  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}>
    <T style={{ fontFamily: F.semibold, fontSize: 15, color: C.soft }}>{t}</T>
  </View>
);
const radio = (on: boolean) => (
  <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.ink : 'transparent', borderWidth: on ? 0 : 1.5, borderColor: C.line2 }}>
    {on ? <Icon name="check" size={15} color={C.inkText} width={2.6} /> : null}
  </View>
);

/** A shared account (a Safe) on any Ethereum-style network. One person creates it on chain; the others add the same people and number. */
export default function NewEthShared() {
  const cfg = useChainSettings();
  const nets = useMemo(() => ethNetChoices(cfg.allowMainnet), [cfg.allowMainnet]);
  const [net, setNet] = useState<EthNet>(() => (nets.includes(activeNets().eth) ? activeNets().eth : nets[0]));
  const [pick, setPick] = useState(false);
  const [q, setQ] = useState('');
  const [ready, setReady] = useState<'checking' | 'yes' | 'no'>('checking');
  const [me, setMe] = useState('');
  const [name, setName] = useState('');
  const [others, setOthers] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [need, setNeed] = useState(2);
  const [mode, setMode] = useState<'make' | 'add'>('make');
  const [busy, setBusy] = useState(false);
  const [relayKey, setRelayKey] = useState('');
  useEffect(() => {
    ensureAddresses().then((a) => setMe(a.eth), () => {});
  }, []);
  // Safe's contracts have to exist on the network before anything is created there
  useEffect(() => {
    let live = true;
    setReady('checking');
    safeReady(net).then((ok) => live && setReady(ok ? 'yes' : 'no'), () => live && setReady('no'));
    return () => {
      live = false;
    };
  }, [net]);
  const owners = me ? [me, ...others] : others;
  const n = owners.length;
  const t = Math.min(Math.max(1, need), Math.max(1, n));
  const add = (x: string) => {
    const a = x.trim();
    if (!ethAddressOk(a)) return toast("That isn't an Ethereum address", 'info');
    if (owners.some((o) => o.toLowerCase() === a.toLowerCase())) return toast('Already on the list', 'info');
    setOthers((o) => [...o, a]);
    setTyped('');
  };
  let preview = '';
  try {
    preview = n >= 2 ? sharedAddress({ owners: owners as `0x${string}`[], threshold: t }) : '';
  } catch {}
  const shown = nets.filter((x) => ETH_NETS[x].label.toLowerCase().includes(q.trim().toLowerCase()));
  const netSub = ready === 'checking' ? 'Checking Safe on this network…' : ready === 'yes' ? 'Safe is on this network' : 'Safe is not on this network yet';

  return (
    <Screen title="New shared account" large>
      <Segmented value={mode} onChange={setMode} options={[['make', 'Make one'], ['add', "I've been added"]]} />
      <T v="sub" dim style={{ lineHeight: 21, fontSize: 14.5, paddingHorizontal: 6 }}>{mode === 'make' ? 'Money moves when enough people approve. You pay the network fee once.' : 'Enter the same network, people and number as whoever made it.'}</T>
      <Field value={name} onChangeText={setName} placeholder="Name, like Family fund" maxLength={30} />
      {mode === 'add' ? <Field value={relayKey} onChangeText={setRelayKey} placeholder="Relay key from the setup message (optional)" autoCapitalize="none" autoCorrect={false} mono /> : null}

      <Group title="Network">
        <LeadRow lead={<NetMark net={net} size={40} />} title={ETH_NETS[net].label} sub={netSub} subColor={ready === 'no' ? C.wait : undefined} chevron onPress={() => setPick(true)} />
      </Group>

      <Group title="People">
        {me ? <LeadRow lead={avatar('Y')} title="You" sub={`${me.slice(0, 8)}…${me.slice(-6)}`} /> : <></>}
        {others.map((a, i) => (
          <LeadRow key={a} lead={avatar(String(i + 2))} title={`${a.slice(0, 8)}…${a.slice(-6)}`} right={<Press onPress={() => setOthers((o) => o.filter((x) => x !== a))} hitSlop={10}><Icon name="close" size={16} color={C.sub} /></Press>} />
        ))}
      </Group>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Field value={typed} onChangeText={setTyped} placeholder="Add a person: 0x…" autoCapitalize="none" autoCorrect={false} mono /></View>
        <Press onPress={async () => (typed ? add(typed) : add(await Clipboard.getStringAsync()))} style={{ height: 56, paddingHorizontal: 22, borderRadius: 28, backgroundColor: C.ink, justifyContent: 'center' }}>
          <T style={{ fontFamily: F.semibold, fontSize: 15, color: C.inkText }}>{typed ? 'Add' : 'Paste'}</T>
        </Press>
      </View>

      <Group title="Approvals needed"><View style={{ padding: 0 }}><Stepper t={t} n={n} onChange={setNeed} /></View></Group>
      {preview ? (
        <View style={{ borderRadius: 24, backgroundColor: C.fill, padding: 16, gap: 4 }}>
          <T v="caption" dim>Its address, the same on every network</T>
          <T v="mono" selectable style={{ fontSize: 13 }}>{preview}</T>
        </View>
      ) : null}
      <Button
        title={mode === 'make' ? 'Create account' : 'Add account'}
        busy={busy}
        disabled={!me || n < 2 || (mode === 'make' && ready !== 'yes')}
        onPress={async () => {
          if (mode === 'make' && !(await confirmIt(`Create the shared account on ${ETH_NETS[net].label} (network fee)`))) return;
          setBusy(true);
          try {
            if (mode === 'add' && relayKey.trim() && !groupKeyOk(relayKey)) throw new Error("That relay key isn't valid. Copy it again from the setup message.");
            const s = await addEthShared(name, owners, t, mode === 'make', net, mode === 'add' ? relayKey : undefined);
            router.replace(`/shared/eth/${s.address}?chain=${s.chainId}`);
          } catch (e) {
            toast((e as Error).message, 'info');
            setBusy(false);
          }
        }}
      />
      {mode === 'make' ? <T v="caption" dim style={{ textAlign: 'center' }}>{`Creating it costs a small network fee on ${ETH_NETS[net].label}.`}</T> : null}

      <Sheet open={pick} onClose={() => setPick(false)}>
        <View style={{ gap: 12 }}>
          <T v="title">Network</T>
          <Field value={q} onChangeText={setQ} placeholder={`Search ${nets.length} networks`} autoCapitalize="none" autoCorrect={false} style={{ height: 48 }} />
          <Group>
            {shown.map((x) => (
              <LeadRow key={x} lead={<NetMark net={x} size={36} />} title={ETH_NETS[x].label} sub={ETH_NETS[x].real ? '' : 'Test network'} right={radio(x === net)} onPress={() => { setNet(x); setPick(false); setQ(''); }} />
            ))}
          </Group>
          <T v="caption" dim style={{ textAlign: 'center', lineHeight: 18 }}>Safe's audited contracts are checked on the network before you pay anything.</T>
        </View>
      </Sheet>
    </Screen>
  );
}
