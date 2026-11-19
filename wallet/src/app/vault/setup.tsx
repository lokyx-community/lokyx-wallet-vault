import { WordCheck } from '../../ui/Feature';
import { TowerStep } from '../../ui/TowerStep';
import { logEvent } from '../../lib/events';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { T } from '../../ui/Text';
import { Button, ErrorText, Field, Note, Screen, SwitchRow } from '../../ui/controls';
import { Segmented } from '../../ui/Segmented';
import { WordGrid } from '../../ui/WordGrid';
import { SaveBackup } from '../../ui/BackupSheets';
import { ScreenGuard } from '../../ui/ScreenGuard';
import { ConfirmOp } from '../../ui/ConfirmOp';
import { currentAddress, useWallet } from '../../lib/wallet';
import { STORAGE_PLEDGES, pledgeOk, safeAddressProblem } from '../../lib/guard-core';
import { newShortMnemonic } from '../../lib/lokyx';
import { buildSettings, DELAYS, HEIR_WAITS, recoveryKeys } from '../../lib/vault-core';
import { usePoll, type ChainInfo } from '../../lib/rpc';

type Step = 'phrase' | 'pledge' | 'check' | 'settings' | 'tower' | 'review';

export default function VaultSetup() {
  const me = currentAddress();
  const w = useWallet();
  const others = w.accounts.filter((a) => a.address !== me);
  const info = usePoll<ChainInfo>('lyx_chainInfo', {}, 0);
  const phrase = useMemo(() => newShortMnemonic(), []);
  const keys = useMemo(() => {
    const k = recoveryKeys(phrase);
    k.recKey.fill(0); // only the addresses are needed here; the key is derived again if it's ever used
    return k;
  }, [phrase]);
  const words = phrase.split(' ');
  const ask = useMemo(() => [2 + Math.floor(Math.random() * 3), 8 + Math.floor(Math.random() * 3)], []);
  const [step, setStep] = useState<Step>('phrase');
  const [answers, setAnswers] = useState(['', '']);
  const [allowance, setAllowance] = useState('50');
  const [delay, setDelay] = useState(1);
  const [safe, setSafe] = useState(others[0]?.address ?? '');
  const [pledged, setPledged] = useState<boolean[]>(STORAGE_PLEDGES.map(() => false));
  const [heirOn, setHeirOn] = useState(false);
  const [heirAddr, setHeirAddr] = useState('');
  const [heirWait, setHeirWait] = useState(0);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const bt = info.data?.targetBlockTime ?? 60;

  const built = buildSettings({
    owner: me, recovery: keys.recovery, safe: safe.trim().toLowerCase(), allowanceLyx: allowance, delaySecs: DELAYS[delay][1],
    heir: heirOn ? { address: heirAddr.trim().toLowerCase(), waitSecs: HEIR_WAITS[heirWait][1] } : null, blockTime: bt,
  });
  const safeProblem = safeAddressProblem(safe, { recoveryDerived: keys.safe, owner: me });
  const checked = ask.every((i, k) => answers[k].trim().toLowerCase() === words[i]);

  return (
    <Screen title="Set up a vault" large>
      <ScreenGuard />
      {step === 'phrase' && (
        <>
          <Note>Write these 12 words on paper and keep them away from this phone. They are shown once and the app does not keep them. Anyone with them can cancel your withdrawals and send your vault to the safe address, so keep them apart from your 24 words.</Note>
          <WordGrid words={words} />
          <Button title="Save an encrypted backup (QR or text)" kind="line" onPress={() => setSaving(true)} />
          <SaveBackup open={saving} onClose={() => setSaving(false)} secret={phrase} kind="vault" />
          <Button title="I've written them down" onPress={() => setStep('pledge')} />
        </>
      )}
      {step === 'pledge' && (
        <>
          <Note>Before you go on, promise these three things. They are what keep a stolen phone or a stolen paper from emptying the vault.</Note>
          {STORAGE_PLEDGES.map((t, i) => (
            <SwitchRow key={i} on={pledged[i]} label={t} onChange={(v) => setPledged(pledged.map((p, j) => (j === i ? v : p)))} />
          ))}
          <Button title="Continue" disabled={!pledgeOk(pledged)} onPress={() => setStep('check')} />
          <Button title="Show the words again" kind="plain" onPress={() => setStep('phrase')} />
        </>
      )}
      {step === 'check' && (
        <>
          <Note>Type the words you wrote down. This checks your paper copy is right.</Note>
          {ask.map((i, k) => (
            <WordCheck key={i} n={i + 1} value={answers[k]} ok={answers[k].trim().toLowerCase() === words[i]} onChange={(t) => setAnswers(answers.map((a, j) => (j === k ? t : a)))} />
          ))}
          <Button title="Continue" disabled={!checked} onPress={() => setStep('settings')} />
          <Button title="Show the words again" kind="plain" onPress={() => setStep('phrase')} />
        </>
      )}
      {step === 'settings' && (
        <>
          <T v="headline">Daily allowance (LYX)</T>
          <Note>This much can leave your account each day without waiting. A thief with your phone gets at most this.</Note>
          <Field value={allowance} onChangeText={setAllowance} keyboardType="decimal-pad" />
          <T v="headline">Wait for bigger withdrawals</T>
          <Segmented value={String(delay)} options={DELAYS.map(([l], i) => [String(i), l] as [string, string])} onChange={(k) => setDelay(Number(k))} />
          <T v="headline">Safe address</T>
          <Note>Where a sweep sends everything. It has to be a different wallet that you control, such as another account of yours or a hardware wallet. It cannot be made from these 12 words, or someone who finds only the words could send your coins to themselves.</Note>
          {others.length > 0 && (
            <Segmented value={others.some((a) => a.address === safe) ? safe : ''} options={[...others.map((a) => [a.address, a.name] as [string, string]), ['', 'Other']]} onChange={(k) => setSafe(k)} />
          )}
          <Field value={safe} onChangeText={setSafe} placeholder="lyx1… safe address" autoCapitalize="none" autoCorrect={false} mono />
          <SwitchRow on={heirOn} label="Add an heir" onChange={setHeirOn} />
          {heirOn && (
            <>
              <Note>An heir can claim the vault after you have been inactive for this long. You can cancel a claim during its wait.</Note>
              <Field value={heirAddr} onChangeText={setHeirAddr} placeholder="lyx1… heir" autoCapitalize="none" autoCorrect={false} mono />
              <Segmented value={String(heirWait)} options={HEIR_WAITS.map(([l], i) => [String(i), l] as [string, string])} onChange={(k) => setHeirWait(Number(k))} />
            </>
          )}
          <ErrorText>{err || safeProblem || built.error}</ErrorText>
          <Button title="Review" disabled={!built.settings || !!safeProblem} onPress={() => { setErr(''); setStep('tower'); }} />
        </>
      )}
      {step === 'tower' && <TowerStep kind="lyx" onContinue={() => setStep('review')} onBack={() => setStep('settings')} />}
      {step === 'review' && built.settings && (
        <>
          <Note>Last look. Once the vault exists, nothing bigger than the allowance leaves quickly.</Note>
          <ConfirmOp op={{ kind: 'vaultCreate', settings: built.settings }} me={me} blockTime={bt} delayBlocks={Number(built.settings.delay)} label="Slide to create" onDone={() => { logEvent('vault', 'Vault created', 'LOKYX'); router.replace('/vault'); }} />
          <Button title="Back" kind="plain" onPress={() => setStep('tower')} />
        </>
      )}
    </Screen>
  );
}
