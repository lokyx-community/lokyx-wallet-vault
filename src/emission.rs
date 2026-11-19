//! Block reward schedule. This is the only place new LYX comes from.
//! 10 LYX, halving every 1,051,200 blocks, 0.5 LYX tail. No premine.
#![deny(clippy::float_arithmetic)]

use crate::params::ChainParams;

pub fn block_reward(height: u64, p: &ChainParams) -> u128 {
    if height == 0 {
        return 0;
    }
    let era = (height - 1) / p.halving_interval;
    let halved = if era >= 127 { 0 } else { p.initial_reward >> era };
    halved.max(p.tail_reward)
}

/// Total LYX issued by blocks 1..=height (closed form, era by era).
pub fn issued_through(height: u64, p: &ChainParams) -> u128 {
    let mut total: u128 = 0;
    let mut start = 1u64;
    while start <= height {
        let era_end = start + p.halving_interval - 1;
        let end = era_end.min(height);
        let reward = block_reward(start, p);
        total += reward * (end - start + 1) as u128;
        if reward == p.tail_reward {
            // Tail reached: the remaining blocks all pay the tail.
            total += p.tail_reward * (height - end) as u128;
            break;
        }
        start = end + 1;
    }
    total
}

/// Human-readable schedule for documentation / RPC.
pub fn schedule(p: &ChainParams, eras: u64) -> Vec<(u64, u64, u128)> {
    (0..eras)
        .map(|e| {
            let s = e * p.halving_interval + 1;
            (s, s + p.halving_interval - 1, block_reward(s, p))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::{COIN, TESTNET};

    #[test]
    fn schedule_values() {
        let p = &TESTNET;
        assert_eq!(block_reward(0, p), 0);
        assert_eq!(block_reward(1, p), 10 * COIN);
        assert_eq!(block_reward(p.halving_interval, p), 10 * COIN);
        assert_eq!(block_reward(p.halving_interval + 1, p), 5 * COIN);
        assert_eq!(block_reward(4 * p.halving_interval + 1, p), 625 * COIN / 1000);
        // 0.3125 < tail 0.5 -> tail.
        assert_eq!(block_reward(5 * p.halving_interval + 1, p), COIN / 2);
        assert_eq!(block_reward(u64::MAX, p), COIN / 2);
    }

    #[test]
    fn closed_form_matches_brute_force() {
        // Small synthetic params to brute-force across several eras.
        let p = ChainParams { halving_interval: 7, ..TESTNET.clone() };
        let mut sum = 0u128;
        for h in 0..200u64 {
            sum += block_reward(h, &p);
            assert_eq!(issued_through(h, &p), sum, "h={h}");
        }
        // Five full eras ≈ 20,367,000 LYX on testnet before the tail.
        let five = issued_through(5 * TESTNET.halving_interval, &TESTNET);
        assert_eq!(five, 1_051_200u128 * (10 * COIN + 5 * COIN + 5 * COIN / 2 + 5 * COIN / 4 + 5 * COIN / 8));
    }
}
