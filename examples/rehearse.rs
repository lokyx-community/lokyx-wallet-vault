//! A rehearsal of the Phase 4 operations against live nodes. Usage:
//!   cargo run --release --example rehearse -- <node A rpc> <node B rpc>
//! Node A mines to the printed rehearsal address (start it with --coinbase). Waits for a mature
//! balance, sends every kind of operation, then checks that node B, which only follows A over the
//! network, ends on the same tip with the same state and the same answers.
use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::keys::address_of;
use lokyx::params::{COIN, DEVNET};
use lokyx::pqkey::KeyOp;
use lokyx::swap::sha256;
use lokyx::timelock::TimelockOp;
use lokyx::token::TokenOp;
use lokyx::tx::{Op, Params, SignedTransaction, build_from, build_transfer};
use lokyx::vault::{VaultOp, VaultSettings, blocks_for};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

fn rpc(url: &str, method: &str, params: Value) -> Result<Value, String> {
    let r: Value = ureq::post(url)
        .send_json(json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}))
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;
    match r.get("error") {
        Some(e) => Err(e["message"].as_str().unwrap_or("error").to_string()),
        None => Ok(r["result"].clone()),
    }
}

fn key(n: u8) -> SigningKey {
    SigningKey::from_bytes((&[n; 32]).into()).unwrap()
}

fn height(url: &str) -> u64 {
    rpc(url, "lyx_chainInfo", json!({})).unwrap()["height"].as_u64().unwrap()
}

fn balance(url: &str, a: &Address) -> u128 {
    rpc(url, "lyx_getAccount", json!({"address": a.to_string()})).unwrap()["balance"].as_str().unwrap().parse().unwrap()
}

fn nonce(url: &str, a: &Address) -> u64 {
    rpc(url, "lyx_getAccount", json!({"address": a.to_string()})).unwrap()["pendingNonce"].as_u64().unwrap()
}

fn send(url: &str, t: &SignedTransaction) -> String {
    let h = rpc(url, "lyx_sendRawTransaction", json!({"tx": hex::encode(t.to_bytes())}))
        .unwrap_or_else(|e| panic!("{:?} refused: {e}", t.tx.op.kind()));
    h.as_str().unwrap().to_string()
}

