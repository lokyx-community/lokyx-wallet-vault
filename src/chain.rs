//! Block tree, validation, fork choice (most work wins), reorgs, and headers-first sync.
//!
//! Three views of the same tree:
//!   - `index`: every header we've accepted (main chain, side branches, headers whose bodies
//!     haven't arrived yet).
//!   - `header_main`: the path to the header with the most work. Bodies are fetched along it.
//!   - `main`: the chain whose transactions have actually been applied to `state`.
//!
//! Spam protection (none of it changes which chain is valid, or which one wins):
//!   - A side branch is only kept if its total work is within HEADER_MARGIN blocks of our tip;
//!     its bodies only within BODY_MARGIN blocks. Anything further behind is never stored, and
//!     branches that fall behind are pruned.
//!   - Headers from a peer are collected across batches (`Pending`) and judged as one branch,
//!     so a heavier fork deeper than one batch is still followed.
//!   - Bodies are only downloaded for the best header chain, and only once it has
//!     `min_chain_work`. Every transaction's signature is checked before a body is stored.
#![deny(clippy::float_arithmetic)]

use crate::address::Address;
use crate::block::{Block, BlockHeader, genesis};
use crate::crypto::Hash;
use crate::difficulty::next_difficulty;
use crate::params::{BLOCK_VERSION, ChainParams, MAX_BLOCK_BYTES, MAX_TXS_PER_BLOCK, MEDIAN_TIME_SPAN};
use crate::pow::{PowEngine, meets_difficulty, seed_height};
use crate::state::{State, Undo};
use crate::store::Store;
use crate::tx::SignedTransaction;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::Arc;

/// Marker used in the address index for "this address mined the block".
pub const MINED: u32 = u32::MAX;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

/// A side branch's headers are kept only if it has at least as much work as our chain had this
/// many blocks ago.
pub const HEADER_MARGIN: u64 = 100;
/// A side block's body is kept only if it has at least as much work as our chain had this many
/// blocks ago (ordinary one- and two-block races stay instant to reorg).
pub const BODY_MARGIN: u64 = 6;
/// Most headers in one message.
pub const MAX_HEADERS_PER_MSG: usize = 2000;
/// Most headers we'll hold from one peer before judging its branch (~50 MB, ~139 days of blocks
/// at 60 s). A heavier fork deeper than this can't be followed automatically; see SECURITY.md.
pub const MAX_PENDING_HEADERS: usize = 200_000;
/// Above this many pending headers a peer counts as "feeding a long chain"...
pub const BIG_PENDING: usize = 2_000;
/// ...and only this many peers may do that at once.
pub const MAX_BIG_PENDING_PEERS: usize = 2;
/// While collecting a peer's headers, one in this many (plus the last of every batch) has its
/// proof of work checked straight away, so a chain with fake work is caught within a few dozen
/// headers instead of filling memory. The rest are checked when the branch is judged.
pub const POW_SAMPLE: u32 = 32;
/// We count as synced while the best known header is at most this many blocks ahead of our tip.
pub const SYNCED_LAG: u64 = 6;

#[derive(Clone, Debug)]
pub struct BlockMeta {
    pub header: BlockHeader,
    pub hash: Hash,
    pub cum_work: u128,
}

/// The best of `start` and `others` to follow: the most work, and among equal work the lowest
/// hash. The tie rule matters because `others` comes out of a hash map in whatever order that map
/// likes, and two nodes with the same headers must settle on the same one.
pub fn best_header<'a>(start: &'a BlockMeta, others: impl Iterator<Item = &'a BlockMeta>) -> &'a BlockMeta {
    let mut best = start;
    for m in others {
        if m.cum_work > best.cum_work || (m.cum_work == best.cum_work && m.hash < best.hash) {
            best = m;
        }
    }
    best
}

#[derive(Debug)]
pub enum Outcome {
    AlreadyKnown,
    /// The parent header is unknown. Nothing was stored; ask the sender for headers.
    NeedHeaders,
    /// On a branch too far behind our tip to be worth keeping. Nothing was stored.
    Ignored,
    /// Valid but not on the best chain (less or equal work), or a header whose body we didn't keep.
    SideChain,
    /// Became the new tip. `disconnected` holds transactions from blocks that left the best
    /// chain during a reorg (to return to the mempool); `reorg_depth` is 0 for a plain extension.
    NewTip {
        reorg_depth: u64,
        disconnected: Vec<SignedTransaction>,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum BlockError {
    /// The block breaks a consensus rule. Peers sending these are penalized.
    #[error("invalid block: {0}")]
    Invalid(String),
    /// The body doesn't match its header (wrong transactions for that transaction root). That's
    /// the sender's fault, not the block's: the header stays good and the body is asked for again.
    #[error("body doesn't match its header: {0}")]
    Mismatch(String),
    /// Timestamped further ahead than `future_time_limit`. Usually a peer with a fast clock, so
    /// it isn't punished or remembered as invalid; the block is simply looked at again later.
    #[error("block from the future: {0}")]
    TooEarly(String),
    #[error("internal error: {0}")]
    Internal(String),
    /// The supply invariant broke while applying this block. That means a bug in our own
    /// consensus code, not a bad peer: the node stops instead of carrying on with a supply it
    /// can't account for. The sender isn't punished and the block isn't remembered as invalid,
    /// so a fixed release can look at it again.
    #[error("halted: {0}")]
    Halted(String),
}

/// What a switch to another branch can run into.
#[derive(Debug)]
enum SwitchError {
    /// This block failed validation (it and everything after it are now marked invalid).
    Invalid(Hash, String),
    Internal(String),
    /// The supply invariant broke. Nothing is marked invalid; the node halts.
    Halted(String),
}

/// Why applying a block in place failed. Either way the state has been put back.
enum ApplyFailure {
    /// The block breaks a rule.
    Invalid(String),
    /// The block applied but the supply invariant broke: a bug of ours.
    Supply(String),
}

/// A header whose proof of work still has to be checked (outside the chain lock).
#[derive(Clone, Debug)]
pub struct PowJob {
    pub hash: Hash,
    pub seed: Hash,
    pub header: BlockHeader,
}

/// Result of handing a batch of headers to `stage_headers`.
#[derive(Debug)]
pub enum Staged {
    /// Too many peers are already feeding us long header chains; ask this one again later.
    Busy,
    /// Check these headers' proof of work, then call `judge_pending`. `stalled` means a header
    /// was dated too far ahead and the rest of the batch waits (don't re-ask straight away).
    Verify { jobs: Vec<PowJob>, stalled: bool },
}

/// What to do with a peer's collected headers.
#[derive(Debug)]
pub enum Judgement {
    /// Nothing pending for this peer (the batch was all headers we already had).
    Nothing,
    /// Not enough to judge yet: ask the peer for its next batch.
    NeedMore,
    /// Not worth keeping (the branch has too little work). Already dropped.
    Discard(String),
    /// Worth keeping: check these headers' proof of work, then call `commit_pending`.
    Commit(Vec<PowJob>),
}

/// Headers collected from one peer that aren't in the block tree yet: a straight chain whose
/// first header's parent is in `index`.
#[derive(Default)]
struct Pending {
    metas: Vec<BlockMeta>,
    pos: HashMap<Hash, usize>,
    seeds: Vec<Hash>,
    /// Proof of work already checked.
    checked: Vec<bool>,
    /// `judge_pending` said to keep this branch, so `commit_pending` may be called.
    committing: bool,
}

/// Header lookups across the block tree plus, optionally, one peer's pending headers.
struct View<'a> {
    index: &'a HashMap<Hash, BlockMeta>,
    extra: Option<&'a Pending>,
}

impl<'a> View<'a> {
    fn get(&self, h: &Hash) -> Option<&'a BlockMeta> {
        if let Some(p) = self.extra
            && let Some(&i) = p.pos.get(h)
        {
            return Some(&p.metas[i]);
        }
        self.index.get(h)
    }

    /// Ancestor of `from` at `height`. `main` is a shortcut once the walk reaches the main chain.
    fn ancestor(&self, main: &[Hash], from: &Hash, height: u64) -> Option<Hash> {
        let mut cur = self.get(from)?;
        if cur.header.height < height {
            return None;
        }
        loop {
            if main.get(cur.header.height as usize) == Some(&cur.hash) {
                return main.get(height as usize).copied();
            }
            if cur.header.height == height {
                return Some(cur.hash);
            }
            cur = self.get(&cur.header.prev_hash)?;
        }
    }

    /// (timestamp, difficulty) of up to `n` mined ancestors ending at `parent`, oldest first.
    fn history(&self, parent: &Hash, n: usize) -> Vec<(u64, u128)> {
        let mut out = Vec::with_capacity(n);
        let mut cur = self.get(parent);
        while let Some(m) = cur {
            if m.header.height == 0 || out.len() == n {
                break;
            }
            out.push((m.header.timestamp, m.header.difficulty));
            cur = self.get(&m.header.prev_hash);
        }
        out.reverse();
        out
    }

