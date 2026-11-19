// Notes in time capsules are locked with time-based encryption (drand "quicknet").
//
// drand is a public randomness network run by many independent groups. Every 3 seconds they
// jointly publish a signature for that moment, and a note encrypted "to" a future moment can
// only be decrypted with that moment's signature. Until the opening day comes, nobody can
// read the note: not someone reading the chain, not the person it's for, not the sender.

import { Buffer, timelockDecrypt, timelockEncrypt, type ChainClient, type ChainInfo } from 'tlock-js';

export const QUICKNET: ChainInfo = {
  public_key: '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  period: 3,
  genesis_time: 1692803367,
  hash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  groupHash: 'f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e',
  schemeID: 'bls-unchained-g1-rfc9380',
  metadata: { beaconID: 'quicknet' },
};

const RELAYS = ['https://api.drand.sh', 'https://api2.drand.sh', 'https://api3.drand.sh', 'https://drand.cloudflare.com'];
const PREFIX = 'tlock1:';

type Beacon = { round: number; randomness: string; signature: string };
export type BeaconSource = (round: number) => Promise<Beacon>;

async function fromRelays(info: ChainInfo, round: number): Promise<Beacon> {
  let last: unknown;
  for (const r of RELAYS) {
    try {
      const res = await fetch(`${r}/${info.hash}/public/${round}`);
      if (res.ok) return (await res.json()) as Beacon;
      last = new Error(`${res.status}`);
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`Can't reach the time network right now (${String((last as Error)?.message ?? last)})`);
}

function client(info: ChainInfo, source?: BeaconSource): ChainClient {
  const get = (round: number) => (source ? source(round) : fromRelays(info, round));
  return {
    options: { disableBeaconVerification: true, noCache: true },
    chain: () => ({ baseUrl: RELAYS[0], info: async () => info }),
    get,
    latest: () => get(Math.floor((Date.now() / 1000 - info.genesis_time) / info.period) + 1),
  } as unknown as ChainClient;
}

/** The first round published at or after `unix`, so the note can't be read even a moment early. */
export const roundFor = (unix: number, info = QUICKNET) => Math.max(1, Math.ceil((unix - info.genesis_time) / info.period) + 1);

export async function lockNote(note: string, opens: number, info = QUICKNET): Promise<string> {
  if (!note) return '';
  const armored = await timelockEncrypt(roundFor(opens, info), Buffer.from(note, 'utf8'), client(info));
  return PREFIX + armored;
}

export const isLocked = (text: string) => text.startsWith(PREFIX);

/** The note as written. A plain note (made before notes were locked) comes back as is. */
export async function unlockNote(text: string, info = QUICKNET, source?: BeaconSource): Promise<string> {
  if (!isLocked(text)) return text;
  const out = await timelockDecrypt(text.slice(PREFIX.length), client(info, source));
  return out.toString('utf8');
}
