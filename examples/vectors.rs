//! Prints testdata/vectors.json: keys, and one signed transaction for every kind of operation,
//! with the fields it was built from. The web wallet, the Snap, the CLI wallet and Spoke check
//! their encoders against it, byte for byte.
use lokyx::address::Address;
use lokyx::keys::{address_of, derive_signing_key, parse_mnemonic};
use lokyx::params::{COIN, DEVNET};
use lokyx::swap::{SWAP_ADDRESS, SwapOp, sha256};
use lokyx::timelock::TimelockOp;
use lokyx::token::TokenOp;
use lokyx::tx::{Op, Params, SignedTransaction, build_from};
use lokyx::vault::{Heir, VAULT_ADDRESS, VaultOp, VaultSettings};
use serde_json::{Value, json};

fn settings_json(s: &VaultSettings) -> Value {
    json!({
        "recovery": s.recovery.to_string(), "safe": s.safe.to_string(), "delay": s.delay,
        "allowance": s.allowance.to_string(),
        "heir": s.heir.as_ref().map(|h| json!({"address": h.address.to_string(), "inactiveBlocks": h.inactive_blocks})),
    })
}

/// The operation as the fields a wallet fills in.
fn op_json(op: &Op) -> Value {
    match op {
        Op::Transfer { to, value } => json!({"kind": "transfer", "to": to.to_string(), "value": value.to_string()}),
        Op::Batch(v) => json!({"kind": "batch", "payments": v.iter()
            .map(|(a, x)| json!({"to": a.to_string(), "amount": x.to_string()})).collect::<Vec<_>>()}),
        Op::Swap(SwapOp::Lock { amount, hashlock, recipient, refund_height }) => json!({
            "kind": "swapLock", "amount": amount.to_string(), "hashlock": hex::encode(hashlock),
            "recipient": recipient.to_string(), "refundHeight": refund_height}),
        Op::Swap(SwapOp::Claim { lock, secret }) => {
            json!({"kind": "swapClaim", "lock": hex::encode(lock), "secret": hex::encode(secret)})
        }
        Op::Swap(SwapOp::Refund { lock }) => json!({"kind": "swapRefund", "lock": hex::encode(lock)}),
        Op::Vault(v) => match v {
            VaultOp::Create(s) => json!({"kind": "vaultCreate", "settings": settings_json(s)}),
            VaultOp::Withdraw { to, amount } => {
                json!({"kind": "vaultWithdraw", "to": to.to_string(), "amount": amount.to_string()})
            }
            VaultOp::Update(s) => json!({"kind": "vaultUpdate", "settings": settings_json(s)}),
            VaultOp::Close => json!({"kind": "vaultClose"}),
            VaultOp::Cancel { id } => json!({"kind": "vaultCancel", "id": hex::encode(id)}),
            VaultOp::Sweep { vault } => json!({"kind": "vaultSweep", "vault": vault.to_string()}),
            VaultOp::HeirClaim { vault } => json!({"kind": "vaultHeirClaim", "vault": vault.to_string()}),
        },
        Op::Key(lokyx::pqkey::KeyOp::CommitPq { hash }) => json!({"kind": "keyCommitPq", "hash": hex::encode(hash)}),
        Op::Key(lokyx::pqkey::KeyOp::Rotate { new_key }) => json!({"kind": "keyRotate", "newKey": new_key.to_string()}),
        Op::Key(lokyx::pqkey::KeyOp::CancelRotate { account }) => {
            json!({"kind": "keyCancelRotate", "account": account.to_string()})
        }
        Op::Timelock(TimelockOp::Lock { beneficiary, amount, unlock_height }) => json!({
            "kind": "timelockLock", "beneficiary": beneficiary.to_string(), "amount": amount.to_string(),
            "unlockHeight": unlock_height}),
        Op::Timelock(TimelockOp::Claim { id }) => json!({"kind": "timelockClaim", "id": hex::encode(id)}),
        Op::Token(TokenOp::Create { symbol, name, decimals, supply }) => json!({
            "kind": "tokenCreate", "symbol": symbol, "name": name, "decimals": decimals, "supply": supply.to_string()}),
        Op::Token(TokenOp::Transfer { token, to, amount }) => json!({
            "kind": "tokenTransfer", "token": hex::encode(token), "to": to.to_string(), "amount": amount.to_string()}),
        Op::Token(TokenOp::Burn { token, amount }) => {
            json!({"kind": "tokenBurn", "token": hex::encode(token), "amount": amount.to_string()})
        }
        Op::Deploy { value, code, abi, input, gas } => json!({
            "kind": "deploy", "value": value.to_string(), "code": hex::encode(code), "abi": abi,
            "input": hex::encode(input), "gas": gas}),
        Op::Call { to, value, input, gas } => json!({
            "kind": "call", "to": to.to_string(), "value": value.to_string(), "input": hex::encode(input), "gas": gas}),
    }
}

