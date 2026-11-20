// Saves which tutorials have been shown, and tells a screen whether to show one now.

import { useCallback, useEffect, useState } from 'react';
import { getItem, setItem } from './kv';
import { SEEN_KEY, hasSeen, parseSeen, serializeSeen, withSeen, type TutorialId } from './tutorial-core';

async function readSeen() {
  try {
    return parseSeen(await getItem(SEEN_KEY));
  } catch {
    return [];
  }
}

async function markSeen(id: TutorialId) {
  try {
    await setItem(SEEN_KEY, serializeSeen(withSeen(await readSeen(), id)));
  } catch {
    /* storage failed: it may show again next time, which is harmless */
  }
}

/**
 * For one feature screen. `open` turns true the first time the screen is opened (and stays closed ever after);
 * `replay()` opens it again from a "How it works" link. Closing, finishing or skipping all count as seen.
 */
export function useTutorial(id: TutorialId) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    readSeen().then((seen) => {
      if (live && !hasSeen(seen, id)) setOpen(true);
    });
    return () => {
      live = false;
    };
  }, [id]);
  const close = useCallback(() => {
    setOpen(false);
    void markSeen(id);
  }, [id]);
  const replay = useCallback(() => setOpen(true), []);
  return { open, close, replay };
}
