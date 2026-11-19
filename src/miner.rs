//! Built-in RandomX miner. Stats here are counted, not estimated.

use crate::address::Address;
use crate::block::Block;
use crate::crypto::Hash;
use crate::node::Node;
use crate::pow::{PowEngine, meets_difficulty};
use parking_lot::{Mutex, RwLock};
use randomx_rs::RandomXVM;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

pub struct Job {
    pub id: u64,
    pub block: Block,
    pub seed: Hash,
    pub created: Instant,
    pub tip: Hash,
    pub mempool_gen: u64,
}

pub struct Miner {
    pub enabled: AtomicBool,
    pub threads: AtomicUsize,
    pub max_threads: usize,
    pub coinbase: Mutex<Option<Address>>,
    pub hashes_total: AtomicU64,
    hashrate_bits: AtomicU64,
    pub blocks_found: AtomicU64,
    pub blocks_accepted: AtomicU64,
    pub blocks_stale: AtomicU64,
    pub blocks_rejected: AtomicU64,
    pub last_accepted: Mutex<Option<(u64, Hash)>>,
    job: RwLock<Option<Arc<Job>>>,
    job_id: AtomicU64,
}

impl Default for Miner {
    fn default() -> Self {
        Self::new()
    }
}

impl Miner {
    pub fn new() -> Self {
        Miner {
            enabled: AtomicBool::new(false),
            threads: AtomicUsize::new(1),
            max_threads: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
            coinbase: Mutex::new(None),
            hashes_total: AtomicU64::new(0),
            hashrate_bits: AtomicU64::new(0f64.to_bits()),
            blocks_found: AtomicU64::new(0),
            blocks_accepted: AtomicU64::new(0),
            blocks_stale: AtomicU64::new(0),
            blocks_rejected: AtomicU64::new(0),
            last_accepted: Mutex::new(None),
            job: RwLock::new(None),
            job_id: AtomicU64::new(0),
        }
    }

    /// Measured hashes per second (exponential moving average over ~10 s).
    pub fn hashrate(&self) -> f64 {
        f64::from_bits(self.hashrate_bits.load(Ordering::Relaxed))
    }

    pub fn configure(&self, enabled: bool, threads: Option<usize>, coinbase: Option<Address>) -> Result<(), String> {
        if let Some(c) = coinbase {
            *self.coinbase.lock() = Some(c);
        }
        if let Some(t) = threads {
            if t == 0 || t > self.max_threads {
                return Err(format!("threads must be 1..={}", self.max_threads));
            }
            self.threads.store(t, Ordering::Relaxed);
        }
        if enabled && self.coinbase.lock().is_none() {
            return Err("set a coinbase (lyx1…) address before mining".into());
        }
        self.enabled.store(enabled, Ordering::Relaxed);
        if !enabled {
            *self.job.write() = None;
            self.job_id.fetch_add(1, Ordering::Relaxed);
        }
        Ok(())
    }
}

