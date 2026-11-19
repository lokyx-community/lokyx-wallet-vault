//! Everything a peer or an RPC client can send gets parsed by one of these decoders. Throw random
//! and mutated inputs at them: they must return errors, never panic or hang.

use k256::ecdsa::SigningKey;
use lokyx::block::{Block, genesis};
use lokyx::keys::address_of;
use lokyx::params::{COIN, DEVNET};
use lokyx::swap::{build_lock, sha256};
use lokyx::tx::{SignedTransaction, build_transfer};
use rand::rngs::StdRng;
use rand::{Rng, RngCore, SeedableRng};

/// Rounds, and the seed they run from. Both fixed by default so a failure is reproducible and the
/// test is quick; CI sets `FUZZ_ROUNDS` high and `FUZZ_SEED=random` for a long pass over fresh
/// inputs. A failing seed is printed, so it can be re-run with `FUZZ_SEED=<n>`.
const ROUNDS: usize = 20_000;
const SEED: u64 = 0x10c;

fn settings() -> (usize, u64) {
    let rounds = std::env::var("FUZZ_ROUNDS").ok().and_then(|v| v.parse().ok()).unwrap_or(ROUNDS);
    let seed = match std::env::var("FUZZ_SEED").as_deref() {
        Ok("random") => rand::random(),
        Ok(v) => v.parse().unwrap_or(SEED),
        Err(_) => SEED,
    };
    (rounds, seed)
}

fn mutate(rng: &mut StdRng, base: &[u8]) -> Vec<u8> {
    let mut v = base.to_vec();
    match rng.gen_range(0..5) {
        0 if !v.is_empty() => {
            let i = rng.gen_range(0..v.len());
            v[i] ^= 1 << rng.gen_range(0..8);
        }
        1 if !v.is_empty() => v.truncate(rng.gen_range(0..v.len())),
        2 => v.extend((0..rng.gen_range(1..64)).map(|_| rng.r#gen::<u8>())),
        3 if v.len() > 4 => {
            // a length prefix gone huge
            let i = rng.gen_range(0..v.len() - 4);
            v[i..i + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        }
        _ => {
            let n = rng.gen_range(0..512);
            v = vec![0; n];
            rng.fill_bytes(&mut v);
        }
    }
    v
}

fn samples() -> Vec<Vec<u8>> {
    let sk = SigningKey::from_slice(&[7u8; 32]).unwrap();
    let to = address_of(&SigningKey::from_slice(&[8u8; 32]).unwrap());
    let t = build_transfer(&sk, &DEVNET, 0, to, COIN, None).unwrap();
    let l = build_lock(&sk, &DEVNET, 1, COIN, sha256(b"x"), to, 99).unwrap();
    let mut b = genesis(&DEVNET);
    b.txs = vec![t.clone(), l.clone()];
    let batch = lokyx::tx::build_op(&sk, &DEVNET, 2, lokyx::tx::Op::Batch(vec![(to, 1), (to, 2)])).unwrap();
    vec![t.to_bytes(), l.to_bytes(), b.to_bytes(), batch.to_bytes()]
}

#[test]
fn decoders_never_panic() {
    let (rounds, seed) = settings();
    println!("{rounds} rounds, FUZZ_SEED={seed}");
    let mut rng = StdRng::seed_from_u64(seed);
    let base = samples();
    for i in 0..rounds {
        let input = mutate(&mut rng, &base[i % base.len()]);
        let _ = SignedTransaction::from_bytes(&input);
        let _ = Block::from_bytes(&input);
        let _ = borsh::from_slice::<lokyx::net::Message>(&input);
        if let Ok(t) = SignedTransaction::from_bytes(&input) {
            let _ = t.check_stateless(&DEVNET);
        }
    }
}
