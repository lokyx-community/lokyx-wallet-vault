//! Header v2: the proof-of-work enum, the receipts root and where the nonce sits.

use lokyx::address::Address;
use lokyx::block::{Block, BlockHeader};
use lokyx::chain::{Chain, now};
use lokyx::contract::{Receipt, receipts_root};
use lokyx::crypto::ZERO_HASH;
use lokyx::params::{ChainParams, DEVNET};
use lokyx::pow::{PowEngine, meets_difficulty};
use lokyx::work::{HEADER_BYTES, NONCE_OFFSET};

fn params() -> &'static ChainParams {
    Box::leak(Box::new(ChainParams {
        initial_difficulty: 2,
        min_difficulty: 2,
        target_block_time: 10,
        min_block_spacing: 0,
        coinbase_maturity: 0,
        genesis_timestamp: now() - 1_000_000,
        ..DEVNET.clone()
    }))
}

fn solve(c: &Chain, mut b: Block) -> Block {
    let seed = c.pow_seed(&b).unwrap();
    loop {
        let h = PowEngine::global().hash(&seed, &b.header.pow_input()).unwrap();
        if meets_difficulty(&h, b.header.difficulty) {
            return b;
        }
        b.header.bump_nonce();
    }
}

fn template(c: &Chain) -> Block {
    let (mut b, _) = c.block_template(Address([1; 20]), vec![]).unwrap();
    b.header.timestamp = c.tip().header.timestamp.max(c.params.genesis_timestamp) + c.params.target_block_time;
    b
}

#[test]
fn only_the_native_pow_variant_decodes() {
    let c = Chain::new(params(), None).unwrap();
    let b = solve(&c, template(&c));
    let mut bytes = b.to_bytes();
    assert_eq!(bytes[NONCE_OFFSET - 1], 0, "Native is tag 0, just before the nonce");
    assert_eq!(Block::from_bytes(&bytes).unwrap(), b);
    for tag in [1u8, 2, 0xff] {
        bytes[NONCE_OFFSET - 1] = tag;
        let e = Block::from_bytes(&bytes).unwrap_err();
        assert!(e.contains("malformed"), "{e}");
    }
    // and the header is exactly the length work.rs says, so a phone miner's offsets are right
    assert_eq!(b.header.pow_input().len(), HEADER_BYTES);
    assert_eq!(&b.header.pow_input()[NONCE_OFFSET..], &b.header.nonce().to_le_bytes());
}

#[test]
fn a_wrong_receipts_root_is_refused() {
    let mut c = Chain::new(params(), None).unwrap();
    let mut b = template(&c);
    b.header.receipts_root = [9; 32];
    let b = solve(&c, b);
    let e = c.process_block(b, false).unwrap_err().to_string();
    assert!(e.contains("receipts root"), "{e}");
    assert_eq!(c.height(), 0);
    // the honest one goes in
    let b = solve(&c, template(&c));
    assert_eq!(b.header.receipts_root, ZERO_HASH);
    c.process_block(b, false).unwrap();
}

#[test]
fn receipts_root_commits_to_what_matters() {
    let r = |ok: bool, gas: u64, out: &[u8], err: Option<&str>| Receipt {
        ok,
        gas_used: gas,
        fee: 5,
        output: out.to_vec(),
        error: err.map(String::from),
        logs: vec![],
        contract: None,
    };
    let h = [4u8; 32];
    assert_eq!(receipts_root(&[]), ZERO_HASH);
    let base = receipts_root(&[(h, r(true, 10, b"x", None))]);
    assert_ne!(base, ZERO_HASH);
    assert_ne!(base, receipts_root(&[(h, r(true, 11, b"x", None))]), "gas");
    assert_ne!(base, receipts_root(&[(h, r(true, 10, b"y", None))]), "output of a success");
    assert_ne!(base, receipts_root(&[(h, r(false, 10, b"x", None))]), "success flag");
    assert_ne!(base, receipts_root(&[([5; 32], r(true, 10, b"x", None))]), "tx hash");
    // a failure's text is for people and is not committed
    let f1 = receipts_root(&[(h, r(false, 10, b"one", Some("out of gas")))]);
    let f2 = receipts_root(&[(h, r(false, 10, b"two", Some("different words")))]);
    assert_eq!(f1, f2);
    // order matters
    let a = (h, r(true, 1, b"", None));
    let b2 = ([5; 32], r(true, 2, b"", None));
    assert_ne!(receipts_root(&[a.clone(), b2.clone()]), receipts_root(&[b2, a]));
}

#[test]
fn header_hash_is_domain_separated_from_v1() {
    let c = Chain::new(params(), None).unwrap();
    let h: &BlockHeader = &c.tip().header;
    let v2 = h.hash();
    let v1 = lokyx::crypto::tagged_hash(b"LOKYX/header/v1", &h.pow_input());
    assert_ne!(v1, v2);
}

/// A block with a contract transaction carries a receipts root that nodes recompute: the honest
/// one is accepted, a changed one is refused.
#[test]
fn a_contract_block_commits_to_its_receipts() {
    use k256::ecdsa::SigningKey;
    use lokyx::abi;
    use lokyx::contract::build_deploy;
    use lokyx::keys::address_of;
    use rand::rngs::OsRng;
    let p = params();
    let mut c = Chain::new(p, None).unwrap();
    let sk = SigningKey::random(&mut OsRng);
    let me = address_of(&sk);
    let mine_on = |c: &mut Chain, txs: Vec<lokyx::tx::SignedTransaction>, tamper: bool| {
        let (mut b, _) = c.block_template(me, txs).unwrap();
        b.header.timestamp = c.tip().header.timestamp.max(p.genesis_timestamp) + p.target_block_time;
        if tamper {
            b.header.receipts_root = [1; 32];
        }
        let b = solve(c, b);
        let root = b.header.receipts_root;
        (c.process_block(b, false), root)
    };
    mine_on(&mut c, vec![], false).0.unwrap();
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/contracts/");
    let code = std::fs::read(format!("{dir}counter.wasm")).unwrap();
    let abi_text = std::fs::read_to_string(format!("{dir}counter.abi.json")).unwrap();
    let a = abi::parse(&abi_text).unwrap();
    let input = abi::encode_deploy(&a, &[serde_json::json!(0)]).unwrap();
    let tx = build_deploy(&sk, p, 0, code, abi_text, input, 2_000_000, 0).unwrap();
    let (r, _) = mine_on(&mut c, vec![tx.clone()], true);
    assert!(r.unwrap_err().to_string().contains("receipts root"));
    let (r, root) = mine_on(&mut c, vec![tx], false);
    r.unwrap();
    assert_ne!(root, ZERO_HASH);
}
