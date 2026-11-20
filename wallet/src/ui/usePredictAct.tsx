import { useCallback, useRef, useState, type ReactElement } from 'react';
import { Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ProblemSheet } from './ProblemSheet';
import { toast } from './Toast';
import { confirmIt } from '../lib/auth';
import { faucetFor, problemFrom, type OptionId, type Problem } from '../lib/problem-core';
import { deployment, myAddress, waitFor } from '../lib/predict';

/**
 * Does one thing on the market contract the safe way: asks the phone to confirm, sends, waits for the network, and if
 * it goes wrong shows the choices sheet instead of a line of red text. `steps` sends and returns the transaction id
 * of the last send (it may send more than one, waiting in between with `waitFor`).
 */
export function usePredictAct(after: () => void): { run: (reason: string, steps: () => Promise<string | void>, done: string) => Promise<boolean>; busy: string; sheet: ReactElement } {
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const last = useRef<(() => Promise<boolean>) | null>(null);

  const run = useCallback(
    async (reason: string, steps: () => Promise<string | void>, done: string) => {
      const go = async (): Promise<boolean> => {
        setBusy(reason);
        try {
          const hash = await steps();
          if (hash) {
            const r = await waitFor(hash, await myAddress());
            if (!r.mined) throw new Error('The network is slow. Check again in a minute.');
            if (!r.ok) throw new Error('The network refused it: nothing changed.');
          }
          toast(done, 'check');
          after();
          return true;
        } catch (e) {
          setProblem(problemFrom(e, { where: deployment().label, symbol: 'BNB' }));
          return false;
        } finally {
          setBusy('');
        }
      };
      if (!(await confirmIt(reason, { keyFollows: true }))) return false;
      last.current = go;
      return go();
    },
    [after],
  );

  const pick = async (id: OptionId) => {
    const was = problem;
    setProblem(null);
    if (id === 'retry' || id === 'check-again') await last.current?.();
    else if (id === 'faucet') {
      const url = faucetFor(deployment().label);
      if (url) Linking.openURL(url).catch(() => {});
    } else if (id === 'copy-address') {
      await Clipboard.setStringAsync(await myAddress());
      toast('Address copied', 'copy');
    } else if (id === 'copy-details' && was) {
      await Clipboard.setStringAsync(was.details);
      toast('Details copied', 'copy');
    }
  };

  return { run, busy, sheet: <ProblemSheet problem={problem} onPick={pick} onClose={() => setProblem(null)} /> };
}