fn case(name: &str, key: usize, sk: &k256::ecdsa::SigningKey, p: Params, op: Op) -> Value {
    let from = address_of(sk);
    let t: SignedTransaction = build_from(sk, from, &DEVNET, p, op).unwrap();
    json!({
        "name": name, "key": key,
        "tx": {
            "version": t.tx.version, "chainId": t.tx.chain_id, "from": t.tx.from.to_string(),
            "nonce": t.tx.nonce, "expires": t.tx.expires, "fee": t.tx.fee.to_string(),
            "memo": hex::encode(&t.tx.memo),
            "op": op_json(&t.tx.op), "opBytes": hex::encode(borsh::to_vec(&t.tx.op).unwrap()),
        },
        "signingHash": hex::encode(t.tx.signing_hash()),
        "signed": hex::encode(t.to_bytes()), "hash": hex::encode(t.hash()),
    })
}

fn main() {
    let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    let m = parse_mnemonic(phrase).unwrap();
    let sks: Vec<_> = (0..3).map(|i| derive_signing_key(&m, "", i).unwrap()).collect();
    let addr: Vec<Address> = sks.iter().map(address_of).collect();
    let keys: Vec<Value> = (0..3)
        .map(|i| {
            json!({"index": i, "privateKey": hex::encode(sks[i].to_bytes()), "address": addr[i].to_string(),
                   "evm": addr[i].to_evm_hex()})
        })
        .collect();
    let k1 = {
        let mut b = [0u8; 32];
        b[31] = 1;
        Address::from_verifying_key(k256::ecdsa::SigningKey::from_slice(&b).unwrap().verifying_key())
    };
    let p = |nonce: u64| Params { nonce, ..Default::default() };
    let secret = [0x42u8; 32];
    let lock_id = [0x11u8; 32];
    let set = VaultSettings {
        recovery: addr[1],
        safe: addr[2],
        delay: 5760,
        allowance: 50 * COIN,
        heir: Some(Heir { address: addr[2], inactive_blocks: 172_800 }),
    };
    let mut cases = vec![
        case("transfer", 0, &sks[0], p(0), Op::Transfer { to: addr[1], value: COIN }),
        case(
            "transfer with memo and expiry",
            0,
            &sks[0],
            Params { nonce: 7, expires: 123_456, memo: b"invoice 1042".to_vec(), fee: Some(999_000_000_000_000) },
            Op::Transfer { to: addr[1], value: 1_234_567_890_123_456_789 },
        ),
        case("batch", 0, &sks[0], p(1), Op::Batch(vec![(addr[1], COIN), (addr[2], 3), (k1, 7 * COIN)])),
        case(
            "swap lock",
            0,
            &sks[0],
            p(3),
            Op::Swap(SwapOp::Lock {
                amount: 5 * COIN,
                hashlock: sha256(&secret),
                recipient: addr[1],
                refund_height: 1234,
            }),
        ),
        case("swap claim", 1, &sks[1], p(0), Op::Swap(SwapOp::Claim { lock: lock_id, secret })),
        case("swap refund", 0, &sks[0], p(4), Op::Swap(SwapOp::Refund { lock: lock_id })),
        case("vault create", 0, &sks[0], p(10), Op::Vault(VaultOp::Create(set.clone()))),
        case("vault withdraw", 0, &sks[0], p(11), Op::Vault(VaultOp::Withdraw { to: addr[2], amount: 75 * COIN })),
        case("vault update", 0, &sks[0], p(12), Op::Vault(VaultOp::Update(VaultSettings { heir: None, ..set }))),
        case("vault close", 0, &sks[0], p(13), Op::Vault(VaultOp::Close)),
        case("vault cancel", 1, &sks[1], p(1), Op::Vault(VaultOp::Cancel { id: lock_id })),
        case("vault sweep", 1, &sks[1], p(2), Op::Vault(VaultOp::Sweep { vault: addr[0] })),
        case("vault heir claim", 2, &sks[2], p(0), Op::Vault(VaultOp::HeirClaim { vault: addr[0] })),
        case("key commit", 0, &sks[0], p(20), Op::Key(lokyx::pqkey::KeyOp::CommitPq { hash: [0x33; 32] })),
        case("key rotate", 0, &sks[0], p(24), Op::Key(lokyx::pqkey::KeyOp::Rotate { new_key: addr[1] })),
        case("key cancel rotate", 0, &sks[0], p(25), Op::Key(lokyx::pqkey::KeyOp::CancelRotate { account: addr[0] })),
        case(
            "deploy",
            0,
            &sks[0],
            p(21),
            Op::Deploy { value: 0, code: vec![0, 0x61, 0x73, 0x6d], abi: "{}".into(), input: vec![1, 2], gas: 500_000 },
        ),
        case(
            "call",
            0,
            &sks[0],
            p(22),
            Op::Call { to: addr[1], value: COIN / 2, input: b"increment".to_vec(), gas: 100_000 },
        ),
    ];
    extra_cases(&mut cases, &sks, &addr);
    let out = json!({
        "mnemonic": phrase, "path": "m/44'/7701'/0'/0/i", "chainId": DEVNET.chain_id, "keys": keys,
        "privkeyOneAddress": k1.to_string(),
        "addresses": {"swap": SWAP_ADDRESS.to_string(), "vault": VAULT_ADDRESS.to_string(),
                      "key": lokyx::pqkey::KEY_ADDRESS.to_string(),
                      "timelock": lokyx::timelock::TIMELOCK_ADDRESS.to_string(),
                      "token": lokyx::token::TOKEN_ADDRESS.to_string(), "deploy": lokyx::contract::DEPLOY_ADDRESS.to_string()},
        "cases": cases,
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}

/// Cases for the operations added after the first cut (timelock, token, key rotation).
fn extra_cases(cases: &mut Vec<Value>, sks: &[k256::ecdsa::SigningKey], addr: &[Address]) {
    let p = |nonce: u64| Params { nonce, ..Default::default() };
    let id = [0x22u8; 32];
    cases.push(case(
        "timelock lock",
        0,
        &sks[0],
        p(30),
        Op::Timelock(TimelockOp::Lock { beneficiary: addr[1], amount: 3 * COIN, unlock_height: 100_000 }),
    ));
    cases.push(case("timelock claim", 1, &sks[1], p(3), Op::Timelock(TimelockOp::Claim { id })));
    cases.push(case(
        "token create",
        0,
        &sks[0],
        p(31),
        Op::Token(TokenOp::Create { symbol: "GOLD".into(), name: "Gold".into(), decimals: 6, supply: 1_000_000 }),
    ));
    cases.push(case(
        "token transfer",
        0,
        &sks[0],
        p(32),
        Op::Token(TokenOp::Transfer { token: id, to: addr[2], amount: 250 }),
    ));
    cases.push(case("token burn", 0, &sks[0], p(33), Op::Token(TokenOp::Burn { token: id, amount: 10 })));
}
