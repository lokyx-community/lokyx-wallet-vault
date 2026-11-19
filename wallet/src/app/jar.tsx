import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Rect, ClipPath, Defs } from 'react-native-svg';
import Animated, { Easing, FadeInDown, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import { base64 } from '@scure/base';
import { T } from '../ui/Text';
import { Button, ErrorText, Field, Note, Press, Screen, failure, success, tick } from '../ui/controls';
import { Sheet } from '../ui/Sheet';
import { C, F } from '../ui/theme';
import { rpc, type GasEstimate, type RunResult } from '../lib/rpc';
import { bytesToHex, formatLyx, hexToBytes, parseLyx } from '../lib/lokyx';
import { JAR_ABI, JAR_WASM } from '../lib/contracts';
import { currentAddress, sendContract } from '../lib/wallet';
import { addPending, jars, resolveDeploy, useJars, type Jar } from '../lib/data';
import { confirmIt } from '../lib/auth';
import { useChain } from '../lib/chain';
import { niceLyx } from '../lib/format';
import { ContractsOnly } from '../ui/ContractsOnly';
import { CoinJar } from '../ui/CoinJar';
import { Icon } from '../ui/Icon';
import { DUR, EASE_OUT } from '../ui/motion';

const CODE = base64.decode(JAR_WASM);
const ARect = Animated.createAnimatedComponent(Rect);
const SPANS: [string, number][] = [
  ['A month', 30 * 86400],
  ['3 months', 91 * 86400],
  ['6 months', 182 * 86400],
  ['1 year', 365 * 86400],
];
/** How many coins a jar shows: more LYX, a fuller jar, on a gentle curve. */
const coinsFor = (lyx: number) => Math.max(4, Math.min(33, Math.round(5 + 9 * Math.log10(1 + lyx))));

/** A jar outline that fills to show how close it is to opening. */
function JarArt({ fill, size = 72 }: { fill: number; size?: number }) {
  const k = useSharedValue(0);
  useEffect(() => {
    k.value = withTiming(fill, { duration: 1100, easing: Easing.out(Easing.cubic) });
  }, [fill, k]);
  const p = useAnimatedProps(() => {
    const f = Math.min(1, Math.max(0, k.value));
    return { y: 26 + 62 * (1 - f), height: 62 * f };
  });
  return (
    <Svg width={size} height={size * 1.15} viewBox="0 0 80 92">
      <Defs>
        <ClipPath id="jar">
          <Path d="M18 26h44l4 10v44a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8V36z" />
        </ClipPath>
      </Defs>
      <ARect x={0} width={80} fill={C.text} clipPath="url(#jar)" animatedProps={p} />
      <Path d="M18 26h44l4 10v44a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8V36z" stroke={C.text} strokeWidth={3} fill="none" strokeLinejoin="round" />
      <Rect x={22} y={10} width={36} height={12} rx={4} stroke={C.text} strokeWidth={3} fill="none" />
    </Svg>
  );
}

function JarCard({ j, height, i, blockSecs, hero, onPick }: { j: Jar; height: number; i: number; blockSecs: number; hero: boolean; onPick: () => void }) {
  const [info, setInfo] = useState<{ amount: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const left = Math.max(0, j.unlock - height);
  const span = Math.max(1, j.unlock - (j.start ?? j.unlock - left));
  const open = left === 0;

  useEffect(() => {
    let live = true;
    const load = async () => {
      if (!j.address) {
        const a = await resolveDeploy(j.tx);
        if (a) await jars.save((x) => x.map((y) => (y.tx === j.tx ? { ...y, address: a } : y)));
        if (a === '') await jars.save((x) => x.filter((y) => y.tx !== j.tx));
        return;
      }
      try {
        const r = await rpc<RunResult>('lyx_call', { to: j.address, method: 'info', args: [] });
        const v = r.result as [string, number, string];
        if (live && r.ok) setInfo({ amount: niceLyx(String(v[2])) });
      } catch {
        /* keep the last value */
      }
    };
    load();
    const t = setInterval(load, 6000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [j]);

  const withdraw = async () => {
    if (!j.address) return;
    if (!(await confirmIt('Open the jar', { keyFollows: true }))) return;
    setBusy(true);
    setErr('');
    try {
      const g = await rpc<GasEstimate>('lyx_estimateGas', { from: currentAddress(), to: j.address, method: 'withdraw', args: [] });
      if (!g.ok) throw new Error(g.error ?? "The jar won't open yet");
      const input = await rpc<string>('lyx_encodeCall', { to: j.address, method: 'withdraw', args: [] });
      const h = await sendContract({ kind: 'call', input: hexToBytes(input.replace(/^0x/, '')), gas: BigInt(g.gasLimit) }, j.address);
      await addPending({ hash: h, from: currentAddress(), to: j.address, amount: '', what: 'call', at: Date.now() });
      await jars.save((x) => x.filter((y) => y.tx !== j.tx));
      success();
    } catch (e) {
      failure();
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const secs = left * blockSecs;
  const days = secs / 86400;
  const when = open ? 'Ready to open' : days >= 2 ? `Opens in ${Math.ceil(days)} days` : secs >= 7200 ? `Opens in ${Math.ceil(secs / 3600)} hours` : `Opens in ${Math.max(1, Math.ceil(secs / 60))} min`;
  const fill = open ? 1 : Math.max(0.04, 1 - left / span);
  const n = coinsFor(info ? parseFloat(info.amount.replace(/,/g, '')) || 0 : 1);
  if (!hero)
    return (
      <Press onPress={onPick} scaleTo={0.985} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 22, backgroundColor: C.fill }}>
        <Ring fill={fill} />
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 16 }}>{j.name}</T>
          <T v="caption" dim>{j.address ? when : 'Being made…'}</T>
        </View>
        <T style={{ fontFamily: F.medium, fontSize: 17 }}>{info ? info.amount : '…'}</T>
      </Press>
    );
  return (
    <Animated.View entering={FadeInDown.delay(i * 60).duration(DUR.base).easing(EASE_OUT)} style={{ alignItems: 'center', gap: 6 }}>
      <CoinJar coins={n} size={210} id={`h${i}`} />
      <T style={{ fontFamily: F.regular, fontSize: 42, letterSpacing: -1.4, marginTop: -4 }}>{info ? info.amount : '…'}<T style={{ fontSize: 17, color: C.sub }}> LYX</T></T>
      <T v="sub" dim>{j.name} · <T v="sub" color={open ? C.good : C.soft}>{j.address ? when : 'Being made…'}</T></T>
      {open && j.address && <Button title="Open and take it out" onPress={withdraw} busy={busy} style={{ alignSelf: 'stretch', marginTop: 10 }} />}
      <ErrorText>{err}</ErrorText>
    </Animated.View>
  );
}

/** A small ring for the jars waiting below the big one: how far to opening. */
function Ring({ fill, size = 44 }: { fill: number; size?: number }) {
  const r = size / 2 - 4;
  const L = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={4} fill="none" />
      <Circle cx={size / 2} cy={size / 2} r={r} stroke="#D9DAE0" strokeWidth={4} fill="none" strokeLinecap="round" strokeDasharray={`${L * fill} ${L}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </Svg>
  );
}

function JarScreen() {
  const list = useJars();
  const chain = useChain();
  const height = chain.info?.height ?? 0;
  const blockSecs = chain.info?.targetBlockTime ?? 60;
  const [make, setMake] = useState(false);
  const [sel, setSel] = useState(0);
  const [name, setName] = useState('');
  const [amt, setAmt] = useState('');
  const [span, setSpan] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const create = async () => {
    setErr('');
    let value: bigint;
    try {
      value = parseLyx(amt);
    } catch (e) {
      return setErr((e as Error).message);
    }
    if (value <= 0n) return setErr('Put at least a little LYX in');
    const unlock = height + Math.ceil(SPANS[span][1] / blockSecs);
    const label = name.trim() || 'Savings';
    // the passcode screen goes over everything, so put the sheet away first
    setMake(false);
    await new Promise((r) => setTimeout(r, 250));
    if (!(await confirmIt(`Lock ${amt} LYX`, { keyFollows: true }))) return setMake(true);
    setBusy(true);
    try {
      const g = await rpc<GasEstimate>('lyx_estimateGas', { from: currentAddress(), code: bytesToHex(CODE), abi: JAR_ABI, args: [unlock], value: value.toString() });
      if (!g.ok) throw new Error(g.error ?? "The jar can't be made");
      const input = await rpc<string>('lyx_encodeDeploy', { abi: JAR_ABI, args: [unlock] });
      const h = await sendContract({ kind: 'deploy', code: CODE, abi: JAR_ABI, input: hexToBytes(input.replace(/^0x/, '')), gas: BigInt(g.gasLimit) }, '', value);
      await addPending({ hash: h, from: currentAddress(), to: '', amount: `${amt} LYX`, what: 'deploy', at: Date.now() });
      await jars.save((x) => [{ owner: currentAddress(), name: label, unlock, start: height, tx: h, at: Date.now() }, ...x]);
      success();
      setMake(false);
      setName('');
      setAmt('');
    } catch (e) {
      failure();
      setErr((e as Error).message);
      setMake(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Savings jar" large>
      <T v="sub" dim style={{ marginTop: -8 }}>Locked until the day you pick. Not even you can open it early.</T>
      {list.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
          <CoinJar coins={0} size={190} id="e" />
          <T v="callout" dim>No jars yet</T>
        </View>
      ) : (
        <>
          <JarCard key={list[Math.min(sel, list.length - 1)].tx} j={list[Math.min(sel, list.length - 1)]} height={height} i={0} blockSecs={blockSecs} hero onPick={() => {}} />
          {list.length > 1 ? (
            <View style={{ gap: 8 }}>
              {list.map((j, i) => (i === Math.min(sel, list.length - 1) ? null : <JarCard key={j.tx} j={j} height={height} i={i} blockSecs={blockSecs} hero={false} onPick={() => (tick(), setSel(i))} />))}
            </View>
          ) : null}
        </>
      )}
      <Button title="New jar" icon="plus" onPress={() => setMake(true)} disabled={!height} />

      <Sheet open={make} onClose={() => setMake(false)}>
        <View style={{ gap: 16 }}>
          <View style={{ alignItems: 'center', marginBottom: -6 }}><CoinJar coins={amt ? coinsFor(parseFloat(amt) || 0) : 0} size={110} id="n" /></View>
          <T v="title" style={{ textAlign: 'center' }}>New jar</T>
          <Field value={name} onChangeText={setName} placeholder="What's it for? Like Holiday" maxLength={28} />
          <Field value={amt} onChangeText={(s) => setAmt(s.replace(/[^\d.]/g, ''))} placeholder="How much LYX" keyboardType="decimal-pad" />
          <T v="sub" dim>Opens after</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {SPANS.map(([l], i) => (
              <Press key={l} onPress={() => (tick(), setSpan(i))} style={{ paddingHorizontal: 16, height: 38, borderRadius: 19, backgroundColor: span === i ? C.ink : C.fill, justifyContent: 'center' }}>
                <T v="sub" style={{ fontFamily: F.medium }} color={span === i ? C.inkText : C.text}>{l}</T>
              </Press>
            ))}
          </View>
          <T v="caption" dim style={{ textAlign: 'center' }}>Nobody can open it early, not even you.</T>
          <ErrorText>{err}</ErrorText>
          <Button title={amt ? `Lock ${amt} LYX` : 'Lock it'} onPress={create} busy={busy} disabled={!amt} />
        </View>
      </Sheet>
    </Screen>
  );
}

export default function JarScreenGate() {
  return (
    <ContractsOnly>
      <JarScreen />
    </ContractsOnly>
  );
}
