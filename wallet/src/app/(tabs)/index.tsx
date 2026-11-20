import { Aurora } from '../../ui/Aurora';
import { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshControl,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  FadeInDown,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { ActionRow } from "../../ui/ActionRow";
import { T } from "../../ui/Text";
import { Icon } from "../../ui/Icon";
import { Field, Press, success } from "../../ui/controls";
import { MarkDraw } from "../../ui/Intro";
import { NeonCard, type NeonData } from "../../ui/NeonCard";
import { CardCarousel } from "../../ui/CardCarousel";
import { EthNets, netName } from "../../ui/ChainGroup";
import { Logo } from "../../ui/Logo";
import { TokenLogo } from "../../ui/CoinLogo";
import { Sheet } from "../../ui/Sheet";
import { ActivityRow } from "../../ui/ActivityRow";
import { unreadCount, useInbox } from "../../lib/inbox";
import { C, F } from "../../ui/theme";
import { usePoll, type History } from "../../lib/rpc";
import { useAccountRef, useWallet } from "../../lib/wallet";
import { refreshChain, useChain } from "../../lib/chain";
import { toast } from "../../ui/Toast";
import { addInbox } from "../../lib/inbox";
import { flyCoin } from "../../ui/CoinFlight";
import { CapsuleShape, PLANET } from "../../ui/Orbit";
import { useCapsules } from "../../lib/capsules";
import { useContractsOn } from "../../lib/chain";
import { markReceiptsSeen } from "../../lib/watch";
import { newReceipts, receiptKey } from "../../lib/watch-core";
import { niceLyx, shortAddr } from "../../lib/format";
import { useBackupDue } from "../../lib/backup-check";
import { useCoins } from "../../lib/coins";
import { useArrivals } from "../../ui/useArrivals";
import { usePortfolio } from "../../lib/prices";
import { changeText, money } from "../../lib/prices-core";
import { AssetsPanel, PortfolioCard } from "../../ui/PortfolioBits";
import {
  activeNets,
  btcHistory,
  updateChains,
  useAsync,
  useChainSettings,
} from "../../lib/multichain";
import { ethNetChoices, EVM_FAMILIES, EVM_ORDER, evmNet, evmOf, formatBtc, formatUnits, type EvmFamily } from "../../lib/multichain-core";
import { solHistory, tronHistory } from "../../lib/xchains";
import { SOL_DECIMALS } from "../../lib/sol-core";
import { TRX_DECIMALS } from "../../lib/tron-core";
import { timeAgo } from "../../lib/format";

/** One payment row under a card: who, when, and the amount in green when it came in. */
function PayRow({ title, when, amount, unit, incoming, failed, hide }: { title: string; when: string; amount: string; unit: string; incoming: boolean; failed?: boolean; hide: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: 58, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: C.line }}>
      <View style={{ flex: 1 }}>
        <T style={{ fontFamily: F.medium, fontSize: 15.5 }} numberOfLines={1}>{failed ? "Failed" : title}</T>
        <T v="caption" dim>{when}</T>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <T style={{ fontFamily: F.medium, fontSize: 15.5, fontVariant: ["tabular-nums"], color: failed ? C.sub : incoming ? C.good : C.text }}>{hide ? "•••" : `${incoming ? "+" : "−"}${amount}`}</T>
        <T v="caption" dim>{unit}</T>
      </View>
    </View>
  );
}

function TokenRow({ name, symbol, balance, logo, seed, hide, onPress }: { name: string; symbol: string; balance: string; logo?: import("../../ui/logos").LogoId | null; seed: string; hide: boolean; onPress?: () => void }) {
  return (
    <Press onPress={onPress} disabled={!onPress} haptic={false} scaleTo={0.985} accessibilityLabel={name} style={{ flexDirection: "row", alignItems: "center", gap: 13, height: 60, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: C.line }}>
      {logo ? <Logo id={logo} size={36} /> : <TokenLogo symbol={symbol} seed={seed} size={36} />}
      <View style={{ flex: 1 }}>
        <T style={{ fontFamily: F.medium, fontSize: 15.5 }} numberOfLines={1}>{name}</T>
        <T v="caption" dim>{symbol}</T>
      </View>
      <T style={{ fontFamily: F.medium, fontSize: 15.5, fontVariant: ["tabular-nums"] }}>{hide ? "•••" : balance || "–"}</T>
    </Press>
  );
}

