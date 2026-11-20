import { Aurora } from '../ui/Aurora';
import { useEffect, useMemo, useState } from 'react';
import { flyCoin } from '../ui/CoinFlight';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, SlideInRight, SlideOutLeft, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Button, ErrorText, Field, IconButton, Press, Switch, failure, success, tick } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Avatar, RingCode } from '../ui/RingCode';
import { CoinLaunch } from '../ui/CoinLaunch';
import { Slip, shareSlip, useReveal } from '../ui/Slip';
import { CoinLogo } from '../ui/CoinLogo';
import { Keypad, typeAmount } from '../ui/Keypad';
import { Digits } from '../ui/Digits';
import { C, F } from '../ui/theme';
import { usePoll, rpc, type Account, type GasEstimate } from '../lib/rpc';
import { isAddress, formatLyx, parseLyx, hexToBytes } from '../lib/lokyx';
import type { TxInfo } from '../lib/rpc';
import { toast } from '../ui/Toast';
import { currentAddress, sendContract, sendLyx, transferFee, useAccountRef, useWallet } from '../lib/wallet';
import { addPending, amountText, contacts, formatUnits, parseUnits, rememberRecent, tokenBalance, useContacts, useRecent, useTokens, type Token } from '../lib/data';
import { checkDailyLimit, noteSpent } from '../lib/limits';
import { newDeviceGate } from '../lib/guard';
import { DestGuard } from '../ui/DestGuard';
import { bioName, biometricKind, confirmIt, type Bio } from '../lib/auth';
import { nameFor, niceLyx, shortAddr } from '../lib/format';
import { useContractsOn } from '../lib/chain';
import { KeyboardScroll } from '../ui/KeyboardScroll';
import { DUR, EASE_OUT } from '../ui/motion';

type Step = 'to' | 'amount' | 'review' | 'sent';

