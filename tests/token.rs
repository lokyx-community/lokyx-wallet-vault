//! Built-in fungible tokens: create, transfer, burn, and how they keep out of vaults.

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::crypto::Hash;
use lokyx::keys::address_of;
use lokyx::mempool::Mempool;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::state::State;
use lokyx::token::{MAX_NAME, MAX_SYMBOL, TOKEN_CREATE_BURN, TokenOp};
use lokyx::tx::{Op, SignedTransaction, build_op};
use lokyx::vault::{VaultOp, VaultSettings, blocks_for};
use rand::rngs::OsRng;

const MINER: Address = Address([7; 20]);

fn params() -> &'static ChainParams {
    Box::leak(Box::new(ChainParams { coinbase_maturity: 0, ..DEVNET.clone() }))
}

struct T {
    p: &'static ChainParams,
    s: State,
    alice: SigningKey,
    a: Address,
    bob: SigningKey,
    b: Address,
    h: u64,
}

fn setup() -> T {
    let p = params();
    let (alice, bob) = (SigningKey::random(&mut OsRng), SigningKey::random(&mut OsRng));
    let (a, b) = (address_of(&alice), address_of(&bob));
    // the two of them mine alternate blocks, so both have something to spend
    let mut s = State::default();
    for h in 1..=10 {
        s.apply_body(h, if h % 2 == 0 { b } else { a }, &[], p).unwrap();
    }
    T { p, s, alice, a, bob, b, h: 10 }
}

fn create(symbol: &str, supply: u128) -> TokenOp {
    TokenOp::Create { symbol: symbol.into(), name: format!("{symbol} coin"), decimals: 6, supply }
}

impl T {
    fn tx(&self, k: &SigningKey, op: TokenOp) -> SignedTransaction {
        build_op(k, self.p, self.s.account(&address_of(k)).nonce, Op::Token(op)).unwrap()
    }
    fn block(&mut self, txs: &[SignedTransaction]) -> Result<(), String> {
        let mut s = self.s.clone();
        s.apply_body(self.h + 1, MINER, txs, self.p)?;
        s.check_supply(self.h + 1, self.p)?;
        self.h += 1;
        self.s = s;
        Ok(())
    }
    /// Alice makes a token with `supply`, returns its id.
    fn make(&mut self, supply: u128) -> Hash {
        let tx = self.tx(&self.alice, create("GOLD", supply));
        let id = tx.hash();
        self.block(&[tx]).unwrap();
        id
    }
}

#[test]
fn creating_a_token_burns_lyx_and_gives_the_whole_supply_to_the_creator() {
    let mut t = setup();
    let before = t.s.account(&t.a).balance;
    let tx = t.tx(&t.alice, create("GOLD", 1_000_000));
    let (id, fee) = (tx.hash(), tx.tx.fee);
    t.block(&[tx]).unwrap();
    assert_eq!(t.s.account(&t.a).balance, before - TOKEN_CREATE_BURN - fee);
    assert_eq!(t.s.burned, TOKEN_CREATE_BURN);
    assert_eq!(t.s.token_balance(&t.a, &id), 1_000_000);
    let tok = &t.s.tokens[&id];
    assert_eq!((tok.symbol.as_str(), tok.decimals, tok.supply, tok.creator), ("GOLD", 6, 1_000_000, t.a));
    // issued is more than is held: the difference was burned on purpose
    assert!(t.s.circulating() < t.s.issued);
    assert_eq!(t.s.circulating() + t.s.burned, t.s.issued);
    // same symbol again is allowed (symbols aren't unique); it is a different token
    let again = t.tx(&t.alice, create("GOLD", 5));
    let id2 = again.hash();
    t.block(&[again]).unwrap();
    assert_ne!(id, id2);
    assert_eq!(t.s.tokens.len(), 2);
}

