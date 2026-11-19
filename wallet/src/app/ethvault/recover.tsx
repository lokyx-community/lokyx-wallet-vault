import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { plainError } from '../../lib/plain-error';
import { T } from '../../ui/Text';
import { Button, ErrorText, Field, Note, Screen, success } from '../../ui/controls';
import { Segmented } from '../../ui/Segmented';
import { ScreenGuard } from '../../ui/ScreenGuard';
import { isMnemonic } from '../../lib/lokyx';
import { OpenBackup } from '../../ui/BackupSheets';
import { ethKey } from '../../lib/multichain-core';
import { useStore } from '../../lib/store';
import { NETS, balanceOf, checkEthVaults, loadVaults, recoveryCancel, recoverySweep, vaults } from '../../lib/ethvault';
import { VAULT_NETS, type VaultNet, NATIVE } from '../../lib/ethvault-core';
import { shortAddr } from '../../lib/format';
import { formatUnits } from '../../lib/multichain-core';

/**
 * With the 12 recovery words: cancel everything waiting, or move the vault's coins to the safe address.
 * The recovery key can do only those two things (a narrow Roles role), and it sends them itself, so its own address
 * needs a little ETH on the network for fees.
 */
export default function EthRecover() {
  const p = useLocalSearchParams<{ net?: VaultNet }>();
  const [net, setNet] = useState<VaultNet>(p.net && NETS.includes(p.net) ? p.net : NETS[0]);
  const v = useStore(vaults)[net];
  const [words, setWords] = useState('');
  const [bk, setBk] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fuel, setFuel] = useState('');
  if (!v) loadVaults();

  const withKey = async (what: 'cancel' | 'sweep') => {
    setErr('');
    setNote('');
    if (!v) return setErr(`No vault on ${VAULT_NETS[net].label} on this phone.`);
    if (!isMnemonic(words)) return setErr('Those 12 words do not check out. Look for a typo.');
    const k = ethKey(words);
    try {
      if (k.address.toLowerCase() !== v.recovery.toLowerCase()) return setErr('Those words are not the recovery words of this vault.');
      setBusy(true);
      const bal = await balanceOf(net, k.address);
      setFuel(`${formatUnits(bal, 18, 6)} ${NATIVE[net]}`);
      if (bal === 0n) return setErr(`The recovery address ${shortAddr(k.address, 8, 6)} has no ${NATIVE[net]} on ${VAULT_NETS[net].label}. Send it a little, then try again: the recovery key pays its own fees.`);
      if (what === 'cancel') await recoveryCancel(v, k.sk);
      else await recoverySweep(v, k.sk);
      success();
      setNote(what === 'cancel' ? 'Done. Everything that was waiting is cancelled.' : 'Done. Everything on the list moved to your safe address.');
      checkEthVaults().catch(() => {});
    } catch (e) {
      setErr(plainError(e, VAULT_NETS[net].label));
    } finally {
      k.sk.fill(0);
      setBusy(false);
    }
  };

  const ready = words.trim().split(/\s+/).length >= 12;
  return (
    <Screen title="Ethereum recovery key" large>
      <ScreenGuard />
      <Segmented<VaultNet> value={net} onChange={setNet} options={NETS.map((n) => [n, VAULT_NETS[n].label] as [VaultNet, string])} />
      <T v="callout" dim style={{ lineHeight: 22 }}>Type the 12 words you wrote down when you made the vault. They never leave this phone. With them you can cancel everything waiting, or move the coins to your safe address. They can do nothing else.</T>
      <Button title="Use my encrypted backup" kind="line" onPress={() => setBk(true)} />
      <OpenBackup open={bk} onClose={() => setBk(false)} kind="vault" onSecret={setWords} />
      <Field value={words} onChangeText={setWords} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} placeholder="word word word…" style={{ minHeight: 120, borderRadius: 22, fontSize: 17, lineHeight: 24 }} />
      {v && <T v="caption" dim>{`Safe address: ${shortAddr(v.sweepTo, 8, 6)}. Recovery address: ${shortAddr(v.recovery, 8, 6)}${fuel ? ` (${fuel})` : ''}`}</T>}
            <Button title="Cancel everything waiting" disabled={busy || !ready} onPress={() => withKey('cancel')} />
      <Button title="Move everything to my safe address" kind="line" disabled={busy || !ready} onPress={() => withKey('sweep')} />
      <T v="caption" dim style={{ lineHeight: 18 }}>The recovery address pays its own network fees, so keep a little ETH on it on each network. Only ETH and the tokens on your allowance list move. Other tokens stay until you add them to that list.</T>
      <ErrorText>{err}</ErrorText>
      {note ? <Note>{note}</Note> : null}
    </Screen>
  );
}
