// What the wallet always knows about the coins it supports, with no internet and no price feed: a plain sentence or two and the
// official links. Written for LOKYX, so it never goes blank when the feed is busy or does not list a coin. Pure, tested.
import type { CoinInfo } from './coininfo-core';

export interface CoinFacts {
  about: string;
  links: { label: string; url: string }[];
}

/** By the price feed's coin id, plus `lyx` for the wallet's own coin. */
export const FACTS: Record<string, CoinFacts> = {
  bitcoin: {
    about: 'Bitcoin is digital money that no bank or company runs. Everyone who takes part keeps the same public record of payments, and only 21 million coins will ever exist.',
    links: [{ label: 'Website', url: 'https://bitcoin.org' }, { label: 'Whitepaper', url: 'https://bitcoin.org/bitcoin.pdf' }, { label: 'Explorer', url: 'https://mempool.space' }],
  },
  ethereum: {
    about: 'Ethereum is a network where people send money and also run small programs called smart contracts. Its coin, ether (ETH), pays the fee for using it.',
    links: [{ label: 'Website', url: 'https://ethereum.org' }, { label: 'Whitepaper', url: 'https://ethereum.org/en/whitepaper/' }, { label: 'Explorer', url: 'https://etherscan.io' }],
  },
  solana: {
    about: 'Solana is a fast network for payments and apps, with very small fees. SOL pays those fees and is also locked up (staked) by the people who help run the network.',
    links: [{ label: 'Website', url: 'https://solana.com' }, { label: 'Explorer', url: 'https://solscan.io' }],
  },
  tron: {
    about: 'TRON is a network best known for moving stablecoins such as USDT cheaply. TRX is its coin and pays for using the network.',
    links: [{ label: 'Website', url: 'https://tron.network' }, { label: 'Explorer', url: 'https://tronscan.org' }],
  },
  'polygon-ecosystem-token': {
    about: 'POL is the coin of Polygon, a family of networks built to make Ethereum cheaper and quicker to use.',
    links: [{ label: 'Website', url: 'https://polygon.technology' }, { label: 'Explorer', url: 'https://polygonscan.com' }],
  },
  binancecoin: {
    about: 'BNB is the coin of BNB Chain, a network started by the Binance exchange. It pays the fees on that network.',
    links: [{ label: 'Website', url: 'https://www.bnbchain.org' }, { label: 'Explorer', url: 'https://bscscan.com' }],
  },
  'avalanche-2': {
    about: 'AVAX is the coin of Avalanche, a network where apps can launch chains of their own. It pays fees and is staked to keep the network honest.',
    links: [{ label: 'Website', url: 'https://www.avax.network' }, { label: 'Explorer', url: 'https://snowtrace.io' }],
  },
  tether: {
    about: 'Tether (USDT) is a stablecoin meant to stay worth one US dollar. The company Tether issues it and says reserves back it, so you are trusting that company to honour it.',
    links: [{ label: 'Website', url: 'https://tether.to' }],
  },
  'usd-coin': {
    about: 'USD Coin (USDC) is a stablecoin meant to stay worth one US dollar. Circle issues it, so its value rests on Circle holding the dollars it says it holds.',
    links: [{ label: 'Website', url: 'https://www.circle.com/usdc' }],
  },
  dai: {
    about: 'Dai is a stablecoin meant to stay near one US dollar. It is made by locking other assets away as collateral in smart contracts, not by one company holding dollars.',
    links: [{ label: 'Website', url: 'https://sky.money' }],
  },
  'wrapped-bitcoin': {
    about: 'Wrapped Bitcoin (WBTC) is a token on Ethereum meant to be worth one bitcoin, so bitcoin can be used in Ethereum apps. A custodian holds the real bitcoin behind it.',
    links: [{ label: 'Website', url: 'https://wbtc.network' }],
  },
  lyx: {
    about: "LOKYX is this wallet's own test coin, on its own test chain. It is for trying the wallet and has no market price.",
    links: [],
  },
};

export const factsFor = (id: string | undefined): CoinFacts | null => (id ? FACTS[id] ?? null : null);

/** The live page's text and links when it has them, otherwise what is built in. */
export function aboutFrom(info: CoinInfo | null, facts: CoinFacts | null): CoinFacts {
  return {
    about: info?.about || facts?.about || '',
    links: info?.links?.length ? info.links : facts?.links ?? [],
  };
}