#[test]
fn symbols_names_decimals_and_supply_are_checked() {
    let t = setup();
    let bad = |op: TokenOp| t.tx(&t.alice, op).check_stateless(t.p).unwrap_err();
    assert!(bad(create("", 1)).contains("symbol"));
    assert!(bad(create(&"A".repeat(MAX_SYMBOL + 1), 1)).contains("symbol"));
    assert!(bad(create("gold", 1)).contains("capital"));
    assert!(bad(create("A B", 1)).contains("capital"));
    assert!(bad(TokenOp::Create { symbol: "OK".into(), name: String::new(), decimals: 0, supply: 1 }).contains("name"));
    assert!(
        bad(TokenOp::Create { symbol: "OK".into(), name: "x".repeat(MAX_NAME + 1), decimals: 0, supply: 1 })
            .contains("name")
    );
    assert!(
        bad(TokenOp::Create { symbol: "OK".into(), name: "tab\there".into(), decimals: 0, supply: 1 }).contains("name")
    );
    assert!(
        bad(TokenOp::Create { symbol: "OK".into(), name: "ok".into(), decimals: 19, supply: 1 }).contains("decimals")
    );
    assert!(bad(create("OK", 0)).contains("supply"));
    // the limits themselves are fine
    for op in [
        create("A1B2C3D4", 1),
        TokenOp::Create { symbol: "Z".into(), name: "x".repeat(MAX_NAME), decimals: 18, supply: u128::MAX },
    ] {
        t.tx(&t.alice, op).check_stateless(t.p).unwrap();
    }
    // can't pay for the burn
    let poor = SigningKey::random(&mut OsRng);
    let e = t.s.clone().apply_body(t.h + 1, MINER, &[t.tx(&poor, create("OK", 1))], t.p).unwrap_err();
    assert!(e.contains("insufficient"), "{e}");
}

#[test]
fn transfers_move_balances_and_zero_balances_are_not_kept() {
    let mut t = setup();
    let id = t.make(1000);
    let send = t.tx(&t.alice, TokenOp::Transfer { token: id, to: t.b, amount: 400 });
    t.block(&[send]).unwrap();
    assert_eq!((t.s.token_balance(&t.a, &id), t.s.token_balance(&t.b, &id)), (600, 400));
    // everything away: the entry is gone, not stored as 0
    let rest = t.tx(&t.alice, TokenOp::Transfer { token: id, to: t.b, amount: 600 });
    t.block(&[rest]).unwrap();
    assert!(!t.s.token_balances.contains_key(&(t.a, id)));
    assert!(!t.s.holds_tokens(&t.a));
    assert_eq!(t.s.token_balance(&t.b, &id), 1000);
    // more than held, an unknown token, zero, to a system address
    let more = t.tx(&t.alice, TokenOp::Transfer { token: id, to: t.b, amount: 1 });
    assert!(t.block(&[more]).unwrap_err().contains("insufficient token"));
    let unknown = t.tx(&t.bob, TokenOp::Transfer { token: [9; 32], to: t.a, amount: 1 });
    assert!(t.block(&[unknown]).unwrap_err().contains("no token"));
    let zero = t.tx(&t.bob, TokenOp::Transfer { token: id, to: t.a, amount: 0 });
    assert!(zero.check_stateless(t.p).unwrap_err().contains("zero"));
    let sys = t.tx(&t.bob, TokenOp::Transfer { token: id, to: lokyx::vault::VAULT_ADDRESS, amount: 1 });
    assert!(sys.check_stateless(t.p).unwrap_err().contains("system"));
    // the same transaction twice in one block: the second has a stale nonce
    let two = t.tx(&t.bob, TokenOp::Transfer { token: id, to: t.a, amount: 1 });
    assert!(t.block(&[two.clone(), two]).unwrap_err().contains("bad nonce"));
}

#[test]
fn burning_lowers_the_supply() {
    let mut t = setup();
    let id = t.make(1000);
    let burn = t.tx(&t.alice, TokenOp::Burn { token: id, amount: 300 });
    t.block(&[burn]).unwrap();
    assert_eq!(t.s.tokens[&id].supply, 700);
    assert_eq!(t.s.token_balance(&t.a, &id), 700);
    let too_much = t.tx(&t.alice, TokenOp::Burn { token: id, amount: 701 });
    assert!(t.block(&[too_much]).unwrap_err().contains("insufficient token"));
    // a token can burn down to nothing and still exist with supply 0
    let all = t.tx(&t.alice, TokenOp::Burn { token: id, amount: 700 });
    t.block(&[all]).unwrap();
    assert_eq!(t.s.tokens[&id].supply, 0);
    assert!(t.s.token_balances.is_empty());
}

