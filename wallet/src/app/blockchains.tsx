import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { T } from '../ui/Text';
import { Press, Screen } from '../ui/controls';
import { Logo } from '../ui/Logo';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/Toast';
import { C, F } from '../ui/theme';
import { BLOCKCHAINS, searchChains, type Blockchain } from '../lib/blockchains-core';

export function ChainMark({ b, size = 36 }: { b: Blockchain; size?: number }) {
  if (b.logo) return <Logo id={b.logo} size={size} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: b.tint[1], alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, width: size, height: size / 2, backgroundColor: b.tint[0], opacity: 0.55 }} />
      <T style={{ fontFamily: F.semibold, fontSize: size * 0.48, color: '#fff' }}>{b.letter}</T>
    </View>
  );
}

/** Other blockchains, kept off Home. Each needs its own signing code, so for now they only show what is planned. */
export default function Blockchains() {
  const [q, setQ] = useState('');
  const list = searchChains(q);
  return (
    <Screen title="Add a blockchain" large close back={false}>
      <T v="callout" dim style={{ lineHeight: 21 }}>They stay off your Home screen. Each one needs its own signing code first, so none work yet.</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderRadius: 24, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)' }}>
        <Icon name="search" size={18} color={C.sub} width={1.9} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search a network" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} selectionColor={C.text} keyboardAppearance="dark" style={{ flex: 1, fontFamily: F.regular, fontSize: 15.5, color: C.text, height: 48 }} />
      </View>
      <View style={{ borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        {list.map((b, i) => (
          <Press key={b.id} haptic={false} scaleTo={0.99} onPress={() => toast(`${b.name} is not supported yet`, 'info')} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: i ? 0.5 : 0, borderColor: 'rgba(255,255,255,0.07)' }}>
            <ChainMark b={b} />
            <View style={{ flex: 1 }}>
              <T style={{ fontFamily: F.medium, fontSize: 15.5 }}>{b.name}</T>
              <T v="caption" dim>{b.note}</T>
            </View>
            <T v="caption" dim>Coming</T>
          </Press>
        ))}
        {list.length === 0 ? <T v="callout" dim style={{ padding: 18 }}>{`Nothing called "${q.trim()}".`}</T> : null}
      </View>
      <T v="caption" dim style={{ paddingHorizontal: 6, lineHeight: 18 }}>{`${BLOCKCHAINS.length} planned. A network only joins your wallet once it can receive and send.`}</T>
    </Screen>
  );
}