export default function Send() {
  const q = useLocalSearchParams<{ to?: string; amount?: string; token?: string }>();
  const insets = useSafeAreaInsets();
  const w = useWallet();
  const me = useAccountRef();
  const contractsOn = useContractsOn();
  const allTokens = useTokens();
  const tokens = contractsOn ? allTokens : [];
  const [to, setTo] = useState(q.to && isAddress(q.to) ? q.to : '');
  const [amt, setAmt] = useState(q.amount ?? '');
  const [token, setToken] = useState<Token | null>(tokens.find((t) => t.address === q.token) ?? null);
  const [step, setStep] = useState<Step>(to ? 'amount' : 'to');
  const [hash, setHash] = useState('');
  const [feeShown, setFeeShown] = useState('');
  const [sentAt, setSentAt] = useState(0);
  const [guardOk, setGuardOk] = useState(false);
  const cs = useContacts();
  const rc = useRecent();
  const knownDests = useMemo(() => [...cs.map((c) => c.address), ...rc, ...w.accounts.map((a) => a.address)], [cs, rc, w.accounts]);

  const acct = usePoll<Account>('lyx_getAccount', me ? { address: me.address } : null, 6000);
  const [tokBal, setTokBal] = useState<bigint>();
  useEffect(() => {
    setTokBal(undefined);
    if (token && me) tokenBalance(token, me.address).then(setTokBal).catch(() => {});
  }, [token, me]);

  const symbol = token?.symbol ?? 'LYX';
  const decimals = token?.decimals ?? 18;
  const fee = transferFee();
  const have = token ? tokBal : acct.data ? BigInt(acct.data.balance) : undefined;
  const value = useMemo(() => {
    try {
      return amt ? (token ? parseUnits(amt.replace(/\.$/, ''), decimals) : parseLyx(amt.replace(/\.$/, ''))) : 0n;
    } catch {
      return 0n;
    }
  }, [amt, token, decimals]);
  const tooMuch = have !== undefined && (token ? value > have : value + fee > have);

  const title = step === 'to' ? 'Send' : step === 'amount' ? '' : step === 'review' ? 'Review' : '';
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }}>
      <Aurora />
      {step !== 'sent' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 48, gap: 12 }}>
          {step === 'to' || (step === 'amount' && q.to) ? (
            <IconButton name="close" label="Close" onPress={() => router.back()} />
          ) : (
            <IconButton name="back" label="Back" onPress={() => setStep(step === 'review' ? 'amount' : 'to')} />
          )}
          <T v="headline" style={{ flex: 1, textAlign: 'center', marginRight: 52 }}>{title}</T>
        </View>
      )}

      {step === 'to' && (
        <ToStep
          onPick={(a) => {
            if (a === currentAddress()) return toast("That's this account. Pick someone else, or another of your accounts.", 'info');
            setTo(a);
            tick();
            setStep('amount');
          }}
        />
      )}

      {step === 'amount' && (
        <Animated.View key="amount" entering={SlideInRight.duration(DUR.base).easing(EASE_OUT)} exiting={SlideOutLeft.duration(160)} style={{ flex: 1, paddingHorizontal: 24 }}>
          <Press onPress={() => setStep('to')} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6, paddingVertical: 4 }}>
            <Avatar address={to} size={32} name={contacts.get().find((c) => c.address === to)?.name} />
            <T v="callout">{nameFor(to) ?? shortAddr(to)}</T>
          </Press>
          <DestGuard dest={to} known={knownDests} onOk={setGuardOk} />
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
              <Digits text={amt || '0'} style={{ fontFamily: F.semibold, fontSize: amt.length > 9 ? 46 : 64, letterSpacing: -2.4, lineHeight: amt.length > 9 ? 54 : 72 }} color={amt ? (tooMuch ? C.bad : C.text) : C.faint} />
              <T style={{ fontFamily: F.medium, fontSize: 22, color: C.sub }}>{symbol}</T>
            </View>
            <Press
              onPress={() => {
                if (have === undefined) return;
                const max = token ? have : have > fee ? have - fee : 0n;
                setAmt(token ? formatUnits(max, decimals, 8).replace(/,/g, '') : formatLyx(max, 8).replace(/,/g, ''));
              }}
              style={{ paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: C.fill, justifyContent: 'center' }}
            >
              <T v="sub" color={tooMuch ? C.bad : C.soft}>
                {have === undefined ? '…' : tooMuch ? 'More than you have' : `${token ? formatUnits(have, decimals) : niceLyx(formatLyx(have))} ${symbol} available · Max`}
              </T>
            </Press>
            {tokens.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }} style={{ flexGrow: 0 }}>
                {[null, ...tokens].map((t) => {
                  const on = (t?.address ?? null) === (token?.address ?? null);
                  return (
                    <Press key={t?.address ?? 'lyx'} onPress={() => (tick(), setToken(t), setAmt(''))} style={{ paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: on ? C.ink : C.fill, justifyContent: 'center' }}>
                      <T v="sub" style={{ fontFamily: F.medium }} color={on ? C.inkText : C.text}>{t?.symbol ?? 'LYX'}</T>
                    </Press>
                  );
                })}
              </ScrollView>
            )}
          </View>
          <Keypad round onKey={(k) => setAmt((a) => typeAmount(a, k, Math.min(decimals, 8)))} extra="." />
          <Button title="Review" disabled={value === 0n || tooMuch || !guardOk} onPress={() => setStep('review')} style={{ marginTop: 14 }} />
        </Animated.View>
      )}

      {step === 'review' && (
        <Review
          to={to}
          amount={amt.replace(/\.$/, '')}
          value={value}
          token={token}
          ask={!(w.settings.askAbove && !token && value <= parseLyx(w.settings.askAbove || '0'))}
          onSent={(h, feeText) => {
            setHash(h);
            setFeeShown(feeText);
            setSentAt(Date.now());
            setStep('sent');
          }}
        />
      )}

      {step === 'sent' && <Sent amount={amt.replace(/\.$/, '')} unit={symbol} to={to} hash={hash} fee={feeShown} at={sentAt} />}
    </View>
  );
}

// ---------- who ----------

