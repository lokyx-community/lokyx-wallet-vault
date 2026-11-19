// Bookmarks for the in-app browser: three that always exist, plus the ones you star.
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { siteUrl } from './rpc';

export interface Bookmark {
  title: string;
  url: string;
  fixed?: boolean;
}

const KEY = 'browser.bookmarks';
export const userBookmarks = store<Bookmark[]>([]);

export async function loadBookmarks() {
  try {
    const raw = await getItem(KEY);
    userBookmarks.set(raw ? (JSON.parse(raw) as Bookmark[]).filter((b) => typeof b.url === 'string' && /^https:\/\//.test(b.url)) : []);
  } catch {
    userBookmarks.set([]);
  }
}

export const fixedBookmarks = (): Bookmark[] => [
  { title: 'LOKYX', url: 'https://lokyx.xyz', fixed: true },
  { title: 'Explorer', url: `${siteUrl()}/#/explorer`, fixed: true },
];

const same = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
export const isBookmarked = (url: string) => [...fixedBookmarks(), ...userBookmarks.get()].some((b) => same(b.url, url));

/** Stars or un-stars a page. Only https pages can be kept. The fixed three can't be removed. */
export async function toggleBookmark(url: string, title: string) {
  if (!/^https:\/\//.test(url) || fixedBookmarks().some((b) => same(b.url, url))) return;
  const list = userBookmarks.get();
  const next = list.some((b) => same(b.url, url)) ? list.filter((b) => !same(b.url, url)) : [...list, { title: title.slice(0, 40) || url, url }].slice(-30);
  userBookmarks.set(next);
  await setItem(KEY, JSON.stringify(next));
}

export function useBookmarks(): Bookmark[] {
  const mine = useStore(userBookmarks);
  return [...fixedBookmarks(), ...mine];
}
