import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { formatUnits } from 'viem';
import { T } from '../../ui/Text';
import { Button, ErrorText, Group, Note, Press, Row, Screen } from '../../ui/controls';
import { AppsCard } from '../../ui/AppsCard';
import { CoinMark } from '../../ui/CoinMark';
import { toast } from '../../ui/Toast';
import { C, F } from '../../ui/theme';
import { confirmIt } from '../../lib/auth';
import { plainError } from '../../lib/plain-error';
import { ensureApps, useApps } from '../../lib/appswallet';
import { useEvmSites, evmSites } from '../../lib/data';
import { logoFor } from '../../ui/Logo';
import { ethBalance, tokenBalance, useAsync } from '../../lib/multichain';
import { ETH_NETS, KNOWN_TOKENS, type EthNet } from '../../lib/multichain-core';

type Held = { key: string; symbol: string; net: EthNet; text: string };
const NETS = (Object.keys(ETH_NETS) as EthNet[]).filter((n) => !ETH_NETS[n].real);

async function holdings(address: string): Promise<Held[]> {
  const jobs: Promise<Held | null>[] = [];
  for (const net of NETS) {
    jobs.push(ethBalance(net, address).then((b) => (b > 0n ? { key: `${net}-eth`, symbol: net === 'sepolia' ? 'ETH' : ETH_NETS[net].unit, net, text: formatUnits(b, 18) } : null)).catch(() => null));
    for (const t of KNOWN_TOKENS.filter((k) => k.chainId === ETH_NETS[net].chainId))
      jobs.push(tokenBalance(net, t, address).then((b) => (b > 0n ? { key: `${net}-${t.contract}`, symbol: t.symbol, net, text: formatUnits(b, t.decimals) } : null)).catch(() => null));
  }
  return (await Promise.all(jobs)).filter((x): x is Held => !!x);
}
const trim = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s).slice(0, 12);

/** The Apps wallet: the only account websites can see. Holds what you add and nothing else. */
export default function AppsWallet() {
  const { address } = useApps();
  const sites = useEvmSites().filter((s) => !!address && s.address.toLowerCase() === address.toLowerCase());
  const [making, setMaking] = useState(false);
  const [err, setErr] = useState('');
  const held = useAsync<Held[]>(() => (address ? holdings(address) : Promise.resolve([])), [address], 20000);

  const make = async () => {
    setErr('');
    if (!(await confirmIt('Make your Apps wallet'))) return;
    setMaking(true);
    try {
      await ensureApps();
      router.replace('/apps-wallet/made');
    } catch (e) {
      setErr(plainError(e, 'the wallet'));
    }
    setMaking(false);
  };

  if (!address)
    return (
      <Screen title="Apps wallet" large>
        <AppsCard />
        <T v="sub" dim style={{ lineHeight: 21 }}>A small wallet just for websites. They can only reach what you put in it, so the worst a bad site can do is take that. Your vault and main wallet stay hidden.</T>
        <ErrorText>{err}</ErrorText>
        <Button title="Make my Apps wallet" onPress={make} busy={making} />
      </Screen>
    );

  const heldLogos = [...new Set((held.data ?? []).map((h) => logoFor(h.symbol)).filter((x): x is NonNullable<typeof x> => !!x))];
  return (
    <Screen title="Apps wallet" large>
      <AppsCard held={heldLogos} />
      {held.data && held.data.length > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <T v="caption" dim>Holds</T>
          <View style={{ flexDirection: 'row' }}>
            {[...new Set(held.data.map((h) => h.symbol))].slice(0, 6).map((sym, i) => (
              <View key={sym} style={{ marginLeft: i ? -8 : 0, borderRadius: 99, borderWidth: 2, borderColor: C.bg }}>
                <CoinMark symbol={sym} seed={sym} logo={logoFor(sym)} size={26} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Add money" onPress={() => router.push('/apps-wallet/refill')} style={{ flex: 1 }} />
        <Button title="Copy address" kind="line" onPress={async () => { await Clipboard.setStringAsync(address); toast('Address copied', 'copy'); }} style={{ flex: 1 }} />
      </View>
      <Note>Sites can only reach what's here. Worst case, you lose what's in this wallet.</Note>

      <Group title="Coins">
        {held.data == null ? (
          <View style={{ padding: 16 }}><T v="sub" dim>Looking…</T></View>
        ) : held.data.length === 0 ? (
          <View style={{ padding: 16 }}><T v="sub" dim>Nothing here yet. Add money from your main wallet or a vault, or send to the address above.</T></View>
        ) : (
          held.data.map((h) => (
            <View key={h.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingHorizontal: 16 }}>
              <CoinMark symbol={h.symbol} seed={h.key} size={40} net={h.net} />
              <View style={{ flex: 1 }}>
                <T v="callout">{h.symbol}</T>
                <T v="caption" dim>{ETH_NETS[h.net].label}</T>
              </View>
              <T style={{ fontFamily: F.medium, fontSize: 16 }}>{trim(h.text)}</T>
            </View>
          ))
        )}
      </Group>

      <Group title="Connected sites">
        {sites.length === 0 ? (
          <View style={{ padding: 16 }}><T v="sub" dim>Sites you connect with the Apps wallet show up here.</T></View>
        ) : (
          sites.map((s) => (
            <Row
              key={s.origin}
              title={s.origin.replace(/^https?:\/\/(www\.)?/, '')}
              sub={`Connected ${new Date(s.at).toLocaleDateString()}`}
              right={
                <Press onPress={() => evmSites.save((l) => l.filter((x) => x.origin !== s.origin))} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1, borderColor: C.line2, justifyContent: 'center' }}>
                  <T v="caption" style={{ fontFamily: F.medium }}>Disconnect</T>
                </Press>
              }
            />
          ))
        )}
      </Group>
    </Screen>
  );
}