function ToStep({ onPick }: { onPick: (a: string) => void }) {
  const [text, setText] = useState('');
  const people = useContacts();
  const recent = useRecent();
  const w = useWallet();
  const mine = w.accounts.filter((a) => a.address !== currentAddress());
  const t = text.trim().toLowerCase();
  const valid = isAddress(t);
  const match = people.filter((p) => !t || p.name.toLowerCase().includes(t) || p.address.includes(t));

  return (
    <KeyboardScroll contentContainerStyle={{ paddingHorizontal: 20, gap: 22, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Field value={text} onChangeText={setText} placeholder="Name or lyx1… address" autoCapitalize="none" autoCorrect={false} style={{ flex: 1 }} autoFocus />
        <Press onPress={() => router.replace('/ring?mode=scan&for=lyx')} accessibilityLabel="Scan" style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="scan" size={22} color={C.text} />
        </Press>
      </View>
      {valid && (
        <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)}>
          <PersonRow address={t} name={nameFor(t) ?? 'This address'} sub={shortAddr(t, 12, 8)} onPress={() => onPick(t)} />
        </Animated.View>
      )}
      {!t && (
        <Press
          onPress={async () => {
            const s = (await Clipboard.getStringAsync()).trim().toLowerCase();
            if (isAddress(s)) onPick(s);
            else setText(s);
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
        >
          <Icon name="copy" size={18} color={C.sub} />
          <T v="callout" dim>Paste from clipboard</T>
        </Press>
      )}
      {!t && recent.length > 0 && (
        <View style={{ gap: 4 }}>
          <T v="sub" dim>Recent</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 18, paddingVertical: 8 }}>
            {recent.map((a) => (
              <Press key={a} onPress={() => onPick(a)} style={{ alignItems: 'center', gap: 8, width: 64 }}>
                <Avatar address={a} size={56} name={people.find((p) => p.address === a)?.name} />
                <T v="caption" numberOfLines={1}>{nameFor(a)?.replace(' (you)', '') ?? a.slice(4, 10)}</T>
              </Press>
            ))}
          </ScrollView>
        </View>
      )}
      {match.length > 0 && (
        <View style={{ gap: 2 }}>
          <T v="sub" dim style={{ paddingBottom: 4 }}>People</T>
          {match.map((p) => (
            <PersonRow key={p.address} address={p.address} name={p.name} named sub={shortAddr(p.address)} onPress={() => onPick(p.address)} />
          ))}
        </View>
      )}
      {!t && mine.length > 0 && (
        <View style={{ gap: 2 }}>
          <T v="sub" dim style={{ paddingBottom: 4 }}>Your other accounts</T>
          {mine.map((a) => (
            <PersonRow key={a.address} address={a.address} name={a.name} sub={shortAddr(a.address)} onPress={() => onPick(a.address)} />
          ))}
        </View>
      )}
      <ErrorText hint>{t.length > 8 && !valid && match.length === 0 ? "That isn't a LOKYX address. They start with lyx1." : ''}</ErrorText>
    </KeyboardScroll>
  );
}

function PersonRow({ address, name, sub, onPress, named }: { address: string; name: string; sub: string; onPress: () => void; named?: boolean }) {
  return (
    <Press haptic={false} scaleTo={0.98} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 }}>
      <Avatar address={address} size={44} name={named ? name : undefined} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="callout" style={{ fontSize: 16 }}>{name}</T>
        <T v="caption" dim>{sub}</T>
      </View>
      <Icon name="chevron" size={16} color={C.faint} width={2} />
    </Press>
  );
}

// ---------- check and send ----------