#[test]
fn tokens_and_vaults_stay_apart() {
    let mut t = setup();
    let id = t.make(1000);
    let settings = VaultSettings {
        recovery: Address([1; 20]),
        safe: Address([2; 20]),
        delay: blocks_for(86_400, t.p),
        allowance: 5 * COIN,
        heir: None,
    };
    let make_vault = |t: &T, k: &SigningKey| {
        build_op(k, t.p, t.s.account(&address_of(k)).nonce, Op::Vault(VaultOp::Create(settings.clone()))).unwrap()
    };
    // an account holding tokens can't become a vault
    let e = t.block_err(&[make_vault(&t, &t.alice)]);
    assert!(e.contains("holds tokens"), "{e}");
    // after sending them away it can
    let away = t.tx(&t.alice, TokenOp::Transfer { token: id, to: t.b, amount: 1000 });
    t.block(&[away]).unwrap();
    t.block(&[make_vault(&t, &t.alice)]).unwrap();
    assert!(t.s.vaults.contains_key(&t.a));
    // a vault can't be sent tokens, can't create them and can't move or burn them
    let to_vault = t.tx(&t.bob, TokenOp::Transfer { token: id, to: t.a, amount: 1 });
    assert!(t.block(&[to_vault]).unwrap_err().contains("vault can't hold"));
    let create_in_vault = t.tx(&t.alice, create("NOPE", 1));
    assert!(t.block(&[create_in_vault]).unwrap_err().contains("vault accounts can't use tokens"));
    // the mempool says the same before a block does
    let mut mp = Mempool::default();
    let mut s = t.s.clone();
    s.height = t.h;
    let to_vault = t.tx(&t.bob, TokenOp::Transfer { token: id, to: t.a, amount: 1 });
    assert!(mp.add(to_vault, &s, t.p).unwrap_err().contains("vault can't hold"));
}

impl T {
    fn block_err(&self, txs: &[SignedTransaction]) -> String {
        self.s.clone().apply_body(self.h + 1, MINER, txs, self.p).unwrap_err()
    }
}

#[test]
fn the_books_catch_token_and_burn_mistakes() {
    let mut t = setup();
    let id = t.make(1000);
    t.s.check_supply(t.h, t.p).unwrap();
    // tokens that appear from nowhere
    let mut s = t.s.clone();
    s.token_balances.insert((Address([5; 20]), id), 1);
    assert!(s.check_supply(t.h, t.p).unwrap_err().contains("holds"));
    // balances of a token that doesn't exist
    let mut s = t.s.clone();
    s.token_balances.insert((Address([5; 20]), [8; 32]), 1);
    assert!(s.check_supply(t.h, t.p).unwrap_err().contains("doesn't exist"));
    // a supply that was changed without moving balances
    let mut s = t.s.clone();
    s.tokens.get_mut(&id).unwrap().supply += 1;
    assert!(s.check_supply(t.h, t.p).is_err());
    // LYX burned without being counted, or counted without being burned
    let mut s = t.s.clone();
    s.burned -= 1;
    assert!(s.check_supply(t.h, t.p).is_err());
    let mut s = t.s.clone();
    s.burned += 1;
    assert!(s.check_supply(t.h, t.p).is_err());
}

#[test]
fn a_block_with_token_operations_can_be_taken_back() {
    let mut t = setup();
    let id = t.make(1000);
    let before = t.s.clone();
    let root = t.s.root();
    let txs = [
        t.tx(&t.alice, TokenOp::Transfer { token: id, to: t.b, amount: 100 }),
        build_op(&t.alice, t.p, t.s.account(&t.a).nonce + 1, Op::Token(TokenOp::Burn { token: id, amount: 50 }))
            .unwrap(),
        build_op(&t.alice, t.p, t.s.account(&t.a).nonce + 2, Op::Token(create("NEW", 7))).unwrap(),
    ];
    let mut s = t.s.clone();
    s.record();
    s.apply_body(t.h + 1, MINER, &txs, t.p).unwrap();
    assert_ne!(s.root(), root);
    let u = s.finish();
    s.undo(u);
    assert_eq!(s, before);
    assert_eq!(s.root(), root);
}

#[test]
fn a_saved_state_keeps_tokens_timelocks_and_burns() {
    let mut t = setup();
    t.make(1000);
    let lock = build_op(
        &t.alice,
        t.p,
        t.s.account(&t.a).nonce,
        Op::Timelock(lokyx::timelock::TimelockOp::Lock { beneficiary: t.b, amount: COIN, unlock_height: 99 }),
    )
    .unwrap();
    t.block(&[lock]).unwrap();
    let back = State::from_bytes(&t.s.to_bytes()).unwrap();
    assert_eq!(back, t.s);
    assert_eq!(back.root(), t.s.root());
    assert!(back.burned > 0 && !back.timelocks.is_empty() && !back.token_balances.is_empty());
    let _ = &t.bob;
}
