import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { useChain } from '../state';
import { Ago, NodeError, Skeleton, ago, hashrate, useNow } from '../ui';
import { BlockGlyph, ChainScene, Seal, Signet } from '../visuals';
import { formatLyx, shortHash } from '../lib/lokyx';
import { usePoll, type Supply } from '../lib/rpc';

export default function Overview() {
  const { info, error, recent, arrived } = useChain();
  const now = useNow();

  return (
    <>
      <section className="hero">
        <h1>
          Your network.
          <span>Your blockchain.</span>
        </h1>
        <p className="lede">
          {info ? (
            <>
              LOKYX {info.network} is at block <strong className="num">{info.height.toLocaleString()}</strong>. The last one was mined{' '}
              <strong>{ago(info.bestTimestamp, now)}</strong>, and every number on this page comes straight from a LOKYX node, not a database.
            </>
          ) : error ? (
            'Connect to a node to see the chain.'
          ) : (
            'Connecting to a LOKYX node…'
          )}
        </p>
      </section>

      {error && !info && (
        <div style={{ marginTop: 40 }}>
          <NodeError error={error} />
        </div>
      )}

      {info && (
        <>
          <motion.div className="scene" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.2, delay: 0.15 }}>
            <ChainScene blocks={recent} arrived={arrived} nextHeight={info.height + 1} />
          </motion.div>
          <div className="scene-caption">
            <span>Block {(info.height + 1).toLocaleString()} is being mined. Blocks arrive every {info.targetBlockTime} seconds on average.</span>
            <Link to="/explorer" className="link">All blocks</Link>
          </div>

          {info.genesisMessage && (
            <Link to="/block/0" className="genesis-line">
              <span className="faint">Block 0</span>
              <span>{info.genesisMessage}</span>
            </Link>
          )}

          <section className="section">
            <dl className="stats primary">
              <div>
                <dt>Block height</dt>
                <dd>{info.height.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Network hashrate</dt>
                <dd>
                  {info.networkHashrateEstimate > 0 ? (
                    <>
                      {hashrate(info.networkHashrateEstimate)[0]}
                      <span className="unit">{hashrate(info.networkHashrateEstimate)[1]}</span>
                    </>
                  ) : (
                    <span className="faint" title="Needs at least two mined blocks to measure">–</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Difficulty</dt>
                <dd>{Number(info.nextDifficulty).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Connected peers</dt>
                <dd>
                  <Link to="/network">{info.peers}</Link>
                </dd>
              </div>
            </dl>
            <dl className="stats">
              <div>
                <dt>Last block</dt>
                <dd><Ago ts={info.bestTimestamp} short /><span className="unit">ago</span></dd>
              </div>
              <div>
                <dt>Target block time</dt>
                <dd>{info.targetBlockTime}<span className="unit">seconds</span></dd>
              </div>
              <div>
                <dt>Transactions waiting</dt>
                <dd>{info.mempoolSize}</dd>
              </div>
              <div>
                <dt>LYX issued</dt>
                <dd><Link to="/supply">{formatLyx(info.issued, 2)}</Link></dd>
              </div>
            </dl>
            <p className="hint" style={{ marginTop: 16 }}>Hashrate is an estimate from difficulty and block times.</p>
          </section>

          <LatestBlocks />
          <SupplyCheck />
          <Miners />
        </>
      )}
    </>
  );
}

function LatestBlocks() {
  const { recent } = useChain();
  const rows = [...recent].reverse().slice(0, 8);
  return (
    <section className="section">
      <div className="section-head">
        <h2>Latest blocks</h2>
        <Link to="/explorer" className="link">Explorer</Link>
      </div>
      <div className="table blocks-table">
        <div className="tr th wide-head">
          <span />
          <span>Height</span>
          <span className="wide">Hash</span>
          <span className="wide">Miner</span>
          <span className="wide right">Txs</span>
          <span className="wide right">Reward</span>
          <span className="right">Mined</span>
        </div>
        {rows.map((b, i) => (
          <motion.div key={b.hash} layout initial={i === 0 ? { opacity: 0, y: -12 } : false} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 26 }}>
            <Link to={`/block/${b.height}`} className="tr">
              <BlockGlyph hash={b.hash} size={34} />
              <span className="cell-main">
                <span className="t">{b.height.toLocaleString()}</span>
                <span className="s mobile-only">{b.txCount} tx, {b.rewardLyx} LYX</span>
              </span>
              <span className="wide mono faint">{shortHash(b.hash, 8, 6)}</span>
              <span className="wide mono faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortHash(b.miner, 10, 6)}</span>
              <span className="wide right num">{b.txCount}</span>
              <span className="wide right num">{b.rewardLyx} LYX</span>
              <span className="right faint"><Ago ts={b.timestamp} short /> ago</span>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function SupplyCheck() {
  const { info } = useChain();
  const s = usePoll<Supply>('lyx_getSupply', {}, 0, info?.height);
  const d = s.data;
  return (
    <section className="section">
      <div className="section-head">
        <h2>Supply</h2>
        <Link to="/supply" className="link">Details</Link>
      </div>
      <p className="muted" style={{ maxWidth: '36em', marginBottom: 40, fontSize: 18 }}>
        New LYX only comes from block rewards. The node adds up supply three different ways and checks they match.
      </p>
      {!d ? (
        <Skeleton h={60} />
      ) : (
        <>
          <dl className="equation">
            <div className="term">
              <dt>Tracked as blocks are applied</dt>
              <dd>{formatLyx(d.issued, 2)}</dd>
            </div>
            <span className="eq">=</span>
            <div className="term">
              <dt>Reward schedule</dt>
              <dd>{formatLyx(d.expectedFromSchedule, 2)}</dd>
            </div>
            <span className="eq">=</span>
            <div className="term">
              <dt>Every balance, added up</dt>
              <dd>{formatLyx(d.sumOfAllBalances, 2)}</dd>
            </div>
          </dl>
          <div className="seal" key={`${d.height}-${d.consistent}`}>
            <Seal ok={d.consistent} />
            <span>
              {d.consistent ? 'Matches at block ' + d.height.toLocaleString() + '.' : "These don't match. This node's state may be damaged; resync it."}
              <span className="faint" style={{ display: 'block', fontSize: 15, marginTop: 4 }}>
                No premine. {formatLyx(d.lockedRewards, 2)} LYX of recent rewards are still locked.
              </span>
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function Miners() {
  const { recent } = useChain();
  const counts = new Map<string, { n: number; last: number }>();
  // Genesis has no miner, so it's left out.
  const mined = recent.filter((b) => b.height > 0);
  mined.forEach((b) => {
    const c = counts.get(b.miner) ?? { n: 0, last: 0 };
    counts.set(b.miner, { n: c.n + 1, last: Math.max(c.last, b.timestamp) });
  });
  const rows = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  const top = rows.slice(0, 6);
  const tones = ['var(--text)', 'var(--text-3)', 'var(--line)', 'var(--line)'];
  return (
    <section className="section">
      <div className="section-head">
        <h2>Who's mining</h2>
        <p>Last {mined.length} blocks</p>
      </div>
      <div className="share-bar" role="img" aria-label="Share of recent blocks by miner">
        {top.map(([m, c], i) => (
          <motion.span key={m} initial={{ flexGrow: 0 }} animate={{ flexGrow: c.n }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} style={{ background: tones[Math.min(i, 3)], flexBasis: 0 }} />
        ))}
      </div>
      <div className="table">
        {top.map(([m, c], i) => (
          <Link to={`/address/${m}`} className="tr" key={m} style={{ gridTemplateColumns: '12px 32px minmax(0,1fr) auto auto' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: tones[Math.min(i, 3)], border: '1px solid var(--line)' }} />
            <Signet of={m} size={32} />
            <span className="cell-main">
              <span className="t"><AddressLinkText address={m} /></span>
              <span className="s">last block <Ago ts={c.last} /></span>
            </span>
            <span className="num">{c.n} {c.n === 1 ? 'block' : 'blocks'}</span>
            <span className="num faint" style={{ width: 56, textAlign: 'right' }}>{Math.round((c.n / mined.length) * 100)}%</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function AddressLinkText({ address }: { address: string }) {
  return <span className="mono">{shortHash(address, 12, 6)}</span>;
}