fn mined(url: &str, h: &str) {
    let t0 = Instant::now();
    loop {
        if let Ok(v) = rpc(url, "lyx_getTransaction", json!({"hash": h}))
            && v["confirmations"].as_u64().unwrap_or(0) >= 1
        {
            return;
        }
        assert!(t0.elapsed() < Duration::from_secs(300), "{h} wasn't mined in 5 minutes");
        std::thread::sleep(Duration::from_secs(2));
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 3 {
        let (k, v) = (key(1), key(2));
        eprintln!("rehearsal address (mine to this): {}\nvault test account: {}", address_of(&k), address_of(&v));
        return;
    }
    let (ua, ub) = (a[1].as_str(), a[2].as_str());
    let p = &DEVNET;
    let (k, w, n) = (key(1), key(2), key(3));
    let (ka, wa, na) = (address_of(&k), address_of(&w), address_of(&n));
    println!("rehearsal address {ka}");
    while balance(ua, &ka) < 40 * COIN {
        println!(
            "waiting for a mature balance: {} LYX at height {}",
            lokyx::amount::format_lyx(balance(ua, &ka)),
            height(ua)
        );
        std::thread::sleep(Duration::from_secs(15));
    }
    let tx = |op: Op| {
        let t = build_from(&k, ka, p, Params { nonce: nonce(ua, &ka), ..Default::default() }, op).unwrap();
        let h = send(ua, &t);
        println!("sent {:<9} {h}", t.tx.op.kind());
        mined(ua, &h);
        h
    };
    // a batch of three payments, one of them to the account used for the vault and rotation
    tx(Op::Batch(vec![(wa, 12 * COIN), (Address([0x61; 20]), COIN), (Address([0x62; 20]), 2 * COIN)]));
    // a timelock to ourselves a few blocks ahead, claimed once it opens
    let h = height(ua);
    let lock = tx(Op::Timelock(TimelockOp::Lock { beneficiary: ka, amount: COIN, unlock_height: h + 4 }));
    while height(ua) < h + 5 {
        std::thread::sleep(Duration::from_secs(3));
    }
    let id = hex::decode(lock.trim_start_matches("0x")).unwrap();
    tx(Op::Timelock(TimelockOp::Claim { id: id.try_into().unwrap() }));
    // a token: made, some sent, some burned
    let create = tx(Op::Token(TokenOp::Create {
        symbol: "REH".into(),
        name: "Rehearsal".into(),
        decimals: 2,
        supply: 1_000_000,
    }));
    let token: [u8; 32] = hex::decode(create.trim_start_matches("0x")).unwrap().try_into().unwrap();
    tx(Op::Token(TokenOp::Transfer { token, to: wa, amount: 400 }));
    tx(Op::Token(TokenOp::Burn { token, amount: 100 }));
    // the account W: a vault, then a key rotation started and cancelled
    let wtx = |op: Op| {
        let t = build_from(&w, wa, p, Params { nonce: nonce(ua, &wa), ..Default::default() }, op).unwrap();
        let h = send(ua, &t);
        println!("sent {:<9} {h} (from W)", t.tx.op.kind());
        mined(ua, &h);
    };
    // W holds tokens, so it can't become a vault (the rule); move them back first
    wtx(Op::Token(TokenOp::Transfer { token, to: ka, amount: 400 }));
    let settings = VaultSettings {
        recovery: na,
        safe: Address([0x63; 20]),
        delay: blocks_for(3600, p),
        allowance: 2 * COIN,
        heir: None,
    };
    wtx(Op::Vault(VaultOp::Create(settings)));
    wtx(Op::Key(KeyOp::Rotate { new_key: na }));
    let pending = rpc(ua, "lyx_getAccount", json!({"address": wa.to_string()})).unwrap()["pendingRotation"].clone();
    println!("pending rotation: {pending}");
    assert!(pending["newKey"].as_str() == Some(&na.to_string()), "rotation not pending");
    // N (the new key, also W's recovery address) has no LYX; the vault pays for the cancel
    let c =
        build_from(&n, na, p, Params { nonce: 0, ..Default::default() }, Op::Key(KeyOp::CancelRotate { account: wa }))
            .unwrap();
    let h = send(ua, &c);
    println!("sent cancel-rotate by the recovery address {h}");
    mined(ua, &h);
    let after = rpc(ua, "lyx_getAccount", json!({"address": wa.to_string()})).unwrap();
    assert!(after["pendingRotation"].is_null(), "rotation still pending");
    // one more plain transfer so the last block carries something ordinary
    let t = build_transfer(&k, p, nonce(ua, &ka), Address([0x64; 20]), COIN / 2, None).unwrap();
    let h = send(ua, &t);
    mined(ua, &h);
    let _ = sha256;

    // node B has only followed A over the network
    let target = height(ua);
    let t0 = Instant::now();
    while height(ub) < target {
        assert!(t0.elapsed() < Duration::from_secs(300), "B didn't catch up");
        std::thread::sleep(Duration::from_secs(3));
    }
    let same = |m: &str, params: Value| {
        let (x, y) = (rpc(ua, m, params.clone()).unwrap(), rpc(ub, m, params).unwrap());
        assert_eq!(x, y, "{m} differs between the nodes");
    };
    let at = target.min(height(ub));
    same("lyx_getBlock", json!({"height": at}));
    for acct in [&ka, &wa, &na] {
        same("lyx_getAccount", json!({"address": acct.to_string()}));
    }
    same("lyx_getToken", json!({"id": format!("0x{}", hex::encode(token))}));
    println!("both nodes agree at height {at}: blocks, accounts, token");
}
