import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { T } from '../ui/Text';
import { Button, ErrorText, Field, Group, Note, Row, Screen, success } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { C, F } from '../ui/theme';
import { addNode, forgetPin, refusals, removeNode, rpc, setNodeUrl, useNodes, useNodeUrl, type ChainInfo } from '../lib/rpc';
import { useStore } from '../lib/store';
import { syncState, type Sync } from '../lib/nodes-core';

type Status = { info?: ChainInfo & { bestTimestamp: number }; down?: boolean };

const WORDS: Record<Sync, string> = { synced: 'In sync', behind: 'Behind', stale: 'Not producing blocks' };

export default function Node() {
  const active = useNodeUrl();
  const list = useNodes();
  const refused = useStore(refusals);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const look = useCallback(async () => {
    const out: Record<string, Status> = {};
    await Promise.all(list.map(async (n) => {
      try {
        out[n.url] = { info: await rpc<ChainInfo & { bestTimestamp: number }>('lyx_chainInfo', {}, n.url) };
      } catch {
        out[n.url] = { down: true };
      }
    }));
    setStatus(out);
  }, [list]);
  useEffect(() => {
    look();
    const t = setInterval(look, 10_000);
    return () => clearInterval(t);
  }, [look]);

  const best = Math.max(0, ...Object.values(status).map((s) => s.info?.height ?? 0));
  const add = async () => {
    setErr('');
    setBusy(true);
    try {
      await addNode(text);
      success();
      setText('');
      look();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const up = list.filter((n) => status[n.url]?.info).length;
  const here = status[active]?.info;
  return (
    <Screen title="Network" large>
      <View style={{ alignItems: 'center', gap: 6, paddingVertical: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: here ? 'rgba(155,229,189,0.12)' : 'rgba(255,255,255,0.07)' }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: here ? C.good : C.wait }} />
          <T style={{ fontFamily: F.semibold, fontSize: 14.5, color: here ? C.good : C.sub }}>{here ? 'Connected' : up === 0 && Object.keys(status).length ? 'Not connected' : 'Checking…'}</T>
        </View>
        {here ? <T style={{ fontFamily: F.regular, fontSize: 44, letterSpacing: -1.6, lineHeight: 52 }}>{here.height.toLocaleString('en-US')}</T> : null}
        {here ? <T v="sub" dim>{`latest block · ${here.peers} peers`}</T> : null}
      </View>
      <T v="callout" dim style={{ lineHeight: 22 }}>The wallet uses the first node that answers and is on the right network. If one stops, it moves to the next on its own. Every node is checked before the wallet believes it.</T>
      <Group title="Nodes">
        {list.map((n) => {
          const s = status[n.url];
          const sy = s?.info ? syncState({ height: s.info.height, bestTimestamp: s.info.bestTimestamp }, best, s.info.targetBlockTime, Date.now() / 1000) : undefined;
          const why = refused[n.url];
          const sub = why ? why : s?.down ? 'Not reachable' : s?.info ? `${WORDS[sy!]} · block ${s.info.height.toLocaleString('en-US')} · ${s.info.peers} peers` : 'Checking…';
          return (
            <Row
              key={n.url}
              title={n.label}
              sub={sub}
              onPress={() => setNodeUrl(n.url)}
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: why || s?.down ? C.bad : sy === 'synced' ? C.good : C.wait }} />
                  {active === n.url ? <Icon name="check" size={18} color={C.text} width={2.4} /> : null}
                </View>
              }
            />
          );
        })}
      </Group>
      {list.filter((n) => !n.builtin).map((n) => (
        <Button key={n.url} title={`Remove ${n.label}`} kind="plain" onPress={() => removeNode(n.url)} />
      ))}
      <T v="caption" dim style={{ lineHeight: 18 }}>{`In use: ${active.replace(/^https?:\/\//, '')}. Running your own node? Add it, like http://192.168.1.20:28701. The wallet only reads from it and sends signed payments. Your keys stay on the phone.`}</T>
      <Field value={text} onChangeText={setText} placeholder="http://…:28701" autoCapitalize="none" autoCorrect={false} keyboardType="url" style={{ height: 56, borderRadius: 20 }} />
      <ErrorText>{err}</ErrorText>
      <Button title="Add my node" busy={busy} disabled={!/^https?:\/\/.+/.test(text.trim())} onPress={add} />
      <Button title="The network was reset" kind="plain" onPress={async () => { await forgetPin(); look(); }} />
      <T v="caption" dim style={{ lineHeight: 18 }}>Only use that last button after an announced network reset. It lets the wallet learn the new first block.</T>
    </Screen>
  );
}
