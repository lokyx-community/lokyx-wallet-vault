import { useCallback, useEffect, useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Animated, { FadeIn } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Icon } from '../../ui/Icon';
import { Button, ErrorText, Field, Group, Note, Press, Row, Screen, success } from '../../ui/controls';
import { CoinLogo } from '../../ui/CoinLogo';
import { C, F } from '../../ui/theme';
import { DUR } from '../../ui/motion';
import { toast } from '../../ui/Toast';
import { confirmIt } from '../../lib/auth';
import { answersFor, boardAddress, closePost, isPosted, postOffer } from '../../lib/board';
import { useAsync } from '../../lib/multichain';
import { useBoardPosts } from '../../lib/data';
import { shortAddr } from '../../lib/format';
import {
  claimLyx, claimOther, fundOther, lockLyx, lyxText, otherText, readLive, refundLyx, refundOther, removeSwap, swapId, swapTitle, sw, takeAccept, useSwaps,
} from '../../lib/swaps';

const stageOf = (step: sw.Step, r: sw.SwapRecord): number => {
  const lyxFirst = r.offer.dir === 'sell-lyx';
  switch (step.kind) {
    case 'wait-accept':
    case 'share-accept':
      return 0;
    case 'lock-lyx':
    case 'wait-lyx-lock':
      return lyxFirst ? 1 : 2;
    case 'fund-other':
    case 'wait-other-fund':
      return lyxFirst ? 2 : 1;
    case 'claim-other':
    case 'claim-lyx':
    case 'wait-claim':
    case 'confirming':
      return 3;
    case 'done':
    case 'refunded':
      return 4;
    default:
      return -1;
  }
};

function copyText(t: string, what: string) {
  return async () => {
    await Clipboard.setStringAsync(t);
    success();
    toastLike(what);
  };
}
const toastLike = (what: string) => toast(`${what} copied`, 'copy');

