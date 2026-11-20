import { Tutorial, HowItWorks } from '../../ui/Tutorial';
import { useTutorial } from '../../lib/tutorial';
import { IntroHero, Feature, Features } from '../../ui/Feature';
import { View } from 'react-native';
import { router } from 'expo-router';
import { T } from '../../ui/Text';
import { Button, Group, Note, Row, Screen } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { C } from '../../ui/theme';
import { ConfirmOp } from '../../ui/ConfirmOp';
import { currentAddress } from '../../lib/wallet';
import { usePoll, type Account, type ChainInfo, type PendingInfo } from '../../lib/rpc';
import { hexToBytes, formatLyx } from '../../lib/lokyx';
import { inTime, pendingLine, KEY_THEFT_NOTICE } from '../../lib/vault-core';
import { labelFor } from '../../lib/format';
import { niceLyx } from '../../lib/format';
import { useState } from 'react';

function Pending({ p, height, blockTime, me, delay, onDone }: { p: PendingInfo; height: number; blockTime: number; me: string; delay: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const line = pendingLine(p, height, { blockTime, me, label: labelFor });
  return (
    <View style={{ gap: 10, padding: 14, borderRadius: 18, backgroundColor: C.fill }}>
      <T v="callout">{line}</T>
      {open ? (
        <ConfirmOp op={{ kind: 'vaultCancel', id: hexToBytes(p.id.replace(/^0x/, '')) }} me={me} blockTime={blockTime} delayBlocks={delay} label="Slide to cancel" onDone={onDone} />
      ) : (
        <Button title="Cancel this" kind="line" onPress={() => setOpen(true)} />
      )}
    </View>
  );
}

export default function VaultScreen() {
  const tut = useTutorial('vault');
  const me = currentAddress();
  const acct = usePoll<Account>('lyx_getAccount', { address: me }, 6000);
  const info = usePoll<ChainInfo>('lyx_chainInfo', {}, 6000);
  const a = acct.data;
  const bt = info.data?.targetBlockTime ?? 60;
  const height = info.data?.height ?? 0;
  const v = a?.vault;
  const [action, setAction] = useState<'' | 'withdraw' | 'close' | 'claim'>('');

  if (!a || !info.data) return <Screen title="Vault" large><Note>Loading…</Note></Screen>;

  if (!v) {
    return (
      <Screen title="Vault" large>
        <Tutorial id="vault" open={tut.open} onClose={tut.close} />
        <IntroHero icon="shield" text="A normal account with a speed limit. Only a daily allowance can leave right away. Anything bigger waits, in the open, where you can stop it." />
        <Features>
          <Feature icon="coin" title="A daily allowance" text="Everyday spending works as normal, up to a limit you choose." />
          <Feature icon="clock" title="Bigger amounts wait" text="You see them coming and can cancel." />
          <Feature icon="key" title="A recovery key on paper" text="12 words that cancel a withdrawal or move everything to safety." />
        </Features>
        <T v="caption" dim style={{ lineHeight: 18, textAlign: 'center' }}>If someone steals your phone or your words, they get at most one day's allowance. {KEY_THEFT_NOTICE}</T>
        <Button title="Set up a vault" onPress={() => router.push('/vault/setup')} />
        <Button title="Use a recovery key" kind="line" onPress={() => router.push('/vault/recover')} />
        {a.heirOf && a.heirOf.length > 0 ? <HeirClaims vaults={a.heirOf} me={me} bt={bt} /> : null}
        <HowItWorks onPress={tut.replay} />
      </Screen>
    );
  }

  const s = v.settings;
  const refresh = () => { acct.refresh(); setAction(''); };
  const dayLeft = inTime(v.dayResetsAt - height, bt);
  return (
    <Screen title="Vault" large>
      <Tutorial id="vault" open={tut.open} onClose={tut.close} />
      <View style={{ borderRadius: 24, backgroundColor: C.fill, padding: 20, gap: 6 }}>
        <T v="sub" dim>Left to spend today</T>
        <T v="display">{niceLyx(formatLyx(BigInt(v.allowanceLeft)))} LYX</T>
        <T v="sub" dim>of {niceLyx(s.allowanceLyx)} LYX a day · resets in {dayLeft}</T>
      </View>
      <Note>Bigger withdrawals wait {inTime(s.delayBlocks, bt)}. Safe address: {labelFor(s.safe)}.</Note>

      {v.pending.length > 0 && (
        <View style={{ gap: 10 }}>
          <T v="headline">Waiting to leave</T>
          {v.pending.map((p) => (
            <Pending key={p.id} p={p} height={height} blockTime={bt} me={me} delay={s.delayBlocks} onDone={refresh} />
          ))}
        </View>
      )}
      {a.pendingRotation ? <RotationNotice a={a} height={height} bt={bt} /> : null}

      {action === 'withdraw' ? <Withdraw me={me} bt={bt} delay={s.delayBlocks} done={refresh} /> : null}
      {action === 'close' ? <ConfirmOp op={{ kind: 'vaultClose' }} me={me} blockTime={bt} delayBlocks={s.delayBlocks} label="Slide to close" onDone={refresh} /> : null}

      {!action && (
        <Group>
          <Row icon="send" title="Start a large withdrawal" sub={`Arrives after ${inTime(s.delayBlocks, bt)}`} onPress={() => setAction('withdraw')} />
          <Row icon="key" title="Rotate this account's key" onPress={() => router.push('/rotate')} />
          <Row icon="shield" title="Sweep or cancel with my recovery key" onPress={() => router.push('/vault/recover')} />
          <Row icon="lock" title="Close the vault" sub="Waits, like a withdrawal" onPress={() => setAction('close')} />
        </Group>
      )}
      <Note>{KEY_THEFT_NOTICE}</Note>
      {a.heirOf && a.heirOf.length > 0 ? <HeirClaims vaults={a.heirOf} me={me} bt={bt} /> : null}
      <HowItWorks onPress={tut.replay} />
    </Screen>
  );
}

function RotationNotice({ a, height, bt }: { a: Account; height: number; bt: number }) {
  const r = a.pendingRotation!;
  return (
    <View style={{ gap: 10, padding: 14, borderRadius: 18, backgroundColor: C.fill }}>
      <T v="callout">A key rotation is waiting</T>
      <T v="sub" dim>{labelFor(r.newKey)} takes over this account in {inTime(r.releaseHeight - height, bt)}. If you didn't start this, cancel it now.</T>
      <Button title="Open key rotation" kind="line" onPress={() => router.push('/rotate')} />
    </View>
  );
}

import { Field, ErrorText } from '../../ui/controls';
import { parseLyx, isAddress } from '../../lib/lokyx';

function Withdraw({ me, bt, delay, done }: { me: string; bt: number; delay: number; done: () => void }) {
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('');
  const [ready, setReady] = useState(false);
  let amount = 0n;
  let err = '';
  try { if (amt) amount = parseLyx(amt); } catch (e) { err = (e as Error).message; }
  const ok = isAddress(to.trim()) && amount > 0n && !err;
  return (
    <View style={{ gap: 12 }}>
      <Field value={to} onChangeText={(t) => { setTo(t); setReady(false); }} placeholder="lyx1… where to" autoCapitalize="none" autoCorrect={false} mono />
      <Field value={amt} onChangeText={(t) => { setAmt(t); setReady(false); }} placeholder="Amount in LYX" keyboardType="decimal-pad" />
      <ErrorText>{err}</ErrorText>
      {ready && ok ? (
        <ConfirmOp op={{ kind: 'vaultWithdraw', to: to.trim().toLowerCase(), amount }} me={me} blockTime={bt} delayBlocks={delay} label="Slide to start" onDone={done} />
      ) : (
        <Button title="Review" disabled={!ok} onPress={() => setReady(true)} />
      )}
    </View>
  );
}

function HeirClaims({ vaults, me, bt }: { vaults: string[]; me: string; bt: number }) {
  const [pick, setPick] = useState('');
  return (
    <View style={{ gap: 10 }}>
      <T v="headline">You are an heir</T>
      <Note>You can claim these vaults after their owner has been inactive for the agreed time. The owner can cancel during the wait.</Note>
      {vaults.map((v) => (
        <View key={v} style={{ gap: 8 }}>
          <Row title={labelFor(v)} onPress={() => setPick(pick === v ? '' : v)} />
          {pick === v ? <ConfirmOp op={{ kind: 'vaultHeirClaim', vault: v }} me={me} blockTime={bt} label="Slide to claim" /> : null}
        </View>
      ))}
    </View>
  );
}
