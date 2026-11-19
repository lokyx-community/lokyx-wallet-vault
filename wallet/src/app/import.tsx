import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { formatUnits, type Hex } from 'viem';
import { T } from '../ui/Text';
import { Button, ErrorText, Field, Group, Note, Screen, success } from '../ui/controls';
import { Segmented } from '../ui/Segmented';
import { CoinMark } from '../ui/CoinMark';
import { ScreenGuard } from '../ui/ScreenGuard';
import { PhraseEntry } from '../ui/PhraseEntry';
import { SlideToPay } from '../ui/SlideToPay';
import { C, F } from '../ui/theme';
import { confirmIt } from '../lib/auth';
import { plainError } from '../lib/plain-error';
import { isMnemonic } from '../lib/lokyx';
import { ensureAddresses } from '../lib/multichain';
import { ETH_NETS, type EthNet } from '../lib/multichain-core';
import { appsAddress } from '../lib/appswallet';
import { expectedFor, loadVaults, vaults } from '../lib/ethvault';
import { VAULT_NETS } from '../lib/ethvault-core';
import { findMoney, moveMoney, type Source } from '../lib/import';
import { parsePrivateKey, styleLabel, wordCountOk, type FoundAddress } from '../lib/import-core';

const trim = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s).slice(0, 12);

/** Bring in another wallet: find where its money is, then move it into a vault so the old words stop mattering. */
export default function Import() {
  const [mode, setMode] = useState<'words' | 'key'>('words');
  const [words, setWords] = useState('');
  const [key, setKey] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [found, setFound] = useState<FoundAddress[] | null>(null);
  const [src, setSrc] = useState<Source | null>(null);
  const [dest, setDest] = useState<Record<string, string>>({});
  const [vaultNets, setVaultNets] = useState<string[]>([]);
  const [done, setDone] = useState('');

  const pasteWords = async () => {
    setWords((await Clipboard.getStringAsync()).trim());
    await Clipboard.setStringAsync('').catch(() => {});
  };
  const ready = mode === 'words' ? wordCountOk(words) : !!parsePrivateKey(key);

  const find = async () => {
    setErr('');
    let s: Source;
    if (mode === 'words') {
      if (!isMnemonic(words)) return setErr("One of those words is wrong, or they're out of order.");
      s = { words, passphrase: pass };
    } else {
      const k = parsePrivateKey(key);
      if (!k) return setErr('That is not a private key. It is 64 letters and numbers.');
      s = { key: k as Hex };
    }
    setBusy(true);
    try {
      const own = [(await ensureAddresses()).eth, appsAddress() ?? ''].filter(Boolean);
      const list = await findMoney(s, own);
      await loadVaults();
      const d: Record<string, string> = {};
      const have: string[] = [];
      for (const [net, v] of Object.entries(vaults.get())) {
        if (v) {
          d[net] = (await expectedFor(v)).safe;
          have.push(net);
        }
      }
      setDest(d);
      setVaultNets(have);
      setSrc(s);
      setFound(list);
    } catch (e) {
      setErr(plainError(e, 'the network'));
    }
    setBusy(false);
  };

  const move = async (toVault: boolean) => {
    if (!src || !found) return false;
    if (!(await confirmIt(toVault ? 'Move it into your vault' : 'Move it into your wallet'))) return false;
    try {
      const main = (await ensureAddresses()).eth;
      const r = await moveMoney(src, found, (net) => (toVault && dest[net] ? dest[net] : main));
      success();
      setDone(r.sent ? `Moved. ${r.sent} transfer${r.sent === 1 ? '' : 's'} sent.${r.problems.length ? ` ${r.problems[0]}` : ''}` : r.problems[0] ?? 'Nothing could be moved.');
      setSrc(null);
      return true;
    } catch (e) {
      setErr(plainError(e, 'the network'));
      return false;
    }
  };

  if (done)
    return (
      <Screen title="Import">
        <Note>{done}</Note>
        <Button title="Done" onPress={() => router.replace('/')} />
      </Screen>
    );

  if (found)
    return (
      <Screen title="We found your money">
        <ScreenGuard />
        {found.length === 0 ? (
          <Note>Nothing found in the common address styles for MetaMask, Ledger, Trezor and Exodus, on the test networks this wallet uses.</Note>
        ) : (
          found.map((f) => (
            <Group key={f.address} title={`${styleLabel(f.style)} · ${f.address.slice(0, 6)}…${f.address.slice(-4)}`}>
              {f.holdings.map((h) => (
                <View key={h.net + h.symbol} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingHorizontal: 16 }}>
                  <CoinMark symbol={h.symbol} seed={h.net + h.symbol} size={38} net={h.net as EthNet} />
                  <View style={{ flex: 1 }}>
                    <T v="callout">{h.symbol}</T>
                    <T v="caption" dim>{ETH_NETS[h.net as EthNet].label}</T>
                  </View>
                  <T style={{ fontFamily: F.medium, fontSize: 16 }}>{trim(formatUnits(h.amount, h.decimals))}</T>
                </View>
              ))}
            </Group>
          ))
        )}
        {found.length > 0 ? (
          <>
            <View style={{ gap: 6, padding: 16, borderRadius: 20, backgroundColor: C.fill }}>
              <T v="callout">Move it now</T>
              <T v="sub" dim>Your old words may be in other apps or photos. Once the money is here, they are useless.</T>
              {vaultNets.length ? <T v="caption" dim>{`Goes into your vault on ${vaultNets.map((n) => VAULT_NETS[n as keyof typeof VAULT_NETS].label).join(' and ')}. Other networks go to your main address.`}</T> : <T v="caption" dim>You have no vault yet, so it goes to your main address. Make a vault from Apps to protect it.</T>}
            </View>
            <ErrorText>{err}</ErrorText>
            <SlideToPay label={vaultNets.length ? 'Slide to move into my vault' : 'Slide to move it here'} onSlide={() => move(vaultNets.length > 0)} />
          </>
        ) : null}
        <Button title="Back" kind="plain" onPress={() => { setFound(null); setSrc(null); }} />
      </Screen>
    );

  return (
    <Screen title="Import a wallet">
      <ScreenGuard />
      <Segmented<'words' | 'key'> value={mode} onChange={setMode} options={[['words', 'Recovery words'], ['key', 'Private key']]} />
      {mode === 'words' ? (
        <>
          <T v="sub" dim>From MetaMask, Trust, Ledger, Trezor, Exodus and others. 12, 15, 18, 21 or 24 words.</T>
          <PhraseEntry value={words} onChange={setWords} />
          <Button title="Paste" kind="line" onPress={pasteWords} />
          <Field value={pass} onChangeText={setPass} placeholder="Passphrase (only if you added a 25th word)" secureTextEntry autoCapitalize="none" autoCorrect={false} />
        </>
      ) : (
        <Field value={key} onChangeText={setKey} placeholder="Private key" secureTextEntry autoCapitalize="none" autoCorrect={false} mono />
      )}
      <T v="caption" dim>Your words and keys stay on this phone and are not saved. The clipboard is cleared after pasting.</T>
      <ErrorText>{err}</ErrorText>
      <Button title={busy ? 'Looking…' : 'Find my money'} busy={busy} disabled={!ready} onPress={find} />
    </Screen>
  );
}
