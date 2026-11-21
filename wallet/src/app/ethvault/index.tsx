import { Tutorial, HowItWorks } from '../../ui/Tutorial';
import { useTutorial } from '../../lib/tutorial';
import { useEffect, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { toast } from "../../ui/Toast";
import { plainError } from '../../lib/plain-error';
import { T } from "../../ui/Text";
import { C, F } from "../../ui/theme";
import { VaultRing } from "../../ui/VaultRing";
import { ActionRow } from "../../ui/ActionRow";
import type { CardKind } from "../../ui/WalletCards";
import { Icon } from "../../ui/Icon";
import { Sheet } from "../../ui/Sheet";
import { VaultEditSheet } from "../../ui/VaultEditSheet";
import { CoinMark } from "../../ui/CoinMark";
import { LeadRow } from "../../ui/LeadRow";
import type { LogoId } from "../../ui/logos";
import { Button, ErrorText, Group, Note, Press, Row, Screen } from "../../ui/controls";
import { LogoChips, VAULT_MARK } from "../../ui/LogoChips";
import { IntroHero, Feature, Features } from "../../ui/Feature";
import { SlideToPay } from "../../ui/SlideToPay";
import { confirmIt } from "../../lib/auth";
import { useStore } from "../../lib/store";
import { useAsync } from "../../lib/multichain";
import {
  NETS,
  checkEthVaults,
  executeReady,
  loadVaults,
  partsStatus,
  phoneCancel,
  snapshot,
  tokensOn,
  vaults,
  type Snapshot,
} from "../../lib/ethvault";
import {
  VAULT_NETS,
  describeCall,
  ETH,
  NATIVE,
  itemState,
  type VaultNet,
} from "../../lib/ethvault-core";
import { shortAddr } from "../../lib/format";

const eth = (w: bigint, d = 18, f = 6) => {
  const s = w.toString().padStart(d + 1, "0");
  const fr = s
    .slice(s.length - d)
    .slice(0, f)
    .replace(/0+$/, "");
  return fr ? `${s.slice(0, s.length - d)}.${fr}` : s.slice(0, s.length - d);
};
const waitText = (s: number) =>
  s >= 172800
    ? `${Math.round(s / 86400)} days`
    : `${Math.round(s / 3600)} hours`;
const CARD: Record<VaultNet, { kind: CardKind; logo: LogoId; name: string }> = {
  "base-sepolia": { kind: "base", logo: "base", name: "Base" },
  "arbitrum-sepolia": { kind: "arb", logo: "arb", name: "Arbitrum" },
  sepolia: { kind: "eth", logo: "eth", name: "Ethereum" },
  "op-sepolia": { kind: "op", logo: "op", name: "Optimism" },
  "bnb-testnet": { kind: "bnb", logo: "bnb", name: "BNB Chain" },
};
const left = (t: number) => {
  const s = Math.max(0, t - Math.floor(Date.now() / 1000));
  return s >= 7200
    ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
    : `${Math.max(1, Math.ceil(s / 60))} min`;
};

/** The Ethereum vault, one network at a time: the same vault address has separate settings on each network. */
export default function EthVault() {
  const tut = useTutorial('vault');
  const p = useLocalSearchParams<{ net?: VaultNet }>();
  const [net, setNet] = useState<VaultNet>(
    p.net && NETS.includes(p.net) ? p.net : NETS[0],
  );
  const all = useStore(vaults);
  useEffect(() => {
    loadVaults();
  }, []);
  const v = all[net];
  const snap = useAsync<Snapshot | null>(
    async () => (v ? snapshot(v) : null),
    [net, v?.state],
    20_000,
  );
  const parts = useAsync<{ ready: boolean; missing: string[] } | null>(async () => (v ? null : partsStatus(net)), [net, !!v]);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [hist, setHist] = useState(false);
  const [cancelAll, setCancelAll] = useState(false);
  const s = snap.data;
  const copy = async (text: string, what: string) => {
    await Clipboard.setStringAsync(text);
    toast(`${what} copied`, "copy");
  };
  const done = () => {
    checkEthVaults().catch(() => {});
    snap.refresh();
  };

  return (
    <Screen title="Ethereum vault" large>
      <Tutorial id="vault" open={tut.open} onClose={tut.close} />
      <LogoChips<VaultNet> value={net} onChange={setNet} items={NETS.map((n) => ({ key: n, label: VAULT_MARK[n].name, logo: VAULT_MARK[n].logo }))} />
      {!v ? (
        <>
          <IntroHero icon="shield" text={`A vault keeps your coins safe even if your phone is lost or stolen. On ${VAULT_NETS[net].label} it works like this.`} />
          <Features>
            <Feature icon="coin" title="Small amounts leave at once" text="A daily allowance moves straight away. Anything bigger waits, can only go to your safe address, and you can cancel it while it waits." />
            <Feature icon="key" title="12 words are your way back" text="Written once, on paper. They can cancel a withdrawal or move everything to a safe address." />
            <Feature icon="lock" title="Your phone can't be forced" text="Even someone who gets into your phone is held to the same limit and wait, and the rules cannot be changed afterwards." />
          </Features>
          <T v="caption" dim style={{ textAlign: "center", lineHeight: 18 }}>Test networks only. This vault has not been used with real money.</T>
          {parts.data && !parts.data.ready ? (
            <Note>{`First-time setup needed. The audited vault parts are not on ${VAULT_NETS[net].label} yet. They are placed once from their official build and checked byte for byte, then reused by everyone. Until that is done here, a vault can't be made on this network.`}</Note>
          ) : null}
          <Button
            title={`Set up a vault on ${VAULT_NETS[net].label}`}
            disabled={!!parts.data && !parts.data.ready}
            onPress={() => router.push(`/ethvault/setup?net=${net}`)}
          />
        </>
      ) : (
        <>
          {s &&
            s.issues
              .filter((i) => i.level === "danger")
              .map((i) => <Note key={i.text}>{`Warning: ${i.text}`}</Note>)}
          {s &&
            s.issues
              .filter(
                (i) =>
                  i.level === "warn" && !/item\(s\) are waiting/.test(i.text),
              )
              .map((i) => <Note key={i.text}>{i.text}</Note>)}
          {(() => {
            const nowS = Math.floor(Date.now() / 1000);
            const a = v.allowances.find((x) => x.token.toLowerCase() === ETH.toLowerCase());
            const total = a ? BigInt(a.amount) : 0n;
            const l = a && s ? s.today.find((t) => t.token.toLowerCase() === ETH.toLowerCase())?.left ?? total : total;
            const used = total > 0n ? Math.max(0, Math.min(1, 1 - Number(l) / Number(total))) : 0;
            const waitingN = s ? s.items.filter((i) => itemState(i, nowS, s.live.delay.txNonce) === 'waiting').length : 0;
            const danger = !!s?.issues.some((i) => i.level === 'danger');
            return (
              <>
                <View style={{ borderRadius: 30, padding: 20, gap: 12, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
                  <View style={{ position: 'absolute', right: -34, top: -34, opacity: 0.1 }}><VaultRing size={170} stroke={14} frac={1 - used} color={C.text} /></View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <CoinMark symbol={NATIVE[net]} seed={net} logo={VAULT_MARK[net].logo} size={30} />
                    <T style={{ fontFamily: F.semibold, fontSize: 15 }}>{`${CARD[net].name} vault`}</T>
                    <View style={{ marginLeft: 'auto', height: 26, paddingHorizontal: 11, borderRadius: 13, justifyContent: 'center', backgroundColor: danger ? 'rgba(255,92,92,0.14)' : 'rgba(255,255,255,0.09)' }}>
                      <T style={{ fontFamily: F.medium, fontSize: 12.5, color: danger ? C.bad : C.soft }}>{!s ? 'Checking…' : danger ? 'Needs a look' : 'Protected'}</T>
                    </View>
                  </View>
                  {a ? (
                    <>
                      <T v="sub" dim>Left to spend today</T>
                      <T style={{ fontFamily: F.regular, fontSize: 40, letterSpacing: -1.4, fontVariant: ['tabular-nums'], marginTop: -6 }} numberOfLines={1} adjustsFontSizeToFit>{`${eth(l, a.decimals, 4)} ${NATIVE[net]}`}</T>
                      <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)' }}>
                        <View style={{ height: 4, borderRadius: 2, backgroundColor: C.text, opacity: 0.85, width: `${Math.round(used * 100)}%` }} />
                      </View>
                      <T v="caption" dim>{`of ${eth(total, a.decimals, 4)} ${NATIVE[net]} a day · ${s ? `${eth(s.eth, 18, 4)} ${NATIVE[net]} in the vault` : ''}`}</T>
                    </>
                  ) : (
                    <>
                      <T v="sub" dim>In the vault</T>
                      <T style={{ fontFamily: F.regular, fontSize: 40, letterSpacing: -1.4, fontVariant: ['tabular-nums'], marginTop: -6 }} numberOfLines={1} adjustsFontSizeToFit>{s ? `${eth(s.eth, 18, 4)} ${NATIVE[net]}` : ''}</T>
                      <T v="caption" dim>No daily limit on this coin: every send waits.</T>
                    </>
                  )}
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {([
                    ['pen', 'Edit limit', () => (v.gated ? router.push(`/ethvault/settings?net=${net}`) : setEditing(true)), false],
                    ['close', waitingN ? `Cancel ${waitingN}` : 'Cancel waiting', waitingN && s ? () => setCancelAll(true) : undefined, !waitingN],
                    ['clock', 'History', () => setHist(true), false],
                  ] as const).map(([icon, label, on, off]) => (
                    <Press key={label} onPress={on} disabled={off} accessibilityLabel={label} style={{ flex: 1, height: 46, borderRadius: 23, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', opacity: off ? 0.4 : 1, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)' }}>
                      <Icon name={icon} size={16} color={C.soft} width={1.9} />
                      <T style={{ fontFamily: F.medium, fontSize: 13.5 }}>{label}</T>
                    </Press>
                  ))}
                </View>
              </>
            );
          })()}
          <ActionRow
            items={[
              { icon: "send", label: "Send", onPress: () => router.push(`/ethvault/send?net=${net}`) },
              { icon: "receive", label: "Receive", onPress: s ? () => copy(s.expected.safe, "Vault address") : () => {} },
            ]}
          />
          <Group title="Rules">
            <Row title="Daily limit" detail={(() => { const a = v.allowances.find((x) => x.token.toLowerCase() === ETH.toLowerCase()); return a ? `${eth(BigInt(a.amount), a.decimals, 4)} ${NATIVE[net]}` : 'None'; })()} onPress={() => (v.gated ? router.push(`/ethvault/settings?net=${net}`) : setEditing(true))} />
            <Row title="Wait on bigger sends" detail={waitText(v.wait)} onPress={() => (v.gated ? router.push(`/ethvault/settings?net=${net}`) : setEditing(true))} />
            <Row title="Bigger sends go to" sub="Your safe address" detail={shortAddr(v.sweepTo, 6, 4)} onPress={() => copy(v.sweepTo, "Safe address")} />
          </Group>
          {s && s.items.length > 0 && (
            <View style={{ gap: 12 }}>
              <T style={{ fontFamily: F.semibold, fontSize: 13, letterSpacing: 0.2, color: C.sub, paddingHorizontal: 8 }}>Waiting sends</T>
              {s.items.map((i) => {
                const st = itemState(i, Math.floor(Date.now() / 1000), s.live.delay.txNonce);
                if (st === "cancelled") return null;
                const d = describeCall(i, tokensOn(net), { safe: s.expected.safe });
                const frac = Math.max(0.04, Math.min(1, 1 - (i.readyAt - Math.floor(Date.now() / 1000)) / Math.max(1, v.wait)));
                return (
                  <View key={String(i.nonce)} style={{ padding: 16, gap: 14, borderRadius: 24, backgroundColor: st === "waiting" ? "rgba(245,184,61,0.07)" : C.fill, borderWidth: 0.5, borderColor: st === "waiting" ? "rgba(245,184,61,0.22)" : C.line2 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                      <VaultRing size={46} stroke={5} frac={st === "waiting" ? frac : 1} color={d.level === "danger" ? C.bad : C.text} />
                      <View style={{ flex: 1 }}>
                        <T style={{ fontFamily: F.semibold, fontSize: 15.5 }} color={d.level === "danger" ? C.bad : undefined}>{d.line}</T>
                        <T v="caption" dim>
                          {st === "waiting" ? `Runs in ${left(i.readyAt)}` : st === "ready" ? "Ready to run" : "Expired: it can no longer run"}
                        </T>
                      </View>
                    </View>
                    {st === "ready" && (
                      <Button
                        title="Run it now"
                        kind="line"
                        onPress={async () => {
                          try {
                            await executeReady(v, i);
                            done();
                          } catch (e) {
                            setErr(plainError(e, VAULT_NETS[net].label));
                          }
                        }}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          )}
          <Group title="Protected coins">
            {(() => {
              const rows = [
                { key: "ETH", symbol: NATIVE[net], token: ETH as string, decimals: 18, have: s?.eth ?? 0n },
                ...(s?.tokens ?? []).map((t) => ({ key: t.token.address, symbol: t.token.symbol, token: t.token.address as string, decimals: t.token.decimals, have: t.amount })),
              ].filter((r) => r.key === "ETH" || r.have > 0n || v.allowances.some((a) => a.token.toLowerCase() === r.token.toLowerCase()));
              return rows.map((r) => {
                const a = v.allowances.find((x) => x.token.toLowerCase() === r.token.toLowerCase());
                const l = s?.today.find((t) => t.token.toLowerCase() === r.token.toLowerCase())?.left;
                return (
                  <LeadRow
                    key={r.key}
                    lead={<CoinMark symbol={r.symbol} seed={r.token} size={40} net={undefined} />}
                    title={r.symbol}
                    sub={!a ? "Every send waits" : l == null ? `Limit ${eth(BigInt(a.amount), r.decimals, 4)} a day` : `${eth(l, r.decimals, 4)} left today of ${eth(BigInt(a.amount), r.decimals, 4)}`}
                    detail={eth(r.have, r.decimals, 4)}
                    onPress={() => router.push(`/ethvault/settings?net=${net}`)}
                    chevron
                  />
                );
              });
            })()}
          </Group>
          <VaultEditSheet open={editing} onClose={() => setEditing(false)} v={v} net={net} symbol={NATIVE[net]} onQueued={done} />
          <Sheet open={hist} onClose={() => setHist(false)}>
            <View style={{ padding: 20, gap: 12 }}>
              <T v="headline">History</T>
              {s && s.items.length ? s.items.slice().sort((x, y) => y.readyAt - x.readyAt).map((i) => {
                const st = itemState(i, Math.floor(Date.now() / 1000), s.live.delay.txNonce);
                const d = describeCall(i, tokensOn(net), { safe: s.expected.safe });
                return (
                  <View key={String(i.nonce)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
                    <View style={{ flex: 1 }}>
                      <T style={{ fontFamily: F.medium, fontSize: 14.5 }} numberOfLines={2}>{d.line}</T>
                      <T v="caption" dim>{st === 'waiting' ? `Runs in ${left(i.readyAt)}` : st === 'ready' ? 'Ready to run' : st === 'cancelled' ? 'Cancelled' : 'Expired or done'}</T>
                    </View>
                  </View>
                );
              }) : <T v="sub" dim>Nothing has waited in this vault yet.</T>}
            </View>
          </Sheet>
          {s && s.items.some((i) => itemState(i, Math.floor(Date.now() / 1000), s.live.delay.txNonce) === 'waiting') && cancelAll ? (
            <View style={{ gap: 10 }}>
              <SlideToPay
                label="Slide to cancel all waiting"
                onSlide={async () => {
                  if (!(await confirmIt('Cancel everything waiting in your vault'))) return false;
                  try {
                    await phoneCancel(v, s);
                    setCancelAll(false);
                    done();
                    return true;
                  } catch (e) {
                    setErr(plainError(e, VAULT_NETS[net].label));
                    return false;
                  }
                }}
              />
              <Button title="Keep them" kind="line" onPress={() => setCancelAll(false)} />
            </View>
          ) : null}
          <Group title="Settings">
            <Row
              title="Wait on bigger withdrawals"
              detail={waitText(v.wait)}
              onPress={() => router.push(`/ethvault/settings?net=${net}`)}
            />
            <Row
              title="Vault address"
              sub="Tap to copy. Send coins here to protect them"
              detail={shortAddr(s?.expected.safe ?? "", 6, 4)}
              onPress={s ? () => copy(s.expected.safe, "Vault address") : undefined}
            />
          </Group>
          <Group title="How it works">
            <View style={{ padding: 16, gap: 10 }}>
              <T v="sub" dim style={{ lineHeight: 20 }}>Your vault address is a separate account that holds your protected coins. Coins sent there are not spent from your everyday address.</T>
              <T v="sub" dim style={{ lineHeight: 20 }}>{`Your phone can move the daily allowance straight away. Anything bigger waits ${waitText(v.wait)} in the open, and you can cancel it in that time.`}</T>
              <T v="sub" dim style={{ lineHeight: 20 }}>The recovery address belongs to your 12 words. They can cancel a waiting withdrawal or move everything to your safe address. It holds a little {NATIVE[net]} to pay for that.</T>
            </View>
          </Group>
          <Group title="Recovery">
            <Row
              title="Recovery address"
              sub="Tap to copy"
              detail={shortAddr(v.recovery, 6, 4)}
              onPress={() => copy(v.recovery, "Recovery address")}
            />
            <Row
              title="Safe address"
              sub="Where a sweep sends everything. Tap to copy"
              detail={shortAddr(v.sweepTo, 6, 4)}
              onPress={() => copy(v.sweepTo, "Safe address")}
            />
          </Group>
          {s?.recoveryGas.low && (
            <Note>{`Low fuel on your recovery address ${shortAddr(v.recovery, 8, 6)}: it has ${eth(s.recoveryGas.have, 18, 6)} ${NATIVE[net]} and a cancel or sweep needs about ${eth(s.recoveryGas.needed, 18, 6)}. Send a little ${NATIVE[net]} there: the recovery key sends its own transactions, so without fuel it cannot cancel or sweep.`}</Note>
          )}
          {s && !s.recoveryGas.low && (
            <T
              v="caption"
              dim
            >{`Recovery address ${shortAddr(v.recovery, 8, 6)} holds ${eth(s.recoveryGas.have, 18, 6)} ${NATIVE[net]} for fees.`}</T>
          )}
          <ErrorText title="That didn't go through" note="Anything waiting in your vault is still waiting.">{err}</ErrorText>
          <ErrorText hint>{snap.error}</ErrorText>
          <Button
            title="Use my recovery key"
            kind="line"
            onPress={() => router.push(`/ethvault/recover?net=${net}`)}
          />
          {s && <T v="caption" dim style={{ lineHeight: 18 }}>Each time you open the app, the vault's rules are read from the network and checked against what you set up. Anything different is shown here and sent as an alert.</T>}
        </>
      )}
      <HowItWorks onPress={tut.replay} />
    </Screen>
  );
}