    fn median_time_past(&self, parent: &Hash) -> u64 {
        let mut ts = Vec::with_capacity(MEDIAN_TIME_SPAN);
        let mut cur = self.get(parent);
        while let Some(m) = cur {
            ts.push(m.header.timestamp);
            if ts.len() == MEDIAN_TIME_SPAN || m.header.height == 0 {
                break;
            }
            cur = self.get(&m.header.prev_hash);
        }
        ts.sort_unstable();
        ts[ts.len() / 2]
    }

    fn min_timestamp_for(&self, p: &ChainParams, parent: &Hash) -> u64 {
        let spaced = self.get(parent).map(|m| m.header.timestamp.saturating_add(p.min_block_spacing)).unwrap_or(0);
        self.median_time_past(parent).saturating_add(1).max(spaced)
    }

    /// Every consensus rule a header must meet given its parent (not proof of work, not the body).
    fn check_header(&self, p: &ChainParams, h: &BlockHeader, parent: &BlockMeta) -> Result<(), String> {
        if h.version != BLOCK_VERSION {
            return Err(format!("unsupported version {}", h.version));
        }
        if Some(h.height) != parent.header.height.checked_add(1) {
            return Err("height does not follow parent".into());
        }
        if h.timestamp < parent.header.timestamp.saturating_add(p.min_block_spacing) {
            return Err(format!("block comes less than {} s after its parent", p.min_block_spacing));
        }
        if h.timestamp < self.min_timestamp_for(p, &parent.hash) {
            return Err("timestamp not after median of previous 11 blocks".into());
        }
        let want = next_difficulty(&self.history(&parent.hash, p.lwma_window as usize + 1), p);
        if h.difficulty != want {
            return Err(format!("wrong difficulty {} (expected {want})", h.difficulty));
        }
        Ok(())
    }
}

const SNAPSHOT_EVERY: u64 = 100;
/// Blocks whose undo notes we keep. A reorg no deeper than this steps back note by note; a deeper
/// one rebuilds from the nearest snapshot.
const MAX_UNDO: usize = 256;
/// Block bodies kept in memory when there is a database to read the rest from.
const BODY_CACHE: usize = 128;

/// Block bodies. The headers are all in memory (`Chain::index`); the bodies are on disk, with the
/// most recent few kept in memory because that's what gets asked for. Without a database (tests,
/// throwaway nodes) every body stays in memory.
struct Bodies {
    /// Hashes of every body we hold, wherever it lives.
    have: HashSet<Hash>,
    cache: HashMap<Hash, Arc<Block>>,
    fifo: VecDeque<Hash>,
    /// Genesis isn't in the database (every node builds it), so it is never evicted.
    genesis: (Hash, Arc<Block>),
    /// Set once a database is attached: from then on the cache is limited.
    bounded: bool,
}

impl Bodies {
    fn new(genesis: Block) -> Bodies {
        let h = genesis.hash();
        let mut have = HashSet::new();
        have.insert(h);
        Bodies { have, cache: HashMap::new(), fifo: VecDeque::new(), genesis: (h, Arc::new(genesis)), bounded: false }
    }
    fn contains(&self, h: &Hash) -> bool {
        self.have.contains(h)
    }
    fn len(&self) -> usize {
        self.have.len()
    }
    fn insert(&mut self, h: Hash, b: Block) {
        if h == self.genesis.0 {
            return;
        }
        self.have.insert(h);
        if self.cache.insert(h, Arc::new(b)).is_none() {
            self.fifo.push_back(h);
        }
        while self.bounded && self.cache.len() > BODY_CACHE {
            let Some(old) = self.fifo.pop_front() else { break };
            self.cache.remove(&old);
        }
    }
    /// Note that the database holds this body, without reading it.
    fn mark(&mut self, h: Hash) {
        self.have.insert(h);
    }
    fn remove(&mut self, h: &Hash) -> bool {
        self.cache.remove(h);
        self.have.remove(h)
    }
    fn get(&self, h: &Hash, store: Option<&Store>) -> Option<Arc<Block>> {
        if *h == self.genesis.0 {
            return Some(self.genesis.1.clone());
        }
        if let Some(b) = self.cache.get(h) {
            return Some(b.clone());
        }
        if !self.have.contains(h) {
            return None;
        }
        store?.get_block(h).ok().flatten().map(Arc::new)
    }
}
const MAX_SNAPSHOTS: usize = 50;
/// Prune side branches at least this often (in blocks).
const PRUNE_EVERY: u64 = 16;

pub struct Chain {
    pub params: &'static ChainParams,
    index: HashMap<Hash, BlockMeta>,
    /// parent -> children, for everything in `index`.
    children: HashMap<Hash, Vec<Hash>>,
    /// Entries of `index` that aren't on `header_main`.
    side: HashSet<Hash>,
    bodies: Bodies,
    /// How to take each of the last few best-chain blocks off the state, by height.
    undos: BTreeMap<u64, Undo>,
    /// Best chain: `main[h]` is the hash at height h.
    main: Vec<Hash>,
    /// Path to the header with the most work: `header_main[h]` is the hash at height h.
    header_main: Vec<Hash>,
    pub state: State,
    tx_index: HashMap<Hash, (u64, usize)>,
    /// Per-address activity on the best chain: (height, tx index), with MINED for a coinbase.
    activity: HashMap<Address, BTreeSet<(u64, u32)>>,
    /// Swap lock id -> the tx that claimed or refunded it, on the best chain.
    swap_closed: HashMap<Hash, Hash>,
    /// What each contract transaction on the best chain did.
    receipts: HashMap<Hash, crate::contract::Receipt>,
    /// Copies of the state at every SNAPSHOT_EVERY heights on the best chain, so a reorg only
    /// replays blocks since the nearest snapshot instead of the whole chain.
    snapshots: BTreeMap<u64, (Hash, State)>,
    invalid: HashSet<Hash>,
    /// Headers collected per peer, not yet judged.
    pending: HashMap<u64, Pending>,
    /// Set once the supply invariant has broken: no further block is applied, and the node
    /// stops mining. Only a new release clears it (it isn't written to disk).
    halted: Option<String>,
    last_prune: u64,
    store: Option<Store>,
    /// Height of the saved state this chain started from, if it did.
    started_from: Option<u64>,
}

impl Chain {
    pub fn new(params: &'static ChainParams, store: Option<Store>) -> anyhow::Result<Self> {
        Chain::open(params, store, false)
    }

    /// Open a chain on a database. Normally the state saved with the last snapshot is the
    /// starting point and only the blocks after it are applied; `reverify` applies every stored
    /// block from genesis instead, checking each rule again.
    pub fn open(params: &'static ChainParams, store: Option<Store>, reverify: bool) -> anyhow::Result<Self> {
        let g = genesis(params);
        let gh = g.hash();
        let mut c = Chain {
            params,
            index: HashMap::new(),
            children: HashMap::new(),
            side: HashSet::new(),
            bodies: Bodies::new(g.clone()),
            undos: BTreeMap::new(),
            main: vec![gh],
            header_main: vec![gh],
            state: State::default(),
            tx_index: HashMap::new(),
            activity: HashMap::new(),
            swap_closed: HashMap::new(),
            receipts: HashMap::new(),
            snapshots: BTreeMap::new(),
            invalid: HashSet::new(),
            pending: HashMap::new(),
            halted: None,
            last_prune: 0,
            store: None,
            started_from: None,
        };
        c.index.insert(gh, BlockMeta { header: g.header.clone(), hash: gh, cum_work: 0 });
        if let Some(store) = store {
            let mut heads = store.headers()?;
            let n = heads.len();
            let by_hash: HashMap<Hash, BlockHeader> = heads.iter().map(|h| (h.hash(), h.clone())).collect();
            let mut ours: HashSet<Hash> = HashSet::new();
            if let Some(tip) = store.tip()? {
                let mut at = tip;
                while let Some(h) = by_hash.get(&at) {
                    ours.insert(at);
                    at = h.prev_hash;
                }
            }
            heads.sort_by_cached_key(|h| (h.height, !ours.contains(&h.hash())));
            let stored: Vec<Hash> = heads.iter().map(|h| h.hash()).collect();
            // The store is attached from the start so pruning during the replay deletes from disk.
            c.store = Some(store);
            c.bodies.bounded = true;
            if !reverify {
                c.start_from_saved_state(&by_hash, &ours);
            }
            // Replay what's left: all of it, or the blocks after the saved state and any side
            // branches. PoW and signatures were checked when these blocks were first accepted, so
            // they're skipped; every other rule (including applying every transaction) is checked
            // again. At each height the block of our last best chain goes first, so ties between
            // equal-work branches resolve the same way as before the restart.
            for hd in &heads {
                let hash = hd.hash();
                if hd.height == 0 || c.bodies.contains(&hash) {
                    continue;
                }
                let Some(b) = c.store.as_ref().expect("attached above").get_block(&hash)? else { continue };
                match c.process_inner(b, true, true, false) {
                    Ok(_) => {}
                    // A halt while replaying our own database means the bug is already in the
                    // chain we stored. Stop here rather than replaying thousands more blocks.
                    Err(e @ BlockError::Halted(_)) => {
                        tracing::error!("stopped replaying the stored chain: {e}");
                        break;
                    }
                    Err(e) => tracing::warn!("stored block rejected on reload: {e}"),
                }
            }
            c.prune();
            // Whatever didn't make it back in (pruned, invalid, or cut off from its parent) goes.
            let s = c.store.as_ref().expect("attached above");
            let stale: Vec<Hash> = stored.into_iter().filter(|h| !c.bodies.contains(h)).collect();
            if !stale.is_empty() {
                s.delete_blocks(&stale)?;
                tracing::info!("removed {} stale blocks from the database", stale.len());
            }
            s.set_tip(&c.tip().hash)?;
            tracing::info!("loaded {n} stored blocks; tip height {}", c.height());
        }
        Ok(c)
    }