/** One swap: where it stands, the one thing to do next, and the codes to send the other person. */
export default function SwapView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const list = useSwaps();
  const r = list.find((x) => swapId(x) === decodeURIComponent(id ?? ''));
  const [live, setLive] = useState<sw.Live | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [acceptCode, setAcceptCode] = useState('');

  const refresh = useCallback(async () => {
    if (!r) return;
    try {
      const out = await readLive(r);
      setLive(out.live);
      setLoadErr('');
    } catch (e) {
      setLoadErr((e as Error).message);
    }
  }, [r]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [refresh]);

  const step = useMemo(() => (r && live ? sw.nextStep(r, live) : null), [r, live]);

  if (!r) {
    return (
      <Screen title="Swap" large>
        <Note>This swap isn't on this phone any more.</Note>
        <Button title="Back to swaps" onPress={() => router.replace('/swap')} />
      </Screen>
    );
  }

  const asset = sw.assetOf(r.offer);
  const sym = asset === 'btc' ? 'BTC' : 'ETH';
  const stage = step ? stageOf(step, r) : 0;
  const lyxFirst = r.offer.dir === 'sell-lyx';
  const iLockLyx = sw.locksLyx(r);
  const offerCode = sw.offerCode(r.offer);
  const accCode = r.accept ? sw.acceptCode(r.accept) : '';

  const act = (reason: string, f: () => Promise<void>) => async () => {
    setErr('');
    if (!(await confirmIt(reason, { keyFollows: true }))) return;
    setBusy(true);
    try {
      await f();
      success();
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stages = [
    'Codes swapped',
    lyxFirst ? `${iLockLyx ? 'You lock' : 'They lock'} ${lyxText(r.offer)}` : `${iLockLyx ? 'They lock' : 'You lock'} ${otherText(r.offer)}`,
    lyxFirst ? `${iLockLyx ? 'They lock' : 'You lock'} ${otherText(r.offer)}` : `${iLockLyx ? 'You lock' : 'They lock'} ${lyxText(r.offer)}`,
    'Both claim',
    'Done',
  ];

  const say = (s: sw.Step): string => {
    switch (s.kind) {
      case 'wait-accept': return 'Send your offer code to the other person, then paste their acceptance code below.';
      case 'share-accept': return 'Send your acceptance code back to them.';
      case 'lock-lyx': return `Lock ${lyxText(r.offer)} for the other person. You get it back if they don't follow through.`;
      case 'wait-lyx-lock': return s.mine ? 'Your LYX lock is waiting for a block.' : 'Waiting for them to lock their LYX (3 blocks).';
      case 'fund-other': return `Now lock ${otherText(r.offer)}. It's checked first: the LYX lock matches the deal.`;
      case 'wait-other-fund': return iLockLyx ? `Waiting for their ${sym} to arrive and confirm.` : `Your ${sym} is confirming.`;
      case 'claim-other': return `Their ${sym} is locked for you. Claim it.`;
      case 'claim-lyx': return 'The LYX is ready for you. Claim it.';
      case 'wait-claim': return 'Waiting for the other person to claim. Your side is safe.';
      case 'wait-refund': return 'Waiting for the refund time to pass.';
      case 'refund-lyx': return 'Time ran out. Take your LYX back.';
      case 'refund-other': return `Time ran out. Take your ${sym} back.`;
      case 'confirming': return 'Claimed. Waiting for a confirmation.';
      case 'done': return `Done. You got ${s.got === 'lyx' ? lyxText(r.offer) : otherText(r.offer)}.`;
      case 'refunded': return 'Refunded. Your coins are back.';
      case 'unsafe': return s.reason;
    }
  };

  return (
    <Screen title="Swap" large>
      <View style={{ alignItems: 'center', gap: 10, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <CoinLogo chain="lyx" size={40} />
          <Icon name="swap" size={20} color={C.sub} width={2} />
          <CoinLogo chain={asset} size={40} />
        </View>
        <T style={{ fontFamily: F.semibold, fontSize: 21, letterSpacing: -0.4, textAlign: 'center' }}>{swapTitle(r)}</T>
      </View>

      <View style={{ borderRadius: 16, backgroundColor: C.fill2, padding: 16 }}>
        {stages.map((t, i) => {
          const done = i < stage || stage === 4;
          const now = i === stage && stage !== 4;
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ alignItems: 'center', width: 22 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: done ? C.good : now ? C.blue : 'transparent', borderWidth: done || now ? 0 : 1.5, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' }}>
                  {done ? <Icon name="check" size={12} color="#000" width={3.2} /> : null}
                </View>
                {i < stages.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: 14, backgroundColor: done ? 'rgba(61,214,140,0.5)' : C.line2 }} /> : null}
              </View>
              <T v="callout" color={done || now ? C.text : C.sub} style={{ paddingBottom: 12, flex: 1 }}>{t}</T>
            </View>
          );
        })}
      </View>

      {step ? (
        <Animated.View key={step.kind} entering={FadeIn.duration(DUR.base)} style={{ gap: 12 }}>
          <T v="callout" color={step.kind === 'unsafe' ? C.bad : C.text} style={{ lineHeight: 22 }}>{say(step)}</T>
          {step.kind === 'lock-lyx' && <Button title={`Lock ${lyxText(r.offer)}`} busy={busy} onPress={act('Lock LYX for this swap', () => lockLyx(r, step.refundHeight))} />}
          {step.kind === 'fund-other' && (
            <>
              <Button title={`Lock ${otherText(r.offer)} from this phone`} busy={busy} onPress={act(`Lock ${sym} for this swap`, () => fundOther(r, live!))} />
              {asset === 'btc' && live?.btcAddress ? (
                <Press onPress={copyText(live.btcAddress, 'Contract address')}>
                  <T v="caption" dim style={{ textAlign: 'center' }}>Or pay exactly {otherText(r.offer)} from another wallet to {shortAddr(live.btcAddress, 10, 8)} (tap to copy)</T>
                </Press>
              ) : null}
            </>
          )}
          {step.kind === 'claim-other' && <Button title={`Claim ${otherText(r.offer)}`} busy={busy} onPress={act(`Claim ${sym}`, () => claimOther(r, live!))} />}
          {step.kind === 'claim-lyx' && <Button title={`Claim ${lyxText(r.offer)}`} busy={busy} onPress={act('Claim LYX', () => claimLyx(r, live!, step.lockId))} />}
          {step.kind === 'refund-lyx' && <Button title="Take my LYX back" busy={busy} onPress={act('Take LYX back', () => refundLyx(r, step.lockId))} />}
          {step.kind === 'refund-other' && <Button title={`Take my ${sym} back`} busy={busy} onPress={act(`Take ${sym} back`, () => refundOther(r, live!))} />}
        </Animated.View>
      ) : (
        <T v="sub" dim>{loadErr || 'Reading the chains…'}</T>
      )}
      <ErrorText>{err}</ErrorText>

      {r.role === 'initiator' && !r.accept && <BoardBox r={r} onPicked={() => void refresh()} />}
      {r.role === 'initiator' && !r.accept && (
        <Group title="Your offer code">
          <Row title="Copy offer code" onPress={copyText(offerCode, 'Offer code')} />
          <Row title="Share offer code" onPress={() => Share.share({ message: offerCode })} />
        </Group>
      )}
      {r.role === 'initiator' && !r.accept && (
        <View style={{ gap: 10 }}>
          <Field value={acceptCode} onChangeText={setAcceptCode} placeholder="Paste their acceptance code" autoCapitalize="none" autoCorrect={false} mono />
          <Button
            title="Use acceptance code"
            kind="line"
            disabled={!acceptCode.trim()}
            onPress={async () => {
              setErr('');
              try {
                await takeAccept(r, acceptCode);
                setAcceptCode('');
                success();
                void refresh();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          />
        </View>
      )}
      {r.role === 'responder' && accCode ? (
        <Group title="Your acceptance code">
          <Row title="Copy acceptance code" onPress={copyText(accCode, 'Acceptance code')} />
          <Row title="Share acceptance code" onPress={() => Share.share({ message: accCode })} />
        </Group>
      ) : null}

      {(step?.kind === 'done' || step?.kind === 'refunded' || !r.accept) && (
        <Button
          title={r.accept ? 'Remove from this list' : 'Cancel this offer'}
          kind="plain"
          onPress={async () => {
            await removeSwap(r);
            router.replace('/swap');
          }}
        />
      )}
    </Screen>
  );
}

/** The maker's side of the board: post this offer, then pick up an answer when one comes. */
function BoardBox({ r, onPicked }: { r: sw.SwapRecord; onPicked: () => void }) {
  useBoardPosts();
  const posted = isPosted(r);
  const answers = useAsync(async () => (posted ? answersFor(r) : []), [posted], 10_000);
  const [busy, setBusy] = useState(false);
  if (!boardAddress()) return null;
  if (!posted)
    return (
      <Button
        title="Post it on the offer board"
        kind="line"
        busy={busy}
        onPress={async () => {
          if (!(await confirmIt('Post this offer on the board'))) return;
          setBusy(true);
          try {
            await postOffer(r);
            toast('Posted. Answers show up here.', 'info');
          } catch (e) {
            toast((e as Error).message, 'info');
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  const list = answers.data ?? [];
  return (
    <Group title="Answers from the offer board">
      {list.length === 0 ? (
        <Row title="Waiting for someone to answer" sub="This checks the board every few seconds" />
      ) : (
        list.map((a, i) => (
          <Row
            key={i}
            title={`From ${shortAddr(a.taker)}`}
            sub="Tap to use this answer and go ahead with them"
            onPress={async () => {
              try {
                await takeAccept(r, a.code);
                success();
                closePost(r).catch(() => {});
                onPicked();
              } catch (e) {
                toast((e as Error).message, 'info');
              }
            }}
          />
        ))
      )}
    </Group>
  );
}
