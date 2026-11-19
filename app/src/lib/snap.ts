// MetaMask support through the LOKYX Snap (see /snap). MetaMask keeps the key; the app asks the
// Snap for the lyx1 address and for signatures, and MetaMask shows its own confirmation.

const isLocal = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);

/** `local:` while developing against `npm run serve` in /snap; the published npm package otherwise. */
export const SNAP_ID: string = import.meta.env.VITE_SNAP_ID || (isLocal ? 'local:http://localhost:8080' : 'npm:lokyx-snap');

interface Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

function provider(): Provider | null {
  const w = window as unknown as { ethereum?: Provider };
  return w.ethereum ?? null;
}

export const hasMetaMask = () => provider() !== null;

export class SnapError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

async function call<T>(method: string, params?: unknown): Promise<T> {
  const p = provider();
  if (!p) throw new SnapError('MetaMask isn\'t installed in this browser.');
  try {
    return (await p.request({ method, params })) as T;
  } catch (e) {
    const err = e as { message?: string; code?: number };
    throw new SnapError(err.message ?? 'MetaMask returned an error', err.code);
  }
}

async function invoke<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return call<T>('wallet_invokeSnap', { snapId: SNAP_ID, request: { method, params } });
}

/** True for MetaMask Flask, the developer build that can install Snaps not yet in MetaMask's directory. */
export async function isFlask(): Promise<boolean> {
  try {
    return (await call<string>('web3_clientVersion')).toLowerCase().includes('flask');
  } catch {
    return false;
  }
}

/** Install (if needed) and connect the Snap, then return the lyx1 address it controls. */
export async function connectSnap(): Promise<string> {
  try {
    await call('wallet_requestSnaps', { [SNAP_ID]: {} });
  } catch (e) {
    const err = e as SnapError;
    if (err.code === 4001) throw new SnapError('You declined the connection in MetaMask.', 4001);
    if (!(await isFlask())) {
      throw new SnapError(
        'This version of MetaMask only installs Snaps listed in its directory, and the LOKYX Snap is still waiting for approval. Use MetaMask Flask for now.',
        err.code,
      );
    }
    throw err;
  }
  return (await invoke<{ address: string }>('lyx_getAddress')).address;
}

/** The connected address, or null if the Snap isn't installed for this site. */
export async function connectedAddress(): Promise<string | null> {
  if (!hasMetaMask()) return null;
  try {
    const snaps = await call<Record<string, unknown>>('wallet_getSnaps');
    if (!snaps || !snaps[SNAP_ID]) return null;
    return (await invoke<{ address: string }>('lyx_getAddress')).address;
  } catch {
    return null;
  }
}

export interface SnapSigned {
  from: string;
  tx: string;
  hash: string;
}

/** Ask MetaMask to show the transfer and sign it. Rejects with code 4001 if the user cancels. */
export function signWithSnap(t: { chainId: number; nonce: number; to: string; value: bigint; fee: bigint }): Promise<SnapSigned> {
  return invoke<SnapSigned>('lyx_signTransfer', {
    chainId: String(t.chainId),
    nonce: String(t.nonce),
    to: t.to,
    value: t.value.toString(),
    fee: t.fee.toString(),
  });
}
