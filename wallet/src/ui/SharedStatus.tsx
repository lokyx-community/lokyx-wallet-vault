import { ActivityIndicator, View } from 'react-native';
import { Button, Group, Screen } from './controls';
import { LeadRow } from './LeadRow';
import { NetMark } from './CoinMark';
import { Icon } from './Icon';
import { T } from './Text';
import { C, F } from './theme';
import { ETH_NETS, type EthNet } from '../lib/multichain-core';

/** While a shared account is being made on the network. It says only what is true: it is sent, and it can take a minute. */
export function SharedCreating({ name, net, people, need }: { name: string; net: EthNet; people: number; need: number }) {
  return (
    <Screen title="">
      <View style={{ alignItems: 'center', gap: 14, paddingTop: 48 }}>
        <ActivityIndicator color={C.wait} size="large" />
        <T style={{ fontFamily: F.semibold, fontSize: 24, textAlign: 'center' }}>{`Creating ${name}`}</T>
        <T v="sub" dim style={{ textAlign: 'center', lineHeight: 21 }}>{`Sending it to ${ETH_NETS[net].label}. This can take a minute, and it is safe to leave this screen.`}</T>
      </View>
      <Group>
        <LeadRow lead={<NetMark net={net} size={40} />} title={ETH_NETS[net].label} sub={`${people} people · ${need} must approve`} />
      </Group>
    </Screen>
  );
}

/** After it exists: what was made, who still has to join, and the one thing to do next. */
export function SharedCreated({ name, net, address, people, need, onInvite }: { name: string; net: EthNet; address: string; people: number; need: number; onInvite: () => void }) {
  return (
    <Screen title="">
      <View style={{ alignItems: 'center', gap: 12, paddingTop: 32 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(61,214,140,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={32} color={C.good} width={2.6} />
        </View>
        <T style={{ fontFamily: F.semibold, fontSize: 26, textAlign: 'center' }}>{`${name} is ready`}</T>
        <T v="sub" dim style={{ textAlign: 'center' }}>{`${need} of ${people} people approve every payment`}</T>
      </View>
      <Group>
        <LeadRow lead={<NetMark net={net} size={40} />} title={ETH_NETS[net].label} sub={`${address.slice(0, 8)}…${address.slice(-6)}`} />
      </Group>
      <T v="caption" dim style={{ textAlign: 'center', lineHeight: 18 }}>Send the setup message to the others so they can add it on their phones. Coins sent to this address are held by the group.</T>
      <Button title="Invite people" onPress={onInvite} />
    </Screen>
  );
}
