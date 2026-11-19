import { NodeError, duration } from '../ui';
import { Orbit } from '../visuals';
import { usePoll, type Peer } from '../lib/rpc';

export default function Network() {
  const peers = usePoll<Peer[]>('lyx_getPeers', {}, 2000);
  const list = peers.data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Network</h1>
          <p>The nodes this site's node is talking to right now. Every miner who runs LOKYX adds one more.</p>
        </div>
      </div>
      {peers.error && <NodeError error={peers.error} />}
      {peers.data && (
        <div className="split" style={{ alignItems: 'center' }}>
          <section>
            {list.length === 0 ? (
              <div className="empty">
                <p>No peers.</p>
                <p className="mono hint">lokyxd --peer host:27701</p>
              </div>
            ) : (
              <Orbit peers={list.map((p) => ({ id: p.address, label: p.listenAddress, height: p.bestHeight }))} />
            )}
            <p className="hint" style={{ marginTop: 16 }}>A dot moves in when a peer sends a new block.</p>
          </section>
          <section>
            <div className="section-head">
              <h2>{list.length} {list.length === 1 ? 'peer' : 'peers'}</h2>
            </div>
            <div className="table">
              {list.map((p) => (
                <div className="tr" key={p.address} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                  <span className="cell-main">
                    <span className="t mono">{p.listenAddress}</span>
                    <span className="s">{p.direction === 'inbound' ? 'Connected to us' : 'We connected'}, {duration(p.connectedSecs)}, {p.userAgent}</span>
                  </span>
                  <span className="right">
                    <span className="num" style={{ display: 'block' }}>Block {p.bestHeight.toLocaleString()}</span>
                    {p.misbehavior > 0 && <span className="faint" style={{ fontSize: 14 }}>{p.misbehavior} penalty points</span>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
