import { WordCheck } from '../../ui/Feature';
import { VaultCreating } from '../../ui/VaultCreating';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { bytesToHex, isAddress, parseUnits, type Hex } from 'viem';
import { plainError } from '../../lib/plain-error';
import { T } from '../../ui/Text';
import { Button, ErrorText, Field, Note, Screen, SwitchRow } from '../../ui/controls';
import { Segmented } from '../../ui/Segmented';
import { STORAGE_PLEDGES, pledgeOk, safeAddressProblem } from '../../lib/guard-core';
import { WordGrid } from '../../ui/WordGrid';
import { SaveBackup } from '../../ui/BackupSheets';
import { ScreenGuard } from '../../ui/ScreenGuard';
import { SlideToPay } from '../../ui/SlideToPay';
import { confirmIt } from '../../lib/auth';
import { newShortMnemonic, isMnemonic } from '../../lib/lokyx';
import { ethKey } from '../../lib/multichain-core';
import { ensureAddresses, useAsync } from '../../lib/multichain';
import { NETS, USDC, createVault, vaults, balanceOf } from '../../lib/ethvault';
import { useStore } from '../../lib/store';
import { DEFAULT_WAIT, ETH, MIN_WAIT, VAULT_NETS, checkSettings, type TokenAllowance, type VaultNet } from '../../lib/ethvault-core';

type Step = 'phrase' | 'pledge' | 'check' | 'settings' | 'review' | 'working';
const WAITS: [string, number][] = [['24 hours', MIN_WAIT], ['2 days', DEFAULT_WAIT], ['7 days', 7 * 86400]];
const STEPS: Record<string, string> = { checking: 'Checking the audited contracts on the network…', deploying: 'Creating your vault (your everyday address pays the fee)…', activating: 'Switching the protection on…', verifying: 'Checking the vault matches what you set…', done: 'Done.' };

