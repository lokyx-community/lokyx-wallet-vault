import { useState } from 'react';
import { View } from 'react-native';
import { T } from '../../ui/Text';
import { C } from '../../ui/theme';
import { Button, ErrorText, Field, Group, Note, Row, Screen } from '../../ui/controls';
import { ScreenGuard } from '../../ui/ScreenGuard';
import { ConfirmOp } from '../../ui/ConfirmOp';
import { isMnemonic, hexToBytes, formatLyx } from '../../lib/lokyx';
import { OpenBackup } from '../../ui/BackupSheets';
import { recoveryKeys, pendingLine, inTime, KEY_THEFT_NOTICE } from '../../lib/vault-core';
import { rpc, usePoll, type Account, type ChainInfo } from '../../lib/rpc';
import { labelFor, niceLyx } from '../../lib/format';
import { currentAddress } from '../../lib/wallet';

/** With the 12-word recovery phrase: cancel what's pending, or sweep everything to the safe address. */
export default function Recover() {
  const [phrase, setPhrase] = useState('');
  const [bk, setBk] = useState(false);
  const [keys, setKeys] = useState<ReturnType<typeof recoveryKeys> | null>(null);
  const [vaults, setVaults] = useState<Account[]>([]);
  const [err, setErr] = useState('');
  const info = usePoll<ChainInfo>('lyx_chainInfo', {}, 8000);
  const bt = info.data?.targetBlockTime ?? 60;
  const height = info.data?.height ?? 0;

  const load = async () => {
    setErr('');
    if (!isMnemonic(phrase)) return setErr('Those 12 words do not check out. Look for a typo.');
    const k = recoveryKeys(phrase);
    setKeys(k);
    try {
      const me = await rpc<Account>('lyx_getAccount', { address: k.recovery });
      const list = await Promise.all((me.recoveryFor ?? []).map((a) => rpc<Account>('lyx_getAccount', { address: a })));
      setVaults(list);
      if (!list.length) setErr('No vault uses this recovery key.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const reload = () => { if (keys) load(); };

  return (
    <Screen title="Recovery key" large>
      <ScreenGuard />
      {!keys || vaults.length === 0 ? (
        <>
          <T v="callout" dim style={{ lineHeight: 22 }}>Type the 12 words you wrote down when you made the vault. They never leave this phone.</T>
          <Button title="Use my encrypted backup" kind="line" onPress={() => setBk(true)} />
          <OpenBackup open={bk} onClose={() => setBk(false)} kind="vault" onSecret={setPhrase} />
          <Field value={phrase} onChangeText={setPhrase} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} placeholder="word word word…" style={{ minHeight: 120, borderRadius: 22, fontSize: 17, lineHeight: 24 }} />
          <ErrorText>{err}</ErrorText>
          <Button title="Find my vaults" disabled={phrase.trim().split(/\s+/).length < 12} onPress={load} />
        </>
      ) : (
        <>
          <T v="caption" dim style={{ lineHeight: 18 }}>{KEY_THEFT_NOTICE}</T>
          {vaults.map((v) => (
            <VaultRecovery key={v.address} v={v} keys={keys} bt={bt} height={height} refresh={reload} />
          ))}
        </>
      )}
    </Screen>
  );
}

function VaultRecovery({ v, keys, bt, height, refresh }: { v: Account; keys: ReturnType<typeof recoveryKeys>; bt: number; height: number; refresh: () => void }) {
  const [sweep, setSweep] = useState(false);
  const [cancel, setCancel] = useState('');
  const as = { sk: keys.recKey, from: keys.recovery };
  const vault = v.vault;
  return (
    <View style={{ gap: 14, padding: 18, borderRadius: 24, backgroundColor: C.fill }}>
      <T v="callout">{labelFor(v.address)}</T>
      <T v="sub" dim>{niceLyx(formatLyx(BigInt(v.balance)))} LYX · safe address {labelFor(vault?.settings.safe ?? '')}</T>
      {vault?.pending.map((p) => (
        <View key={p.id} style={{ gap: 8 }}>
          <T v="sub">{pendingLine(p, height, { blockTime: bt, me: v.address, label: labelFor })}</T>
          {cancel === p.id ? (
            <ConfirmOp op={{ kind: 'vaultCancel', id: hexToBytes(p.id.replace(/^0x/, '')) }} me={v.address} blockTime={bt} as={as} label="Slide to cancel" onDone={refresh} />
          ) : (
            <Button title="Cancel this" kind="line" onPress={() => setCancel(p.id)} />
          )}
        </View>
      ))}
      {v.pendingRotation ? (
        <View style={{ gap: 8 }}>
          <T v="sub">Key rotation to {labelFor(v.pendingRotation.newKey)} in {inTime(v.pendingRotation.releaseHeight - height, bt)}</T>
          {cancel === 'rot' ? (
            <ConfirmOp op={{ kind: 'keyCancelRotate', account: v.address }} me={v.address} blockTime={bt} as={as} label="Slide to cancel" onDone={refresh} />
          ) : (
            <Button title="Cancel the rotation" kind="line" onPress={() => setCancel('rot')} />
          )}
        </View>
      ) : null}
      {sweep ? (
        <ConfirmOp op={{ kind: 'vaultSweep', vault: v.address }} me={v.address} blockTime={bt} as={as} label="Slide to sweep" onDone={refresh} />
      ) : (
        <Button title="Sweep everything to the safe address" onPress={() => setSweep(true)} />
      )}
    </View>
  );
}
