import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { T } from "./Text";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { TokenLogo } from "./CoinLogo";
import { Press, tick } from "./controls";
import { CoinRow } from "./WalletCards";
import { C, F } from "./theme";
import { ETH_NETS, ethNetChoices, type EthNet } from "../lib/multichain-core";
import type { Coins } from "../lib/coins";
import type { LogoId } from "./logos";

/** The network's plain name: Sepolia and mainnet are both just "Ethereum" next to Base, Arbitrum and the rest. */
export const netName = (n: EthNet) => (n === "sepolia" || n === "mainnet" ? "Ethereum" : ETH_NETS[n].short);

/**
 * Ethereum and everything that lives on it, in one frame: the coin, the network it is on, then its tokens.
 * One address works on every Ethereum network, so the network is a switch here, not a separate coin.
 */
export function EthGroup({
  coins,
  net,
  allowMainnet,
  onNet,
  width,
  hide,
}: {
  coins: Coins;
  net: EthNet;
  allowMainnet: boolean;
  onNet: (n: EthNet) => void;
  width: number;
  hide?: boolean;
}) {
  const inner = width - 12;
  const nets = ethNetChoices(allowMainnet);
  return (
    <View
      style={{
        width,
        borderRadius: 28,
        padding: 6,
        gap: 8,
        backgroundColor: C.raised,
        borderWidth: 0.5,
        borderColor: C.line2,
      }}
    >
      <CoinRow
        c={coins.eth}
        width={inner}
        hide={hide}
        onPress={() => router.push("/coin/eth")}
      />
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 4 }}>
        {nets.map((n) => {
          const on = n === net;
          return (
            <Press
              key={n}
              haptic={false}
              scaleTo={0.96}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => {
                if (!on) tick();
                onNet(n);
              }}
              style={{
                flex: 1,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: on ? C.fill2 : "transparent",
                borderWidth: 1,
                borderColor: on ? C.line2 : "transparent",
              }}
            >
              <T
                style={{
                  fontFamily: F.medium,
                  fontSize: 12.5,
                  color: on ? C.text : C.sub,
                }}
                numberOfLines={1}
              >
                {ETH_NETS[n].short}
              </T>
            </Press>
          );
        })}
      </View>
      <View style={{ paddingHorizontal: 8 }}>
        {coins.tokens.map((t, i) => (
          <Press
            key={t.contract}
            onPress={() => router.push(`/coin/${t.contract}`)}
            scaleTo={0.985}
            accessibilityLabel={t.name}
          >
            <View
              style={{
                height: 54,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                borderTopWidth: i === 0 ? 0 : 0.5,
                borderTopColor: C.line,
              }}
            >
              {t.logo ? (
                <Logo id={t.logo} size={30} />
              ) : (
                <TokenLogo symbol={t.symbol} seed={t.contract} size={30} />
              )}
              <View style={{ flex: 1 }}>
                <T
                  style={{ fontFamily: F.medium, fontSize: 15 }}
                  numberOfLines={1}
                >
                  {t.name}
                </T>
                <T
                  style={{ fontFamily: F.regular, fontSize: 12, color: C.sub }}
                  numberOfLines={1}
                >
                  {t.symbol}
                </T>
              </View>
              <T
                style={{
                  fontFamily: F.medium,
                  fontSize: 15,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {hide ? "•••" : t.balance || "–"}
              </T>
            </View>
          </Press>
        ))}
        <Press
          onPress={() => router.push("/coins")}
          scaleTo={0.985}
          accessibilityLabel="Add a token"
        >
          <View
            style={{
              height: 46,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              borderTopWidth: coins.tokens.length ? 0.5 : 0,
              borderTopColor: C.line,
            }}
          >
            <View style={{ width: 30, alignItems: "center" }}>
              <Icon name="plus" size={16} color={C.sub} width={2} />
            </View>
            <T style={{ fontFamily: F.medium, fontSize: 14, color: C.sub }}>
              {coins.tokens.length
                ? `Add a token on ${ETH_NETS[net].short}`
                : `Add USDC, USDT or another token on ${ETH_NETS[net].short}`}
            </T>
          </View>
        </Press>
      </View>
    </View>
  );
}

/** The network an Ethereum address is on: a quick switch, shown under the wallet deck. */
/** Each network's mark, where there is one; the rest get a coloured disc with their first letter. */
const NET_MARK: Partial<Record<EthNet, LogoId>> = {
  sepolia: "eth", mainnet: "eth", "base-sepolia": "base", base: "base", "arbitrum-sepolia": "arb", arbitrum: "arb", "op-sepolia": "op", optimism: "op",
  "polygon-amoy": "pol", polygon: "pol", "bnb-testnet": "bnb", bnb: "bnb", "avalanche-fuji": "avax", avalanche: "avax",
};
const NET_TINT: Partial<Record<EthNet, string>> = { "linea-sepolia": "#61DFFF", linea: "#61DFFF", "scroll-sepolia": "#FFDBB0", scroll: "#FFDBB0", "mantle-sepolia": "#65B3AE", gnosis: "#3E6957", celo: "#FCFF52" };

function NetMark({ n, size }: { n: EthNet; size: number }) {
  const id = NET_MARK[n];
  if (id) return <Logo id={id} size={size} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: NET_TINT[n] ?? "#8A8A93", alignItems: "center", justifyContent: "center" }}>
      <T style={{ fontFamily: F.semibold, fontSize: size * 0.55, color: "#000" }}>{ETH_NETS[n].short[0]}</T>
    </View>
  );
}

/** Every Ethereum-style network as a pill with its mark. One address works on all of them. */
export function EthNets({ net, allowMainnet, onNet }: { net: EthNet; allowMainnet: boolean; onNet: (n: EthNet) => void }) {
  const nets = ethNetChoices(allowMainnet);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
      {nets.map((n) => {
        const on = n === net;
        return (
          <Press key={n} haptic={false} scaleTo={0.96} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={ETH_NETS[n].label} onPress={() => { if (!on) tick(); onNet(n); }}
            style={{ height: 36, paddingLeft: 8, paddingRight: 14, borderRadius: 18, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: on ? C.ink : "rgba(255,255,255,0.07)", borderWidth: on ? 0 : 0.5, borderColor: "rgba(255,255,255,0.12)" }}>
            <NetMark n={n} size={20} />
            <T style={{ fontFamily: F.medium, fontSize: 14, color: on ? C.inkText : C.text }} numberOfLines={1}>{netName(n)}</T>
          </Press>
        );
      })}
    </ScrollView>
  );
}
