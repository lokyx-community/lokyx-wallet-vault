import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { base64 } from '@scure/base';
import { T } from '../ui/Text';
import { Button, ErrorText, Field, Note, Press, Screen, failure, success } from '../ui/controls';
import { BreathingMark } from '../ui/RingCode';
import { Icon } from '../ui/Icon';
import { C, F } from '../ui/theme';
import { rpc, type GasEstimate } from '../lib/rpc';
import { bytesToHex, hexToBytes } from '../lib/lokyx';
import { TOKEN_ABI, TOKEN_WASM } from '../lib/contracts';
import { currentAddress, sendContract } from '../lib/wallet';
import { addPending, amountText, parseUnits, resolveDeploy, tokens } from '../lib/data';
import { confirmIt } from '../lib/auth';
import { niceLyx, shortAddr } from '../lib/format';
import { ContractsOnly } from '../ui/ContractsOnly';
import { DUR, EASE_OUT } from '../ui/motion';

const CODE = base64.decode(TOKEN_WASM);

/** The colours to pick for the coin's face: face, rim, lettering. Only how the coin looks on this screen; it is not saved with the token. */
const TINTS: [string, string, string][] = [['#F6D793', '#E9B86A', '#6A4A1A'], ['#A9EBCB', '#6FD6A3', '#17583A'], ['#B4CCFF', '#7BA3F5', '#1B3B7A'], ['#F8BBD3', '#EE86AE', '#7A1F47'], ['#D9C2FA', '#B28DF0', '#442A7A'], ['#E6E6E8', '#C3C3C8', '#3A3A40']];

