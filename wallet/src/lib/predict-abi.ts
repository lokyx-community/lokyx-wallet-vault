// What the wallet needs to know about the deployed prediction market: where it is, and its interface.
// Pure data, so it can be checked offline. The deployed contract is PredictionMarket.sol with the fee fixed at deploy.

export type PredictNet = 'bnb-testnet';

export interface Deployment {
  label: string;
  chainId: number;
  rpc: string;
  explorer: string;
  /** the prediction market contract */
  market: `0x${string}`;
  /** the dollar token that backs it, and how it is shown */
  token: `0x${string}`;
  symbol: string;
  decimals: number;
  /** fixed on the contract at deploy; shown on the buy sheet and the receipt */
  feeBps: number;
  feeCollector: `0x${string}`;
  /** the first block to read `Traded` logs from, so history reads never start at block 0 */
  fromBlock: bigint;
  /** a play token anyone can mint to themselves, for trying it out. Real money networks have none. */
  playToken: boolean;
}

export const DEPLOYMENTS: Record<PredictNet, Deployment> = {
  'bnb-testnet': {
    label: 'BNB Chain testnet',
    chainId: 97,
    rpc: 'https://bsc-testnet-rpc.publicnode.com',
    explorer: 'https://testnet.bscscan.com',
    market: '0xDbAF63626698BbAE2d7B62190126E581E621772a',
    token: '0xE6E5Dc56D0EE9aAF4d06ebE5d44597767f0a0528',
    symbol: 'USDT',
    decimals: 18,
    feeBps: 100,
    feeCollector: '0x8de40f0FAa1Ac6EeeA157ACFd90F1b1aFAf5F3Ae',
    // unknown until the first read; the glue narrows it from the market's `Created` event and keeps it
    fromBlock: 0n,
    playToken: true,
  },
};

const u = (name: string) => ({ name, type: 'uint256' });

export const PREDICT_ABI = [
  { type: 'function', name: 'token', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'feeBps', stateMutability: 'view', inputs: [], outputs: [u('')] },
  { type: 'function', name: 'feeCollector', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'count', stateMutability: 'view', inputs: [], outputs: [u('')] },
  { type: 'function', name: 'free', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [u('')] },
  { type: 'function', name: 'yesOf', stateMutability: 'view', inputs: [u('id'), { name: 'who', type: 'address' }], outputs: [{ name: '', type: 'uint64' }] },
  { type: 'function', name: 'noOf', stateMutability: 'view', inputs: [u('id'), { name: 'who', type: 'address' }], outputs: [{ name: '', type: 'uint64' }] },
  {
    type: 'function', name: 'info', stateMutability: 'view', inputs: [u('id')],
    outputs: [
      { name: 'title', type: 'string' }, { name: 'creator', type: 'address' }, { name: 'close', type: 'uint64' },
      u('unit'), { name: 'state', type: 'uint8' }, { name: 'supply', type: 'uint64' }, u('pool'),
      { name: 'panel', type: 'address[]' }, { name: 'votes', type: 'uint8[]' },
    ],
  },
  {
    type: 'function', name: 'resolution', stateMutability: 'view', inputs: [u('id')],
    outputs: [
      { name: 'proposed', type: 'uint8' }, { name: 'proposer', type: 'address' }, { name: 'proposedAt', type: 'uint64' },
      { name: 'disputer', type: 'address' }, { name: 'disputedAt', type: 'uint64' }, u('bond'), u('bonds'),
    ],
  },
  {
    type: 'function', name: 'book', stateMutability: 'view', inputs: [u('id')],
    outputs: [
      { name: 'ids', type: 'uint64[]' }, { name: 'owners', type: 'address[]' }, { name: 'outcomes', type: 'uint8[]' },
      { name: 'sides', type: 'uint8[]' }, { name: 'prices', type: 'uint8[]' }, { name: 'qtys', type: 'uint64[]' },
    ],
  },
  { type: 'function', name: 'answerFees', stateMutability: 'view', inputs: [u('id')], outputs: [u('')] },
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [u('amount')], outputs: [] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [u('amount')], outputs: [] },
  {
    type: 'function', name: 'create', stateMutability: 'nonpayable',
    inputs: [{ name: 'title', type: 'string' }, { name: 'close', type: 'uint64' }, u('unit'), { name: 'panel', type: 'address[]' }],
    outputs: [u('id')],
  },
  {
    type: 'function', name: 'place', stateMutability: 'nonpayable',
    inputs: [u('id'), { name: 'outcome', type: 'uint8' }, { name: 'side', type: 'uint8' }, { name: 'price', type: 'uint8' }, { name: 'qty', type: 'uint64' }],
    outputs: [{ name: '', type: 'uint64' }],
  },
  { type: 'function', name: 'cancel', stateMutability: 'nonpayable', inputs: [u('id'), { name: 'orderId', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'propose', stateMutability: 'nonpayable', inputs: [u('id'), { name: 'outcome', type: 'uint8' }], outputs: [] },
  { type: 'function', name: 'dispute', stateMutability: 'nonpayable', inputs: [u('id')], outputs: [] },
  { type: 'function', name: 'finalize', stateMutability: 'nonpayable', inputs: [u('id')], outputs: [] },
  { type: 'function', name: 'expire', stateMutability: 'nonpayable', inputs: [u('id')], outputs: [] },
  { type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [u('id')], outputs: [u('pay')] },
  {
    type: 'event', name: 'Traded',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true }, { name: 'price', type: 'uint8', indexed: false },
      { name: 'qty', type: 'uint64', indexed: false }, { name: 'taker', type: 'address', indexed: true },
      { name: 'maker', type: 'address', indexed: true }, { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Created',
    inputs: [{ name: 'id', type: 'uint256', indexed: true }, { name: 'creator', type: 'address', indexed: true }, { name: 'close', type: 'uint64', indexed: false }],
  },
] as const;

/** The play token: the two calls a first-time user needs. */
export const PLAY_TOKEN_ABI = [
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'who', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;