/// Spawn the coordinator, `max_threads` workers (idle unless enabled), and the result handler.
pub fn start(node: Arc<Node>) {
    let miner = node.miner.clone();
    let (found_tx, mut found_rx) = mpsc::unbounded_channel::<Block>();

    // Coordinator: keeps the job fresh and measures hashrate.
    {
        let node = node.clone();
        let miner = miner.clone();
        std::thread::Builder::new()
            .name("miner-coord".into())
            .spawn(move || {
                let mut last_count = 0u64;
                let mut last_tick = Instant::now();
                let mut ema = 0f64;
                let mut idled = false;
                loop {
                    std::thread::sleep(Duration::from_millis(250));
                    if idled {
                        // Part of this second was spent waiting out the block spacing. Measuring it
                        // would show a fraction of the real speed, so skip it.
                        last_count = miner.hashes_total.load(Ordering::Relaxed);
                        last_tick = Instant::now();
                        idled = false;
                    } else if last_tick.elapsed() >= Duration::from_secs(1) {
                        let total = miner.hashes_total.load(Ordering::Relaxed);
                        let rate = (total - last_count) as f64 / last_tick.elapsed().as_secs_f64();
                        ema = if miner.enabled.load(Ordering::Relaxed) {
                            if ema == 0.0 { rate } else { ema * 0.8 + rate * 0.2 }
                        } else {
                            0.0
                        };
                        miner.hashrate_bits.store(ema.to_bits(), Ordering::Relaxed);
                        last_count = total;
                        last_tick = Instant::now();
                    }
                    if !miner.enabled.load(Ordering::Relaxed) {
                        continue;
                    }
                    let Some(coinbase) = *miner.coinbase.lock() else { continue };
                    let (tip, due, synced, halted) = {
                        let c = node.chain.lock();
                        (c.tip().hash, c.next_block_due(), c.is_synced(), c.halted().is_some())
                    };
                    // Nothing can be mined until min_block_spacing has passed since the tip, or
                    // while we're still catching up with the network (that would only make a
                    // fork nobody follows). Park the workers until then.
                    // Halted means a supply bug: stop for good rather than build on a state we
                    // can't account for. The error is already in the log from the chain.
                    if crate::chain::now() < due || !synced || halted {
                        idled = true;
                        if miner.job.read().is_some() {
                            *miner.job.write() = None;
                            miner.job_id.fetch_add(1, Ordering::Relaxed);
                        }
                        continue;
                    }
                    let mp_gen = node.mempool.lock().generation;
                    let stale = match &*miner.job.read() {
                        None => true,
                        Some(j) => {
                            j.tip != tip
                                || (j.mempool_gen != mp_gen && j.created.elapsed() > Duration::from_secs(2))
                                || j.created.elapsed() > Duration::from_secs(30)
                        }
                    };
                    if !stale {
                        continue;
                    }
                    let built = {
                        let c = node.chain.lock();
                        let mp = node.mempool.lock();
                        let txs = mp.select(&c.state, node.params);
                        c.block_template(coinbase, txs).map(|(b, s)| (b, s, c.tip().hash, mp.generation))
                    };
                    match built {
                        Ok((block, seed, tip, mempool_gen)) => {
                            let id = miner.job_id.fetch_add(1, Ordering::Relaxed) + 1;
                            *miner.job.write() =
                                Some(Arc::new(Job { id, block, seed, created: Instant::now(), tip, mempool_gen }));
                        }
                        Err(e) => tracing::error!("could not build block template: {e}"),
                    }
                }
            })
            .expect("spawn miner coordinator");
    }

    // Workers.
    for i in 0..miner.max_threads {
        let miner = miner.clone();
        let found_tx = found_tx.clone();
        std::thread::Builder::new()
            .name(format!("miner-{i}"))
            .spawn(move || {
                let mut vm: Option<(Hash, RandomXVM)> = None;
                let mut done_job = 0u64;
                loop {
                    let active = miner.enabled.load(Ordering::Relaxed) && i < miner.threads.load(Ordering::Relaxed);
                    let job = if active { miner.job.read().clone() } else { None };
                    let Some(job) = job.filter(|j| j.id != done_job) else {
                        std::thread::sleep(Duration::from_millis(100));
                        continue;
                    };
                    if vm.as_ref().map(|(s, _)| *s != job.seed).unwrap_or(true) {
                        match PowEngine::global().new_vm(&job.seed) {
                            Ok(v) => vm = Some((job.seed, v)),
                            Err(e) => {
                                tracing::error!("RandomX VM init failed: {e}");
                                std::thread::sleep(Duration::from_secs(1));
                                continue;
                            }
                        }
                    }
                    let v = &vm.as_ref().unwrap().1;
                    let mut header = job.block.header.clone();
                    header.set_nonce(rand::random::<u64>());
                    // Hash until the job changes, mining is paused, or a block is found.
                    while miner.job_id.load(Ordering::Relaxed) == job.id
                        && miner.enabled.load(Ordering::Relaxed)
                        && i < miner.threads.load(Ordering::Relaxed)
                    {
                        // Keep the timestamp current: a block should say when it was found, not
                        // when work on it started. Spacing and difficulty both depend on it.
                        let t = crate::chain::now();
                        if t > header.timestamp {
                            header.timestamp = t;
                        }
                        let Ok(h) = v.calculate_hash(&header.pow_input()) else { break };
                        miner.hashes_total.fetch_add(1, Ordering::Relaxed);
                        if meets_difficulty(&h.try_into().unwrap_or([0xff; 32]), header.difficulty) {
                            miner.blocks_found.fetch_add(1, Ordering::Relaxed);
                            let _ = found_tx.send(Block { header: header.clone(), txs: job.block.txs.clone() });
                            done_job = job.id;
                            break;
                        }
                        header.bump_nonce();
                    }
                }
            })
            .expect("spawn miner worker");
    }

    // Results: submit found blocks through the same validation path as peer blocks.
    tokio::spawn(async move {
        while let Some(b) = found_rx.recv().await {
            let (height, hash) = (b.header.height, b.hash());
            match node.submit_block(b, None).await {
                Ok(crate::chain::Outcome::NewTip { .. }) => {
                    miner.blocks_accepted.fetch_add(1, Ordering::Relaxed);
                    *miner.last_accepted.lock() = Some((height, hash));
                    tracing::info!(
                        "⛏  mined block {height} {}, accepted as new tip",
                        crate::crypto::to_hex(&hash[..8])
                    );
                }
                Ok(o) => {
                    miner.blocks_stale.fetch_add(1, Ordering::Relaxed);
                    tracing::info!("mined block {height} was stale ({o:?})");
                }
                Err(e) => {
                    miner.blocks_rejected.fetch_add(1, Ordering::Relaxed);
                    tracing::error!("mined block {height} rejected: {e}");
                }
            }
        }
    });
}
