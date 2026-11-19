import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { T } from '../ui/Text';
import { Group, Screen } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { LeadRow } from '../ui/LeadRow';
import { CoinMark } from '../ui/CoinMark';
import { LyxLogo } from '../ui/CoinLogo';
import { C } from '../ui/theme';
import { currentAddress } from '../lib/wallet';
import { usePoll, type Account } from '../lib/rpc';
import { niceLyx } from '../lib/format';
import { useAsync } from '../lib/multichain';
import { NETS, loadVaults, partsStatus, snapshot, vaults, type Snapshot } from '../lib/ethvault';
import { NATIVE, VAULT_NETS, itemState, type VaultNet } from '../lib/ethvault-core';
import { useStore } from '../lib/store';
import type { LogoId } from '../ui/logos';

const MARK: Record<VaultNet, { logo: LogoId; name: string }> = {
  'base-sepolia': { logo: 'base', name: 'Base' },
  'arbitrum-sepolia': { logo: 'arb', name: 'Arbitrum' },
  sepolia: { logo: 'eth', name: 'Ethereum' },
  'op-sepolia': { logo: 'op', name: 'Optimism' },
  'bnb-testnet': { logo: 'bnb', name: 'BNB Chain' },
};
const eth4 = (w: bigint) => {
  const s = w.toString().padStart(19, '0');
  const fr = s.slice(s.length - 18).slice(0, 4).replace(/0+$/, '');
  return fr ? `${s.slice(0, s.length - 18)}.${fr}` : s.slice(0, s.length - 18);
};

const stacked = (ids: LogoId[]) => (
  <View style={{ width: 40, height: 40, flexDirection: 'row', alignItems: 'center' }}>
    {ids.map((id, i) => (
      <View key={id} style={{ marginLeft: i ? -9 : 0, borderRadius: 99, borderWidth: 2, borderColor: C.fill }}>
        <Logo id={id} size={22} grey />
      </View>
    ))}
  </View>
);

/** One Ethereum vault in the list: its balance and whether anything needs you. */
function EthVaultRow({ net }: { net: VaultNet }) {
  const v = useStore(vaults)[net]!;
  const snap = useAsync<Snapshot | null>(async () => snapshot(v), [net, v.state], 30_000);
  const s = snap.data;
  const now = Math.floor(Date.now() / 1000);
  const waiting = s ? s.items.filter((i) => itemState(i, now, s.live.delay.txNonce) === 'waiting').length : 0;
  const danger = !!s?.issues.some((i) => i.level === 'danger');
  const sub = !s ? 'Checking…' : danger ? 'Needs a look' : waiting ? `${waiting} withdrawal${waiting === 1 ? '' : 's'} waiting` : 'Protected';
  return (
    <LeadRow
      lead={<CoinMark symbol={NATIVE[net]} seed={net} logo={MARK[net].logo} size={40} />}
      title={`${MARK[net].name} vault`}
      sub={sub}
      subColor={danger ? C.bad : waiting ? C.wait : undefined}
      detail={s ? `${eth4(s.eth)} ${NATIVE[net]}` : ''}
      chevron
      onPress={() => router.push(`/ethvault?net=${net}`)}
    />
  );
}

/** Every vault in one list, and a way to add one. A vault protects the coins of one network. */
export default function Vaults() {
  const me = currentAddress();
  const acct = usePoll<Account>('lyx_getAccount', { address: me }, 15000);
  const all = useStore(vaults);
  useEffect(() => {
    loadVaults();
  }, []);
  const hasLyx = !!acct.data?.vault;
  const have = NETS.filter((n) => all[n]);
  const todo = NETS.filter((n) => !all[n]);
  const count = (hasLyx ? 1 : 0) + have.length;
  const parts = useAsync<Record<string, boolean | null>>(async () => Object.fromEntries(await Promise.all(todo.map(async (n) => [n, (await partsStatus(n))?.ready ?? null]))), [todo.join(',')]);

  return (
    <Screen title="Vault" large>
      <T v="body" dim style={{ marginTop: -8 }}>A daily limit and a wait on big sends. One vault for each network.</T>

      {count > 0 ? (
        <Group title="Your vaults">
          {hasLyx ? <LeadRow lead={<LyxLogo size={40} />} title="LOKYX vault" sub="Protected" detail={acct.data ? `${niceLyx(acct.data.balanceLyx, 2)} LYX` : ''} chevron onPress={() => router.push('/vault')} /> : <></>}
          {have.map((n) => <EthVaultRow key={n} net={n} />)}
        </Group>
      ) : (
        <View style={{ borderRadius: 24, backgroundColor: C.fill, padding: 18, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="shield" size={18} color={C.sub} width={1.9} />
            <T v="callout">No vault yet</T>
          </View>
          <T v="sub" dim style={{ lineHeight: 20 }}>If someone gets your phone or your words, a vault limits how much they can take at once, and gives you time to stop it.</T>
        </View>
      )}

      {(!hasLyx || todo.length > 0) && (
        <Group title="Add a vault">
          {!hasLyx ? <LeadRow lead={<LyxLogo size={40} />} title="LOKYX" sub="Set up a vault" chevron onPress={() => router.push('/vault')} /> : <></>}
          {todo.map((n) => (
            <LeadRow key={n} lead={<CoinMark symbol={NATIVE[n]} seed={n} logo={MARK[n].logo} size={40} />} title={VAULT_NETS[n].label} sub={parts.data?.[n] === true ? 'Ready' : parts.data?.[n] === false ? 'First-time setup' : 'Test network'} chevron onPress={() => router.push(`/ethvault?net=${n}`)} />
          ))}
        </Group>
      )}

      <Group title="Later">
        <LeadRow lead={stacked(['btc', 'sol', 'trx'])} title="Bitcoin, Solana, Tron" sub="Coming. They need a second key." />
      </Group>
      <T v="caption" dim style={{ textAlign: 'center', paddingHorizontal: 12, lineHeight: 18 }}>Setting up a vault on one network does not change the others.</T>
    </Screen>
  );
}