    /// Begin from the state saved at the last snapshot instead of from genesis, if there is one
    /// we can trust: its block must be on the chain we were on, and the state has to hash to
    /// that block's state root and balance its books. Blocks up to it are taken as already
    /// checked (we checked them when we first accepted them); everything after is applied and
    /// checked as usual. Anything that doesn't fit leaves the chain empty, for a full replay.
    fn start_from_saved_state(&mut self, headers: &HashMap<Hash, BlockHeader>, ours: &HashSet<Hash>) {
        let Some(store) = &self.store else { return };
        let (height, hash, state) = match store.state() {
            Ok(Some(x)) => x,
            Ok(None) => return,
            Err(e) => {
                tracing::warn!("saved state unreadable, replaying the chain: {e}");
                return;
            }
        };
        let fail = |why: &str| tracing::warn!("saved state at height {height} not used, replaying the chain: {why}");
        if height == 0 || state.height != height {
            return fail("it doesn't say what height it is");
        }
        if !ours.contains(&hash) {
            return fail("its block isn't on the chain we were on");
        }
        // The path from genesis to that block, from the stored headers.
        let mut path = vec![];
        let mut at = hash;
        while let Some(h) = headers.get(&at) {
            path.push(h.clone());
            at = h.prev_hash;
        }
        path.reverse();
        let genesis = self.main[0];
        // The state is vouched for by its root against this block's header, and the block by the
        // chain of stored headers back to our own genesis.
        if at != genesis {
            return fail("the stored blocks don't lead back to genesis");
        }
        let last = &path[path.len() - 1];
        if state.root() != last.state_root {
            return fail("it doesn't match the block's state root");
        }
        if let Err(e) = state.check_supply(height, self.params) {
            return fail(&e);
        }
        let mut work = 0u128;
        let mut metas = Vec::with_capacity(path.len());
        for h in &path {
            let Some(w) = work.checked_add(h.difficulty) else { return fail("total work overflows") };
            work = w;
            metas.push(BlockMeta { header: h.clone(), hash: h.hash(), cum_work: w });
        }
        for m in metas {
            self.bodies.mark(m.hash);
            self.main.push(m.hash);
            self.insert_header(m);
        }
        self.state = state;
        for h in 1..=height {
            self.index_txs(h);
        }
        // Receipts of the blocks we skipped come from the database; one whose transaction isn't
        // on our chain belongs to a block that's gone.
        if let Some(store) = &self.store {
            match store.receipts() {
                Ok(all) => {
                    let (keep, gone): (Vec<_>, Vec<_>) =
                        all.into_iter().partition(|(t, _)| self.tx_index.contains_key(t));
                    self.receipts.extend(keep);
                    let _ = store.delete_receipts(&gone.into_iter().map(|(t, _)| t).collect::<Vec<_>>());
                }
                Err(e) => tracing::warn!("receipts unreadable: {e}"),
            }
        }
        if height.is_multiple_of(SNAPSHOT_EVERY) {
            self.snapshots.insert(height, (hash, self.state.clone()));
        }
        self.started_from = Some(height);
        tracing::info!("started from the saved state at height {height}");
    }