type ListCoin = { key: string; name: string; symbol: string; balance: string; logo?: import("../../ui/logos").LogoId | null; seed: string; sub: string; onPress: () => void };

/** The chain's own coin and its tokens in one panel, with search and a switch to hide empty ones. */
function CoinList({ coins, hide, net, onAdd }: { coins: ListCoin[]; hide: boolean; net: string; onAdd: () => void }) {
  const [q, setQ] = useState("");
  const [empty, setEmpty] = useState(false);
  const zero = (b: string) => b !== "" && !(parseFloat(b.replace(/,/g, "")) > 0);
  const shown = coins.filter((c, i) => (i === 0 || !empty || !zero(c.balance)) && (!q.trim() || `${c.name} ${c.symbol}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", height: 40, borderRadius: 20, backgroundColor: "#141418", borderWidth: 0.5, borderColor: "#2A2A31", paddingLeft: 14 }}>
          <Icon name="search" size={16} color={C.sub} width={2} />
          <Field value={q} onChangeText={setQ} placeholder={`Search coins on ${net}`} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, backgroundColor: "transparent", height: 40, fontSize: 14 }} />
        </View>
        <Press onPress={() => setEmpty((v) => !v)} haptic={false} accessibilityLabel="Hide empty coins" style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: "center", backgroundColor: empty ? "#F4F4F6" : "#141418", borderWidth: 0.5, borderColor: "#2A2A31" }}>
          <T style={{ fontFamily: F.medium, fontSize: 13, color: empty ? "#111" : C.soft }}>Hide empty</T>
        </Press>
      </View>
      <View style={{ borderRadius: 24, backgroundColor: "#0B0B0E", borderWidth: 0.5, borderColor: "#1F1F25", overflow: "hidden" }}>
        {shown.map((c, i) => (
          <Press key={c.key} onPress={c.onPress} haptic={false} scaleTo={0.99} accessibilityLabel={c.name} style={{ flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: i ? 0.5 : 0, borderTopColor: "#1D1D22" }}>
            {c.logo ? <Logo id={c.logo} size={38} /> : <TokenLogo symbol={c.symbol} seed={c.seed} size={38} />}
            <View style={{ flex: 1, gap: 2 }}>
              <T style={{ fontFamily: F.medium, fontSize: 16 }} numberOfLines={1}>{c.name}</T>
              <T v="caption" dim numberOfLines={1}>{c.sub}</T>
            </View>
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              <T style={{ fontFamily: F.medium, fontSize: 16.5, fontVariant: ["tabular-nums"], color: zero(c.balance) ? C.sub : C.text }}>{hide ? "•••" : c.balance || "–"}</T>
              <T v="caption" dim>{c.symbol}</T>
            </View>
          </Press>
        ))}
        {!shown.length ? <T v="caption" dim style={{ padding: 16 }}>Nothing matches.</T> : null}
      </View>
      <Press onPress={onAdd} haptic={false} accessibilityLabel="Add a token" style={{ alignItems: "center", paddingVertical: 4 }}>
        <T style={{ fontFamily: F.medium, fontSize: 14, color: C.soft }}>+ Add another token</T>
      </Press>
    </View>
  );
}
import { DUR, EASE_OUT } from "../../ui/motion";

const greeting = () => {
  const h = new Date().getHours();
  return h < 5
    ? "Good night"
    : h < 12
      ? "Good morning"
      : h < 17
        ? "Good afternoon"
        : "Good evening";
};

function Banner({
  title,
  sub,
  onPress,
  tint,
}: {
  title: string;
  sub: string;
  onPress: () => void;
  tint?: string;
}) {
  return (
    <Press
      onPress={onPress}
      scaleTo={0.985}
      style={{
        marginTop: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        padding: 14,
        borderRadius: 20,
        backgroundColor: C.fill2,
        borderWidth: 0.5,
        borderColor: C.line2,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 15.5 }}>{title}</T>
        <T v="caption" dim color={tint}>
          {sub}
        </T>
      </View>
      <Icon name="chevron" size={16} color={C.faint} width={2.2} />
    </Press>
  );
}

function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingBottom: 8, paddingHorizontal: 6 }}>
      <T style={{ flex: 1, fontFamily: F.semibold, fontSize: 12, letterSpacing: 1.6, color: C.sub }}>{title}</T>
      {action ? (
        <Press onPress={onAction} hitSlop={10}>
          <T style={{ fontFamily: F.medium, fontSize: 14.5 }}>{action}</T>
        </Press>
      ) : null}
    </View>
  );
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const { width: sw } = useWindowDimensions();
  const cw = Math.min(sw - 32, 420);
  // the cards are tall like the Receive card, a little narrower than the page so the next one peeks in
  const tallW = Math.round(cw * 0.7);
  const tallH = Math.round(tallW * 1.28);
  const me = useAccountRef();
  const w = useWallet();
  const hide = w.settings.hideBalance;
  const address = me?.address ?? "";
  const coins = useCoins();
  useArrivals(coins);
  const { p: port, cur } = usePortfolio(coins);
  const chainCfg = useChainSettings();
  const ethNet = activeNets().eth;
  const hist = usePoll<History>(
    "lyx_getAddressHistory",
    address ? { address, limit: 6 } : null,
    8000,
  );
  const contractsOn = useContractsOn();
  const allCaps = useCapsules();
  const backupDue = useBackupDue();
  const readyCaps = contractsOn
    ? allCaps.filter(
        (c) =>
          c.address &&
          !c.opened &&
          c.to === address &&
          Date.now() / 1000 >= c.opens,
      )
    : [];
  const { error: chainError } = useChain();
  const [pulling, setPulling] = useState(false);

  // Depth: scrolling up sends the card back (smaller, softer); pulling down brings it forward.
  const y = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    y.value = e.contentOffset.y;
  });
  const cardDepth = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, 220], [1, 0.55], "clamp"),
    transform: [
      { translateY: interpolate(y.value, [-160, 0, 220], [-8, 0, 46], "clamp") },
      { scale: interpolate(y.value, [-160, 0, 220], [1.05, 1, 0.92], "clamp") },
    ],
  }));

  const refresh = useCallback(async () => {
    setPulling(true);
    await Promise.all([hist.refresh(), refreshChain(), coins.refresh()]);
    setPulling(false);
  }, [hist, coins]);

  // A payment that lands while the wallet is open: a toast, once (the background check skips it after).
  const known = useRef<{ addr: string; keys: Set<string> } | null>(null);
  useEffect(() => {
    if (!hist.data || !address) return;
    if (!known.current || known.current.addr !== address) {
      known.current = {
        addr: address,
        keys: new Set(hist.data.items.map((i) => receiptKey(address, i))),
      };
      return;
    }
    const fresh = newReceipts(address, hist.data.items, known.current.keys);
    if (!fresh.length) return;
    fresh.forEach((i) => known.current!.keys.add(receiptKey(address, i)));
    success();
    flyCoin('in', 'lyx', fresh.length === 1 ? `+${niceLyx(fresh[0].amountLyx)} LYX` : undefined);
    toast(
      fresh.length === 1
        ? `Received ${niceLyx(fresh[0].amountLyx)} LYX`
        : `Received ${fresh.length} payments`,
      "receive",
    );
    markReceiptsSeen(fresh.map((i) => receiptKey(address, i))).catch(() => {});
    fresh.forEach((i) => addInbox({ id: `rx:${receiptKey(address, i)}`, kind: "receive", title: `Received ${niceLyx(i.amountLyx)} LYX`, body: i.from ? `From ${shortAddr(i.from, 10, 6)}.` : "A payment arrived.", route: "/(tabs)/activity" }).catch(() => {}));
  }, [hist.data, address]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (id: string) => {
    if (id === "portfolio") {
      router.push("/portfolio");
      return;
    }
    if (id.startsWith("evm:")) {
      updateChains({ ethNet: evmNet(id.slice(4) as EvmFamily, chainCfg.allowMainnet) });
      router.push("/coin/eth");
      return;
    }
    router.push(id === "sol" || id === "trx" ? `/xcoin/${id}` : `/coin/${id}`);
  };
  const [front, setFront] = useState(0);
  const [add, setAdd] = useState(false);
  const unread = unreadCount(useInbox());
  const ethNetCount = ethNetChoices(chainCfg.allowMainnet).length;
  const note = (tag?: string) => (tag ? "Testnet · no market value" : "");
  const deck: { id: string; c: NeonData }[] = [
    { id: "lyx", c: { rim: "lyx", title: "LOKYX", sub: coins.lyx.sub, balance: coins.lyx.balance, unit: coins.lyx.unit, note: "Testnet · no market value", mark: { kind: "lyx" } } },
    { id: "btc", c: { rim: "btc", title: "Bitcoin", sub: coins.btc.sub, balance: coins.btc.balance, unit: coins.btc.unit, note: note(coins.btc.tag), mark: { kind: "logo", id: "btc" } } },
    { id: "eth", c: { rim: "eth", title: "Ethereum", sub: coins.ethHome.sub, balance: coins.ethHome.balance, unit: coins.ethHome.unit, note: note(coins.eth.tag), mark: { kind: "logo", id: "eth" } } },
    ...coins.extra.map((x) => ({ id: x, c: { rim: x, title: coins[x].title, sub: coins[x].address ? coins[x].sub : "Tap to set up", balance: coins[x].address ? coins[x].balance : "—", unit: coins[x].unit, note: note(coins[x].tag || "t"), mark: { kind: "logo" as const, id: x } } })),
    ...coins.evm.map((x) => ({ id: `evm:${x.id}`, c: { rim: x.logo, title: x.name, sub: x.sub, balance: x.balance, unit: x.unit, note: note("t"), mark: { kind: "logo", id: x.logo } } as NeonData })),
  ];
  const cardIds = port ? [...deck.map((d) => d.id), "portfolio"] : deck.map((d) => d.id);
  const frontKey = cardIds[Math.min(front, cardIds.length - 1)];
  // an added chain (Base, Arbitrum…) is the Ethereum screens pointed at that network
  const frontId = frontKey.startsWith("evm:") ? "eth" : frontKey;
  // the Portfolio card has no coin of its own, so the buttons act on LOKYX
  const actId = frontId === "portfolio" ? "lyx" : frontId;
  useEffect(() => {
    const homeEth = chainCfg.allowMainnet ? "mainnet" : "sepolia";
    const want = frontKey.startsWith("evm:") ? evmNet(frontKey.slice(4) as EvmFamily, chainCfg.allowMainnet) : frontKey === "eth" && evmOf(chainCfg.ethNet) ? homeEth : null;
    if (want && want !== chainCfg.ethNet) updateChains({ ethNet: want });
  }, [frontKey, chainCfg.allowMainnet]); // eslint-disable-line react-hooks/exhaustive-deps
  const nets = activeNets();
  const btcH = useAsync(async () => (frontId === "btc" && coins.btc.address ? btcHistory(nets.btc, coins.btc.address) : null), [frontId, coins.btc.address, nets.btc], 60_000);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Aurora strength={1} />
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 120,
          paddingHorizontal: 16,
        }}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={refresh}
            tintColor={C.sub}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            height: 52,
            paddingHorizontal: 4,
          }}
        >
          <Press
            onPress={() => router.push("/accounts")}
            accessibilityLabel="Switch account"
            style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <MarkDraw size={34} delay={250} />
            <View>
              <T v="caption" dim>
                {greeting()}
              </T>
              <T
                style={{
                  fontFamily: F.semibold,
                  fontSize: 17,
                  letterSpacing: -0.3,
                }}
              >
                {me?.name}
              </T>
            </View>
          </Press>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Press
              onPress={() => router.push("/(tabs)/notifications")}
              accessibilityLabel="Notifications"
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: "rgba(255,255,255,0.08)",
                borderWidth: 0.5,
                borderColor: "rgba(255,255,255,0.14)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="bell" size={19} color={C.text} width={1.9} />
              {unread > 0 ? <View style={{ position: "absolute", top: 8, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: C.bad, borderWidth: 1.5, borderColor: C.bg }} /> : null}
            </Press>
            <Press
              onPress={() => setAdd(true)}
              accessibilityLabel="Add a blockchain"
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: "rgba(255,255,255,0.08)",
                borderWidth: 0.5,
                borderColor: "rgba(255,255,255,0.14)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="plus" size={19} color={C.text} width={1.9} />
            </Press>
          </View>
        </View>

        <Animated.View style={[{ marginTop: 6, zIndex: 2 }, cardDepth]}>
          <CardCarousel
            width={tallW}
            height={tallH}
            index={front}
            onIndex={setFront}
            cards={[
              ...deck.map((d) => (
                <Press key={d.id} onPress={() => open(d.id)} scaleTo={0.985} accessibilityLabel={`${d.c.title} card`}>
                  <NeonCard c={d.c} width={tallW} height={tallH} hide={hide} />
                </Press>
              )),
              ...(port ? [<Press key="portfolio" onPress={() => open("portfolio")} scaleTo={0.985} accessibilityLabel="Portfolio card"><PortfolioCard p={port} cur={cur} width={tallW} height={tallH} hide={hide} /></Press>] : []),
            ]}
          />
        </Animated.View>

        <ActionRow
          items={[
            { icon: "send", label: "Send", onPress: () => router.push(actId === "lyx" ? "/send" : actId === "sol" || actId === "trx" ? (coins[actId].address ? `/xsend?chain=${actId}` : `/xcoin/${actId}`) : `/chain/send?chain=${actId}`) },
            { icon: "receive", label: "Receive", onPress: () => router.push(`/receive?coin=${actId}`) },
            { icon: "scan", label: "Scan", onPress: () => router.push("/ring?mode=scan") },
            { icon: "swap", label: "Swap", onPress: () => router.push("/swap") },
          ]}
        />
        {port ? <AssetsPanel p={port} cur={cur} hide={hide} onSeeAll={() => router.push("/portfolio")} /> : null}

        {chainError ? (
          <Animated.View
            entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)}
            style={{ marginTop: 18, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, backgroundColor: C.fill, borderWidth: 0.5, borderColor: C.line2 }}
          >
            <Icon name="info" size={18} color={C.sub} width={1.9} />
            <View style={{ flex: 1 }}>
              <T style={{ fontFamily: F.semibold, fontSize: 14.5 }}>You're offline</T>
              <T v="caption" dim>Balances may be out of date. They update when you're back.</T>
            </View>
          </Animated.View>
        ) : null}
        {coins.addressError ? (
          <Banner
            title="Your Bitcoin and Ethereum addresses are not ready"
            sub={`${coins.addressError}. Tap to try again.`}
            onPress={coins.retry}
          />
        ) : null}
        {backupDue && (
          <Banner
            title="Check your backup"
            sub="Three questions to prove your 24 words still work."
            onPress={() => router.push("/backup-check")}
          />
        )}
        {readyCaps.length > 0 && (
          <Press
            onPress={() => router.push(`/capsule/${readyCaps[0].address}`)}
            scaleTo={0.985}
            style={{
              marginTop: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              padding: 14,
              borderRadius: 20,
              backgroundColor: "#101633",
              borderWidth: 1,
              borderColor: "#24306A",
            }}
          >
            <View style={{ transform: [{ rotate: "-18deg" }] }}>
              <CapsuleShape w={36} h={17} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T style={{ fontFamily: F.semibold, fontSize: 15.5 }}>
                A time capsule is ready
              </T>
              <T v="caption" color={PLANET.light}>
                Today's the day. Tap to open it.
              </T>
            </View>
          </Press>
        )}

        {frontId === "lyx" ? (
          <View style={{ paddingTop: 26 }}>
            <SectionHead title="RECENT" action="See all" onAction={() => router.push("/(tabs)/activity")} />
            {(hist.data?.items ?? []).slice(0, 3).map((it, i) => (
              <ActivityRow key={i} item={it} i={i} hide={hide} />
            ))}
            {!(hist.data?.items ?? []).length ? <T v="caption" dim style={{ paddingHorizontal: 6, paddingTop: 6 }}>Nothing yet. Payments you send and receive show here.</T> : null}
          </View>
        ) : null}
        {frontId === "btc" ? (
          <View style={{ paddingTop: 26 }}>
            <SectionHead title="RECENT" action="See all" onAction={() => open("btc")} />
            {(btcH.data ?? []).slice(0, 4).map((r) => (
              <PayRow key={r.txid} title={r.delta >= 0n ? "Received" : "Sent"} when={r.time ? timeAgo(r.time) : "Waiting for a block"} amount={formatBtc(r.delta < 0n ? -r.delta : r.delta)} unit={coins.btc.unit} incoming={r.delta >= 0n} hide={hide} />
            ))}
            {!(btcH.data ?? []).length ? <T v="caption" dim style={{ paddingHorizontal: 6, paddingTop: 6 }}>{btcH.error ? "Can't reach the Bitcoin network right now." : btcH.data ? "Nothing yet. Bitcoin you send and receive shows here." : "Loading…"}</T> : null}
          </View>
        ) : null}
        {frontId === "eth" || frontId.startsWith("0x") ? (
          <View style={{ paddingTop: 26 }}>
            <SectionHead title={`ON ${netName(ethNet).toUpperCase()}`} action="Add token" onAction={() => router.push("/coins")} />
            <CoinList
              hide={hide}
              net={netName(ethNet)}
              onAdd={() => router.push("/coins")}
              coins={[
                { key: "native", name: coins.eth.unit === "ETH" || coins.eth.unit.endsWith("ETH") ? "Ether" : coins.eth.unit, symbol: coins.eth.unit, balance: coins.eth.balance, logo: coins.eth.unit.endsWith("ETH") ? "eth" : coins.eth.logo, seed: "native", sub: "Network coin", onPress: () => open("eth") },
                ...coins.tokens.map((t) => ({ key: t.contract, name: t.name, symbol: t.symbol, balance: t.balance, logo: t.logo, seed: t.contract, sub: t.symbol, onPress: () => open(t.contract) })),
              ]}
            />
          </View>
        ) : null}
        {frontId === "sol" || frontId === "trx" ? (
          coins[frontId].address ? (
            <View style={{ paddingTop: 26 }}>
              <SectionHead title={`TOKENS ON ${coins[frontId].title.toUpperCase()}`} action="Add" onAction={() => router.push(`/add-token?chain=${frontId}`)} />
              {coins.xTokens[frontId].map((t) => (
                <TokenRow key={t.id} name={t.name} symbol={t.symbol} balance={t.balance} logo={t.logo} seed={t.id} hide={hide} />
              ))}
              {!coins.xTokens[frontId].length ? <T v="caption" dim style={{ paddingHorizontal: 6, paddingBottom: 4 }}>{frontId === "sol" ? "Tokens you hold on Solana show here." : "USDT and other tokens you hold on Tron show here."}</T> : null}
            </View>
          ) : (
            <View style={{ paddingTop: 26, paddingHorizontal: 6, gap: 12 }}>
              <T v="sub" dim style={{ lineHeight: 21 }}>{`Your ${coins[frontId].title} address comes from the same 24 words. Set it up once to see your balance.`}</T>
              <Press onPress={() => open(frontId)} style={{ height: 50, borderRadius: 25, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }}>
                <T style={{ fontFamily: F.semibold, fontSize: 15.5, color: C.inkText }}>{`Set up ${coins[frontId].title}`}</T>
              </Press>
            </View>
          )
        ) : null}
      </Animated.ScrollView>
      <Sheet open={add} onClose={() => setAdd(false)}>
        <View style={{ gap: 6 }}>
          <T v="headline">Add a blockchain</T>
          <T v="caption" dim style={{ paddingBottom: 10 }}>Each blockchain gets its own card on Home. Base, Arbitrum and the other Ethereum-style chains use the same address as Ethereum, so there is nothing to set up.</T>
          {([{ id: "sol", n: "Solana", s: "SOL · devnet" }, { id: "trx", n: "Tron", s: "TRX · Nile testnet" }] as const).map((b) => {
            const on = coins.extra.includes(b.id);
            return (
              <Press key={b.id} haptic={false} onPress={() => updateChains({ extra: on ? coins.extra.filter((x) => x !== b.id) : [...coins.extra, b.id] })} style={{ flexDirection: "row", alignItems: "center", gap: 14, height: 58 }}>
                <Logo id={b.id} size={38} />
                <View style={{ flex: 1 }}>
                  <T style={{ fontFamily: F.medium, fontSize: 16 }}>{b.n}</T>
                  <T v="caption" dim>{b.s}</T>
                </View>
                <T style={{ fontFamily: F.medium, fontSize: 14.5, color: on ? C.sub : C.text }}>{on ? "On Home · Remove" : "Add"}</T>
              </Press>
            );
          })}
          {EVM_ORDER.map((f) => {
            const on = coins.evm.some((x) => x.id === f);
            const m2 = EVM_FAMILIES[f];
            return (
              <Press key={f} haptic={false} onPress={() => updateChains({ evm: on ? (chainCfg.evm ?? []).filter((x) => x !== f) : [...(chainCfg.evm ?? []), f] })} style={{ flexDirection: "row", alignItems: "center", gap: 14, height: 58 }}>
                <Logo id={m2.logo} size={38} />
                <View style={{ flex: 1 }}>
                  <T style={{ fontFamily: F.medium, fontSize: 16 }}>{m2.name}</T>
                  <T v="caption" dim>{m2.unit} · same address as Ethereum</T>
                </View>
                <T style={{ fontFamily: F.medium, fontSize: 14.5, color: on ? C.sub : C.text }}>{on ? "On Home · Remove" : "Add"}</T>
              </Press>
            );
          })}
          <Press onPress={() => { setAdd(false); router.push("/coins"); }} scaleTo={0.985} style={{ flexDirection: "row", alignItems: "center", gap: 14, height: 58 }}>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.fill2, alignItems: "center", justifyContent: "center" }}>
              <Icon name="plus" size={18} color={C.text} width={2} />
            </View>
            <View style={{ flex: 1 }}>
              <T style={{ fontFamily: F.medium, fontSize: 16 }}>Add a coin or token</T>
              <T v="caption" dim>USDC, USDT or another token</T>
            </View>
            <Icon name="chevron" size={16} color={C.faint} width={2.2} />
          </Press>
        </View>
      </Sheet>
    </View>
  );
}