function Review({ to, amount, value, token, ask, onSent }: { to: string; amount: string; value: bigint; token: Token | null; ask: boolean; onSent: (h: string, fee: string) => void }) {
  const [bio, setBio] = useState<Bio>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [gas, setGas] = useState<GasEstimate | null>(null);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [busy]);
  const [save, setSave] = useState(false);
  const [name, setName] = useState('');
  const known = contacts.get().find((c) => c.address === to);
  const w = useWallet();
  const paidBefore = useRecent().includes(to);

  useEffect(() => {
    biometricKind().then((b) => setBio(w.settings.biometrics ? b : null));
  }, [w.settings.biometrics]);

  // a token payment is a contract call: try it first to know the gas
  useEffect(() => {
    if (!token) return;
    rpc<GasEstimate>('lyx_estimateGas', { from: currentAddress(), to: token.address, method: 'transfer', args: [to, amountText(value)] })
      .then((g) => {
        setGas(g);
        if (!g.ok) setErr(g.error ?? "The token won't accept this transfer");
      })
      .catch((e) => setErr(e.message));
  }, [token, to, value]);

  const feeText = token ? (gas ? `${niceLyx(gas.maxGasFeeLyx, 6)} LYX at most` : '…') : `${formatLyx(transferFee(), 6)} LYX`;

  const go = async (): Promise<boolean> => {
    setErr('');
    if (ask && !(await confirmIt(`Send ${amount} ${token?.symbol ?? 'LYX'}`, { keyFollows: true }))) return false;
    if (!token && !(await checkDailyLimit(value))) return false;
    let gate: Awaited<ReturnType<typeof newDeviceGate>> = { ok: true, commit: async () => {} };
    if (!token) {
      try {
        const bal = BigInt((await rpc<Account>('lyx_getAccount', { address: currentAddress() })).balance);
        gate = newDeviceGate('lyx', bal, value, (v) => `${niceLyx(formatLyx(v))} LYX`);
      } catch {}
      if (!gate.ok) {
        setErr(gate.message);
        return false;
      }
    }
    setBusy(true);
    try {
      let h: string;
      if (token) {
        const input = await rpc<string>('lyx_encodeCall', { to: token.address, method: 'transfer', args: [to, amountText(value)] });
        h = await sendContract({ kind: 'call', input: hexToBytes(input.replace(/^0x/, '')), gas: BigInt(gas?.gasLimit ?? 200_000) }, token.address);
      } else {
        h = await sendLyx(to, value);
        await noteSpent(value);
        if (gate.ok) await gate.commit();
      }
      await addPending({ hash: h, from: currentAddress(), to, amount: `${amount} ${token?.symbol ?? 'LYX'}`, what: token ? 'token' : 'send', at: Date.now() });
      await rememberRecent(to);
      if (save && name.trim()) await contacts.save((c) => [...c.filter((x) => x.address !== to), { name: name.trim(), address: to }]);
      success();
      if (!token) flyCoin('out', 'lyx', `${amount} LYX`);
      onSent(h, feeText);
      return true;
    } catch (e) {
      failure();
      setErr((e as Error).message);
      setBusy(false);
      return false;
    }
  };

  return (
    <Animated.View entering={SlideInRight.duration(DUR.base).easing(EASE_OUT)} style={{ flex: 1, paddingHorizontal: 20 }}>
      <KeyboardScroll contentContainerStyle={{ gap: 18, paddingTop: 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Digits text={amount} style={{ fontFamily: F.regular, fontSize: amount.length > 9 ? 46 : 62, letterSpacing: -2.4, lineHeight: amount.length > 9 ? 54 : 70 }} color={C.text} />
          <T style={{ fontFamily: F.regular, fontSize: 18, color: C.sub, marginTop: -4 }}>{token?.symbol ?? 'LYX'}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <Avatar address={to} size={26} name={known?.name} />
            <T v="callout" dim>{known?.name ?? nameFor(to) ?? shortAddr(to, 10, 6)}</T>
          </View>
        </View>
        <View style={{ borderRadius: 22, backgroundColor: C.fill, paddingHorizontal: 18 }}>
          {([
            ['Network fee', feeText],
            ['Arrives', 'In about a minute'],
          ] as const).map(([l, v], i) => (
            <View key={l} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 52, borderTopWidth: i ? 0.5 : 0, borderColor: C.line }}>
              <T v="sub" dim style={{ fontSize: 15 }}>{l}</T>
              <T v="callout">{v}</T>
            </View>
          ))}
          {!known && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 52, borderTopWidth: 0.5, borderColor: C.line }}>
              <T v="sub" dim style={{ fontSize: 15 }}>Save to people</T>
              <Switch on={save} onChange={setSave} label="Save to people" />
            </View>
          )}
        </View>
        {!known && save && (
          <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)}>
            <Field value={name} onChangeText={setName} placeholder="Their name" autoFocus />
          </Animated.View>
        )}
        {!paidBefore && !known && (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingHorizontal: 6 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#F0B35A', marginTop: 7 }} />
            <T v="sub" dim style={{ flex: 1, lineHeight: 20 }}>First time you pay this address. Check the first and last letters with them.</T>
          </View>
        )}
        <ErrorText title="Couldn't send" note="If you're not sure it went through, check Activity before trying again.">{err}</ErrorText>
        {busy && slow ? <T v="sub" color={C.wait} style={{ textAlign: 'center' }}>The LOKYX test network is slow to answer. Nothing has left your wallet yet. If this keeps going, go back and try again in a minute.</T> : null}
        <T v="caption" dim style={{ textAlign: 'center' }}>Payments can't be taken back.</T>
      </KeyboardScroll>
      <View style={{ marginTop: 8, alignItems: 'center', gap: 6, paddingBottom: 6 }}>
        {ask ? (
          <Press
            onPress={() => !busy && go()}
            disabled={busy || (!!token && (!gas || !gas.ok))}
            accessibilityLabel={bio ? `Send with ${bioName(bio)}` : 'Send with your passcode'}
            scaleTo={0.94}
            style={{ alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 30, opacity: busy ? 0.5 : 1 }}
          >
            <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: 'rgba(10,132,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={bio === 'face' ? 'face' : bio ? 'finger' : 'lock'} size={40} color={C.blue} width={1.8} />
            </View>
            <T style={{ fontFamily: F.semibold, fontSize: 16 }}>{busy ? 'Sending…' : bio === 'face' ? 'Look at your phone to send' : bio ? 'Touch the sensor to send' : 'Enter your passcode to send'}</T>
          </Press>
        ) : (
          <Button title={busy ? 'Sending…' : `Send ${amount} ${token?.symbol ?? 'LYX'}`} busy={busy} disabled={!!token && (!gas || !gas.ok)} onPress={() => go()} style={{ alignSelf: 'stretch' }} />
        )}
        {ask && bio && <T v="caption" dim>{bioName(bio)} not working? Your passcode works too.</T>}
      </View>
    </Animated.View>
  );
}