    fn view(&self) -> View<'_> {
        View { index: &self.index, extra: None }
    }

    // ---------- queries ----------

    /// The height of the saved state this chain began from, or None if it replayed from genesis.
    pub fn started_from(&self) -> Option<u64> {
        self.started_from
    }
    pub fn genesis_hash(&self) -> Hash {
        self.main[0]
    }
    pub fn tip(&self) -> &BlockMeta {
        &self.index[self.main.last().unwrap()]
    }
    pub fn height(&self) -> u64 {
        self.main.len() as u64 - 1
    }
    pub fn cum_work(&self) -> u128 {
        self.tip().cum_work
    }
    /// The header with the most work we know of. Ahead of `tip()` while bodies are downloading.
    pub fn best_header(&self) -> &BlockMeta {
        &self.index[self.header_main.last().unwrap()]
    }
    pub fn hash_at(&self, h: u64) -> Option<Hash> {
        self.main.get(h as usize).copied()
    }
    pub fn meta(&self, hash: &Hash) -> Option<&BlockMeta> {
        self.index.get(hash)
    }
    /// A block's body, from memory or from the database.
    pub fn block(&self, hash: &Hash) -> Option<Arc<Block>> {
        self.body(hash)
    }
    fn body(&self, hash: &Hash) -> Option<Arc<Block>> {
        self.bodies.get(hash, self.store.as_ref())
    }
    pub fn has_body(&self, hash: &Hash) -> bool {
        self.bodies.contains(hash)
    }
    pub fn is_main(&self, hash: &Hash) -> bool {
        self.index.get(hash).map(|m| self.main.get(m.header.height as usize) == Some(hash)).unwrap_or(false)
    }
    fn on_header_main(&self, m: &BlockMeta) -> bool {
        self.header_main.get(m.header.height as usize) == Some(&m.hash)
    }
    /// We have this block's header (its body may still be on the way).
    pub fn knows(&self, hash: &Hash) -> bool {
        self.index.contains_key(hash)
    }
    /// The tx that claimed or refunded a swap lock, if any.
    pub fn swap_closed_by(&self, lock: &Hash) -> Option<Hash> {
        self.swap_closed.get(lock).copied()
    }

    /// (block height, index within block) of a transaction on the best chain.
    pub fn receipt(&self, tx: &Hash) -> Option<&crate::contract::Receipt> {
        self.receipts.get(tx)
    }
    pub fn tx_location(&self, h: &Hash) -> Option<(u64, usize)> {
        self.tx_index.get(h).copied()
    }
    /// Headers collected from peers but not judged yet.
    pub fn pending_count(&self) -> usize {
        self.pending.values().map(|p| p.metas.len()).sum()
    }
    /// Headers in the block tree (main chain, side branches, and headers awaiting bodies).
    pub fn block_count(&self) -> usize {
        self.index.len()
    }
    /// Bodies held, in memory or on disk.
    pub fn body_count(&self) -> usize {
        self.bodies.len()
    }

    /// Our chain's work `k` blocks back: the least a side branch needs to be worth keeping.
    fn floor_at(&self, k: u64) -> u128 {
        let h = self.height().saturating_sub(k);
        self.index[&self.main[h as usize]].cum_work
    }
    pub fn header_floor(&self) -> u128 {
        self.floor_at(HEADER_MARGIN)
    }
    pub fn body_floor(&self) -> u128 {
        self.floor_at(BODY_MARGIN)
    }

    /// Caught up: our chain has `min_chain_work` and no known header chain is much further ahead.
    /// Until then the node doesn't mine.
    pub fn is_synced(&self) -> bool {
        let tip = self.tip();
        tip.cum_work >= self.params.min_chain_work
            && self.best_header().header.height <= tip.header.height.saturating_add(SYNCED_LAG)
    }

    /// Save a small named value in the node's database (nothing happens for a chain without one).
    pub fn save_meta(&self, name: &str, value: &[u8]) {
        if let Some(store) = &self.store
            && let Err(e) = store.put_meta(name, value)
        {
            tracing::warn!("could not save {name}: {e}");
        }
    }

    pub fn load_meta(&self, name: &str) -> Option<Vec<u8>> {
        self.store.as_ref()?.meta(name).ok().flatten()
    }

    /// Difficulty required for a child of `parent`.
    pub fn next_difficulty_for(&self, parent: &Hash) -> u128 {
        next_difficulty(&self.view().history(parent, self.params.lwma_window as usize + 1), self.params)
    }

    /// Minimum valid timestamp for a child of `parent`: after the median of recent blocks, and at
    /// least `min_block_spacing` seconds after the parent itself.
    pub fn min_timestamp_for(&self, parent: &Hash) -> u64 {
        self.view().min_timestamp_for(self.params, parent)
    }

    /// Earliest time (unix seconds) a block on the current tip can be valid. Miners wait for it.
    pub fn next_block_due(&self) -> u64 {
        self.min_timestamp_for(&self.tip().hash)
    }

    /// RandomX key for a block at `height` whose parent is `parent`.
    pub fn seed_for(&self, parent: &Hash, height: u64) -> Option<Hash> {
        self.view().ancestor(&self.main, parent, seed_height(height))
    }

    /// Block locator: recent hashes densely, then exponentially sparser, then genesis.
    fn locator_of(chain: &[Hash]) -> Vec<Hash> {
        let mut out = Vec::new();
        let mut h = chain.len() as i64 - 1;
        let mut step = 1i64;
        while h > 0 {
            out.push(chain[h as usize]);
            if out.len() >= 10 {
                step *= 2;
            }
            h -= step;
        }
        out.push(chain[0]);
        out
    }

    /// Locator of our main chain.
    pub fn locator(&self) -> Vec<Hash> {
        Self::locator_of(&self.main)
    }

    /// Locator to send `peer` when asking for headers: continues after the headers we're already
    /// collecting from it, otherwise after our best header chain.
    pub fn header_locator(&self, peer: u64) -> Vec<Hash> {
        let mut out = Vec::new();
        if let Some(m) = self.pending.get(&peer).and_then(|p| p.metas.last()) {
            out.push(m.hash);
        }
        out.extend(Self::locator_of(&self.header_main));
        out
    }

    /// Main-chain headers after the first locator hash we recognize.
    pub fn headers_after_locator(&self, locator: &[Hash], max: usize) -> Vec<BlockHeader> {
        let start = locator.iter().find_map(|h| self.is_main(h).then(|| self.index[h].header.height)).unwrap_or(0);
        ((start + 1)..=self.height()).take(max).map(|h| self.index[&self.main[h as usize]].header.clone()).collect()
    }

    /// The bodies we hold out of `hashes`, stopping at `max_bytes`.
    pub fn bodies_for(&self, hashes: &[Hash], max_bytes: usize) -> Vec<Block> {
        let mut out = Vec::new();
        let mut bytes = 0;
        for h in hashes {
            let Some(b) = self.body(h) else { continue };
            bytes += b.to_bytes().len();
            if !out.is_empty() && bytes > max_bytes {
                break;
            }
            out.push((*b).clone());
        }
        out
    }

    /// Height of the last block `main` and `header_main` have in common.
    fn fork_with_header_main(&self) -> u64 {
        let mut h = (self.main.len().min(self.header_main.len()) - 1) as u64;
        while self.main[h as usize] != self.header_main[h as usize] {
            h -= 1; // both start at genesis, so this stops
        }
        h
    }

    /// Bodies to download next: along the best header chain, oldest first. Empty until that chain
    /// has `min_chain_work` (so a fake low-work chain never costs us a download) or when there's
    /// nothing better than what we have.
    pub fn missing_bodies(&self, max: usize) -> Vec<Hash> {
        let best = self.best_header();
        if best.cum_work < self.params.min_chain_work || best.cum_work <= self.cum_work() {
            return vec![];
        }
        let from = self.fork_with_header_main() as usize + 1;
        self.header_main[from..].iter().filter(|h| !self.bodies.contains(h)).take(max).copied().collect()
    }

    // ---------- headers-first sync ----------

    /// Collect a batch of headers from `peer`. Checks every consensus rule except proof of work
    /// (cheap), and returns the headers whose proof of work must be checked now: one in
    /// POW_SAMPLE at random, and the last of the batch. The rest are checked before the branch
    /// is kept (except those covered by assume-valid), never if it's thrown away.
    pub fn stage_headers(&mut self, peer: u64, headers: &[BlockHeader]) -> Result<Staged, BlockError> {
        if headers.len() > MAX_HEADERS_PER_MSG {
            return Err(BlockError::Invalid(format!("more than {MAX_HEADERS_PER_MSG} headers in one message")));
        }
        let mut pend = self.pending.remove(&peer).unwrap_or_default();
        if pend.metas.len() + headers.len() > BIG_PENDING {
            let others = self.pending.iter().filter(|(k, p)| **k != peer && p.metas.len() > BIG_PENDING).count();
            if others >= MAX_BIG_PENDING_PEERS {
                return Ok(Staged::Busy);
            }
        }
        let r = self.stage_into(&mut pend, headers);
        if r.is_ok() && !pend.metas.is_empty() {
            self.pending.insert(peer, pend);
        }
        r
    }

    fn stage_into(&self, pend: &mut Pending, headers: &[BlockHeader]) -> Result<Staged, BlockError> {
        let now = now();
        // Which headers to spot-check on arrival. Straight from the operating system's random
        // source, not a seeded generator, so a peer can't work out which of its headers it could
        // get away with not mining. 256 is a whole number of POW_SAMPLE, so no value is favoured.
        let mut dice = vec![0u8; headers.len()];
        rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut dice);
        let mut jobs = Vec::new();
        let mut stalled = false;
        for (i, h) in headers.iter().enumerate() {
            let hash = h.hash();
            if self.index.contains_key(&hash) {
                if pend.metas.is_empty() {
                    continue; // overlap with what we have
                }
                return Err(BlockError::Mismatch("headers jump back into our chain".into()));
            }
            if pend.pos.contains_key(&hash) {
                continue;
            }
            if self.invalid.contains(&hash) || self.invalid.contains(&h.prev_hash) {
                return Err(BlockError::Invalid("descends from an invalid block".into()));
            }
            let parent = match pend.metas.last() {
                Some(last) if last.hash == h.prev_hash => last.clone(),
                Some(_) => return Err(BlockError::Mismatch("headers are not one chain".into())),
                None => match self.index.get(&h.prev_hash) {
                    Some(m) => m.clone(),
                    None => return Err(BlockError::Mismatch("headers don't connect to anything we know".into())),
                },
            };
            if h.timestamp > now.saturating_add(self.params.future_time_limit) {
                stalled = true;
                break;
            }
            let (cum_work, seed) = {
                let v = View { index: &self.index, extra: Some(pend) };
                v.check_header(self.params, h, &parent).map_err(BlockError::Invalid)?;
                let cum = parent
                    .cum_work
                    .checked_add(h.difficulty)
                    .ok_or_else(|| BlockError::Invalid("total work overflows".into()))?;
                let seed = v
                    .ancestor(&self.main, &parent.hash, seed_height(h.height))
                    .ok_or_else(|| BlockError::Internal("no RandomX seed for header".into()))?;
                (cum, seed)
            };
            let now_check = i + 1 == headers.len() || (dice[i] as u32).is_multiple_of(POW_SAMPLE);
            if now_check {
                jobs.push(PowJob { hash, seed, header: h.clone() });
            }
            pend.pos.insert(hash, pend.metas.len());
            pend.metas.push(BlockMeta { header: h.clone(), hash, cum_work });
            pend.seeds.push(seed);
            pend.checked.push(false);
        }
        Ok(Staged::Verify { jobs, stalled })
    }

    /// Decide what to do with `peer`'s collected headers, after the PoW of `verified` checked out.
    /// The branch is judged as a whole: kept as soon as it has more work than our best header,
    /// or once the peer has nothing more to send (or we've collected the maximum) if it's within
    /// HEADER_MARGIN blocks of our tip. While first syncing towards an assume-valid point, we
    /// keep collecting until we reach it so those headers can skip their RandomX check.
    pub fn judge_pending(&mut self, peer: u64, peer_done: bool, verified: &[Hash]) -> Judgement {
        let floor = self.header_floor();
        let best = self.best_header().cum_work;
        let best_height = self.best_header().header.height;
        let av = self.params.assume_valid;
        let Some(p) = self.pending.get_mut(&peer) else { return Judgement::Nothing };
        for h in verified {
            if let Some(&i) = p.pos.get(h) {
                p.checked[i] = true;
            }
        }
        let Some(last) = p.metas.last() else {
            self.pending.remove(&peer);
            return Judgement::Nothing;
        };
        let work = last.cum_work;
        let full = p.metas.len() >= MAX_PENDING_HEADERS;
        let reaching_av = matches!(av, Some((h, _)) if best_height < h && last.header.height < h);
        let commit = (work > best && !(reaching_av && !peer_done && !full)) || ((peer_done || full) && work >= floor);
        if commit {
            // Headers at or below the assume-valid block are proven by the hash chain that leads
            // to it, so they skip the RandomX check.
            let covered = av.and_then(|(_, h)| p.pos.get(&h).copied());
            let mut jobs: Vec<PowJob> = p
                .metas
                .iter()
                .enumerate()
                .filter(|(i, _)| !p.checked[*i] && covered.is_none_or(|c| *i > c))
                .map(|(i, m)| PowJob { hash: m.hash, seed: p.seeds[i], header: m.header.clone() })
                .collect();
            // Check the strongest claim first: a chain with fake work fails on it straight away.
            if let Some(top) = jobs.pop() {
                jobs.insert(0, top);
            }
            p.committing = true;
            return Judgement::Commit(jobs);
        }
        if peer_done || full {
            let why = if full {
                format!(
                    "a branch more than {MAX_PENDING_HEADERS} headers deep that still has less work than ours; not following it automatically"
                )
            } else {
                "its branch has too little work to keep".into()
            };
            self.pending.remove(&peer);
            return Judgement::Discard(why);
        }
        Judgement::NeedMore
    }

    /// Add `peer`'s judged headers to the block tree, after `judge_pending` said to and the
    /// proof of work of every job it handed back checked out. `verified` is those jobs' hashes.
    ///
    /// Refuses unless every header has either been checked or is covered by the assume-valid
    /// block, so a caller can't skip the slow check by mistake: that's the one thing holding up
    /// the sampling in `stage_headers`.
    pub fn commit_pending(&mut self, peer: u64, verified: &[Hash]) -> Result<usize, BlockError> {
        let Some(mut p) = self.pending.remove(&peer) else { return Ok(0) };
        let Some(first) = p.metas.first() else { return Ok(0) };
        if !p.committing {
            return Err(BlockError::Internal("commit without a Commit judgement".into()));
        }
        if !self.index.contains_key(&first.header.prev_hash) {
            return Err(BlockError::Internal("the headers' parent is no longer known".into()));
        }
        for h in verified {
            if let Some(&i) = p.pos.get(h) {
                p.checked[i] = true;
            }
        }
        let covered = self.params.assume_valid.and_then(|(_, h)| p.pos.get(&h).copied());
        if let Some(i) = (0..p.metas.len()).find(|i| !p.checked[*i] && covered.is_none_or(|c| *i > c)) {
            return Err(BlockError::Internal(format!(
                "header {} has not had its proof of work checked",
                p.metas[i].header.height
            )));
        }
        let n = p.metas.len();
        for m in p.metas {
            if !self.index.contains_key(&m.hash) && !self.invalid.contains(&m.hash) {
                self.insert_header(m);
            }
        }
        self.maybe_prune();
        Ok(n)
    }

    /// Stop applying blocks. The message says what broke; it goes in the log at error level
    /// every time something is turned away, because an operator needs to see it.
    fn halt(&mut self, why: impl Into<String>) -> SwitchError {
        let why = why.into();
        if self.halted.as_ref() != Some(&why) {
            tracing::error!(
                "SUPPLY CHECK FAILED: {why}. This is a bug in LOKYX, not a bad block. The node \
                 has stopped applying blocks and mining. Please report it with this message and \
                 the log, and don't delete the chain database: \
                 https://testnet.lokyx.xyz"
            );
        }
        self.halted = Some(why.clone());
        SwitchError::Halted(why)
    }

    /// Why the node has stopped applying blocks, if it has.
    pub fn halted(&self) -> Option<&str> {
        self.halted.as_deref()
    }

    /// Total work up to a header, if we know it: in `peer`'s collected headers or the block tree.
    pub fn header_work(&self, peer: u64, hash: &Hash) -> Option<u128> {
        if let Some(p) = self.pending.get(&peer)
            && let Some(&i) = p.pos.get(hash)
        {
            return Some(p.metas[i].cum_work);
        }
        self.index.get(hash).map(|m| m.cum_work)
    }

    /// Total work at the end of what we've collected from `peer` so far.
    pub fn pending_work(&self, peer: u64) -> Option<u128> {
        self.pending.get(&peer).and_then(|p| p.metas.last()).map(|m| m.cum_work)
    }

    /// Height of a header in the block tree.
    pub fn header_height(&self, hash: &Hash) -> Option<u64> {
        self.index.get(hash).map(|m| m.header.height)
    }

    /// Forget what we were collecting from `peer` (it disconnected, or sent something bad).
    pub fn drop_pending(&mut self, peer: u64) {
        self.pending.remove(&peer);
    }

    /// Check proof of work for a list of headers, the first one alone and the rest in parallel.
    /// Returns the hashes that passed, or the first failure. Call without holding the chain lock.
    pub fn verify_pow_jobs(jobs: &[PowJob]) -> Result<Vec<Hash>, (Hash, String)> {
        let Some((first, rest)) = jobs.split_first() else { return Ok(vec![]) };
        Chain::verify_pow(&first.seed, &first.header).map_err(|e| (first.hash, e))?;
        let threads = std::thread::available_parallelism().map_or(1, |n| n.get()).min(8);
        if rest.len() < 8 || threads == 1 {
            for j in rest {
                Chain::verify_pow(&j.seed, &j.header).map_err(|e| (j.hash, e))?;
            }
        } else {
            let chunk = rest.len().div_ceil(threads);
            std::thread::scope(|s| {
                let handles: Vec<_> = rest
                    .chunks(chunk)
                    .map(|c| {
                        s.spawn(move || {
                            for j in c {
                                Chain::verify_pow(&j.seed, &j.header).map_err(|e| (j.hash, e))?;
                            }
                            Ok::<(), (Hash, String)>(())
                        })
                    })
                    .collect();
                for h in handles {
                    h.join().map_err(|_| ([0u8; 32], "proof of work check panicked".to_string()))??;
                }
                Ok::<(), (Hash, String)>(())
            })?;
        }
        Ok(jobs.iter().map(|j| j.hash).collect())
    }

    // ---------- validation ----------

    /// Does the body belong to the header? A mismatch is the sender's fault, not the block's.
    pub fn body_matches(b: &Block) -> bool {
        Block::compute_tx_root(&b.txs) == b.header.tx_root
    }

    /// The consensus rules a body must meet that don't depend on state: size, transaction count,
    /// the block gas limit, and every transaction's stateless checks (signature, chain id, fee
    /// format). Exactly what applying the block checks first, so nothing valid is turned away.
    /// Call on a body that matches its header; a failure then means the block itself is invalid.
    pub fn check_body(b: &Block, p: &ChainParams) -> Result<(), String> {
        if b.txs.len() > MAX_TXS_PER_BLOCK {
            return Err("too many transactions".into());
        }
        if b.to_bytes().len() > MAX_BLOCK_BYTES {
            return Err("block too large".into());
        }
        crate::state::check_block_gas(&b.txs)?;
        let threads = std::thread::available_parallelism().map_or(1, |n| n.get()).min(8);
        if b.txs.len() < 64 || threads == 1 {
            for (i, t) in b.txs.iter().enumerate() {
                t.check_stateless(p).map_err(|e| format!("tx {i}: {e}"))?;
            }
            return Ok(());
        }
        let chunk = b.txs.len().div_ceil(threads);
        std::thread::scope(|s| {
            let handles: Vec<_> = b
                .txs
                .chunks(chunk)
                .enumerate()
                .map(|(ci, c)| {
                    s.spawn(move || {
                        for (j, t) in c.iter().enumerate() {
                            t.check_stateless(p).map_err(|e| format!("tx {}: {e}", ci * chunk + j))?;
                        }
                        Ok::<(), String>(())
                    })
                })
                .collect();
            for h in handles {
                h.join().map_err(|_| "signature check panicked".to_string())??;
            }
            Ok(())
        })
    }

    /// Returns the RandomX seed for a block if its parent is known (so PoW can be verified
    /// outside the chain lock).
    pub fn pow_seed(&self, b: &Block) -> Option<Hash> {
        self.index.get(&b.header.prev_hash)?;
        self.seed_for(&b.header.prev_hash, b.header.height)
    }

    /// Verify proof of work. Expensive (one RandomX hash); call without holding the chain lock.
    pub fn verify_pow(seed: &Hash, header: &BlockHeader) -> Result<(), String> {
        let h = PowEngine::global().hash(seed, &header.pow_input()).map_err(|e| e.to_string())?;
        if meets_difficulty(&h, header.difficulty) {
            Ok(())
        } else {
            Err("proof of work does not meet difficulty".into())
        }
    }

    /// The cheap part of handling a whole block: what's left to check before `process_block_checked`.
    pub fn precheck(&self, b: &Block) -> Result<Precheck, BlockError> {
        let hash = b.hash();
        if self.bodies.contains(&hash) {
            return Ok(Precheck::AlreadyKnown);
        }
        if self.invalid.contains(&hash) || self.invalid.contains(&b.header.prev_hash) {
            return Err(BlockError::Invalid("descends from an invalid block".into()));
        }
        if let Some(m) = self.index.get(&hash) {
            let keep_body = self.on_header_main(m) || m.cum_work >= self.body_floor();
            return Ok(Precheck::Go { seed: None, keep_body });
        }
        let Some(parent) = self.index.get(&b.header.prev_hash) else {
            if b.header.height == 0 {
                return Err(BlockError::Invalid("foreign genesis block".into()));
            }
            return Ok(Precheck::NeedHeaders);
        };
        let now = now();
        if b.header.timestamp > now.saturating_add(self.params.future_time_limit) {
            return Err(BlockError::TooEarly(format!("timestamp is {} s ahead", b.header.timestamp - now)));
        }
        self.view().check_header(self.params, &b.header, parent).map_err(BlockError::Invalid)?;
        let cum = parent
            .cum_work
            .checked_add(b.header.difficulty)
            .ok_or_else(|| BlockError::Invalid("total work overflows".into()))?;
        if cum < self.header_floor() {
            return Ok(Precheck::Ignored);
        }
        let keep_body = cum > self.best_header().cum_work || cum >= self.body_floor();
        let seed =
            self.seed_for(&parent.hash, b.header.height).ok_or_else(|| BlockError::Internal("no seed".into()))?;
        Ok(Precheck::Go { seed: Some(seed), keep_body })
    }

    /// A block whose body broke a consensus rule: remember it (and anything built on it) as invalid.
    pub fn reject_block(&mut self, hash: Hash) {
        self.mark_invalid(hash);
    }

    /// Process a block. `pow_checked` = the caller already verified PoW against `pow_seed`.
    pub fn process_block(&mut self, b: Block, pow_checked: bool) -> Result<Outcome, BlockError> {
        self.process_inner(b, pow_checked, false, true)
    }

    /// Like `process_block`; `body_checked` = the caller already ran `body_matches` and
    /// `check_body` on it (outside the lock).
    pub fn process_block_checked(
        &mut self,
        b: Block,
        pow_checked: bool,
        body_checked: bool,
    ) -> Result<Outcome, BlockError> {
        self.process_inner(b, pow_checked, body_checked, true)
    }

    fn process_inner(
        &mut self,
        b: Block,
        pow_checked: bool,
        body_checked: bool,
        persist: bool,
    ) -> Result<Outcome, BlockError> {
        if let Some(why) = &self.halted {
            return Err(BlockError::Halted(why.clone()));
        }
        let hash = b.hash();
        if self.bodies.contains(&hash) {
            return Ok(Outcome::AlreadyKnown);
        }
        if self.invalid.contains(&hash) || self.invalid.contains(&b.header.prev_hash) {
            self.invalid.insert(hash);
            return Err(BlockError::Invalid("descends from an invalid block".into()));
        }

        // The header: everything but the body, cheapest checks first, PoW last.
        if !self.index.contains_key(&hash) {
            let Some(parent) = self.index.get(&b.header.prev_hash).cloned() else {
                if b.header.height == 0 {
                    return Err(BlockError::Invalid("foreign genesis block".into()));
                }
                return Ok(Outcome::NeedHeaders);
            };
            let now = now();
            if b.header.timestamp > now.saturating_add(self.params.future_time_limit) {
                return Err(BlockError::TooEarly(format!("timestamp is {} s ahead", b.header.timestamp - now)));
            }
            self.view().check_header(self.params, &b.header, &parent).map_err(BlockError::Invalid)?;
            let cum_work = parent
                .cum_work
                .checked_add(b.header.difficulty)
                .ok_or_else(|| BlockError::Invalid("total work overflows".into()))?;
            if cum_work < self.header_floor() {
                return Ok(Outcome::Ignored);
            }
            if !pow_checked {
                let seed = self
                    .seed_for(&parent.hash, b.header.height)
                    .ok_or_else(|| BlockError::Internal("no seed".into()))?;
                Chain::verify_pow(&seed, &b.header).map_err(BlockError::Invalid)?;
            }
            self.insert_header(BlockMeta { header: b.header.clone(), hash, cum_work });
        }

        // The body: only kept on the best header chain or close enough to our tip.
        let meta = self.index[&hash].clone();
        if !(self.on_header_main(&meta) || meta.cum_work >= self.body_floor()) {
            return Ok(Outcome::SideChain);
        }
        if !body_checked {
            if !Chain::body_matches(&b) {
                return Err(BlockError::Mismatch("transactions don't match the header's transaction root".into()));
            }
            if let Err(e) = Chain::check_body(&b, self.params) {
                self.mark_invalid(hash);
                return Err(BlockError::Invalid(e));
            }
        }
        if persist && let Some(s) = &self.store {
            s.put_block(&hash, &b).map_err(|e| BlockError::Internal(e.to_string()))?;
        }
        self.bodies.insert(hash, b);

        let before = self.tip().hash;
        let out = match self.try_advance() {
            Ok(o) => o,
            Err(SwitchError::Invalid(bad, e)) if bad == hash => return Err(BlockError::Invalid(e)),
            Err(SwitchError::Invalid(bad, e)) => {
                // A block that arrived earlier turned out to be invalid; not this sender's fault.
                tracing::warn!("block {} found invalid while connecting: {e}", crate::crypto::to_hex(&bad[..8]));
                Outcome::SideChain
            }
            Err(SwitchError::Internal(e)) => return Err(BlockError::Internal(e)),
            Err(SwitchError::Halted(e)) => return Err(BlockError::Halted(e)),
        };
        if persist
            && self.tip().hash != before
            && let Some(s) = &self.store
        {
            s.set_tip(&self.tip().hash).map_err(|e| BlockError::Internal(e.to_string()))?;
        }
        self.maybe_prune();
        Ok(match out {
            o @ Outcome::NewTip { .. } => o,
            _ => Outcome::SideChain,
        })
    }

    /// Add a header to the block tree (all its checks have passed).
    fn insert_header(&mut self, m: BlockMeta) {
        let (hash, prev, cum) = (m.hash, m.header.prev_hash, m.cum_work);
        self.children.entry(prev).or_default().push(hash);
        self.index.insert(hash, m);
        if cum > self.best_header().cum_work {
            self.set_best_header(hash);
        } else {
            self.side.insert(hash);
        }
    }

    /// Make `new_best` the end of `header_main`.
    fn set_best_header(&mut self, new_best: Hash) {
        let mut branch = Vec::new();
        let mut cur = new_best;
        loop {
            let m = &self.index[&cur];
            if self.header_main.get(m.header.height as usize) == Some(&cur) {
                break;
            }
            branch.push(cur);
            cur = m.header.prev_hash; // genesis is always on header_main, so this stops
        }
        let keep = self.index[&cur].header.height as usize + 1;
        let left: Vec<Hash> = self.header_main.drain(keep..).collect();
        self.side.extend(left);
        for x in branch.into_iter().rev() {
            self.side.remove(&x);
            self.header_main.push(x);
        }
    }

    /// Connect whatever the bodies we hold now allow: extend the tip along the best header chain,
    /// or switch to it once its branch has more work than ours and all its bodies.
    fn try_advance(&mut self) -> Result<Outcome, SwitchError> {
        let mut out = Outcome::SideChain;
        loop {
            let fork = self.fork_with_header_main();
            let tip_h = self.height();
            if fork == tip_h {
                let Some(&next) = self.header_main.get(tip_h as usize + 1) else { break };
                if !self.bodies.contains(&next) {
                    break;
                }
                out = merge(out, self.switch_to(next)?);
            } else {
                let tip_work = self.cum_work();
                let mut target = None;
                for h in &self.header_main[fork as usize + 1..] {
                    if !self.bodies.contains(h) {
                        break;
                    }
                    if self.index[h].cum_work > tip_work {
                        target = Some(*h);
                    }
                }
                match target {
                    Some(t) => out = merge(out, self.switch_to(t)?),
                    None => break,
                }
            }
        }
        Ok(out)
    }

    /// Apply a block to the state in place, noting what it changed. If the block is invalid or
    /// breaks the supply invariant, everything it did is taken back before returning.
    fn apply_noting(&mut self, b: &Block) -> Result<(Vec<(Hash, crate::contract::Receipt)>, Undo), ApplyFailure> {
        self.state.record();
        let receipts = match self.state.apply_block(b, self.params) {
            Ok(r) => r,
            Err(e) => {
                let u = self.state.finish();
                self.state.undo(u);
                return Err(ApplyFailure::Invalid(e));
            }
        };
        // Our own books, checked before this becomes the chain.
        if let Err(e) = self.state.check_supply(b.header.height, self.params) {
            let u = self.state.finish();
            self.state.undo(u);
            return Err(ApplyFailure::Supply(e));
        }
        Ok((receipts, self.state.finish()))
    }

    fn push_undo(&mut self, height: u64, u: Undo) {
        self.undos.insert(height, u);
        while self.undos.len() > MAX_UNDO {
            let first = *self.undos.keys().next().expect("not empty");
            self.undos.remove(&first);
        }
    }

    /// Step the state back from the tip to `fork_height` using the undo notes. Only valid when
    /// there is a note for every block in between.
    fn roll_back_to(&mut self, fork_height: u64) {
        for h in ((fork_height + 1)..=self.height()).rev() {
            let u = self.undos.remove(&h).expect("checked by the caller");
            self.state.undo(u);
        }
    }

    /// A branch failed part-way: take back the blocks of it already applied (`applied`, oldest
    /// first) and put the old best chain back on, so the state is what it was before the switch.
    fn restore_after_failed_switch(
        &mut self,
        fork_height: u64,
        applied: Vec<Undo>,
        old_tip: u64,
    ) -> Result<(), String> {
        for u in applied.into_iter().rev() {
            self.state.undo(u);
        }
        for h in (fork_height + 1)..=old_tip {
            let b = self.body(&self.main[h as usize]).ok_or("a block of our own chain has no body")?;
            match self.apply_noting(&b) {
                Ok((_, u)) => self.push_undo(h, u),
                Err(ApplyFailure::Invalid(e) | ApplyFailure::Supply(e)) => {
                    return Err(format!("putting our own chain back at height {h}: {e}"));
                }
            }
        }
        Ok(())
    }

    /// Make `new_tip` the best chain, fully validating every block that becomes connected.
    fn switch_to(&mut self, new_tip: Hash) -> Result<Outcome, SwitchError> {
        let tip_meta = self.index[&new_tip].clone();

        // Fast path: extends the current tip. The block goes straight onto the state, with a note
        // of what it changed; the state is never copied.
        if tip_meta.header.prev_hash == *self.main.last().unwrap() {
            let block = self.body(&new_tip).expect("body checked by the caller");
            let (receipts, undo) = match self.apply_noting(&block) {
                Ok(x) => x,
                Err(ApplyFailure::Invalid(e)) => {
                    self.mark_invalid(new_tip);
                    return Err(SwitchError::Invalid(new_tip, e));
                }
                Err(ApplyFailure::Supply(e)) => return Err(self.halt(e)),
            };
            self.push_undo(tip_meta.header.height, undo);
            self.keep_receipts(&receipts);
            self.receipts.extend(receipts);
            self.main.push(new_tip);
            self.index_txs(tip_meta.header.height);
            self.maybe_snapshot(tip_meta.header.height, new_tip);
            return Ok(Outcome::NewTip { reorg_depth: 0, disconnected: vec![] });
        }

        // Reorg: find the fork point, then rebuild state along the new branch.
        let mut branch = vec![new_tip];
        let mut cur = tip_meta.header.prev_hash;
        while !self.is_main(&cur) {
            branch.push(cur);
            cur = self.index[&cur].header.prev_hash;
        }
        branch.reverse();
        let fork_height = self.index[&cur].header.height;
        let old_tip = self.height();

        let mut branch_snapshots = Vec::new();
        let mut branch_receipts = Vec::new();
        let mut branch_undos: Vec<Undo> = Vec::new();
        let undone = ((fork_height + 1)..=old_tip).all(|h| self.undos.contains_key(&h));
        if undone {
            // Step the old blocks off, then put the new ones on. Cost: the blocks involved.
            self.roll_back_to(fork_height);
            for bh in &branch {
                let b = self.body(bh).expect("branch bodies are held");
                match self.apply_noting(&b) {
                    Ok((r, u)) => {
                        branch_receipts.extend(r);
                        branch_undos.push(u);
                    }
                    Err(f) => {
                        if let Err(e) = self.restore_after_failed_switch(fork_height, branch_undos, old_tip) {
                            return Err(self.halt(e));
                        }
                        return match f {
                            ApplyFailure::Invalid(e) => {
                                self.mark_invalid(*bh);
                                Err(SwitchError::Invalid(*bh, format!("reorg branch block invalid: {e}")))
                            }
                            ApplyFailure::Supply(e) => Err(self.halt(e)),
                        };
                    }
                }
                if b.header.height.is_multiple_of(SNAPSHOT_EVERY) {
                    branch_snapshots.push((b.header.height, *bh, self.state.clone()));
                }
            }
        } else {
            // Further back than the notes go: rebuild from the newest snapshot at or below the
            // fork point (or genesis) on a copy, and validate the new branch on top of it.
            let (start, mut s) = self
                .snapshots
                .range(..=fork_height)
                .next_back()
                .filter(|(h, (hash, _))| self.main.get(**h as usize) == Some(hash))
                .map(|(h, (_, st))| (*h, st.clone()))
                .unwrap_or((0, State::default()));
            for h in (start + 1)..=fork_height {
                let b = self.body(&self.main[h as usize]).expect("best-chain block");
                s.apply_block(&b, self.params)
                    .map_err(|e| SwitchError::Internal(format!("main chain replay failed: {e}")))?;
                if let Err(e) = s.check_supply(h, self.params) {
                    return Err(self.halt(format!("replaying our own chain: {e}")));
                }
            }
            for bh in &branch {
                let b = self.body(bh).expect("branch bodies are held");
                match s.apply_block(&b, self.params) {
                    Ok(r) => branch_receipts.extend(r),
                    Err(e) => {
                        self.mark_invalid(*bh);
                        return Err(SwitchError::Invalid(*bh, format!("reorg branch block invalid: {e}")));
                    }
                }
                if let Err(e) = s.check_supply(b.header.height, self.params) {
                    return Err(self.halt(e));
                }
                if b.header.height.is_multiple_of(SNAPSHOT_EVERY) {
                    branch_snapshots.push((b.header.height, *bh, s.clone()));
                }
            }
            self.state = s;
            // The notes for the old blocks past the fork are void; the new branch has none.
            self.undos.split_off(&(fork_height + 1));
        }
        self.snapshots.retain(|h, _| *h <= fork_height);
        if let Some((h, bh, st)) = branch_snapshots.last() {
            self.persist_state(*h, bh, st);
        }
        for (h, bh, st) in branch_snapshots {
            self.snapshots.insert(h, (bh, st));
        }
        if undone {
            for (i, u) in branch_undos.into_iter().enumerate() {
                self.push_undo(fork_height + 1 + i as u64, u);
            }
        }

        let old: Vec<Hash> = self.main.split_off(fork_height as usize + 1);
        let new_txs: HashSet<Hash> = branch
            .iter()
            .flat_map(|h| self.body(h).expect("held").txs.iter().map(|t| t.hash()).collect::<Vec<_>>())
            .collect();
        let disconnected: Vec<SignedTransaction> = old
            .iter()
            .flat_map(|h| self.body(h).expect("held").txs.clone())
            .filter(|t| !new_txs.contains(&t.hash()))
            .collect();
        let mut gone_receipts = Vec::new();
        for (i, h) in old.iter().enumerate() {
            let height = fork_height + 1 + i as u64;
            let body = self.body(h).expect("held");
            for t in &body.txs {
                self.tx_index.remove(&t.hash());
                if self.receipts.remove(&t.hash()).is_some() {
                    gone_receipts.push(t.hash());
                }
                if let Some(crate::swap::SwapOp::Claim { lock, .. } | crate::swap::SwapOp::Refund { lock }) =
                    crate::swap::op_of(t)
                {
                    self.swap_closed.remove(&lock);
                }
            }
            for (a, k) in self.block_addresses(h) {
                if let Some(set) = self.activity.get_mut(&a) {
                    set.remove(&(height, k));
                }
            }
        }
        if let Some(s) = &self.store {
            let _ = s.delete_receipts(&gone_receipts);
        }
        self.main.extend(branch.iter().copied());
        self.keep_receipts(&branch_receipts);
        self.receipts.extend(branch_receipts);
        for h in (fork_height + 1)..=self.height() {
            self.index_txs(h);
        }
        let depth = old.len() as u64;
        tracing::warn!("reorganization: depth {depth}, fork at height {fork_height}, new tip height {}", self.height());
        Ok(Outcome::NewTip { reorg_depth: depth, disconnected })
    }

    /// Write receipts to the database, so they survive a restart that doesn't replay the block.
    fn keep_receipts(&self, rs: &[(Hash, crate::contract::Receipt)]) {
        if let Some(s) = &self.store
            && let Err(e) = s.put_receipts(rs)
        {
            tracing::warn!("couldn't save receipts: {e}");
        }
    }

    /// Save the state at a snapshot height, so the next start can begin from it.
    fn persist_state(&self, height: u64, hash: &Hash, state: &State) {
        if let Some(s) = &self.store
            && let Err(e) = s.put_state(height, hash, state)
        {
            tracing::warn!("couldn't save the state at height {height}: {e}");
        }
    }

    fn maybe_snapshot(&mut self, height: u64, hash: Hash) {
        if height.is_multiple_of(SNAPSHOT_EVERY) {
            self.snapshots.insert(height, (hash, self.state.clone()));
            self.persist_state(height, &hash, &self.state);
            while self.snapshots.len() > MAX_SNAPSHOTS {
                let first = *self.snapshots.keys().next().unwrap();
                self.snapshots.remove(&first);
            }
        }
    }

    fn index_txs(&mut self, height: u64) {
        let h = self.main[height as usize];
        let body = self.body(&h).expect("best-chain block");
        let hashes: Vec<Hash> = body.txs.iter().map(|t| t.hash()).collect();
        for (i, th) in hashes.into_iter().enumerate() {
            self.tx_index.insert(th, (height, i));
            if let Some(crate::swap::SwapOp::Claim { lock, .. } | crate::swap::SwapOp::Refund { lock }) =
                crate::swap::op_of(&body.txs[i])
            {
                self.swap_closed.insert(lock, th);
            }
        }
        for (a, k) in self.block_addresses(&h) {
            self.activity.entry(a).or_default().insert((height, k));
        }
    }

    /// Every (address, slot) a block touches: the miner, and each tx's sender and recipient.
    fn block_addresses(&self, h: &Hash) -> Vec<(Address, u32)> {
        let b = self.body(h).expect("best-chain block");
        let mut out = vec![(b.header.coinbase, MINED)];
        for (i, t) in b.txs.iter().enumerate() {
            out.push((t.tx.from, i as u32));
            // whoever the operation pays or names: recipients, a swap's recipient, a vault's target
            for a in t.tx.counterparties() {
                out.push((a, i as u32));
            }
        }
        out
    }

    /// Newest-first activity for an address on the best chain, starting below `before_height`.
    pub fn address_activity(&self, a: &Address, before_height: Option<u64>, limit: usize) -> (Vec<(u64, u32)>, usize) {
        let Some(set) = self.activity.get(a) else { return (vec![], 0) };
        let upper = before_height.unwrap_or(u64::MAX);
        let items = set.iter().rev().filter(|(h, _)| *h < upper).take(limit).copied().collect();
        (items, set.len())
    }

    /// Count of blocks on the best chain mined by `a`.
    pub fn blocks_mined_by(&self, a: &Address) -> usize {
        self.activity.get(a).map(|s| s.iter().filter(|(_, k)| *k == MINED).count()).unwrap_or(0)
    }

    /// Remove a block and everything built on it from the tree, and remember them as invalid.
    fn mark_invalid(&mut self, h: Hash) {
        let mut stack = vec![h];
        let mut touched_best = false;
        while let Some(x) = stack.pop() {
            self.invalid.insert(x);
            if let Some(m) = self.index.remove(&x) {
                if self.header_main.get(m.header.height as usize) == Some(&x) {
                    touched_best = true;
                }
                if let Some(sib) = self.children.get_mut(&m.header.prev_hash) {
                    sib.retain(|c| *c != x);
                }
            }
            self.bodies.remove(&x);
            self.side.remove(&x);
            if let Some(s) = &self.store {
                let _ = s.delete_block(&x);
            }
            if let Some(kids) = self.children.remove(&x) {
                stack.extend(kids);
            }
        }
        if touched_best {
            self.recompute_best_header();
        }
    }

    /// After part of the best header chain was removed: find the best remaining header.
    fn recompute_best_header(&mut self) {
        let cut = self.header_main.iter().position(|h| !self.index.contains_key(h)).unwrap_or(self.header_main.len());
        self.header_main.truncate(cut);
        let start = &self.index[self.header_main.last().unwrap()];
        let best = best_header(start, self.index.values()).hash;
        self.set_best_header(best);
    }

    fn maybe_prune(&mut self) {
        if self.height() >= self.last_prune + PRUNE_EVERY || self.side.len() > 4 * MAX_HEADERS_PER_MSG {
            self.prune();
        }
    }

    /// Drop side branches that have fallen too far behind: headers below the header floor, and
    /// bodies below the body floor. Branches a peer's pending headers build on are kept.
    pub fn prune(&mut self) {
        self.last_prune = self.height();
        let floor = self.header_floor();
        let body_floor = self.body_floor();
        let mut protected: HashSet<Hash> =
            self.pending.values().filter_map(|p| p.metas.first()).map(|m| m.header.prev_hash).collect();
        // Children before parents, so each entry sees the best work reachable through it.
        let mut side: Vec<Hash> = self.side.iter().copied().collect();
        side.sort_by_key(|x| std::cmp::Reverse(self.index[x].header.height));
        let mut reach: HashMap<Hash, u128> = HashMap::new();
        for x in &side {
            let mut best = self.index[x].cum_work;
            for k in self.children.get(x).into_iter().flatten() {
                best = best.max(reach.get(k).copied().unwrap_or_else(|| self.index[k].cum_work));
                if protected.contains(k) {
                    protected.insert(*x);
                }
            }
            reach.insert(*x, best);
        }
        let (mut headers, mut bodies) = (0usize, 0usize);
        for x in side {
            if self.is_main(&x) {
                continue; // our own chain, even if a better header chain is downloading
            }
            if reach[&x] < floor && !protected.contains(&x) {
                let m = self.index.remove(&x).expect("side entry is indexed");
                if let Some(sib) = self.children.get_mut(&m.header.prev_hash) {
                    sib.retain(|c| *c != x);
                }
                self.children.remove(&x);
                self.side.remove(&x);
                if self.bodies.remove(&x)
                    && let Some(s) = &self.store
                {
                    let _ = s.delete_block(&x);
                }
                headers += 1;
            } else if self.index[&x].cum_work < body_floor && self.bodies.remove(&x) {
                if let Some(s) = &self.store {
                    let _ = s.delete_block(&x);
                }
                bodies += 1;
            }
        }
        if headers + bodies > 0 {
            tracing::debug!("pruned {headers} side headers and {bodies} side bodies");
        }
    }

    /// Assemble an unsolved block on the current tip. The caller supplies already-selected
    /// transactions; we compute every commitment exactly as validators will check it.
    pub fn block_template(
        &self,
        coinbase: crate::address::Address,
        txs: Vec<SignedTransaction>,
    ) -> Result<(Block, Hash), String> {
        if let Some(why) = &self.halted {
            return Err(format!("not mining: {why}"));
        }
        if !self.is_synced() {
            return Err("still syncing: not mining until caught up".into());
        }
        let parent = self.tip().clone();
        let height = parent.header.height + 1;
        let mut s = self.state.clone();
        let receipts = s.apply_body_with(height, coinbase, &txs, self.params)?;
        // Don't hand a miner a block that would stop every node that applied it.
        s.check_supply(height, self.params)?;
        let header = BlockHeader {
            version: BLOCK_VERSION,
            height,
            prev_hash: parent.hash,
            timestamp: now().max(self.min_timestamp_for(&parent.hash)),
            difficulty: self.next_difficulty_for(&parent.hash),
            tx_root: Block::compute_tx_root(&txs),
            state_root: s.root_incremental(),
            receipts_root: crate::contract::receipts_root(&receipts),
            coinbase,
            pow: crate::block::Pow::Native { nonce: 0 },
        };
        let seed = self.seed_for(&parent.hash, height).ok_or("no seed")?;
        Ok((Block { header, txs }, seed))
    }
}

/// What `precheck` found.
#[derive(Debug)]
pub enum Precheck {
    AlreadyKnown,
    NeedHeaders,
    Ignored,
    /// Still to do, outside the lock: verify PoW against `seed` (if any; none when the header is
    /// already known) and, if `keep_body`, the body. Then call `process_block_checked`.
    Go {
        seed: Option<Hash>,
        keep_body: bool,
    },
}

fn merge(a: Outcome, b: Outcome) -> Outcome {
    match (a, b) {
        (
            Outcome::NewTip { reorg_depth: d1, disconnected: mut x1 },
            Outcome::NewTip { reorg_depth: d2, disconnected: x2 },
        ) => {
            x1.extend(x2);
            Outcome::NewTip { reorg_depth: d1.max(d2), disconnected: x1 }
        }
        (a @ Outcome::NewTip { .. }, _) => a,
        (_, b) => b,
    }
}
