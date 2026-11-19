import type { Json, OnRpcRequestHandler } from '@metamask/snaps-sdk';
import { InvalidParamsError, MethodNotFoundError, UserRejectedRequestError } from '@metamask/snaps-sdk';
import { Box, Copyable, Divider, Heading, Row, Text } from '@metamask/snaps-sdk/jsx';
import { getBIP44AddressKeyDeriver } from '@metamask/key-tree';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  COIN_TYPE, MAX_MEMO_BYTES, NETWORKS, addressFromPrivateKey, addressToBytes, formatLyx, minTransferFee, signTransfer,
} from './lokyx';

/**
 * Key for m/44'/7701'/0'/0/index, the same path the LOKYX wallets use, so a MetaMask recovery
 * phrase gives the same lyx1 addresses as entering it into the LOKYX wallet.
 */
async function keyAt(index: number): Promise<Uint8Array> {
  const node = await snap.request({ method: 'snap_getBip44Entropy', params: { coinType: COIN_TYPE } });
  const derive = await getBIP44AddressKeyDeriver(node);
  const child = await derive(index);
  if (!child.privateKey) throw new Error('Could not derive key');
  return hexToBytes(child.privateKey.slice(2));
}

function indexParam(p: Record<string, unknown>): number {
  const i = p.index ?? 0;
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i > 1000) throw new InvalidParamsError('index must be 0-1000');
  return i;
}

function bigParam(p: Record<string, unknown>, k: string): bigint {
  const v = p[k];
  if (typeof v !== 'string' || !/^\d{1,40}$/.test(v)) throw new InvalidParamsError(`${k} must be a decimal string`);
  return BigInt(v);
}

export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  const p = (request.params ?? {}) as Record<string, unknown>;

  switch (request.method) {
    case 'lyx_getAddress': {
      const sk = await keyAt(indexParam(p));
      const address = addressFromPrivateKey(sk);
      sk.fill(0);
      return { address } as Json;
    }

    case 'lyx_signTransfer': {
      const index = indexParam(p);
      const chainId = bigParam(p, 'chainId');
      const network = NETWORKS[chainId.toString()];
      if (!network) throw new InvalidParamsError(`Unknown LOKYX network ${chainId}`);
      const nonce = bigParam(p, 'nonce');
      const value = bigParam(p, 'value');
      const fee = bigParam(p, 'fee');
      const expires = p.expires === undefined ? 0n : bigParam(p, 'expires');
      let memo = new Uint8Array();
      if (p.memo !== undefined) {
        if (typeof p.memo !== 'string' || !/^([0-9a-f]{2}){0,64}$/i.test(p.memo) || p.memo.length / 2 > MAX_MEMO_BYTES) {
          throw new InvalidParamsError(`memo must be hex, at most ${MAX_MEMO_BYTES} bytes`);
        }
        memo = hexToBytes(p.memo);
      }
      const to = typeof p.to === 'string' ? p.to.trim().toLowerCase() : '';
      try {
        addressToBytes(to);
      } catch {
        throw new InvalidParamsError('to must be a valid lyx1 address');
      }
      if (value === 0n) throw new InvalidParamsError('Amount must be more than zero');

      const sk = await keyAt(index);
      const from = addressFromPrivateKey(sk);
      const transfer = { chainId, nonce, to, value, fee, expires, memo };
      if (fee < minTransferFee(transfer, from)) {
        sk.fill(0);
        throw new InvalidParamsError('Fee is below the network minimum');
      }
      const approved = await snap.request({
        method: 'snap_dialog',
        params: {
          type: 'confirmation',
          content: (
            <Box>
              <Heading>Send {formatLyx(value)} LYX</Heading>
              <Text>{origin} wants you to sign a transfer on LOKYX {network}.</Text>
              <Divider />
              <Row label="From"><Text>{from}</Text></Row>
              <Row label="To"><Text>{to}</Text></Row>
              <Row label="Amount"><Text>{formatLyx(value)} LYX</Text></Row>
              <Row label="Network fee"><Text>{formatLyx(fee)} LYX</Text></Row>
              <Row label="Total"><Text>{formatLyx(value + fee)} LYX</Text></Row>
              <Row label="Valid until"><Text>{expires === 0n ? 'no deadline' : `block ${expires}`}</Text></Row>
              {memo.length > 0 ? <Row label="Memo (hex)"><Text>{bytesToHex(memo)}</Text></Row> : null}
              <Divider />
              <Text>Check the recipient carefully. LOKYX transfers can't be reversed.</Text>
              <Copyable value={to} />
            </Box>
          ),
        },
      });
      if (approved !== true) {
        sk.fill(0);
        throw new UserRejectedRequestError();
      }
      const signed = signTransfer(transfer, sk);
      sk.fill(0);
      return { from, tx: signed.tx, hash: signed.hash } as Json;
    }

    default:
      throw new MethodNotFoundError();
  }
};