// ---------- sent ----------


function Sent({ amount, unit, to, hash, fee, at }: { amount: string; unit: string; to: string; hash: string; fee: string; at: number }) {
  // your ring folds into the coin and the coin crosses to their address; then it turns into a slip that settles once the block has it
  const me = useAccountRef();
  const tx = usePoll<TxInfo>('lyx_getTransaction', { hash }, 4000);
  const inBlock = tx.data?.status === 'confirmed';
  const lyx = (size: number) => <CoinLogo chain="lyx" size={size} />;
  const slipOn = useReveal(true);
  const slip = { amount, unit, to, toName: nameFor(to), from: currentAddress(), fromName: me?.name, network: 'LOKYX testnet', fee, at, hash, testnet: true };
  return (
    <View style={{ flex: 1, paddingHorizontal: 24 }}>
      <View style={{ flex: 1, justifyContent: slipOn ? 'center' : undefined }}>
        {slipOn ? (
          <Slip slip={slip} done={inBlock} caption={inBlock ? `In block ${tx.data?.blockHeight?.toLocaleString('en-US')}` : 'On its way · lands with the next block'} />
        ) : (
          <CoinLaunch
            stage={inBlock ? 'done' : 'waiting'}
            to={to}
            ring={me?.address ? (size) => <RingCode address={me.address} size={size} play={false} /> : null}
            toRing={(size) => <RingCode address={to} size={size} play={false} center={false} />}
            coin={lyx}
            headline={`${inBlock ? 'Delivered' : 'Sent'} ${amount} ${unit}`}
            caption={inBlock ? `To ${nameFor(to) ?? shortAddr(to)}, in block ${tx.data?.blockHeight?.toLocaleString('en-US')}.` : `On its way to ${nameFor(to) ?? shortAddr(to)}. It lands with the next block.`}
          />
        )}
      </View>
      <Animated.View entering={FadeIn.delay(700)} exiting={FadeOut} style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Button title="Share receipt" kind="line" onPress={() => shareSlip(slip, inBlock)} /></View>
          <View style={{ flex: 1 }}><Button title="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} /></View>
        </View>
        <Button title="See details" kind="plain" onPress={() => router.replace(`/tx/${hash}`)} />
      </Animated.View>
    </View>
  );
}
