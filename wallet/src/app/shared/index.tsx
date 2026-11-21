import { useEffect, useState } from 'react';
import { PageHero } from '../../ui/AppCard';
import { View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { T } from '../../ui/Text';
import { ErrorText, Field, Group, Press, Row, Screen } from '../../ui/controls';
import { Primary } from '../../ui/Glass';
import { Icon } from '../../ui/Icon';
import { ApprovalRing } from '../../ui/ApprovalRing';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/Toast';
import { C, F } from '../../ui/theme';
import { useShared } from '../../lib/data';
import { addShared, resolveShared } from '../../lib/shared';
import { isAddress } from '../../lib/lokyx';
import { shortAddr } from '../../lib/format';
import { useBtcShared } from '../../lib/btcms';
import { useEthShared } from '../../lib/ethms';
import { netOfChainId } from '../../lib/ethms-core';
import { netLogoId } from '../../ui/CoinMark';
import type { LogoId } from '../../ui/logos';
import { useContractsOn } from '../../lib/chain';
import { Logo } from '../../ui/Logo';

/** Shared LYX accounts you are an owner of. */
export default function SharedList() {
  const list = useShared();
  const btcList = useBtcShared();
  const ethList = useEthShared();
  const contractsOn = useContractsOn();
  const [adding, setAdding] = useState(false);
  const all = [
    ...list.map((s) => ({ key: s.tx ?? s.address ?? s.name, name: s.name, sub: s.address ? `${shortAddr(s.address)}` : 'Being made… (about a minute)', n: 0, t: 0, logo: undefined as LogoId | undefined, go: s.address ? () => router.push(`/shared/${s.address}`) : undefined })),
    ...ethList.map((s) => ({ key: `${s.chainId}:${s.address}`, name: s.name, sub: `${s.threshold} of ${s.owners.length} · ${shortAddr(s.address)}`, n: s.owners.length, t: s.threshold, logo: ((netOfChainId(s.chainId) && netLogoId(netOfChainId(s.chainId)!)) || 'eth') as LogoId, go: () => router.push(`/shared/eth/${s.address}?chain=${s.chainId}`) })),
    ...btcList.map((s) => ({ key: s.address, name: s.name, sub: `${s.m} of ${s.keys.length} · ${shortAddr(s.address)}`, n: s.keys.length, t: s.m, logo: 'btc' as const, go: () => router.push(`/shared/btc/${s.address}`) })),
  ];
  const [addr, setAddr] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    resolveShared();
    const t = setInterval(resolveShared, 6000);
    return () => clearInterval(t);
  }, []);
  const add = async () => {
    setBusy(true);
    try {
      await addShared(name, addr.trim().toLowerCase());
      setAdding(false);
      setAddr('');
      setName('');
    } catch (e) {
      toast((e as Error).message, 'info');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Shared accounts">
      <PageHero kind="shared" small="Money moves when enough owners approve" />
      <T v="sub" dim style={{ lineHeight: 20 }}>Money moves only when enough owners approve. Each person keeps their own key on their own phone.</T>
      <Press onPress={() => router.push(contractsOn ? '/shared/new' : '/shared/eth/new')} scaleTo={0.985} style={{ borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)', padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <ApprovalRing n={3} have={2} need={2} size={64} stroke={6}>
          <Icon name="people" size={22} color={C.text} width={1.9} />
        </ApprovalRing>
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 17 }}>Make a shared account</T>
          <T v="caption" dim style={{ lineHeight: 18 }}>Pick the people and how many must agree.</T>
        </View>
        <Icon name="chevron" size={14} color={C.faint} width={2.2} />
      </Press>
      {all.length > 0 && (
        <Group title="Your accounts">
          {all.map((r) => (
            <Row key={r.key} title={r.name} sub={r.sub} right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>{r.logo ? <Logo id={r.logo} size={24} /> : null}{r.n ? <ApprovalRing n={Math.min(r.n, 10)} have={r.t} need={r.t} size={34} stroke={4} /> : <Icon name="people" size={20} color={C.sub} width={1.9} />}</View>} onPress={r.go} />
          ))}
        </Group>
      )}
      <Group title="Other">
        <View style={{ flexDirection: 'row', gap: 10, padding: 12 }}>
          {([['btc', 'Bitcoin', '/shared/btc/new'], ['eth', 'Ethereum', '/shared/eth/new']] as const).map(([id, name, to]) => (
            <Press key={id} onPress={() => router.push(to)} scaleTo={0.97} accessibilityLabel={`New shared ${name} account`} style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 20, padding: 14, gap: 12 }}>
              <Logo id={id} size={40} />
              <View style={{ gap: 2 }}>
                <T style={{ fontFamily: F.semibold, fontSize: 16 }}>{name}</T>
                <T v="caption" dim>Make or add one</T>
              </View>
            </Press>
          ))}
        </View>
        {contractsOn && <Row icon="plus" title="Add a LYX one you're part of" sub="Ask whoever made it for the address" onPress={() => setAdding(true)} />}
      </Group>
      <Sheet open={adding} onClose={() => setAdding(false)}>
        <View style={{ gap: 14 }}>
          <T v="headline">Add a shared account</T>
          <T v="sub" dim>Ask whoever made it for its address. You must be one of its owners.</T>
          <Field value={addr} onChangeText={setAddr} placeholder="lyx1…" autoCapitalize="none" autoCorrect={false} mono />
          <Field value={name} onChangeText={setName} placeholder="A name for it, like Family fund" maxLength={30} />
          <ErrorText hint>{addr.length > 8 && !isAddress(addr.trim().toLowerCase()) ? "That isn't a LOKYX address." : ''}</ErrorText>
          <Primary title="Add it" busy={busy} disabled={!isAddress(addr.trim().toLowerCase())} onPress={add} />
        </View>
      </Sheet>
    </Screen>
  );
}
