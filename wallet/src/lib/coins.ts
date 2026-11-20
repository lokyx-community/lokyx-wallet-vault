import { useMemo, useRef } from 'react';
import { usePoll, type Account } from './rpc';
import { useAccountRef } from './wallet';
import { useStore } from './store';
import { readFrom } from './arrivals-core';
import { addrs as addrStore, activeNets, btcBalance, ethBalance, tokenBalance, tokensFor, useAsync, useChainSettings, useMyAddresses, useTokensStore } from './multichain';
import { BTC_NETS, ETH_NETS, EVM_FAMILIES, EVM_ORDER, evmNet, evmOf, formatBtc, formatUnits, type EvmFamily } from './multichain-core';
import { SOL_NETS, SOL_DECIMALS } from './sol-core';
import { TRON_NETS, TRX_DECIMALS } from './tron-core';
import { solBalance, solTokens, tronTokens, trxBalance, useWatchedX, type XToken } from './xchains';
import { niceLyx } from './format';
import type { CardData, CardKind } from '../ui/WalletCards';
import type { LogoId } from '../ui/logos';
import { logoFor } from '../ui/Logo';

export type CoinId = 'lyx' | 'btc' | 'eth';
export type XCoin = 'sol' | 'trx';

export interface Coins {
  lyx: CardData;
  btc: CardData & { logo: LogoId };
  eth: CardData & { logo: LogoId };
  /** ERC-20 tokens on the active Ethereum network, with their balances. */
  tokens: { symbol: string; name: string; contract: string; decimals: number; balance: string; raw: bigint | null; logo: LogoId | null }[];
  /** Solana and Tron, when added. `address` is empty until the words have been read once (older wallets). */
  sol: CardData & { logo: LogoId };
  trx: CardData & { logo: LogoId };
  xTokens: Record<XCoin, XToken[]>;
  extra: XCoin[];
  /** The Ethereum card as the wallet shows it on Home: Ethereum itself, whatever chain is open on its screen. */
  ethHome: { balance: string; unit: string; sub: string };
  /** Each added Ethereum-style chain: its own balance. */
  evm: { id: EvmFamily; name: string; logo: LogoId; unit: string; balance: string; sub: string }[];
  /** An address problem, in words, when Bitcoin or Ethereum addresses could not be made. */
  addressError: string;
  /** The balances as whole numbers, keyed by coin, network and address, so a rise can be noticed. */
  raw: Record<string, bigint>;
  retry: () => void;
  refresh: () => Promise<void>;
}