/** Same flow and wording as the LYX vault: allowance, wait, recovery words shown once and checked, safe address. No heir on Ethereum. */
export default function EthVaultSetup() {
  const p = useLocalSearchParams<{ net?: VaultNet }>();
  const net: VaultNet = p.net && NETS.includes(p.net) ? p.net : NETS[0];
  const have = useStore(vaults);
  const existing = Object.values(have)[0]; // a second network reuses the same recovery key
  const phrase = useMemo(() => newShortMnemonic(), []);
  const words = phrase.split(' ');
  const ask = useMemo(() => [2 + Math.floor(Math.random() * 3), 8 + Math.floor(Math.random() * 3)], []);
  const [step, setStep] = useState<Step>(existing ? 'settings' : 'phrase');
  const [answers, setAnswers] = useState(['', '']);
  const [typed, setTyped] = useState('');
  const [ethAllow, setEthAllow] = useState('0.01');
  const [usdcAllow, setUsdcAllow] = useState('10');
  const [wait, setWait] = useState(1);
  const [safe, setSafe] = useState('');
  const [pledged, setPledged] = useState<boolean[]>(STORAGE_PLEDGES.map(() => false));
  const everyday = useAsync(async () => (await ensureAddresses()).eth, []);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [stepKey, setStepKey] = useState('');
  const checked = ask.every((i, k) => answers[k].trim().toLowerCase() === words[i]);
  const ownAddr = useMemo(() => { const k = ethKey(phrase); k.sk.fill(0); return k.address; }, [phrase]);
  const recoveryAddr = (existing?.recovery ?? ownAddr) as Hex;
  // the safe address defaults to the phone's own everyday address, never to the address of the 12 words
  const safeNow = (safe.trim() || everyday.data || '') as string;
  const safeProblem = safeAddressProblem(safeNow, { recoveryDerived: recoveryAddr, owner: '' });

  const build = (): { settings: { wait: number; allowances: TokenAllowance[] } | null; error: string } => {
    try {
      const allowances: TokenAllowance[] = [
        { token: ETH, symbol: 'ETH', decimals: 18, amount: parseUnits(ethAllow || '0', 18) },
        { token: USDC[net], symbol: 'USDC', decimals: 6, amount: parseUnits(usdcAllow || '0', 6) },
      ];
      const settings = { wait: WAITS[wait][1], allowances };
      const bad = checkSettings(settings);
      if (bad) return { settings: null, error: bad };
      if (safe.trim() && !isAddress(safe.trim())) return { settings: null, error: 'That safe address is not a valid Ethereum address.' };
      return { settings, error: '' };
    } catch {
      return { settings: null, error: 'Type the allowances as plain numbers.' };
    }
  };
  const built = build();

  const create = async () => {
    setErr('');
    if (!(await confirmIt('Create your Ethereum vault'))) return false;
    // the recovery key: this setup's own words, or the words typed again when adding a second network
    let sk: Uint8Array;
    if (existing) {
      if (!isMnemonic(typed)) { setErr('Those 12 words do not check out.'); return false; }
      const k = ethKey(typed);
      if (k.address.toLowerCase() !== existing.recovery.toLowerCase()) { k.sk.fill(0); setErr('Those words are not the recovery words of your vault.'); return false; }
      sk = k.sk;
    } else sk = ethKey(phrase).sk;
    setStep('working');
    try {
      const a = await ensureAddresses();
      const bal = await balanceOf(net, a.eth as Hex);
      if (bal === 0n) throw new Error(`Your everyday address ${a.eth} has no test ETH on ${VAULT_NETS[net].label}. Get some from a faucet first: it pays the one-time setup fee.`);
      await createVault({ net, recoverySk: sk, recovery: recoveryAddr, sweepTo: safeNow as Hex, settings: built.settings!, onStep: (s) => { setMsg(STEPS[s]); setStepKey(s); } });
      router.replace(`/ethvault?net=${net}`);
      return true;
    } catch (e) {
      setErr(plainError(e, VAULT_NETS[net].label));
      setStep('review');
      return false;
    } finally {
      sk.fill(0);
    }
  };

  return (
    <Screen title={`Set up on ${VAULT_NETS[net].label}`} large>
      <ScreenGuard />
      {step === 'phrase' && (
        <>
          <Note>Experimental: this vault has not yet been run on a live network or a real phone. Use test coins only.</Note>
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
          <T v="headline">Daily allowance (ETH)</T>
          <Note>This much can leave your vault each day without waiting. A thief with your phone gets at most this.</Note>
          <Field value={ethAllow} onChangeText={setEthAllow} keyboardType="decimal-pad" />
          <T v="headline">Daily allowance (USDC)</T>
          <Field value={usdcAllow} onChangeText={setUsdcAllow} keyboardType="decimal-pad" />
          <Note>Any other coin has no quick allowance: it always waits.</Note>
          <T v="headline">Wait for bigger withdrawals</T>
          <Segmented value={String(wait)} options={WAITS.map(([l], i) => [String(i), l] as [string, string])} onChange={(k) => setWait(Number(k))} />
          <T v="headline">Safe address</T>
          <Note>Where a sweep sends everything. It cannot be made from these 12 words, or someone who finds only the words could send your coins to themselves. It starts as your everyday address; a separate wallet or hardware wallet is better.</Note>
          <Field value={safe} onChangeText={setSafe} placeholder={everyday.data ?? 'Your everyday address'} autoCapitalize="none" autoCorrect={false} mono />
          <Note>Ethereum vaults have no heir yet.</Note>
          <ErrorText>{err || safeProblem || built.error}</ErrorText>
          <Button title="Review" disabled={!built.settings || !!safeProblem} onPress={() => { setErr(''); setStep('review'); }} />
        </>
      )}
      {step === 'review' && built.settings && (
        <>
          <Note>{`Last look. Once the vault exists, at most ${ethAllow || '0'} ETH and ${usdcAllow || '0'} USDC leave each day without waiting; anything else waits ${WAITS[wait][0]} and you can cancel it. Money is only protected once you send it to the vault address.`}</Note>
          {existing && (
            <>
              <T v="headline">Your 12 recovery words</T>
              <Note>This network uses the same recovery key as your other vault. Type the words so the app can switch the protection on. They are not stored.</Note>
              <Field value={typed} onChangeText={setTyped} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} placeholder="word word word…" style={{ minHeight: 100 }} />
            </>
          )}
          <ErrorText>{err}</ErrorText>
          <SlideToPay label="Slide to create" onSlide={create} />
          <Button title="Back" kind="plain" onPress={() => setStep('settings')} />
        </>
      )}
      {step === 'working' && (
        <>
          <VaultCreating step={stepKey || 'checking'} />
          <Note center>{msg || 'Working…'}</Note>
        </>
      )}
    </Screen>
  );
}