function MakeToken() {
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [supply, setSupply] = useState('1000000');
  const [gas, setGas] = useState<GasEstimate | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState('');
  const [made, setMade] = useState('');
  const [tint, setTint] = useState(0);

  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  let units = 0n;
  try {
    units = supply ? parseUnits(supply, 18) : 0n;
  } catch {
    units = 0n;
  }
  const ready = name.trim().length > 1 && sym.length >= 2 && units > 0n;
  const args = [name.trim(), sym, amountText(units)];

  // try it against the chain while they type, for the fee
  useEffect(() => {
    if (!ready) return setGas(null);
    const t = setTimeout(() => {
      rpc<GasEstimate>('lyx_estimateGas', { from: currentAddress(), code: bytesToHex(CODE), abi: TOKEN_ABI, args })
        .then((g) => {
          setGas(g);
          setErr(g.ok ? '' : g.error ?? "This token can't be made");
        })
        .catch((e) => setErr(e.message));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, sym, supply, ready]);

  // wait for the block, then follow the new token
  useEffect(() => {
    if (!tx || made) return;
    const t = setInterval(async () => {
      const a = await resolveDeploy(tx);
      if (a === '') {
        clearInterval(t);
        setErr("The network didn't accept it. Nothing was made, and only gas was used.");
        setTx('');
        setBusy(false);
      } else if (a) {
        clearInterval(t);
        await tokens.save((x) => [...x.filter((y) => y.address !== a), { address: a, name: name.trim(), symbol: sym, decimals: 18 }]);
        success();
        setMade(a);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [tx, made, name, sym]);

  const go = async () => {
    if (!gas?.ok) return;
    if (!(await confirmIt(`Make ${sym}`, { keyFollows: true }))) return;
    setBusy(true);
    setErr('');
    try {
      const input = await rpc<string>('lyx_encodeDeploy', { abi: TOKEN_ABI, args });
      const h = await sendContract({ kind: 'deploy', code: CODE, abi: TOKEN_ABI, input: hexToBytes(input.replace(/^0x/, '')), gas: BigInt(gas.gasLimit) }, '');
      await addPending({ hash: h, from: currentAddress(), to: '', amount: '', what: 'deploy', at: Date.now() });
      setTx(h);
    } catch (e) {
      failure();
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  if (made)
    return (
      <Screen title="" close>
        <View style={{ alignItems: 'center', gap: 22, paddingTop: 40 }}>
          <Animated.View entering={FadeIn.duration(DUR.base).easing(EASE_OUT)} style={{ width: 132, height: 132, borderRadius: 66, backgroundColor: TINTS[tint][0], alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ fontFamily: F.semibold, fontSize: 30, color: TINTS[tint][2], letterSpacing: -1 }}>{sym}</T>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(200).duration(DUR.base).easing(EASE_OUT)} style={{ alignItems: 'center', gap: 8 }}>
            <T v="display">{name.trim()} is live</T>
            <Note center>All {supply} {sym} are in your wallet. Send some to a friend; they add it with this address.</Note>
            <T v="mono" color={C.soft}>{shortAddr(made, 12, 8)}</T>
          </Animated.View>
        </View>
        <Button title={`Send ${sym}`} onPress={() => router.replace(`/send?token=${made}`)} style={{ marginTop: 20 }} />
        <Button title="Lock the team's share" kind="line" onPress={() => router.replace(`/token/locks?token=${made}`)} />
        <Button title="Done" kind="plain" onPress={() => router.back()} />
      </Screen>
    );

  if (tx)
    return (
      <Screen title="" back={false}>
        <View style={{ alignItems: 'center', gap: 22, paddingTop: 100 }}>
          <BreathingMark size={72} />
          <T v="title">Making {sym}</T>
          <Note center>It goes in the next block, usually within a minute. You can leave this screen; it'll show up on Home.</Note>
          <Button title="Leave it running" kind="line" onPress={() => router.back()} />
        </View>
      </Screen>
    );

  const [face, edge, ink] = TINTS[tint];
  const rowField = (label: string, el: React.ReactNode, i: number) => (
    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', height: 56, borderTopWidth: i ? 0.5 : 0, borderColor: C.line, gap: 12 }}>
      <T v="sub" dim style={{ fontSize: 15, width: 96 }}>{label}</T>
      {el}
    </View>
  );
  const bare = { flex: 1, backgroundColor: 'transparent', paddingHorizontal: 0, textAlign: 'right' as const };
  return (
    <Screen title="Make a token" large>
      <T v="sub" dim style={{ marginTop: -8 }}>Points, shares, rewards: yours to name.</T>
      <Animated.View entering={FadeIn} style={{ alignItems: 'center', paddingVertical: 10 }}>
        <View style={{ width: 112, height: 112, borderRadius: 56, backgroundColor: edge, alignItems: 'center', justifyContent: 'center', shadowColor: edge, shadowOpacity: 0.35, shadowRadius: 26, shadowOffset: { width: 0, height: 8 } }}>
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: face, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' }}>
            {sym ? <T style={{ fontFamily: F.semibold, fontSize: sym.length > 4 ? 20 : 28, color: ink, letterSpacing: -0.8 }}>{sym}</T> : <Icon name="plus" size={34} color={ink} />}
          </View>
        </View>
      </Animated.View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: -4 }}>
        {TINTS.map((t, i) => (
          <Press key={t[1]} onPress={() => setTint(i)} accessibilityLabel={`Coin colour ${i + 1}`} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: t[1], borderWidth: i === tint ? 2.5 : 0, borderColor: C.text, alignItems: 'center', justifyContent: 'center' }}>
            {i === tint ? <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: C.bg }} /> : null}
          </Press>
        ))}
      </View>
      <View style={{ borderRadius: 22, backgroundColor: C.fill, paddingHorizontal: 18 }}>
        {[
          rowField('Name', <Field value={name} onChangeText={setName} placeholder="Garden Club Points" maxLength={32} style={bare} />, 0),
          rowField('Short name', <Field value={symbol} onChangeText={setSymbol} placeholder="GCP" autoCapitalize="characters" autoCorrect={false} maxLength={8} style={bare} />, 1),
          rowField('How many', <Field value={supply} onChangeText={(s) => setSupply(s.replace(/[^\d.]/g, ''))} placeholder="1,000,000" keyboardType="decimal-pad" style={bare} />, 2),
        ]}
      </View>
      <T v="caption" dim style={{ paddingHorizontal: 6, lineHeight: 18 }}>You get all of them to start. Anyone can hold them, and nobody can make more later, not even you.</T>
      {gas?.ok && <T v="caption" dim style={{ paddingHorizontal: 6 }}>Network fee, at most {niceLyx(gas.maxGasFeeLyx, 6)} LYX. Unused gas comes back.</T>}
      <ErrorText>{err}</ErrorText>
      <Button title={`Make ${sym || 'token'}`} disabled={!ready || !gas?.ok} busy={busy} onPress={go} />
    </Screen>
  );
}

export default function MakeTokenGate() {
  return (
    <ContractsOnly>
      <MakeToken />
    </ContractsOnly>
  );
}
