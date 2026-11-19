import { useState } from 'react';
import { motion } from 'motion/react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useChain } from '../state';
import { AddressLink, Ago, Copy, Icon, KV, NodeError, Skeleton } from '../ui';
import { BlockGlyph, Seal, Signet } from '../visuals';
import { formatLyx, isAddress, shortHash } from '../lib/lokyx';
import { rpc, usePoll, type BlockInfo, type History, type Account, type Supply, type TxInfo } from '../lib/rpc';
import { TxTrack, TARGET_CONFIRMATIONS } from './Wallet';

export function Search() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const go = async () => {
    setMsg('');
    if (!q.trim()) return;
    try {
      const r = await rpc<{ type: string; address?: string; height?: number; hash?: string }>('lyx_search', { q: q.trim() });
      if (r.type === 'address') nav(`/address/${r.address}`);
      else if (r.type === 'block') nav(`/block/${r.height}`);
      else if (r.type === 'transaction') nav(`/tx/${r.hash}`);
      else setMsg('Nothing on this chain matches. Try a block height, a hash, or a lyx1 address.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <form onSubmit={(e) => { e.preventDefault(); go(); }} className="input-adorn">
        <input className="input" placeholder="Search by block, transaction or address" value={q} spellCheck={false} onChange={(e) => setQ(e.target.value)} aria-label="Search the chain" style={{ paddingRight: 110, height: 56, fontSize: 17 }} />
        <button className="adorn btn primary" type="submit" style={{ height: 40 }}>Search</button>
      </form>
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}

export default function Explorer() {
  const { info, error } = useChain();
  const [from, setFrom] = useState<number | null>(null);
  const blocks = usePoll<BlockInfo[]>('lyx_getBlocks', from === null ? { count: 25 } : { from, count: 25 }, 0, from === null ? info?.height : from);
  const mempool = usePoll<{ size: number; transactions: TxInfo[] }>('lyx_getMempool', {}, 3000);

  return (
    <>
      <div className="page-head" style={{ display: 'block' }}>
        <h1>Explorer</h1>
        <div style={{ marginTop: 28, maxWidth: 760 }}><Search /></div>
      </div>
      {error && !info && <NodeError error={error} />}

      <div className="split">
        <section>
          <div className="section-head">
            <h2>{from === null ? 'Latest blocks' : `From block ${from.toLocaleString()}`}</h2>
          </div>
          <div className="table">
            {!blocks.data && Array.from({ length: 6 }, (_, i) => <div className="tr" key={i}><Skeleton h={34} /></div>)}
            {(blocks.data ?? []).map((b) => (
              <Link to={`/block/${b.height}`} className="tr" key={b.hash} style={{ gridTemplateColumns: '40px minmax(0,1fr) auto' }}>
                <BlockGlyph hash={b.hash} size={34} />
                <span className="cell-main">
                  <span className="t">{b.height.toLocaleString()} <span className="mono faint hide-sm" style={{ fontWeight: 400, marginLeft: 8 }}>{shortHash(b.hash, 8, 6)}</span></span>
                  <span className="s"><Ago ts={b.timestamp} />, {b.txCount} {b.txCount === 1 ? 'transaction' : 'transactions'}</span>
                </span>
                <span className="right">
                  <span className="num" style={{ display: 'block' }}>{b.rewardLyx} LYX</span>
                  <span className="faint num hide-sm" style={{ fontSize: 14 }}>difficulty {Number(b.difficulty).toLocaleString()}</span>
                </span>
              </Link>
            ))}
          </div>
          <div className="inline" style={{ marginTop: 24 }}>
            {blocks.data && blocks.data.length > 0 && blocks.data[blocks.data.length - 1].height > 0 && (
              <button className="btn" onClick={() => setFrom(blocks.data![blocks.data!.length - 1].height - 1)}>Older blocks</button>
            )}
            {from !== null && <button className="btn quiet" onClick={() => setFrom(null)}>Back to latest</button>}
          </div>
        </section>

        <section>
          <div className="section-head"><h2>Waiting</h2><p>{mempool.data?.size ?? 0} in the mempool</p></div>
          {mempool.data && mempool.data.size === 0 && <p className="muted">Empty.</p>}
          <div className="table">
            {(mempool.data?.transactions ?? []).map((t) => (
              <Link to={`/tx/${t.hash}`} className="tr" key={t.hash} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <span className="cell-main">
                  <span className="t mono">{shortHash(t.hash, 10, 6)}</span>
                  <span className="s">To {shortHash(t.to, 10, 6)}</span>
                </span>
                <span className="num">{t.valueLyx} LYX</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

export function BlockPage() {
  const { id } = useParams();
  const { info } = useChain();
  const params = /^\d+$/.test(id!) ? { height: Number(id), fullTransactions: true } : { hash: id, fullTransactions: true };
  const b = usePoll<BlockInfo>('lyx_getBlock', params, 0, `${id}-${info?.height}`);
  if (b.error) return <><div className="page-head"><div><h1>Block not found</h1><p>There's no block with that height or hash on the chain.</p></div></div>{b.error.unreachable && <NodeError error={b.error} />}</>;
  if (!b.data) return <Skeleton h={80} />;
  const d = b.data;
  const txs = d.transactions as TxInfo[];
  return (
    <>
      <div className="page-head">
        <div className="identity">
          <motion.div initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 160, damping: 18 }}>
            <BlockGlyph hash={d.hash} size={88} />
          </motion.div>
          <div>
            <h1 className="num">Block {d.height.toLocaleString()}</h1>
            <p style={{ marginTop: 12, fontSize: 16 }}>
              {d.mainChain ? <span className="tag">{d.confirmations.toLocaleString()} confirmations</span> : <span className="tag">Not on the main chain</span>}
            </p>
          </div>
        </div>
        <div className="inline">
          {d.height > 0 && <Link className="btn" to={`/block/${d.height - 1}`}>Previous</Link>}
          {info && d.height < info.height && <Link className="btn" to={`/block/${d.height + 1}`}>Next</Link>}
        </div>
      </div>
      {d.message && (
        <motion.figure className="genesis-message" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <blockquote>{d.message}</blockquote>
          <figcaption>
            Block 0 has no block before it. Its parent hash is <span className="mono">keccak256("LOKYX/genesis/v1" + message)</span>,
            so every block on this chain descends from these words.
          </figcaption>
        </motion.figure>
      )}
      <div className="split">
        <KV
          items={[
            ['Hash', <Copy text={d.hash} display={shortHash(d.hash, 12, 10)} />],
            ['Mined', <><Ago ts={d.timestamp} /> <span className="faint">{new Date(d.timestamp * 1000).toLocaleString()}</span></>],
            ['Miner', d.height === 0 ? <span className="faint">Genesis, nobody</span> : <AddressLink address={d.miner} mark />],
            ['Reward', `${d.rewardLyx} LYX`],
            ['Fees', `${d.feesLyx} LYX`],
            ['Size', `${d.size.toLocaleString()} bytes`],
          ]}
        />
        <KV
          items={[
            ['Difficulty', <span className="num">{Number(d.difficulty).toLocaleString()}</span>],
            ['Total work so far', <span className="num">{d.cumulativeWork ? Number(d.cumulativeWork).toLocaleString() : '–'}</span>],
            ['Nonce', <span className="mono">{d.nonce}</span>],
            d.height === 0
              ? ['Parent (message hash)', <Copy text={d.prevHash} display={shortHash(d.prevHash, 10, 6)} />]
              : ['Previous block', <Link to={`/block/${d.prevHash}`} className="mono link">{shortHash(d.prevHash, 10, 6)}</Link>],
            ['Transactions root', <Copy text={d.txRoot} display={shortHash(d.txRoot, 10, 6)} />],
            ['State root', <Copy text={d.stateRoot} display={shortHash(d.stateRoot, 10, 6)} />],
          ]}
        />
      </div>
      <section className="section">
        <div className="section-head"><h2>{txs.length} {txs.length === 1 ? 'transaction' : 'transactions'}</h2></div>
        {txs.length === 0 && <p className="muted">This block only pays the miner's reward.</p>}
        <div className="table">
          {txs.map((t) => (
            <Link to={`/tx/${t.hash}`} className="tr" key={t.hash} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
              <span className="cell-main">
                <span className="t mono">{shortHash(t.hash, 12, 8)}</span>
                <span className="s">{shortHash(t.from, 10, 6)} to {shortHash(t.to, 10, 6)}</span>
              </span>
              <span className="num">{t.valueLyx} LYX</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

export function TxPage() {
  const { hash } = useParams();
  const { info } = useChain();
  const t = usePoll<TxInfo>('lyx_getTransaction', { hash }, 3000, info?.height);
  if (t.error && !t.data)
    return (
      <>
        <div className="page-head"><div><h1>Transaction not found</h1><p>The node doesn't have it, either waiting or on the main chain. If it was only just sent, give it a few seconds.</p></div></div>
        {t.error.unreachable && <NodeError error={t.error} />}
      </>
    );
  if (!t.data) return <Skeleton h={80} />;
  const d = t.data;
  const conf = d.confirmations ?? 0;
  const stage = d.status === 'confirmed' && conf >= TARGET_CONFIRMATIONS ? 'completed' : 'confirming';
  return (
    <>
      <div className="page-head">
        <div>
          <p className="faint" style={{ fontSize: 18, marginTop: 0, marginBottom: 8 }}>
            {d.contract?.kind === 'deploy' ? 'Contract deploy' : d.contract?.kind === 'call' ? 'Contract call' : 'Transfer'}
          </p>
          <h1 className={d.contract?.kind === 'call' ? 'mono' : 'num'}>
            {d.contract?.kind === 'call' ? `${d.contract.method ?? 'call'}()` : d.contract?.kind === 'deploy' ? `${d.contract.codeBytes.toLocaleString()} bytes` : `${d.valueLyx} LYX`}
          </h1>
        </div>
        <span className="tag">{d.status === 'confirmed' ? `${conf} confirmations` : 'Waiting for a block'}</span>
      </div>
      <div style={{ maxWidth: 760, marginBottom: 56 }}>
        <TxTrack stage={stage} tx={d} />
      </div>
      <div className="split">
        <KV
          items={[
            ['From', <AddressLink address={d.from} mark />],
            d.swap?.kind === 'lock'
              ? ['Swap lock for', <AddressLink address={d.swap.recipient} mark />]
              : d.swap
                ? [d.swap.kind === 'claim' ? 'Swap claim of' : 'Swap refund of', <Link to={`/tx/${d.swap.id}`} className="link mono">{shortHash(d.swap.id, 10, 6)}</Link>]
                : ['To', <AddressLink address={d.to} mark />],
            ...(d.swap?.kind === 'lock' ? [['Refundable from', `block ${d.swap.refundHeight.toLocaleString()}`] as [string, string]] : []),
            ...(d.swap?.kind === 'claim' ? [['Secret revealed', <Copy text={d.swap.secret} display={shortHash(d.swap.secret, 10, 6)} />] as [string, React.ReactNode]] : []),
            ...(d.contract?.kind === 'deploy'
              ? [['Contract', d.receipt?.contract ? <AddressLink address={d.receipt.contract} mark /> : d.contract.address ? <span className="mono">{shortHash(d.contract.address, 10, 6)}</span> : '?'] as [string, React.ReactNode]]
              : []),
            ['Amount', `${d.valueLyx} LYX`],
            ...(d.receipt
              ? [
                  ['Outcome', d.receipt.ok ? 'Worked' : `Failed: ${d.receipt.error}`] as [string, React.ReactNode],
                  ...(d.receipt.ok && d.receipt.result !== null && d.receipt.result !== undefined
                    ? [['Returned', <span className="mono">{JSON.stringify(d.receipt.result)}</span>] as [string, React.ReactNode]]
                    : []),
                  ...d.receipt.logs.map((l) => [l.event, <span className="mono" style={{ overflowWrap: 'anywhere' }}>{l.fields ? JSON.stringify(l.fields) : l.data}</span>] as [string, React.ReactNode]),
                  ['Gas used', <span className="num">{d.receipt.gasUsed.toLocaleString()} of {d.contract?.gasLimit.toLocaleString()}</span>] as [string, React.ReactNode],
                ]
              : d.contract
                ? [['Gas limit', <span className="num">{d.contract.gasLimit.toLocaleString()}</span>] as [string, React.ReactNode]]
                : []),
            ...(d.vault ? [['Vault', vaultText(d.vault)] as [string, React.ReactNode]] : []),
            ...(d.key ? [['Quantum backup key', <span className="mono">{shortHash(d.key.hash, 10, 6)}</span>] as [string, React.ReactNode]] : []),
            ['Fee', d.receipt ? `${d.receipt.feeLyx} LYX (unused gas refunded)` : d.contract ? `up to ${d.feeLyx} LYX` : `${d.feeLyx} LYX`],
          ]}
        />
        <KV
          items={[
            ['Hash', <Copy text={d.hash} display={shortHash(d.hash, 12, 8)} />],
            ['Block', d.blockHeight !== undefined ? <Link to={`/block/${d.blockHeight}`} className="link num">{d.blockHeight.toLocaleString()}</Link> : 'Not yet'],
            ['Sender nonce', <span className="num">{d.nonce}</span>],
            ['Size', `${d.size} bytes`],
          ]}
        />
      </div>
    </>
  );
}

export function AddressPage() {
  const { addr } = useParams();
  const { info } = useChain();
  const valid = isAddress(addr ?? '');
  const acct = usePoll<Account>('lyx_getAccount', valid ? { address: addr } : null, 0, info?.height);
  const [before, setBefore] = useState<number | null>(null);
  const hist = usePoll<History>('lyx_getAddressHistory', valid ? { address: addr, limit: 25, ...(before ? { before } : {}) } : null, 0, `${info?.height}-${before}`);
  if (!valid)
    return <div className="page-head"><div><h1>Not a LOKYX address</h1><p>Addresses start with lyx1 and carry a checksum. This one doesn't pass it.</p></div></div>;
  return (
    <>
      <div className="page-head">
        <div className="identity">
          <Signet of={addr!.toLowerCase()} size={80} assemble />
          <div style={{ minWidth: 0 }}>
            <p className="faint" style={{ fontSize: 16, margin: '0 0 6px' }}>Address</p>
            <Copy text={addr!} display={shortHash(addr!, 14, 8)} />
          </div>
        </div>
      </div>
      {acct.error && <NodeError error={acct.error} />}
      {acct.data?.contract && (
        <div className="notice" style={{ maxWidth: 760, marginBottom: 32 }}>
          <Icon.contracts />
          <p>
            <strong>This is a contract{acct.data.contract.abi?.name ? `: ${acct.data.contract.abi.name}` : ''}.</strong>{' '}
            Deployed by <AddressLink address={acct.data.contract.creator} /> in block {acct.data.contract.height.toLocaleString()}, {acct.data.contract.codeBytes.toLocaleString()} bytes of code.{' '}
            <Link className="link" to={`/contracts?address=${addr}`}>Read or use it</Link>
          </p>
        </div>
      )}
      {acct.data && (
        <dl className="stats primary">
          <div><dt>Balance</dt><dd>{formatLyx(acct.data.balance, 4)}<span className="unit">LYX</span></dd></div>
          <div><dt>Locked rewards</dt><dd>{formatLyx(acct.data.locked, 4)}<span className="unit">LYX</span></dd></div>
          <div><dt>Blocks mined</dt><dd>{hist.data?.blocksMined ?? '–'}</dd></div>
          <div><dt>Transactions sent</dt><dd>{acct.data.nonce}</dd></div>
        </dl>
      )}
      <section className="section">
        <div className="section-head"><h2>Activity</h2><p>{hist.data?.total ?? 0} entries</p></div>
        {hist.data && hist.data.items.length === 0 && <p className="muted">This address hasn't appeared on chain yet.</p>}
        <div className="table">
          {hist.data?.items.map((h, i) => {
            const incoming = h.kind !== 'sent';
            return (
              <Link key={i} to={h.txHash ? `/tx/${h.txHash}` : `/block/${h.height}`} className="tr" style={{ gridTemplateColumns: '40px minmax(0,1fr) auto' }}>
                <span className={'kind' + (incoming ? ' in' : '')}>{h.kind === 'mined' ? <Icon.cube /> : incoming ? <Icon.down /> : <Icon.up />}</span>
                <span className="cell-main">
                  <span className="t">{h.kind === 'mined' ? `Mined block ${h.height.toLocaleString()}` : h.kind === 'sent' ? 'Sent' : h.kind === 'self' ? 'Sent to itself' : 'Received'}</span>
                  <span className="s"><Ago ts={h.timestamp} />{h.kind === 'sent' && h.to ? `, to ${shortHash(h.to, 10, 6)}` : ''}{h.kind === 'received' && h.from ? `, from ${shortHash(h.from, 10, 6)}` : ''}</span>
                </span>
                <span className="num" style={{ fontWeight: 500, color: incoming ? 'var(--text)' : 'var(--text-2)' }}>{incoming ? '+' : '−'}{h.amountLyx} LYX</span>
              </Link>
            );
          })}
        </div>
        <div className="inline" style={{ marginTop: 24 }}>
          {hist.data?.nextBefore && <button className="btn" onClick={() => setBefore(hist.data!.nextBefore)}>Older activity</button>}
          {before && <button className="btn quiet" onClick={() => setBefore(null)}>Back to latest</button>}
        </div>
      </section>
    </>
  );
}

export function SupplyPage() {
  const { info } = useChain();
  const s = usePoll<Supply>('lyx_getSupply', {}, 0, info?.height);
  const sched = usePoll<{ fromHeight: number; toHeight: number | null; rewardLyx: string }[]>('lyx_getEmissionSchedule', {}, 0);
  const d = s.data;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Supply</h1>
          <p>All LYX comes from block rewards. No premine, no dev share.</p>
        </div>
      </div>
      {s.error && <NodeError error={s.error} />}
      {d && (
        <>
          <dl className="equation">
            <div className="term"><dt>Tracked as blocks are applied</dt><dd>{formatLyx(d.issued, 2)}</dd></div>
            <span className="eq">=</span>
            <div className="term"><dt>Reward schedule</dt><dd>{formatLyx(d.expectedFromSchedule, 2)}</dd></div>
            <span className="eq">=</span>
            <div className="term"><dt>Every balance, added up</dt><dd>{formatLyx(d.sumOfAllBalances, 2)}</dd></div>
          </dl>
          <div className="seal" key={d.height}>
            <Seal ok={d.consistent} />
            <span>{d.consistent ? `Verified at block ${d.height.toLocaleString()}.` : "These don't agree. This node's data may be damaged."}</span>
          </div>

          <div className="split section">
            <section>
              <h2 style={{ marginBottom: 20 }}>Where it stands</h2>
              <KV
                items={[
                  ['Spendable balances', <span className="num">{formatLyx(BigInt(d.sumOfAllBalances) - BigInt(d.lockedRewards), 2)} LYX</span>],
                  ['Rewards still locked', <span className="num">{formatLyx(d.lockedRewards, 2)} LYX</span>],
                  ...(d.inContracts && BigInt(d.inContracts) > 0n
                    ? [['Held by contracts', <span className="num">{formatLyx(d.inContracts, 2)} LYX</span>] as [string, React.ReactNode]]
                    : []),
                  ['Accounts', <span className="num">{d.accounts.toLocaleString()}</span>],
                  ['Current reward', `${d.currentBlockRewardLyx} LYX per block`],
                  ['Next halving', <span className="num">Block {d.nextHalvingHeight.toLocaleString()}</span>],
                  ['Maximum supply', 'None, see tail reward'],
                  ['Premine, treasury, developer share', 'None'],
                ]}
              />
            </section>
            <section>
              <h2 style={{ marginBottom: 20 }}>Reward schedule</h2>
              <div className="table">
                {sched.data?.map((e, i) => (
                  <div className="tr" key={i} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                    <span className="num muted">{e.toHeight ? `Blocks ${e.fromHeight.toLocaleString()} to ${e.toHeight.toLocaleString()}` : `From block ${e.fromHeight.toLocaleString()} on`}</span>
                    <span className="num" style={{ fontWeight: 500 }}>{e.rewardLyx} LYX</span>
                  </div>
                ))}
              </div>
              <p className="hint" style={{ marginTop: 16 }}>The reward never drops below {d.tailRewardLyx} LYX, so mining always pays something.</p>
            </section>
          </div>
        </>
      )}
    </>
  );
}

function vaultText(v: NonNullable<TxInfo['vault']>): React.ReactNode {
  switch (v.kind) {
    case 'create': return 'Turned this account into a vault';
    case 'withdraw': return <>Withdrawal of {v.amountLyx} LYX to <AddressLink address={v.to!} mark />, after the delay</>;
    case 'update': return 'Settings change, after the delay';
    case 'close': return 'Closing the vault, after the delay';
    case 'cancel': return <>Cancelled <Link to={`/tx/${v.id}`} className="link mono">{shortHash(v.id!, 8, 6)}</Link></>;
    case 'sweep': return <>Moved everything from <AddressLink address={v.vault!} mark /> to its safe address</>;
    case 'heirClaim': return <>Heir's claim on <AddressLink address={v.vault!} mark />, after the delay</>;
  }
}
