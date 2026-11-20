import { useState } from 'react';
import { Aurora } from '../../ui/Aurora';
import { useChainSettings } from '../../lib/multichain';
import { Alert, Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import Animated, { FadeIn } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Group, Press, Row, success } from '../../ui/controls';
import { Avatar } from '../../ui/RingCode';
import { Segmented } from '../../ui/Segmented';
import { WalletCard } from '../../ui/WalletCards';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/Toast';
import { C, F } from '../../ui/theme';
import { lock, switchAccount, useAccountRef, useWallet, wipe } from '../../lib/wallet';
import { resetCapsules } from '../../lib/capsules';
import { resetData, useContacts } from '../../lib/data';
import { useNodeUrl } from '../../lib/rpc';
import { confirmIt } from '../../lib/auth';
import { shortAddr } from '../../lib/format';

export default function You() {
  const insets = useSafeAreaInsets();
  const me = useAccountRef();
  const w = useWallet();
  const chain = useChainSettings();
  const people = useContacts();
  const node = useNodeUrl();

  const remove = () => {
    const go = async () => {
      if (!(await confirmIt('Remove the wallet from this phone'))) return;
      await wipe();
      resetData();
      resetCapsules();
    };
    const msg = "Your LYX stays on the network, but this phone forgets the wallet. You'll need your 24 words to get back in.";
    if (Platform.OS === 'web') {
      if (confirm(msg)) go();
    } else
      Alert.alert('Remove this wallet?', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: go },
      ]);
  };

  const { width: sw } = useWindowDimensions();
  const [tab, setTab] = useState<'wallet' | 'safety' | 'advanced'>('wallet');
  const cw = Math.min(sw, 560) - 40;
  const ch = Math.round(cw / 1.586);
  const copy = async () => {
    await Clipboard.setStringAsync(me?.address ?? '');
    success();
    toast('Address copied', 'copy');
  };
  const dot = { height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.28)', alignItems: 'center' as const, justifyContent: 'center' as const };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <Aurora />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: insets.bottom + 130, gap: 18 }}>
      <T v="display">You</T>
      <Animated.View entering={FadeIn} style={{ width: cw, height: ch, alignSelf: 'center' }}>
        <WalletCard c={{ kind: 'lyx', title: me?.name ?? 'My wallet', sub: 'My wallet', balance: ' ', unit: '', address: '' }} width={cw} />
        <View style={{ position: 'absolute', left: 20, right: 20, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Press onPress={copy} accessibilityLabel="Copy address" style={[dot, { flexDirection: 'row', gap: 9, paddingHorizontal: 15 }]}>
            <T style={{ fontFamily: F.mono, fontSize: 12.5, color: '#fff' }}>{shortAddr(me?.address ?? '', 9, 6)}</T>
            <Icon name="copy" size={15} color="#fff" />
          </Press>
          <Press onPress={() => router.push('/ring')} accessibilityLabel="Show my QR code" style={[dot, { width: 38 }]}>
            <Icon name="qr" size={18} color="#fff" />
          </Press>
        </View>
      </Animated.View>

      <Segmented<'wallet' | 'safety' | 'advanced'> value={tab} onChange={setTab} options={[['wallet', 'Wallet'], ['safety', 'Safety'], ['advanced', 'Advanced']]} />

      {tab === 'wallet' && (
        <>
          <View style={{ gap: 10 }}>
            <T v="sub" dim style={{ paddingHorizontal: 6 }}>Your accounts</T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 10, paddingHorizontal: 20 }}>
              {w.accounts.map((a) => {
                const on = a.index === w.current;
                return (
                  <Press key={a.index} onPress={() => switchAccount(a.index)} accessibilityLabel={`Use ${a.name}`} style={{ width: 150, borderRadius: 22, padding: 15, gap: 18, backgroundColor: on ? '#17171C' : '#0B0B0E', borderWidth: on ? 1 : 0.5, borderColor: on ? 'rgba(255,255,255,0.45)' : '#2A2A31' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Avatar address={a.address} size={28} />
                      {on && <T v="caption" dim>In use</T>}
                    </View>
                    <View style={{ gap: 3 }}>
                      <T style={{ fontFamily: F.semibold, fontSize: 17 }} numberOfLines={1}>{a.name}</T>
                      <T v="mono" color={C.sub} style={{ fontSize: 11.5 }}>{shortAddr(a.address, 7, 4)}</T>
                    </View>
                  </Press>
                );
              })}
              <Press onPress={() => router.push('/accounts')} accessibilityLabel="Add or rename accounts" style={{ width: 110, borderRadius: 22, borderWidth: 0.5, borderColor: '#2A2A31', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Icon name="plus" size={20} color={C.soft} width={2} />
                <T v="caption" dim>Add or edit</T>
              </Press>
            </ScrollView>
          </View>
          <Group>
            <Row icon="flash" title="Tap to pay" sub="Pay by touching two phones" onPress={() => router.push('/tap')} />
            <Row icon="eye" title="Watching" sub="Follow an address, no key" onPress={() => router.push('/watch')} />
            <Row icon="person" title="People" sub="Names for addresses you use" detail={people.length ? String(people.length) : undefined} onPress={() => router.push('/contacts')} />
          </Group>
        </>
      )}

      {tab === 'safety' && (
        <>
          <Group>
            <Row icon="lock" title="Vault" sub="A daily limit, a delay on big sends" onPress={() => router.push('/vaults')} />
            <Row icon="shield" title="Security" sub="Face ID, fingerprint and passcode" onPress={() => router.push('/security')} />
          </Group>
          <Group>
            <Row icon="lock" title="Lock now" sub="Ask for your passcode again" onPress={lock} />
            <Row icon="trash" title="Remove from this phone" sub="Your 24 words bring it back" danger onPress={remove} />
          </Group>
        </>
      )}

      {tab === 'advanced' && (
        <Group>
          <Row icon="globe" title="Networks" sub="Test or real money, per coin" detail={chain.allowMainnet ? "Real money" : "Test"} onPress={() => router.push('/chains-settings')} />
          <Row icon="server" title="Network" detail={node.replace(/^https?:\/\//, '').replace(/\/rpc$/, '')} onPress={() => router.push('/node')} />
          <Row icon="key" title="Developer" sub="Private keys, networks, app details" onPress={() => router.push('/developer')} />
        </Group>
      )}

      <View style={{ alignItems: 'center', gap: 4, paddingTop: 6 }}>
        <T v="caption" color={C.faint}>LOKYX Wallet {Constants.expoConfig?.version ?? ''}{process.env.EXPO_PUBLIC_BUILD ? ` · build ${process.env.EXPO_PUBLIC_BUILD.slice(0, 7)}` : ''}</T>
        <T v="caption" color={C.faint}>Your keys never leave this phone.</T>
      </View>
    </ScrollView>
    </View>
  );
}
