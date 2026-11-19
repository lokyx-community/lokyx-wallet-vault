import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { T } from '../ui/Text';
import { Button, Group, Note, Row, Screen } from '../ui/controls';
import { Segmented } from '../ui/Segmented';
import { ScreenGuard } from '../ui/ScreenGuard';
import { toast } from '../ui/Toast';
import { C } from '../ui/theme';
import { confirmIt } from '../lib/auth';
import { readKeyHex, readPhrase, wallet } from '../lib/wallet';
import { activeNets } from '../lib/multichain';
import { btcKey, ethKey, solKey, trxKey } from '../lib/multichain-core';
import { bytesToHex } from '@noble/hashes/utils.js';

type Which = 'lyx' | 'eth' | 'btc' | 'sol' | 'trx';
const NAMES: Record<Which, string> = { lyx: 'LOKYX', eth: 'Ethereum', btc: 'Bitcoin', sol: 'Solana', trx: 'Tron' };
const SHOW_FOR_MS = 30_000;

/** What a person building on LOKYX needs in one place: the private key of each coin, the networks, and which build this is. */
export default function Developer() {
  const [which, setWhich] = useState<Which>('lyx');
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setKey(null);
  };
  useEffect(() => hide, []);
  // switching coin hides what was showing
  useEffect(() => {
    setKey(null);
    setErr('');
  }, [which]);

  const show = async () => {
    setErr('');
    if (!(await confirmIt(`Show the ${NAMES[which]} private key`, which === 'lyx' ? { keyFollows: true } : undefined))) return;
    try {
      let hex: string | null = null;
      if (which === 'lyx') hex = await readKeyHex();
      else {
        const phrase = await readPhrase();
        if (!phrase) throw new Error('This account was added from a private key, so it has no 24 words and no keys for other coins.');
        const n = activeNets();
        const ac = wallet.get().current;
        const k = which === 'eth' ? ethKey(phrase, 0, ac) : which === 'btc' ? btcKey(phrase, n.btc, 0, ac) : which === 'sol' ? solKey(phrase, ac) : trxKey(phrase, 0, ac);
        hex = bytesToHex(k.sk);
        k.sk.fill(0);
      }
      if (!hex) throw new Error('This phone has no key for that account.');
      setKey(hex.replace(/^0x/, ''));
      timer.current = setTimeout(hide, SHOW_FOR_MS);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Screen title="Developer" large>
      <ScreenGuard />
      <T v="headline">Private key</T>
      <Note>A private key is the whole account. Anyone who sees it can take everything on that coin, and nobody at LOKYX can undo it. Look only somewhere private, and never type it into a website or send it to anyone.</Note>
      <Segmented<Which> value={which} onChange={setWhich} options={(Object.keys(NAMES) as Which[]).map((k) => [k, NAMES[k]] as [Which, string])} />
      {key ? (
        <>
          <View style={{ backgroundColor: C.fill, borderRadius: 16, padding: 16, gap: 8 }}>
            <T v="mono" selectable style={{ lineHeight: 22 }}>{key}</T>
            <T v="caption" dim>{which === 'sol' ? '32-byte seed, hex.' : '32 bytes, hex.'} Hides itself in 30 seconds.</T>
          </View>
          <Button title="Copy" kind="line" onPress={async () => { await Clipboard.setStringAsync(key); toast('Key copied. Clear your clipboard when you are done.', 'copy'); }} />
          <Button title="Hide now" kind="plain" onPress={hide} />
        </>
      ) : (
        <>
          {err ? <Note>{err}</Note> : null}
          <Button title={`Show the ${NAMES[which]} key`} onPress={show} />
        </>
      )}

      <T v="headline" style={{ marginTop: 8 }}>Networks</T>
      <Group>
        <Row icon="server" title="LOKYX node" sub="Which node the wallet talks to" onPress={() => router.push('/node')} />
        <Row icon="globe" title="Bitcoin, Ethereum and others" sub="Test networks and their endpoints" onPress={() => router.push('/chains-settings')} />
      </Group>

      <T v="headline" style={{ marginTop: 8 }}>This build</T>
      <Group>
        <Row title="Version" detail={Constants.expoConfig?.version ?? ''} />
        <Row title="Build" detail={process.env.EXPO_PUBLIC_BUILD ? process.env.EXPO_PUBLIC_BUILD.slice(0, 7) : 'local'} />
      </Group>
    </Screen>
  );
}
