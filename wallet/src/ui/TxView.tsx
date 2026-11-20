import { useEffect, useState, type ReactNode } from 'react';
import { Share, TextInput, View } from 'react-native';
import { Icon } from './Icon';
import { Press, tick } from './controls';
import { DoneMark } from './DoneMark';
import { Qr } from './Qr';
import { T } from './Text';
import { C, F } from './theme';
import { shortAddr } from '../lib/format';
import { loadTxMeta, metaId, setTxNote, toggleTxTag, useAllTxMeta } from '../lib/txmeta';
import { TAGS } from '../lib/txmeta-core';

export interface TxStep { title: string; sub?: string; state: 'done' | 'now' | 'next' | 'failed' }
export interface TxViewProps {
  state: 'pending' | 'block' | 'settled' | 'failed';
  sign: string;
  amount: string;
  unit: string;
  /** "to Maya" or "to TLxs2g…JA9nX3" */
  line: string;
  /** kept for callers; the look no longer depends on the coin's card colour */
  kind?: string;
  /** the coin's mark, about 34 wide */
  mark: ReactNode;
  /** "Sent · Tron Nile" */
  label: string;
  /** the transaction id, shown (and copied) at the foot of the receipt */
  hash: string;
  steps: TxStep[];
  rows: [string, string, boolean?][];
  failMsg?: string;
  /** a link to the payment on a block explorer; when there is one the receipt carries a QR for it */
  qrUrl?: string;
  /** the whole receipt as text, with full addresses */
  shareText?: string;
  onCopy: () => void;
  onExplorer?: () => void;
  /** for money you sent: opens the send screen with the same person and amount filled in */
  onAgain?: () => void;
  /** what it was worth when first seen and now, in the chosen currency (already formatted); either may be missing */
  worth?: { then?: string; now?: string; pct?: number };
  extra?: ReactNode;
}

const glass = { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)' } as const;

/**
 * One payment on any chain, in plain words. A finished payment says "Done" with the LOKYX sign and nothing else: the
 * Sent / In a block / Settled steps are only shown while it is still on its way. Below: the details, a private note and tag,
 * and Send again for money you sent.
 */
