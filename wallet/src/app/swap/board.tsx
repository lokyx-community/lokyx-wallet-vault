import { useEffect, useState } from 'react';
import { Platform, Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { T } from '../../ui/Text';
import { Field, Press, Screen, success, ErrorText } from '../../ui/controls';
import { Label, Panel, GRow, Primary, Secondary } from '../../ui/Glass';
import { Logo } from '../../ui/Logo';
import { Qr } from '../../ui/Qr';
import { toast } from '../../ui/Toast';
import { C, F } from '../../ui/theme';
import { Icon } from '../../ui/Icon';
import { confirmIt } from '../../lib/auth';
import { useAsync } from '../../lib/multichain';
import { formatLyx } from '../../lib/lokyx';
import { otherText, sw, updateSwapSettings, useSwapSettings } from '../../lib/swaps';
import { BOARD_DEFAULT, boardLink, checkBoard, makeBoard, openOffers, parseBoardLink, settleBoard } from '../../lib/board';
import { shortAddr } from '../../lib/format';

/** Offers people posted. The board only puts you in touch: the swap itself runs exactly as with a pasted code. */
export default function Board() {
  const q = useLocalSearchParams<{ join?: string }>();
  const cfg = useSwapSettings();
  const board = cfg.board || BOARD_DEFAULT;
  const list = useAsync(async () => (board ? openOffers(board) : []), [board], 15_000);
  const [typed, setTyped] = useState(q.join ?? '');
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState('');
  const [share, setShare] = useState(false);

  // a board being made: look for it every few seconds (it is also picked up when the app starts)
  useEffect(() => {
    if (!cfg.boardPending) return;
    const t = setInterval(async () => {
      const r = await settleBoard();
      if (r === 'ready') {
        success();
        toast('The board is ready', 'info');
        setShare(true);
      } else if (r === 'failed') toast("The board couldn't be made. Nothing was taken but the fee.", 'info');
    }, 5000);
    return () => clearInterval(t);
  }, [cfg.boardPending]);

  const join = async (raw: string) => {
    const a = parseBoardLink(raw) ?? raw.trim().toLowerCase();
    setErr('');
    setChecking(true);
    const ok = await checkBoard(a);
    setChecking(false);
    if (!ok) return setErr("That address isn't an offer board on this network.");
    await updateSwapSettings({ board: a });
    success();
    toast('Joined the board', 'info');
  };
  const pasteJoin = async () => {
    const v = (await Clipboard.getStringAsync()).trim();
    setTyped(v);
    join(v);
  };
  const copy = async () => {
    await Clipboard.setStringAsync(board);
    success();
    toast('Board address copied', 'copy');
  };
  const send = async () => {
    const msg = `Join the LOKYX offer board: in the wallet open Apps › Offer board and paste this\n${boardLink(board)}`;
    if (Platform.OS === 'web') {
      await Clipboard.setStringAsync(msg);
      toast('Copied, ready to paste');
    } else await Share.share({ message: msg });
  };

  if (!board)
    return (
      <Screen title="Offer board" large>
        <T v="callout" dim style={{ lineHeight: 22 }}>
          A board is where people post swap offers for others to take. One board is enough for everyone on the network: if someone already made one, join theirs, so you see the same offers.
        </T>
        <Label>Join a board</Label>
        <Field value={typed} onChangeText={(t) => { setTyped(t); setErr(''); }} placeholder="lokyx-board:lyx1… or lyx1…" autoCapitalize="none" autoCorrect={false} mono style={{ height: 60, borderRadius: 22, fontSize: 14 }} />
        <ErrorText>{err}</ErrorText>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Secondary title="Paste" onPress={pasteJoin} /></View>
          <View style={{ flex: 1 }}><Primary title={checking ? 'Checking…' : 'Join'} disabled={checking || !typed.trim()} onPress={() => join(typed)} /></View>
        </View>
        <Label>No board yet?</Label>
        {cfg.boardPending ? (
          <Panel>
            <GRow title="Your board is being made" sub="It is ready when its block is mined, usually within a minute or two. You can leave this screen." />
          </Panel>
        ) : (
          <Secondary
            title="Make the board for this network"
            onPress={async () => {
              if (!(await confirmIt('Make the offer board'))) return;
              try {
                await makeBoard();
              } catch (e) {
                toast((e as Error).message, 'info');
              }
            }}
          />
        )}
        <T v="caption" dim style={{ lineHeight: 18 }}>Making a board costs a small fee in LYX. Afterwards, share its code so other people join the same one.</T>
      </Screen>
    );

  const rows = list.data ?? [];
  return (
    <Screen title="Offer board" large>
      <T v="callout" dim style={{ lineHeight: 22 }}>Pick an offer to see exactly what it says before you accept. Your answer goes back to the maker on the board, so there are no codes to copy.</T>
      <Primary title="Post one of my offers" onPress={() => router.push('/swap')} />
      <Label>{list.data ? `${rows.length} open` : 'Loading…'}</Label>
      <View style={{ gap: 12 }}>
        {rows.length ? (
          rows.map((b) => {
            // offers are written from the maker's side
            const give = b.offer.dir === 'sell-lyx' ? otherText(b.offer) : `${formatLyx(b.offer.lyx, 6)} LYX`;
            const get = b.offer.dir === 'sell-lyx' ? `${formatLyx(b.offer.lyx, 6)} LYX` : otherText(b.offer);
            return (
              <Press key={b.id} onPress={() => router.push(`/swap/take?code=${encodeURIComponent(b.code)}&board=${b.id}`)} scaleTo={0.98} style={{ padding: 16, borderRadius: 26, backgroundColor: C.fill, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <T v="caption" dim>You give</T>
                    <T style={{ fontFamily: F.semibold, fontSize: 19 }}>{give}</T>
                  </View>
                  <Icon name="forward" size={18} color={C.sub} width={2} />
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <T v="caption" dim>You get</T>
                    <T style={{ fontFamily: F.semibold, fontSize: 19 }}>{get}</T>
                  </View>
                </View>
                <View style={{ height: 0.5, backgroundColor: C.line2 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <T v="caption" dim>{`from ${shortAddr(b.maker)}${b.answers ? ` · ${b.answers} answered` : ''}`}</T>
                  <Logo id={sw.assetOf(b.offer)} size={24} />
                </View>
              </Press>
            );
          })
        ) : (
          <T v="sub" dim style={{ paddingVertical: 18, textAlign: 'center', lineHeight: 20 }}>
            {list.error ? `Can't read the board: ${list.error}` : list.data ? 'No open offers right now. Post one, or share the board so others can.' : ''}
          </T>
        )}
      </View>

      <Label>This board</Label>
      <Panel>
        <GRow title="Share the board" sub="A code others scan or paste to join it" onPress={() => setShare((s) => !s)} />
        {share ? (
          <View style={{ alignItems: 'center', paddingVertical: 16, gap: 12 }}>
            <View style={{ padding: 12, backgroundColor: '#fff', borderRadius: 20 }}>
              <Qr value={boardLink(board)} size={200} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
              <View style={{ flex: 1 }}><Secondary title="Copy" onPress={copy} /></View>
              <View style={{ flex: 1 }}><Primary title="Send" onPress={send} /></View>
            </View>
          </View>
        ) : null}
        <GRow title="Use a different board" sub={shortAddr(board)} onPress={() => updateSwapSettings({ board: '' })} />
      </Panel>
    </Screen>
  );
}
