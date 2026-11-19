//! LWMA-1 (zawy). Solvetimes are measured after min_block_spacing, since nobody
//! can mine before that anyway.
#![deny(clippy::float_arithmetic)]

use crate::params::ChainParams;
use primitive_types::U256;

/// `history` = (timestamp, difficulty) of *mined* ancestors, oldest first, ending at the parent.
/// The genesis block is excluded (it is not mined and its timestamp is fixed).
pub fn next_difficulty(history: &[(u64, u128)], p: &ChainParams) -> u128 {
    if history.is_empty() {
        return p.initial_difficulty;
    }
    // young chain: pretend the missing blocks came in on target, otherwise the first few lucky
    // blocks swing difficulty all over the place
    let want = p.lwma_window as usize + 1;
    let padded: Vec<(u64, u128)>;
    let history = if history.len() < want {
        let missing = want - history.len();
        let first = history[0].0;
        padded = (1..=missing)
            .rev()
            .map(|k| (first.saturating_sub(k as u64 * p.target_block_time), p.initial_difficulty))
            .chain(history.iter().copied())
            .collect();
        &padded[..]
    } else {
        history
    };
    let n = (history.len() - 1).min(p.lwma_window as usize);
    let window = &history[history.len() - n - 1..];
    let s = p.min_block_spacing as i128;
    let t = p.target_block_time as i128 - s;
    debug_assert!(t > 0, "min_block_spacing must be below target_block_time");

    let mut prev_ts = window[0].0 as i128;
    let mut weighted: i128 = 0;
    let mut sum_d = U256::zero();
    for (i, &(ts, d)) in window.iter().enumerate().skip(1) {
        // Monotonic timestamps defeat out-of-order timestamp manipulation.
        let ts = (ts as i128).max(prev_ts + 1);
        let solvetime = (ts - prev_ts - s).clamp(1, 6 * t);
        prev_ts = ts;
        weighted += solvetime * i as i128;
        sum_d += U256::from(d);
    }
    let n_i = n as i128;
    let k = n_i * (n_i + 1) * t / 2; // weighted sum if every block took exactly T
    let weighted = weighted.max(k / 10).max(1); // cap a single-step rise at 10x

    let next = sum_d * U256::from(k as u128) / (U256::from(n as u128) * U256::from(weighted as u128));
    let next = if next > U256::from(u128::MAX) { u128::MAX } else { next.as_u128() };
    next.max(p.min_difficulty)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::DEVNET;

    /// Devnet timing without the spacing rule, to test plain LWMA behaviour.
    fn plain() -> ChainParams {
        ChainParams { min_block_spacing: 0, ..DEVNET.clone() }
    }

    fn hist(times: &[u64], d: u128) -> Vec<(u64, u128)> {
        times.iter().map(|&t| (t, d)).collect()
    }

    #[test]
    fn stable_when_on_target() {
        let times: Vec<u64> = (0..61).map(|i| 1000 + i * DEVNET.target_block_time).collect();
        assert_eq!(next_difficulty(&hist(&times, 5000), &plain()), 5000);
    }

    #[test]
    fn rises_when_fast_falls_when_slow() {
        let fast: Vec<u64> = (0..61).map(|i| 1000 + i * 5).collect();
        let slow: Vec<u64> = (0..61).map(|i| 1000 + i * 45).collect();
        let up = next_difficulty(&hist(&fast, 5000), &plain());
        let down = next_difficulty(&hist(&slow, 5000), &plain());
        assert!(up > 12_000 && up <= 15_000, "{up}");
        assert!(down < 2_000 && down > 1_500, "{down}");
    }

    #[test]
    fn bounded_against_timestamp_attacks() {
        // All blocks at the same timestamp: rise capped at 10x.
        let same = hist(&[1000; 61], 5000);
        assert_eq!(next_difficulty(&same, &plain()), 50_000);
        // Huge gap: solvetime clamped to 6T, so a single jump can't crater difficulty.
        let mut t: Vec<u64> = (0..61).map(|i| 1000 + i * 15).collect();
        *t.last_mut().unwrap() += 1_000_000;
        assert!(next_difficulty(&hist(&t, 5000), &plain()) > 4000);
        // Never below the floor.
        let dead: Vec<u64> = (0..61).map(|i| i * 100_000).collect();
        assert_eq!(next_difficulty(&hist(&dead, 31), &plain()), plain().min_difficulty);
        assert_eq!(next_difficulty(&[], &plain()), plain().initial_difficulty);
    }

    #[test]
    fn spacing_is_taken_out_of_the_race() {
        let p = &crate::params::TESTNET;
        let t0 = 1_800_000_000;
        // Every block exactly on target (spacing + 10 s of racing): difficulty holds.
        let on: Vec<u64> = (0..61).map(|i| t0 + i * p.target_block_time).collect();
        assert_eq!(next_difficulty(&hist(&on, 400), p), 400);
        // Racing part took 20 s instead of 10: difficulty roughly halves, it doesn't drop by 1/7.
        let slow: Vec<u64> = (0..61).map(|i| t0 + i * (p.min_block_spacing + 20)).collect();
        let d = next_difficulty(&hist(&slow, 400), p);
        assert!((190..=210).contains(&d), "{d}");
    }

    #[test]
    fn young_chain_is_not_thrown_by_lucky_blocks() {
        // Three blocks whose racing part took 1 s, 5 s and 4 s on a 10 s target: nudge, don't leap.
        let p = &crate::params::TESTNET;
        let t0 = 1_800_000_000;
        let h = [(t0, 400), (t0 + 51, 400), (t0 + 106, 400), (t0 + 160, 400)];
        let next = next_difficulty(&h, p);
        assert!(next > 400 && next < 480, "{next}");
        // A single block on target keeps it exactly where it started.
        assert_eq!(next_difficulty(&[(t0, 400), (t0 + 60, 400)], p), 400);
    }
}
