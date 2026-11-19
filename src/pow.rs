//! RandomX. Light mode for now (256 MiB); fast mode is on the roadmap.

use crate::crypto::Hash;
use crate::params::{RX_EPOCH, RX_LAG};
use parking_lot::Mutex;
use primitive_types::{U256, U512};
use randomx_rs::{RandomXCache, RandomXFlag, RandomXVM};
use std::sync::{Arc, OnceLock};

/// Height whose block hash keys RandomX for blocks at `height` (Monero's rx_seedheight).
pub fn seed_height(height: u64) -> u64 {
    if height <= RX_EPOCH + RX_LAG { 0 } else { (height - RX_LAG - 1) / RX_EPOCH * RX_EPOCH }
}

/// `hash` (read as a little-endian 256-bit integer) x difficulty must not overflow 2^256.
/// Equivalent to hash <= (2^256 − 1) / difficulty, i.e. on average `difficulty` hashes per block.
pub fn meets_difficulty(pow_hash: &Hash, difficulty: u128) -> bool {
    if difficulty == 0 {
        return false;
    }
    let h = U256::from_little_endian(pow_hash);
    let product: U512 = h.full_mul(U256::from(difficulty));
    product < (U512::one() << 256)
}

/// A RandomX cache is immutable after initialization and the RandomX API explicitly allows one
/// cache to back many VMs on different threads (randomx.h: "the cache can be shared by multiple
/// VMs"). The Rust binding just doesn't mark the raw pointer as Send/Sync.
pub struct SharedCache(RandomXCache);
// SAFETY: see above, the cache is read-only after `RandomXCache::new` returns, and its lifetime is
// managed by the binding's internal Arc. Each VM that reads it is confined to one thread.
// The one place in the crate that needs `unsafe`, and only to tell the compiler what randomx.h
// already promises (see the comment above).
#[allow(unsafe_code)]
unsafe impl Send for SharedCache {}
#[allow(unsafe_code)]
unsafe impl Sync for SharedCache {}

pub struct PowEngine {
    flags: RandomXFlag,
    caches: Mutex<Vec<(Hash, Arc<SharedCache>)>>,
}

impl PowEngine {
    pub fn global() -> &'static PowEngine {
        static ENGINE: OnceLock<PowEngine> = OnceLock::new();
        ENGINE.get_or_init(|| PowEngine { flags: RandomXFlag::get_recommended_flags(), caches: Mutex::new(vec![]) })
    }

    /// Cache for a seed. Keeps the two most recent keys (current epoch + the next one).
    pub fn cache(&self, seed: &Hash) -> anyhow::Result<Arc<SharedCache>> {
        let mut caches = self.caches.lock();
        if let Some((_, c)) = caches.iter().find(|(s, _)| s == seed) {
            return Ok(c.clone());
        }
        let c = Arc::new(SharedCache(RandomXCache::new(self.flags, seed)?));
        caches.push((*seed, c.clone()));
        if caches.len() > 2 {
            caches.remove(0);
        }
        Ok(c)
    }

    /// A per-thread VM. Not Send: create it on the thread that will use it.
    pub fn new_vm(&self, seed: &Hash) -> anyhow::Result<RandomXVM> {
        let c = self.cache(seed)?;
        Ok(RandomXVM::new(self.flags, Some(c.0.clone()), None)?)
    }

    pub fn hash(&self, seed: &Hash, input: &[u8]) -> anyhow::Result<Hash> {
        #[cfg(feature = "test-pow")]
        if test_pow::on() {
            return Ok(crate::crypto::tagged_hash(b"LOKYX/test-pow", &[&seed[..], input].concat()));
        }
        thread_local! {
            static VM: std::cell::RefCell<Option<(Hash, RandomXVM)>> = const { std::cell::RefCell::new(None) };
        }
        VM.with(|cell| {
            let mut slot = cell.borrow_mut();
            if slot.as_ref().map(|(s, _)| s != seed).unwrap_or(true) {
                *slot = Some((*seed, self.new_vm(seed)?));
            }
            let out = slot.as_ref().unwrap().1.calculate_hash(input)?;
            out.try_into().map_err(|_| anyhow::anyhow!("randomx returned wrong length"))
        })
    }
}

/// A cheap stand-in for RandomX, for tests that need thousands of blocks (RandomX light mode is
/// about 30 ms a hash). The `test-pow` feature only exists in test builds (Cargo.toml turns it on
/// through a dev-dependency), and `lokyxd` refuses to start if it is ever compiled in.
#[cfg(feature = "test-pow")]
pub mod test_pow {
    use std::sync::atomic::{AtomicBool, Ordering};
    static ON: AtomicBool = AtomicBool::new(false);
    /// Switch every hash in this process to the cheap function. Tests only.
    pub fn enable() {
        ON.store(true, Ordering::SeqCst);
    }
    pub(crate) fn on() -> bool {
        ON.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_randomx_test_vector() {
        // From tevador/RandomX tests: key "test key 000", input "This is a test".
        let key = b"test key 000";
        let f = RandomXFlag::get_recommended_flags();
        let vm = RandomXVM::new(f, Some(RandomXCache::new(f, key).unwrap()), None).unwrap();
        assert_eq!(
            hex::encode(vm.calculate_hash(b"This is a test").unwrap()),
            "639183aae1bf4c9a35884cb46b09cad9175f04efd7684e7262a0ac1c2f0b4e3f"
        );
    }

    #[test]
    fn difficulty_target_math() {
        assert!(meets_difficulty(&[0u8; 32], u128::MAX));
        assert!(meets_difficulty(&[0xff; 32], 1));
        assert!(!meets_difficulty(&[0xff; 32], 2));
        assert!(!meets_difficulty(&[0u8; 32], 0));
        // Boundary: hash = 2^255 − 1 passes difficulty 2; 2^255 does not (2^255 x 2 = 2^256).
        let mut h = [0xffu8; 32];
        h[31] = 0x7f;
        assert!(meets_difficulty(&h, 2));
        assert!(!meets_difficulty(&h, 3));
        let mut h = [0u8; 32];
        h[31] = 0x80;
        assert!(!meets_difficulty(&h, 2));
    }

    #[test]
    fn seed_schedule() {
        assert_eq!(seed_height(0), 0);
        assert_eq!(seed_height(2048 + 64), 0);
        assert_eq!(seed_height(2048 + 65), 2048);
        assert_eq!(seed_height(4096 + 64), 2048);
        assert_eq!(seed_height(4096 + 65), 4096);
    }
}