export function TxView(p: TxViewProps) {
  useEffect(() => { loadTxMeta(); }, []);
  const id = metaId(p.hash);
  const meta = useAllTxMeta()[id];
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const shown = note ?? meta?.note ?? '';
  const live = p.state === 'pending' || p.state === 'block';
  const now = p.steps.find((x) => x.state === 'now' || x.state === 'failed');
  const share = () => {
    tick();
    Share.share({ message: p.shareText ?? `${p.sign}${p.amount} ${p.unit}\n${p.line}\nTransaction: ${p.hash}` }).catch(() => {});
  };
  return (
    <>
      <View style={{ alignItems: 'center', paddingTop: 10, gap: 6 }}>
        <View style={{ marginBottom: 6 }}>{p.mark}</View>
        <T v="sub" dim>{p.label}</T>
        <T style={{ fontFamily: F.regular, fontSize: 56, letterSpacing: -2.2, fontVariant: ['tabular-nums'], color: C.text }} numberOfLines={1} adjustsFontSizeToFit>
          {`${p.sign}${p.amount}`}
        </T>
        <T style={{ fontFamily: F.medium, fontSize: 15, color: C.sub, marginTop: -6 }}>{p.unit} · {p.line}</T>
        <View style={{ marginTop: 12, minHeight: 40 }}>
          {p.state === 'settled' ? (
            <DoneMark />
          ) : p.state === 'failed' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: 'rgba(255,92,92,0.12)' }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.bad }} />
              <T style={{ fontFamily: F.medium, fontSize: 14, color: C.bad }}>Didn't go through</T>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 16, borderRadius: 18, ...glass }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.wait }} />
              <T style={{ fontFamily: F.medium, fontSize: 14, color: C.soft }}>{p.state === 'pending' ? 'On its way' : 'Almost done'}</T>
            </View>
          )}
        </View>
        {p.failMsg ? <T v="sub" color={C.bad} style={{ textAlign: 'center', marginTop: 8 }}>{p.failMsg}</T> : null}
        {live ? (
          <View style={{ alignSelf: 'stretch', marginTop: 14, paddingHorizontal: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ position: 'absolute', left: '16%', right: '16%', top: 6, height: 2, backgroundColor: 'rgba(255,255,255,0.12)' }} />
              {p.steps.map((st) => (
                <View key={st.title} style={{ flex: 1, alignItems: 'center' }}>
                  <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: st.state === 'next' ? 'rgba(255,255,255,0.22)' : C.wait, backgroundColor: st.state === 'done' ? C.wait : C.bg }} />
                  <T style={{ fontFamily: F.medium, fontSize: 12.5, color: st.state === 'next' ? C.faint : C.soft, marginTop: 6, textAlign: 'center' }}>{st.title}</T>
                </View>
              ))}
            </View>
            {now?.sub ? <T v="caption" dim style={{ textAlign: 'center', marginTop: 8 }}>{now.sub}</T> : null}
          </View>
        ) : null}
      </View>

      {p.worth && (p.worth.then || p.worth.now) ? (
        <View style={{ borderRadius: 26, paddingHorizontal: 18, paddingVertical: 6, ...glass }}>
          {p.worth.then ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 46 }}>
              <T v="sub" dim style={{ fontSize: 14 }}>{p.sign === '−' ? 'When you sent it' : 'When it arrived'}</T>
              <T style={{ fontFamily: F.medium, fontSize: 15, fontVariant: ['tabular-nums'] }}>{p.worth.then}</T>
            </View>
          ) : null}
          {p.worth.now ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 46, borderTopWidth: p.worth.then ? 0.5 : 0, borderTopColor: 'rgba(255,255,255,0.08)' }}>
              <T v="sub" dim style={{ fontSize: 14 }}>Worth now</T>
              <T style={{ fontFamily: F.medium, fontSize: 15, fontVariant: ['tabular-nums'] }}>
                {p.worth.now}
                {p.worth.pct !== undefined ? <T style={{ fontFamily: F.medium, fontSize: 13, color: p.worth.pct >= 0 ? '#9BE5BD' : C.sub }}>{`  ${p.worth.pct >= 0 ? '+' : '−'}${Math.abs(p.worth.pct).toFixed(1)}%`}</T> : null}
              </T>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ borderRadius: 26, paddingHorizontal: 18, paddingVertical: 6, ...glass }}>
        {p.rows.map(([l, v, mono], i) => (
          <View key={l} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 46, gap: 16, borderTopWidth: i ? 0.5 : 0, borderTopColor: 'rgba(255,255,255,0.08)' }}>
            <T v="sub" dim style={{ fontSize: 14 }}>{l}</T>
            <T style={{ fontFamily: mono ? F.mono : F.medium, fontSize: mono ? 13 : 14, color: C.text, flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>{v}</T>
          </View>
        ))}
        <Press
          onPress={() => {
            p.onCopy();
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          accessibilityLabel="Copy the transaction id"
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 46, gap: 16, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.08)' }}
        >
          <T v="sub" dim style={{ fontSize: 14 }}>Transaction</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
            <T style={{ fontFamily: F.mono, fontSize: 13, color: C.text }} numberOfLines={1}>{copied ? 'Copied' : shortAddr(p.hash, 6, 4)}</T>
            <Icon name={copied ? 'check' : 'copy'} size={15} color={C.faint} />
          </View>
        </Press>
        {p.qrUrl ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.08)' }}>
            <View style={{ borderRadius: 10, overflow: 'hidden' }}><Qr value={p.qrUrl} size={56} /></View>
            <T v="caption" dim style={{ flex: 1, lineHeight: 18 }}>Scan to open this payment on the block explorer.</T>
          </View>
        ) : null}
      </View>

      <View style={{ borderRadius: 26, padding: 16, gap: 12, ...glass }}>
        <T v="caption" dim>Note · only you see it</T>
        <TextInput
          value={shown}
          onChangeText={setNote}
          onEndEditing={() => { if (note !== null) setTxNote(p.hash, note); }}
          onBlur={() => { if (note !== null) setTxNote(p.hash, note); }}
          placeholder="Add a note, like what it was for"
          placeholderTextColor={C.faint}
          selectionColor={C.text}
          keyboardAppearance="dark"
          maxLength={80}
          returnKeyType="done"
          style={{ height: 48, borderRadius: 16, paddingHorizontal: 14, fontFamily: F.regular, fontSize: 15, color: C.text, backgroundColor: 'rgba(255,255,255,0.06)' }}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TAGS.map((t) => {
            const on = meta?.tags?.includes(t);
            return (
              <Press key={t} onPress={() => toggleTxTag(p.hash, t)} accessibilityLabel={`Tag: ${t}`} style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, justifyContent: 'center', backgroundColor: on ? C.ink : 'rgba(255,255,255,0.08)' }}>
                <T style={{ fontFamily: F.medium, fontSize: 13, color: on ? C.inkText : C.soft }}>{t}</T>
              </Press>
            );
          })}
        </View>
      </View>

      {p.extra}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
        <Press onPress={share} style={{ width: p.onAgain ? 120 : undefined, flex: p.onAgain ? undefined : 1, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', ...glass }}>
          <T style={{ fontFamily: F.semibold, fontSize: 15.5 }}>Share</T>
        </Press>
        {p.onAgain ? (
          <Press onPress={p.onAgain} accessibilityLabel="Send again" style={{ flex: 1, height: 54, borderRadius: 27, backgroundColor: C.ink, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="send" size={17} color={C.inkText} width={2.2} />
            <T style={{ fontFamily: F.semibold, fontSize: 16, color: C.inkText }}>Send again</T>
          </Press>
        ) : null}
      </View>
      {p.onExplorer ? (
        <Press onPress={p.onExplorer} style={{ alignItems: 'center', padding: 8 }}>
          <T v="callout" dim>Open in explorer</T>
        </Press>
      ) : null}
    </>
  );
}
