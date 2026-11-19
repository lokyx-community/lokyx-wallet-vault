import { useState } from 'react';
import { View } from 'react-native';
import { T } from '../ui/Text';
import { Field, Group, Press, Row, Screen, Switch } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { Sheet } from '../ui/Sheet';
import { C, F } from '../ui/theme';
import { updateChains, useChainSettings } from '../lib/multichain';
import { BTC_NETS, ETH_NETS, ethNetChoices, type BtcNet, type EthNet } from '../lib/multichain-core';
import { SOL_NETS } from '../lib/sol-core';
import { TRON_NETS } from '../lib/tron-core';

type Coin = 'btc' | 'eth' | 'sol' | 'trx';
const NAME: Record<Coin, string> = { btc: 'Bitcoin', eth: 'Ethereum', sol: 'Solana', trx: 'Tron' };

const Dot = ({ on }: { on: boolean }) => <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: on ? '#9BE5BD' : 'rgba(255,255,255,0.2)' }} />;

/** Which network each coin uses. A list first; a coin opens its own short picker. */
export default function ChainsSettings() {
  const s = useChainSettings();
  const [open, setOpen] = useState<Coin | null>(null);
  const [custom, setCustom] = useState('');
  const main = s.allowMainnet;

  const current: Record<Coin, string> = {
    btc: BTC_NETS[s.btcNet].label.replace('Bitcoin ', ''),
    eth: ETH_NETS[s.ethNet].short,
    sol: SOL_NETS[s.solNet].short,
    trx: TRON_NETS[s.tronNet].short,
  };
  const choices = (c: Coin): { id: string; label: string; real: boolean; on: boolean; pick: () => void }[] => {
    if (c === 'btc')
      return (['signet', 'testnet4', 'testnet', ...(main ? ['mainnet'] : [])] as BtcNet[]).map((k) => ({ id: k, label: BTC_NETS[k].label.replace('Bitcoin ', ''), real: BTC_NETS[k].real, on: s.btcNet === k, pick: () => (updateChains({ btcNet: k }), setCustom(s.esplora[k] ?? '')) }));
    if (c === 'eth')
      return ethNetChoices(main).map((k) => ({ id: k, label: ETH_NETS[k].short, real: ETH_NETS[k].real, on: s.ethNet === k, pick: () => (updateChains({ ethNet: k }), setCustom(s.ethRpc[k] ?? '')) }));
    if (c === 'sol')
      return (Object.keys(SOL_NETS) as (keyof typeof SOL_NETS)[]).filter((k) => main || !SOL_NETS[k].real).map((k) => ({ id: k, label: SOL_NETS[k].short, real: SOL_NETS[k].real, on: s.solNet === k, pick: () => updateChains({ solNet: k }) }));
    return (Object.keys(TRON_NETS) as (keyof typeof TRON_NETS)[]).filter((k) => main || !TRON_NETS[k].real).map((k) => ({ id: k, label: TRON_NETS[k].short, real: TRON_NETS[k].real, on: s.tronNet === k, pick: () => updateChains({ tronNet: k }) }));
  };
  const openCoin = (c: Coin) => {
    setCustom(c === 'btc' ? s.esplora[s.btcNet] ?? '' : c === 'eth' ? s.ethRpc[s.ethNet] ?? '' : '');
    setOpen(c);
  };

  return (
    <Screen title="Networks" large>
      <T v="sub" dim style={{ marginTop: -8, lineHeight: 20 }}>Each coin uses a test network in this beta, with coins that have no value. The same address works on all of a coin's networks.</T>
      <Group>
        {(['btc', 'eth', 'sol', 'trx'] as Coin[]).map((c) => (
          <Row key={c} title={NAME[c]} detail={current[c]} right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Dot on /><T v="callout" dim>{current[c]}</T><Icon name="chevron" size={14} color={C.faint} width={2.2} /></View>} onPress={() => openCoin(c)} icon={undefined} />
        ))}
      </Group>
      <Group title="Advanced">
        <Row title="Real-money networks" sub="Bitcoin, Ethereum, Solana and Tron mainnet. Off in this beta." right={<Switch on={main} label="Real-money networks" onChange={(v) => updateChains({ allowMainnet: v, ...(v ? {} : { btcNet: s.btcNet === 'mainnet' ? 'signet' : s.btcNet, ethNet: ETH_NETS[s.ethNet].real ? ('sepolia' as EthNet) : s.ethNet, solNet: SOL_NETS[s.solNet].real ? 'devnet' : s.solNet, tronNet: TRON_NETS[s.tronNet].real ? 'nile' : s.tronNet }) })} />} />
      </Group>
      <T v="caption" dim style={{ lineHeight: 18, paddingHorizontal: 6 }}>Turning this on lets the wallet send real money. Do not use it until this wallet has been reviewed and released for it.</T>

      <Sheet open={open !== null} onClose={() => setOpen(null)}>
        {open ? (
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Logo id={open} size={32} />
              <T v="headline">{`${NAME[open]} network`}</T>
            </View>
            <View style={{ borderRadius: 20, backgroundColor: C.fill, paddingHorizontal: 16 }}>
              {choices(open).map((o, i) => (
                <Press key={o.id} onPress={o.pick} haptic={false} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 54, borderTopWidth: i ? 0.5 : 0, borderColor: C.line }}>
                  <Dot on={o.on} />
                  <T style={{ flex: 1, fontFamily: F.medium, fontSize: 16 }}>{o.label}</T>
                  <T v="caption" dim>{o.real ? 'Real money' : 'Test'}</T>
                  {o.on ? <Icon name="check" size={18} color={C.text} width={2.4} /> : null}
                </Press>
              ))}
            </View>
            {open === 'btc' || open === 'eth' ? (
              <View style={{ gap: 8 }}>
                <T v="sub" dim>Custom connection (optional)</T>
                <Field
                  value={custom}
                  onChangeText={(t) => {
                    setCustom(t);
                    if (open === 'btc') updateChains({ esplora: { ...s.esplora, [s.btcNet]: t.trim() } });
                    else updateChains({ ethRpc: { ...s.ethRpc, [s.ethNet]: t.trim() } });
                  }}
                  placeholder={open === 'btc' ? BTC_NETS[s.btcNet].esplora : ETH_NETS[s.ethNet].rpc}
                  autoCapitalize="none"
                  autoCorrect={false}
                  mono
                />
                <T v="caption" dim style={{ lineHeight: 18 }}>{open === 'btc' ? 'Block explorer API (Esplora). Leave blank for the default.' : 'JSON-RPC address. Leave blank for the default. The wallet checks that it really is that network.'}</T>
              </View>
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