/** Balances and addresses for every coin the wallet holds. One place, so Home and each coin's screen agree. */
export function useCoins(): Coins {
  const me = useAccountRef();
  const address = me?.address ?? '';
  const acct = usePoll<Account>('lyx_getAccount', address ? { address } : null, 5000);
  useChainSettings();
  useTokensStore();
  const nets = activeNets();
  const addrs = useMyAddresses();
  const btcAddr = addrs.data?.btc[nets.btc] ?? '';
  const ethAddr = addrs.data?.eth ?? '';
  // A balance that is still the old network's while a new one loads must never be filed under the new network:
  // it would look like money arriving when the real number lands. So each read notes which network it came from.
  const loaded = useRef<Record<string, string>>({});
  const btcBal = useAsync(async () => {
    if (!btcAddr) return null;
    const v = await btcBalance(nets.btc, btcAddr);
    loaded.current.btc = nets.btc;
    return v;
  }, [btcAddr, nets.btc], 30_000);
  const ethBal = useAsync(async () => {
    if (!ethAddr) return null;
    const v = await ethBalance(nets.eth, ethAddr);
    loaded.current.eth = nets.eth;
    return v;
  }, [ethAddr, nets.eth], 30_000);
  const cfg = useChainSettings();
  const extra = cfg.extra ?? [];
  const evmOn = EVM_ORDER.filter((f) => (cfg.evm ?? []).includes(f));
  const homeEth = cfg.allowMainnet ? 'mainnet' : 'sepolia';
  const homeEthBal = useAsync(async () => (ethAddr ? ethBalance(homeEth, ethAddr) : null), [ethAddr, homeEth], 30_000);
  const evmBal = useAsync(
    async () => (ethAddr ? Promise.all(evmOn.map(async (f) => ({ f, v: await ethBalance(evmNet(f, cfg.allowMainnet), ethAddr).catch(() => null) }))) : []),
    [ethAddr, evmOn.join(','), cfg.allowMainnet],
    30_000,
  );
  const live = useStore(addrStore);
  const solAddr = extra.includes('sol') ? live?.sol ?? addrs.data?.sol ?? '' : '';
  const trxAddr = extra.includes('trx') ? live?.trx ?? addrs.data?.trx ?? '' : '';
  const solBal = useAsync(async () => {
    if (!solAddr) return null;
    const v = await solBalance(nets.sol, solAddr);
    loaded.current.sol = nets.sol;
    return v;
  }, [solAddr, nets.sol], 30_000);
  const trxBal = useAsync(async () => {
    if (!trxAddr) return null;
    const v = await trxBalance(nets.trx, trxAddr);
    loaded.current.trx = nets.trx;
    return v;
  }, [trxAddr, nets.trx], 30_000);
  const watched = useWatchedX();
  const wkey = watched.map((w) => w.id).join(',');
  const solTok = useAsync(async () => (solAddr ? solTokens(nets.sol, solAddr).catch(() => []) : []), [solAddr, nets.sol, wkey], 60_000);
  const trxTok = useAsync(async () => (trxAddr ? tronTokens(nets.trx, trxAddr).catch(() => []) : []), [trxAddr, nets.trx, wkey], 60_000);
  const tokenList = tokensFor(nets.eth);
  const tokBal = useAsync(
    async () => {
      if (!ethAddr) return [];
      const net = nets.eth;
      const r = await Promise.all(tokenList.map(async (t) => ({ t, v: await tokenBalance(net, t, ethAddr).catch(() => null) })));
      loaded.current.erc20 = net;
      return r;
    },
    [ethAddr, nets.eth, tokenList.map((t) => t.contract).join(',')],
    30_000,
  );

  const raw: Record<string, bigint> = {};
  if (btcAddr && btcBal.data && readFrom(loaded.current, 'btc', nets.btc)) raw[`btc:${nets.btc}:${btcAddr}`] = btcBal.data.confirmed + btcBal.data.pending;
  if (ethAddr && ethBal.data != null && readFrom(loaded.current, 'eth', nets.eth)) raw[`eth:${nets.eth}:${ethAddr}`] = ethBal.data;
  if (solAddr && solBal.data != null && readFrom(loaded.current, 'sol', nets.sol)) raw[`sol:${nets.sol}:${solAddr}`] = solBal.data;
  if (trxAddr && trxBal.data != null && readFrom(loaded.current, 'trx', nets.trx)) raw[`trx:${nets.trx}:${trxAddr}`] = trxBal.data;
  for (const r of readFrom(loaded.current, 'erc20', nets.eth) ? tokBal.data ?? [] : []) if (r.v != null && ethAddr) raw[`erc20:${nets.eth}:${r.t.contract.toLowerCase()}`] = r.v;
  const rawKey = Object.entries(raw).map(([k, v]) => `${k}=${v}`).join('|');

  return useMemo<Coins>(
    () => ({
      raw,
      lyx: { kind: 'lyx', title: 'LOKYX', sub: 'Testnet', unit: 'LYX', balance: acct.data ? niceLyx(acct.data.balanceLyx, 2) : '', address, tag: 'Tap to open' },
      btc: { kind: 'btc', logo: 'btc', title: 'Bitcoin', sub: BTC_NETS[nets.btc].label.replace(/^Bitcoin /, '').replace(/^./, (c) => c.toUpperCase()), unit: BTC_NETS[nets.btc].unit, balance: btcBal.data ? formatBtc(btcBal.data.confirmed) : '', address: btcAddr, tag: BTC_NETS[nets.btc].real ? '' : 'Test network' },
      eth: { kind: (evmOf(nets.eth) ? EVM_FAMILIES[evmOf(nets.eth)!].logo : 'eth') as CardKind, logo: evmOf(nets.eth) ? EVM_FAMILIES[evmOf(nets.eth)!].logo : 'eth', title: evmOf(nets.eth) ? EVM_FAMILIES[evmOf(nets.eth)!].name : 'Ethereum', sub: ETH_NETS[nets.eth].label.replace(/^Ethereum /, ''), unit: ETH_NETS[nets.eth].unit, balance: ethBal.data != null ? formatUnits(ethBal.data, 18, 4) : '', address: ethAddr, tag: ETH_NETS[nets.eth].real ? '' : 'Test network' },
      sol: { kind: 'sol', logo: 'sol', title: 'Solana', sub: SOL_NETS[nets.sol].short, unit: 'SOL', balance: solBal.data != null ? formatUnits(solBal.data, SOL_DECIMALS, 4) : '', address: solAddr, tag: SOL_NETS[nets.sol].real ? '' : 'Test network' },
      trx: { kind: 'trx', logo: 'trx', title: 'Tron', sub: TRON_NETS[nets.trx].short, unit: 'TRX', balance: trxBal.data != null ? formatUnits(trxBal.data, TRX_DECIMALS, 2) : '', address: trxAddr, tag: TRON_NETS[nets.trx].real ? '' : 'Test network' },
      xTokens: { sol: solTok.data ?? [], trx: trxTok.data ?? [] },
      extra,
      ethHome: { balance: homeEthBal.data != null ? formatUnits(homeEthBal.data, 18, 4) : '', unit: ETH_NETS[homeEth].unit, sub: ETH_NETS[homeEth].label.replace(/^Ethereum /, '') },
      evm: evmOn.map((f) => {
        const v = evmBal.data?.find((x) => x.f === f)?.v ?? null;
        const m = EVM_FAMILIES[f];
        return { id: f, name: m.name, logo: m.logo, unit: ETH_NETS[evmNet(f, cfg.allowMainnet)].unit, balance: v != null ? formatUnits(v, 18, 4) : '', sub: ETH_NETS[evmNet(f, cfg.allowMainnet)].label };
      }),
      // a token shows the moment it is added, before its balance comes back
      tokens: tokenList.map((t) => {
        const v = tokBal.data?.find((x) => x.t.contract === t.contract)?.v ?? null;
        return { symbol: t.symbol, name: t.name ?? t.symbol, contract: t.contract, decimals: t.decimals, balance: v == null ? '' : formatUnits(v, t.decimals, 4), raw: v, logo: logoFor(t.symbol) };
      }),
      addressError: addrs.error,
      retry: () => addrs.refresh(),
      refresh: async () => {
        await Promise.all([acct.refresh(), btcBal.refresh(), ethBal.refresh(), homeEthBal.refresh(), evmBal.refresh(), tokBal.refresh(), solBal.refresh(), trxBal.refresh(), solTok.refresh(), trxTok.refresh()]);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawKey, address, acct.data, btcAddr, btcBal.data, ethAddr, ethBal.data, tokBal.data, nets.btc, nets.eth, addrs.error, solAddr, trxAddr, solBal.data, trxBal.data, solTok.data, trxTok.data, nets.sol, nets.trx, extra.join(','), homeEthBal.data, evmBal.data, evmOn.join(','), cfg.allowMainnet, tokenList.map((t) => t.contract).join(',')],
  );
}
