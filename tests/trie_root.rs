//! The state root kept incrementally in the state must equal the root built from scratch, after
//! every block, after blocks are taken back off, and for a state that has just been loaded.

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::keys::address_of;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::state::State;
use lokyx::tx::{SignedTransaction, build_transfer};
use rand::rngs::OsRng;
use rand::{Rng, SeedableRng, rngs::StdRng};

fn params() -> &'static ChainParams {
    Box::leak(Box::new(ChainParams { coinbase_maturity: 2, ..DEVNET.clone() }))
}

#[test]
fn incremental_root_matches_scratch_over_2000_blocks_with_undo() {
    let p = params();
    let mut rng = StdRng::seed_from_u64(7);
    let keys: Vec<SigningKey> = (0..8).map(|_| SigningKey::random(&mut OsRng)).collect();
    let addrs: Vec<Address> = keys.iter().map(address_of).collect();
    let mut s = State::default();
    let mut h = 0u64;
    let mut undone = 0;
    for _ in 0..2000 {
        // Make a block of random transfers from whoever can pay.
        let mut txs: Vec<SignedTransaction> = vec![];
        let sim = s.clone();
        for _ in 0..rng.gen_range(0..4) {
            let f = rng.gen_range(0..8);
            let acc = sim.account(&addrs[f]);
            let t = rng.gen_range(0..8);
            if t == f || acc.balance < 3 * COIN {
                continue;
            }
            let tx = build_transfer(
                &keys[f],
                p,
                acc.nonce + txs.iter().filter(|x| x.signer().ok() == Some(addrs[f])).count() as u64,
                addrs[t],
                COIN / 3,
                None,
            )
            .unwrap();
            txs.push(tx);
        }
        let miner = addrs[rng.gen_range(0..8)];
        // Every seventh block is tried, taken back off, and a different one put on.
        if h % 7 == 3 {
            s.record();
            if s.apply_body(h + 1, miner, &txs, p).is_ok() {
                let _ = s.root_incremental();
                let u = s.finish();
                s.undo(u);
                undone += 1;
                assert_eq!(s.root_incremental(), s.root(), "after undo at {h}");
            } else {
                let u = s.finish();
                s.undo(u);
            }
        }
        h += 1;
        if s.apply_body(h, miner, &txs, p).is_err() {
            // a partly applied block is thrown away, as the chain does
            let mut fresh = sim;
            fresh.apply_body(h, miner, &[], p).unwrap();
            s = fresh;
        }
        assert_eq!(s.root_incremental(), s.root(), "height {h}");
        assert!(s.release_index_consistent());
    }
    assert!(undone > 100);
    // A state loaded from its bytes builds the trie once and agrees.
    let mut loaded = State::from_bytes(&s.to_bytes()).unwrap();
    assert_eq!(loaded.root_incremental(), s.root());
    assert_eq!(loaded, s);
}
