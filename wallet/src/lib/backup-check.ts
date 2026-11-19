import { useEffect, useState } from 'react';
import { getItem, setItem } from './kv';
import { checkDue } from './backup-check-core';
import { inDecoy } from './wallet';

const KEY = 'w.backup.ok';

export async function markBackupChecked(): Promise<void> {
  await setItem(KEY, String(Date.now()));
}

/** True when it's time to ask the person to prove their words still work. Never in the decoy wallet. */
export function useBackupDue(): boolean {
  const [due, setDue] = useState(false);
  useEffect(() => {
    void (async () => {
      if (inDecoy()) return setDue(false);
      const v = Number(await getItem(KEY));
      setDue(checkDue(Number.isFinite(v) && v > 0 ? v : undefined, Date.now()));
    })();
  }, []);
  return due;
}
