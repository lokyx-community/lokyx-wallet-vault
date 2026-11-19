// The swap offer board (contracts/board): makers post their offer code, takers post an acceptance code
// under it, the maker picks one up. It only matches people: every code is checked by the same rules as a
// pasted one (swaps.ts), and no coins ever touch the board.

import { rpc, type ChainInfo } from './rpc';
import { currentAddress } from './wallet';
import { boardPosts } from './data';
import { swapSettings, readOffer, swapId, sw, updateSwapSettings } from './swaps';
import { keccak256, toHex } from 'viem';
import { callMethod, deploy, view, KINDS } from './wcontracts';
import { isAddress } from './lokyx';
import { resolveDeploy } from './data';

/** The board everyone on the public testnet uses. Set once it is deployed; until then a phone can make its own. */
export const BOARD_DEFAULT = '';
export const boardAddress = () => swapSettings.get().board || BOARD_DEFAULT;

export interface BoardOffer {
  id: number;
  maker: string;
  code: string;
  expires: number;
  answers: number;
  offer: sw.Offer;
}

/** Open offers, newest first, that read as valid swap offers for this chain. Your own are left out. */
export async function openOffers(board: string, max = 30): Promise<BoardOffer[]> {
  const count = Number(await view<number>(board, 'count'));
  const me = currentAddress();
  const ids = Array.from({ length: Math.min(max, count) }, (_, i) => count - 1 - i);
  const rows = await Promise.all(
    ids.map(async (id) => {
      try {
        const [maker, code, expires, open, answers] = await view<[string, string, number, boolean, number]>(board, 'offer', [id]);
        if (!open || maker === me) return null;
        const offer = await readOffer(code, me);
        return { id, maker, code, expires: Number(expires), answers: Number(answers), offer } as BoardOffer;
      } catch {
        return null; // damaged, for another chain, or otherwise not a usable offer
      }
    }),
  );
  return rows.filter((r): r is BoardOffer => !!r);
}

/** Post one of your offers. It stays up as long as its LOKYX lock would. */
export async function postOffer(r: sw.SwapRecord) {
  const board = boardAddress();
  if (!board) throw new Error('There is no offer board set up yet');
  const info = await rpc<ChainInfo>('lyx_chainInfo');
  const expires = info.height + Math.max(60, r.offer.lyxBlocks);
  const tx = await callMethod(board, 'post', [sw.offerCode(r.offer), expires]);
  await boardPosts.save((x) => [{ id: -1, tx, swap: swapId(r), at: Date.now() }, ...x]);
}

/** Once a post is mined, find its id on the board (newest first, matching your code). */
async function resolvePost(board: string, swap: string, code: string): Promise<number | null> {
  const count = Number(await view<number>(board, 'count'));
  const me = currentAddress();
  for (let id = count - 1; id >= Math.max(0, count - 50); id--) {
    const [maker, c] = await view<[string, string, number, boolean, number]>(board, 'offer', [id]);
    if (maker === me && c === code) {
      await boardPosts.save((x) => x.map((p) => (p.swap === swap ? { ...p, id } : p)));
      return id;
    }
  }
  return null;
}

/** Acceptance codes posted under your offer, oldest first. */
export async function answersFor(r: sw.SwapRecord): Promise<{ taker: string; code: string }[]> {
  const board = boardAddress();
  const post = boardPosts.get().find((p) => p.swap === swapId(r));
  if (!board || !post) return [];
  const id = post.id >= 0 ? post.id : await resolvePost(board, post.swap, sw.offerCode(r.offer));
  if (id == null) return [];
  const [, , , , n] = await view<[string, string, number, boolean, number]>(board, 'offer', [id]);
  return Promise.all(Array.from({ length: Number(n) }, (_, i) => view<[string, string]>(board, 'answer_at', [id, i]).then(([taker, code]) => ({ taker, code }))));
}

export const isPosted = (r: sw.SwapRecord) => boardPosts.get().some((p) => p.swap === swapId(r));

/** After you picked an answer: take the offer down so nobody else answers it. */
export async function closePost(r: sw.SwapRecord) {
  const post = boardPosts.get().find((p) => p.swap === swapId(r));
  if (!post || post.id < 0) return;
  await callMethod(boardAddress(), 'close', [post.id]);
}

/** A taker's answer, posted under the offer they accepted. */
export const answerOffer = (id: number, acceptCode: string) => callMethod(boardAddress(), 'answer', [id, acceptCode]);

/**
 * Make a board (for a test network without one). The deploy hash is saved, so the board is picked up when
 * it is mined even if you leave the screen or close the app.
 */
export async function makeBoard(): Promise<string> {
  const h = await deploy('board', [], 0n, 'Offer board');
  await updateSwapSettings({ boardPending: h });
  return h;
}

/** A board being made: becomes the board once mined. Returns what happened, for a message. */
export async function settleBoard(): Promise<'ready' | 'failed' | 'waiting' | 'none'> {
  const h = swapSettings.get().boardPending;
  if (!h) return 'none';
  const a = await resolveDeploy(h);
  if (a === null) return 'waiting';
  if (a === '') {
    await updateSwapSettings({ boardPending: undefined });
    return 'failed';
  }
  await updateSwapSettings({ board: a, boardPending: undefined });
  return 'ready';
}

const BOARD_CODE_HASH = keccak256(toHex(KINDS.board.code)).toLowerCase();

/** Is this address an offer board (the same code as the app's own), and not some other contract? */
export async function checkBoard(addr: string): Promise<boolean> {
  if (!isAddress(addr)) return false;
  try {
    const c = await rpc<{ codeHash: string }>('lyx_getContract', { address: addr });
    return (c.codeHash.startsWith('0x') ? c.codeHash : `0x${c.codeHash}`).toLowerCase() === BOARD_CODE_HASH;
  } catch {
    return false;
  }
}

/** What a board's share code says: `lokyx-board:lyx1…`. */
export const boardLink = (addr: string) => `lokyx-board:${addr}`;
export function parseBoardLink(text: string): string | null {
  const m = text.trim().match(/^lokyx-board:(lyx1[02-9ac-hj-np-z]{20,90})$/i);
  return m && isAddress(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
}
export { resolveDeploy };
