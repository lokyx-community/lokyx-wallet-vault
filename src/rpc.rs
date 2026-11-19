//! JSON-RPC over HTTP. Binds to localhost by default. Amounts are strings in base
//! units so nothing gets rounded by JSON floats.

use crate::address::Address;
use crate::amount::format_lyx;
use crate::block::Block;
use crate::chain::Chain;
use crate::crypto::{parse_hash, to_hex};
use crate::emission::{block_reward, issued_through, schedule};
use crate::node::Node;
use crate::params::MIN_FEE_PER_BYTE;
use crate::swap::{self, SwapOp};
use crate::tx::SignedTransaction;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, DefaultBodyLimit, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{Value, json};
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tower_http::cors::CorsLayer;

#[derive(Clone)]
struct Ctx {
    node: Arc<Node>,
    allow_control: bool,
    token: Option<Arc<str>>,
    limits: Arc<parking_lot::Mutex<std::collections::HashMap<std::net::IpAddr, (f64, std::time::Instant)>>>,
}

/// Whether a request may use the control methods (starting and stopping mining, and anything
/// else that changes what the node is doing rather than reading from it).
///
/// With a token set, control needs that token and nothing else does: the operator can manage the
/// node from anywhere, through a proxy, and a page or program on the same machine can't start
/// mining to its own address just by being local. Without one, control stays where it has always
/// been: this machine, not through a proxy, and only if the node allows it at all.
fn may_control(
    token: Option<&str>,
    presented: Option<&str>,
    allow_control: bool,
    loopback: bool,
    forwarded: bool,
) -> bool {
    match token {
        Some(want) => presented.is_some_and(|got| constant_time_eq(want.as_bytes(), got.as_bytes())),
        None => allow_control && loopback && !forwarded,
    }
}

/// Compares without giving away where two strings start to differ.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

/// The token from an `Authorization: Bearer <token>` header.
fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers.get(header::AUTHORIZATION)?.to_str().ok()?.strip_prefix("Bearer ").map(str::trim)
}

/// Per-client token bucket. Generous for people, tight for scripts hammering a public node.
const BUCKET: f64 = 300.0;
const REFILL_PER_SEC: f64 = 30.0;

fn cost(method: &str) -> f64 {
    match method {
        "lyx_sendRawTransaction" | "lyx_getAddressHistory" | "lyx_getBlocks" => 5.0,
        "lyx_getWork" | "lyx_call" | "lyx_estimateGas" => 3.0,
        "lyx_submitWork" => 10.0,
        _ => 1.0,
    }
}

fn charge(ctx: &Ctx, ip: std::net::IpAddr, amount: f64) -> bool {
    let mut m = ctx.limits.lock();
    let now = std::time::Instant::now();
    if m.len() > 50_000 {
        m.retain(|_, (_, t)| now.duration_since(*t).as_secs() < 600);
    }
    let e = m.entry(ip).or_insert((BUCKET, now));
    e.0 = (e.0 + now.duration_since(e.1).as_secs_f64() * REFILL_PER_SEC).min(BUCKET);
    e.1 = now;
    if e.0 < amount {
        return false;
    }
    e.0 -= amount;
    true
}

/// The client's IP: the socket peer, or (behind our own reverse proxy) the last X-Forwarded-For hop,
/// which is the one the proxy added itself.
fn client_ip(peer: &SocketAddr, headers: &HeaderMap) -> std::net::IpAddr {
    if peer.ip().is_loopback()
        && let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.rsplit(',').next())
            .and_then(|s| s.trim().parse().ok())
    {
        return ip;
    }
    peer.ip()
}

/// `allow_control = false` turns off control methods entirely (use it on any node whose RPC is
/// reachable through a reverse proxy or from the internet).
/// `token` requires `Authorization: Bearer <token>` on control methods, and then allows them
/// from anywhere; without it control is limited to this machine as before.
pub async fn serve(
    node: Arc<Node>,
    addr: SocketAddr,
    cors_origin: Option<String>,
    allow_control: bool,
    token: Option<String>,
) -> anyhow::Result<()> {
    let mut app = Router::new()
        .route("/", post(handle))
        .with_state(Ctx { node, allow_control, token: token.map(Arc::from), limits: Default::default() })
        .layer(DefaultBodyLimit::max(1 << 20));
    if let Some(o) = cors_origin {
        let origin: HeaderValue = o.parse()?;
        app = app.layer(
            CorsLayer::new()
                .allow_origin(origin)
                .allow_methods([Method::POST])
                .allow_headers([header::CONTENT_TYPE])
                // lets the allowed website reach a node on the visitor's own computer
                .allow_private_network(true),
        );
    }
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("json-rpc listening on http://{addr}");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}

/// Said the same way whether the token was missing, wrong, or the request came from the wrong
/// place, so a caller learns nothing from which it was.
const CONTROL_REFUSED: &str =
    "not allowed: control methods need the node's RPC token, or a request from the node's own machine";

struct RpcError(i64, String);
type R = Result<Value, RpcError>;

fn bad(msg: impl Into<String>) -> RpcError {
    RpcError(-32602, msg.into())
}

async fn handle(
    State(ctx): State<Ctx>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let node = ctx.node.clone();
    let ip = client_ip(&peer, &headers);
    // A request relayed by a reverse proxy arrives from loopback too, so proxy headers count as remote.
    let forwarded = headers.contains_key("x-forwarded-for")
        || headers.contains_key("forwarded")
        || headers.contains_key("x-real-ip");
    let presented = bearer(&headers);
    let control = may_control(ctx.token.as_deref(), presented, ctx.allow_control, peer.ip().is_loopback(), forwarded);
    if ctx.token.is_some() && presented.is_some() && !control {
        tracing::warn!("rejected a control token from {ip}");
    }
    // A browser page from a website (rather than a local page or a script) can start and stop
    // mining, but not send rewards to a different address.
    let from_site = headers.get(header::ORIGIN).and_then(|o| o.to_str().ok()).is_some_and(|o| {
        !(o.starts_with("http://localhost") || o.starts_with("http://127.0.0.1") || o.starts_with("http://[::1]"))
    });
    let access = Access { control, from_site };
    let ct = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
    if !ct.starts_with("application/json") {
        return (StatusCode::UNSUPPORTED_MEDIA_TYPE, "Content-Type must be application/json").into_response();
    }
    let req: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return Json(json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}))
                .into_response();
        }
    };
    let method_of = |r: &Value| cost(r.get("method").and_then(|m| m.as_str()).unwrap_or(""));
    let total: f64 = match &req {
        Value::Array(a) => a.iter().map(method_of).sum(),
        r => method_of(r),
    };
    if !ip.is_loopback() && !charge(&ctx, ip, total) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"jsonrpc":"2.0","id":null,"error":{"code":-32005,"message":"rate limited, slow down"}})),
        )
            .into_response();
    }
    if let Value::Array(reqs) = req {
        if reqs.is_empty() || reqs.len() > 50 {
            return Json(
                json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"batch must have 1 to 50 requests"}}),
            )
            .into_response();
        }
        let mut out = Vec::with_capacity(reqs.len());
        for r in &reqs {
            out.push(one(&node, r, access).await);
        }
        return Json(Value::Array(out)).into_response();
    }
    Json(one(&node, &req, access).await).into_response()
}

#[derive(Clone, Copy)]
struct Access {
    /// From this machine, not through a proxy, on a node that allows control methods.
    control: bool,
    /// Made by a page on a website.
    from_site: bool,
}

async fn one(node: &Arc<Node>, req: &Value, access: Access) -> Value {
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("").to_string();
    let params = req.get("params").cloned().unwrap_or(json!({}));
    match dispatch(node, &method, &params, access).await {
        Ok(v) => json!({"jsonrpc":"2.0","id":id,"result":v}),
        Err(RpcError(code, message)) => json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}}),
    }
}

fn p_str<'a>(p: &'a Value, k: &str) -> Result<&'a str, RpcError> {
    p.get(k).and_then(|v| v.as_str()).ok_or_else(|| bad(format!("missing string param '{k}'")))
}
fn p_u64(p: &Value, k: &str) -> Option<u64> {
    p.get(k).and_then(|v| v.as_u64())
}
fn p_addr(p: &Value, k: &str) -> Result<Address, RpcError> {
    Address::parse(p_str(p, k)?).map_err(|e| bad(format!("invalid address: {e}")))
}

fn timelock_json(id: &crate::crypto::Hash, l: &crate::timelock::Timelock) -> Value {
    json!({
        "id": to_hex(id), "creator": l.creator.to_string(), "beneficiary": l.beneficiary.to_string(),
        "amount": l.amount.to_string(), "amountLyx": format_lyx(l.amount),
        "unlockHeight": l.unlock_height, "height": l.height,
    })
}

fn token_json(id: &crate::crypto::Hash, t: &crate::token::Token) -> Value {
    json!({
        "id": to_hex(id), "symbol": t.symbol, "name": t.name, "decimals": t.decimals,
        "supply": t.supply.to_string(), "creator": t.creator.to_string(), "height": t.height,
    })
}

fn token_balances_json(s: &crate::state::State, a: &Address) -> Vec<Value> {
    s.token_balances
        .range((*a, [0u8; 32])..=(*a, [0xffu8; 32]))
        .filter_map(|((_, id), bal)| {
            let t = s.tokens.get(id)?;
            let mut v = token_json(id, t);
            v["balance"] = json!(bal.to_string());
            Some(v)
        })
        .collect()
}

fn tx_json(t: &SignedTransaction) -> Value {
    let mut v = json!({
        "hash": to_hex(&t.hash()), "from": t.tx.from.to_string(), "to": t.tx.to().to_string(),
        "value": t.tx.value().to_string(), "valueLyx": format_lyx(t.tx.value()),
        "fee": t.tx.fee.to_string(), "feeLyx": format_lyx(t.tx.fee),
        "nonce": t.tx.nonce, "chainId": t.tx.chain_id, "size": t.size(),
        "op": t.tx.op.kind(), "expires": t.tx.expires, "memo": hex::encode(&t.tx.memo),
    });
    if let crate::tx::Op::Batch(pay) = &t.tx.op {
        v["payments"] = json!(
            pay.iter()
                .map(|(a, x)| json!({"to": a.to_string(), "amount": x.to_string(), "amountLyx": format_lyx(*x)}))
                .collect::<Vec<_>>()
        );
    }
    if let Some(op) = swap::op_of(t) {
        v["swap"] = match op {
            SwapOp::Lock { hashlock, recipient, refund_height, .. } => json!({
                "kind": "lock", "id": to_hex(&t.hash()), "hashlock": hex::encode(hashlock),
                "recipient": recipient.to_string(), "refundHeight": refund_height,
            }),
            SwapOp::Claim { lock, secret } => {
                json!({"kind": "claim", "id": to_hex(&lock), "secret": hex::encode(secret)})
            }
            SwapOp::Refund { lock } => json!({"kind": "refund", "id": to_hex(&lock)}),
        };
    }
    if let Some((_, _, op)) = t.tx.op.contract_op() {
        v["contract"] = match op {
            crate::contract::ContractOp::Deploy { code, gas, .. } => json!({
                "kind": "deploy", "gasLimit": gas, "codeBytes": code.len(),
                "address": crate::contract::contract_address(&t.tx.from, t.tx.nonce).to_string(),
            }),
            crate::contract::ContractOp::Call { input, gas } => json!({
                "kind": "call", "gasLimit": gas, "method": method_name(&input), "input": hex::encode(&input),
            }),
        };
    }
    if let crate::tx::Op::Timelock(op) = &t.tx.op {
        use crate::timelock::TimelockOp;
        v["timelock"] = match op {
            TimelockOp::Lock { beneficiary, amount, unlock_height } => json!({
                "kind": "lock", "id": to_hex(&t.hash()), "beneficiary": beneficiary.to_string(),
                "amount": amount.to_string(), "amountLyx": format_lyx(*amount), "unlockHeight": unlock_height,
            }),
            TimelockOp::Claim { id } => json!({"kind": "claim", "id": to_hex(id)}),
        };
    }
    if let crate::tx::Op::Token(op) = &t.tx.op {
        use crate::token::TokenOp;
        v["token"] = match op {
            TokenOp::Create { symbol, name, decimals, supply } => json!({
                "kind": "create", "id": to_hex(&t.hash()), "symbol": symbol, "name": name,
                "decimals": decimals, "supply": supply.to_string(),
                "burnLyx": format_lyx(crate::token::TOKEN_CREATE_BURN),
            }),
            TokenOp::Transfer { token, to, amount } => json!({
                "kind": "transfer", "token": to_hex(token), "to": to.to_string(), "amount": amount.to_string(),
            }),
            TokenOp::Burn { token, amount } => {
                json!({"kind": "burn", "token": to_hex(token), "amount": amount.to_string()})
            }
        };
    }
    if let Some(k) = crate::pqkey::op_of(t) {
        use crate::pqkey::KeyOp;
        v["key"] = match k {
            KeyOp::CommitPq { hash } => json!({"kind": "commitPq", "hash": hex::encode(hash)}),
            KeyOp::Rotate { new_key } => json!({"kind": "rotate", "newKey": new_key.to_string()}),
            KeyOp::CancelRotate { account } => json!({"kind": "cancelRotate", "account": account.to_string()}),
        };
    }
    if let Some(op) = crate::vault::op_of(t) {
        use crate::vault::VaultOp;
        v["vault"] = match op {
            VaultOp::Create(s) => json!({"kind": "create", "settings": settings_json(&s)}),
            VaultOp::Withdraw { to, amount } => json!({
                "kind": "withdraw", "id": to_hex(&t.hash()), "to": to.to_string(),
                "amount": amount.to_string(), "amountLyx": format_lyx(amount),
            }),
            VaultOp::Update(s) => json!({"kind": "update", "id": to_hex(&t.hash()), "settings": settings_json(&s)}),
            VaultOp::Close => json!({"kind": "close", "id": to_hex(&t.hash())}),
            VaultOp::Cancel { id } => json!({"kind": "cancel", "id": to_hex(&id)}),
            VaultOp::Sweep { vault } => json!({"kind": "sweep", "vault": vault.to_string()}),
            VaultOp::HeirClaim { vault } => {
                json!({"kind": "heirClaim", "id": to_hex(&t.hash()), "vault": vault.to_string()})
            }
        };
    }
    v
}

/// The method name at the start of a call's input, if it has one.
fn method_name(input: &[u8]) -> Option<String> {
    let n = u32::from_le_bytes(input.get(..4)?.try_into().ok()?) as usize;
    String::from_utf8(input.get(4..4usize.checked_add(n)?)?.to_vec()).ok()
}

/// A contract's ABI as JSON, if it has a usable one.
fn contract_abi(state: &crate::state::State, a: &Address) -> Option<Value> {
    let info = state.contracts.get(a)?;
    let text = state.blobs.get(&info.abi)?;
    crate::abi::parse(std::str::from_utf8(text).ok()?).ok()
}

fn logs_json(state: &crate::state::State, logs: &[crate::contract::Log]) -> Value {
    Value::Array(
        logs.iter()
            .map(|l| {
                let fields = contract_abi(state, &l.contract).and_then(|abi| crate::abi::decode_event(&abi, &l.topic, &l.data));
                json!({"contract": l.contract.to_string(), "event": l.topic, "data": hex::encode(&l.data), "fields": fields})
            })
            .collect(),
    )
}

/// What a run did, as JSON. `to` and `method` let the output be decoded with the contract's ABI.
fn run_json(state: &crate::state::State, r: RunView, to: Option<&Address>, method: Option<&str>) -> Value {
    let result = match (r.ok, to.and_then(|a| contract_abi(state, a)), method) {
        (true, Some(abi), Some(m)) => crate::abi::decode_return(&abi, m, r.output).ok(),
        _ => None,
    };
    json!({
        "ok": r.ok, "gasUsed": r.gas_used, "output": hex::encode(r.output), "result": result,
        "error": r.error, "logs": logs_json(state, r.logs),
    })
}

struct RunView<'a> {
    ok: bool,
    gas_used: u64,
    output: &'a [u8],
    error: &'a Option<String>,
    logs: &'a [crate::contract::Log],
}

fn contract_json(state: &crate::state::State, a: &Address) -> Option<Value> {
    let info = state.contracts.get(a)?;
    let code_len = state.blobs.get(&info.code).map(|c| c.len()).unwrap_or(0);
    Some(json!({
        "address": a.to_string(), "creator": info.creator.to_string(), "height": info.height,
        "codeHash": to_hex(&info.code), "codeBytes": code_len, "abi": contract_abi(state, a),
        "storageEntries": state.storage.get(a).map(|m| m.len()).unwrap_or(0),
    }))
}

/// Contract input from either `input` (hex) or `method` + `args` with the contract's ABI.
fn call_input(state: &crate::state::State, to: &Address, p: &Value) -> Result<(Vec<u8>, Option<String>), RpcError> {
    if let Some(h) = p.get("input").and_then(Value::as_str) {
        let b = hex::decode(h.strip_prefix("0x").unwrap_or(h)).map_err(|e| bad(format!("input isn't hex: {e}")))?;
        let m = method_name(&b);
        return Ok((b, m));
    }
    let m = p_str(p, "method")?;
    let abi = contract_abi(state, to).ok_or_else(|| bad("that contract has no ABI; pass input as hex"))?;
    let args = p.get("args").and_then(Value::as_array).cloned().unwrap_or_default();
    let input = crate::abi::encode_call(&abi, m, &args).map_err(bad)?;
    Ok((input, Some(m.to_string())))
}

fn p_value(p: &Value) -> Result<u128, RpcError> {
    match p.get("value") {
        None | Some(Value::Null) => Ok(0),
        Some(Value::String(s)) => s.parse().map_err(|_| bad("value is in base units, as a whole number")),
        Some(v) => v.as_u64().map(u128::from).ok_or_else(|| bad("bad value")),
    }
}

fn settings_json(s: &crate::vault::VaultSettings) -> Value {
    json!({
        "recovery": s.recovery.to_string(), "safe": s.safe.to_string(), "delayBlocks": s.delay,
        "allowance": s.allowance.to_string(), "allowanceLyx": format_lyx(s.allowance),
        "heir": s.heir.as_ref().map(|h| json!({"address": h.address.to_string(), "inactiveBlocks": h.inactive_blocks})),
    })
}

fn pending_json(id: &crate::crypto::Hash, x: &crate::vault::Pending) -> Value {
    use crate::vault::PendingKind;
    let mut v = json!({
        "id": to_hex(id), "vault": x.vault.to_string(), "releaseHeight": x.release, "height": x.height,
        "byHeir": x.by_heir,
    });
    match &x.kind {
        PendingKind::Withdraw { to, amount } => {
            v["kind"] = json!("withdraw");
            v["to"] = json!(to.to_string());
            v["amount"] = json!(amount.to_string());
            v["amountLyx"] = json!(format_lyx(*amount));
        }
        PendingKind::Update(s) => {
            v["kind"] = json!("update");
            v["settings"] = settings_json(s);
        }
        PendingKind::Close => v["kind"] = json!("close"),
    }
    v
}

/// A vault's settings, allowance and pending items, or null.
fn vault_json(c: &Chain, a: &Address) -> Value {
    let Some(v) = c.state.vaults.get(a) else { return Value::Null };
    let next = c.height() + 1;
    let left = c.state.allowance_left(a, next, c.params).unwrap_or(0);
    let pending: Vec<Value> =
        c.state.pending.iter().filter(|(_, x)| x.vault == *a).map(|(id, x)| pending_json(id, x)).collect();
    let heir_from = v.settings.heir.as_ref().map(|h| v.last_active + h.inactive_blocks);
    json!({
        "settings": settings_json(&v.settings),
        "allowanceLeft": left.to_string(), "allowanceLeftLyx": format_lyx(left),
        "dayResetsAt": v.day_start + crate::vault::day_blocks(c.params),
        "lastActive": v.last_active, "heirCanClaimFrom": heir_from,
        "pending": pending,
    })
}

/// Everything known about a swap lock: open, claimed (with the secret), refunded, or still pending.
fn swap_json(node: &Node, id: &crate::crypto::Hash) -> Option<Value> {
    let c = node.chain.lock();
    let mp = node.mempool.lock();
    // the lock tx, confirmed or pending
    let (lock_tx, lock_height) = match c.tx_location(id) {
        Some((h, i)) => (c.block(&c.hash_at(h)?)?.txs[i].clone(), Some(h)),
        None => (mp.get(id)?.tx.clone(), None),
    };
    let Some(SwapOp::Lock { amount, hashlock, recipient, refund_height }) = swap::op_of(&lock_tx) else { return None };
    let sender = lock_tx.tx.from;
    let close = |t: &SignedTransaction| match swap::op_of(t) {
        Some(SwapOp::Claim { lock, secret }) if lock == *id => Some(("claimed", Some(secret))),
        Some(SwapOp::Refund { lock }) if lock == *id => Some(("refunded", None)),
        _ => None,
    };
    let mut status = if lock_height.is_none() { "pending" } else { "open" };
    let (mut close_tx, mut close_height, mut secret, mut close_pending) = (None, None, None, false);
    if let Some(th) = c.swap_closed_by(id) {
        let (h, i) = c.tx_location(&th)?;
        let t = &c.block(&c.hash_at(h)?)?.txs[i];
        let (s, sec) = close(t)?;
        (status, close_tx, close_height, secret) = (s, Some(th), Some(h), sec);
    } else if let Some((th, e)) = mp.entries().find(|(_, e)| close(&e.tx).is_some()) {
        // a claim sitting in the mempool already reveals the secret
        let (s, sec) = close(&e.tx)?;
        close_tx = Some(*th);
        close_pending = true;
        secret = sec;
        if s == "claimed" && secret.is_some() {
            status = "claiming";
        } else {
            status = "refunding";
        }
    }
    let height = c.height();
    Some(json!({
        "id": to_hex(id), "status": status,
        "sender": sender.to_string(), "recipient": recipient.to_string(),
        "amount": amount.to_string(), "amountLyx": format_lyx(amount),
        "hashlock": hex::encode(hashlock), "refundHeight": refund_height,
        "lockHeight": lock_height, "height": height,
        "blocksUntilRefund": refund_height.saturating_sub(height + 1),
        "closeTx": close_tx.map(|h| to_hex(&h)), "closeHeight": close_height, "closePending": close_pending,
        "secret": secret.map(hex::encode),
    }))
}

fn block_json(c: &Chain, b: &Block, full: bool) -> Value {
    let hash = b.hash();
    let meta = c.meta(&hash);
    let fees: u128 = b.txs.iter().map(|t| paid_fee(c, t)).sum();
    let confirmations = if c.is_main(&hash) { c.height() - b.header.height + 1 } else { 0 };
    json!({
        "hash": to_hex(&hash), "height": b.header.height, "prevHash": to_hex(&b.header.prev_hash),
        "message": (b.header.height == 0).then_some(c.params.genesis_message),
        "timestamp": b.header.timestamp, "difficulty": b.header.difficulty.to_string(),
        "cumulativeWork": meta.map(|m| m.cum_work.to_string()),
        "nonce": b.header.nonce().to_string(), "miner": b.header.coinbase.to_string(),
        "txRoot": to_hex(&b.header.tx_root), "stateRoot": to_hex(&b.header.state_root), "receiptsRoot": to_hex(&b.header.receipts_root),
        "reward": block_reward(b.header.height, c.params).to_string(),
        "rewardLyx": format_lyx(block_reward(b.header.height, c.params)),
        "fees": fees.to_string(), "feesLyx": format_lyx(fees),
        "size": b.to_bytes().len(), "txCount": b.txs.len(),
        "mainChain": c.is_main(&hash), "confirmations": confirmations,
        "transactions": if full { Value::Array(b.txs.iter().map(tx_json).collect()) }
                        else { Value::Array(b.txs.iter().map(|t| json!(to_hex(&t.hash()))).collect()) },
    })
}

/// Network hashrate estimate from the last `n` blocks: Σdifficulty / Σsolvetime. Labeled as an
/// estimate everywhere it is shown.
fn net_hashrate(c: &Chain, n: u64) -> f64 {
    let h = c.height();
    if h < 2 {
        return 0.0;
    }
    let start = h.saturating_sub(n).max(1);
    let (Some(a), Some(b)) = (c.hash_at(start), c.hash_at(h)) else { return 0.0 };
    let (ta, tb) = (c.meta(&a).unwrap().header.timestamp, c.meta(&b).unwrap().header.timestamp);
    let work: u128 = (start + 1..=h).filter_map(|x| c.hash_at(x)).map(|x| c.meta(&x).unwrap().header.difficulty).sum();
    if tb <= ta {
        return 0.0;
    }
    // don't count the spacing (nobody mines then); min 1 s per block or a fast network shows 0
    let mut racing = 0u64;
    let mut prev = ta;
    for x in start + 1..=h {
        let Some(hx) = c.hash_at(x) else { continue };
        let t = c.meta(&hx).unwrap().header.timestamp;
        racing += t.saturating_sub(prev).saturating_sub(c.params.min_block_spacing).max(1);
        prev = t;
    }
    work as f64 / racing as f64
}

async fn dispatch(node: &Arc<Node>, method: &str, p: &Value, access: Access) -> R {
    let control = access.control;
    let params = node.params;
    if matches!(method, "lyx_call" | "lyx_estimateGas" | "lyx_encodeCall" | "lyx_encodeDeploy")
        && !params.contracts_active(node.chain.lock().height() + 1)
    {
        return Err(RpcError(-32004, crate::state::CONTRACTS_OFF.into()));
    }
    match method {
        "lyx_chainInfo" => {
            let c = node.chain.lock();
            let t = c.tip();
            Ok(json!({
                "network": params.name, "chainId": params.chain_id, "genesisHash": to_hex(&c.genesis_hash()),
                "genesisMessage": params.genesis_message,
                "height": c.height(), "bestHash": to_hex(&t.hash), "bestTimestamp": t.header.timestamp,
                "difficulty": t.header.difficulty.to_string(),
                "nextDifficulty": c.next_difficulty_for(&t.hash).to_string(),
                "cumulativeWork": t.cum_work.to_string(),
                "targetBlockTime": params.target_block_time,
                "minBlockSpacing": c.params.min_block_spacing,
                "coinbaseMaturity": params.coinbase_maturity,
                "swapAddress": swap::SWAP_ADDRESS.to_string(), "maxSwapBlocks": swap::MAX_LOCK_BLOCKS,
                "vaultAddress": crate::vault::VAULT_ADDRESS.to_string(),
                "keyAddress": crate::pqkey::KEY_ADDRESS.to_string(),
                "deployAddress": crate::contract::DEPLOY_ADDRESS.to_string(),
                "gasPrice": crate::contract::GAS_PRICE.to_string(),
                "maxTxGas": crate::contract::MAX_TX_GAS, "blockGasLimit": crate::contract::BLOCK_GAS_LIMIT,
                "contracts": c.state.contracts.len(),
                "contractsActive": params.contracts_active(c.height() + 1),
                "contractsFrom": params.contracts_from,
                "networkHashrateEstimate": net_hashrate(&c, 30),
                "issued": c.state.issued.to_string(), "issuedLyx": format_lyx(c.state.issued),
                "mempoolSize": node.mempool.lock().len(), "mempoolLimit": node.mempool.lock().limits().max_txs,
                "peers": node.peers.lock().len(),
                "pendingHeaders": c.pending_count(), "knownBlocks": c.block_count(),
                "bestHeaderHeight": c.best_header().header.height, "synced": c.is_synced(),
                "halted": c.halted(),
                "uptimeSecs": node.started.elapsed().as_secs(), "version": crate::node::USER_AGENT,
            }))
        }
        "lyx_getBlock" => {
            let c = node.chain.lock();
            let hash = if let Some(h) = p_u64(p, "height") {
                c.hash_at(h).ok_or_else(|| RpcError(-32001, "no block at that height".into()))?
            } else {
                parse_hash(p_str(p, "hash")?).map_err(bad)?
            };
            let b = c.block(&hash).ok_or_else(|| RpcError(-32001, "block not found".into()))?;
            Ok(block_json(&c, &b, p.get("fullTransactions").and_then(|v| v.as_bool()).unwrap_or(false)))
        }
        "lyx_getBlocks" => {
            // Newest-first page of main-chain blocks, for explorers.
            let c = node.chain.lock();
            let count = p_u64(p, "count").unwrap_or(20).min(100);
            let from = p_u64(p, "from").unwrap_or(c.height()).min(c.height());
            let out: Vec<Value> = (0..count)
                .filter_map(|i| from.checked_sub(i))
                .filter_map(|h| c.hash_at(h).and_then(|x| c.block(&x)).map(|b| block_json(&c, &b, false)))
                .collect();
            Ok(Value::Array(out))
        }
        "lyx_getTransaction" => {
            let h = parse_hash(p_str(p, "hash")?).map_err(bad)?;
            let c = node.chain.lock();
            if let Some((height, idx)) = c.tx_location(&h) {
                let bh = c.hash_at(height).unwrap();
                let t = &c.block(&bh).unwrap().txs[idx];
                let mut v = tx_json(t);
                v["status"] = json!("confirmed");
                v["blockHeight"] = json!(height);
                v["blockHash"] = json!(to_hex(&bh));
                v["confirmations"] = json!(c.height() - height + 1);
                if let Some(r) = c.receipt(&h) {
                    let method = v["contract"]["method"].as_str().map(str::to_string);
                    let view = RunView { ok: r.ok, gas_used: r.gas_used, output: &r.output, error: &r.error, logs: &r.logs };
                    let mut rj = run_json(&c.state, view, Some(&t.tx.to()), method.as_deref());
                    rj["fee"] = json!(r.fee.to_string());
                    rj["feeLyx"] = json!(format_lyx(r.fee));
                    rj["contract"] = json!(r.contract.map(|a| a.to_string()));
                    v["receipt"] = rj;
                }
                return Ok(v);
            }
            if let Some(e) = node.mempool.lock().get(&h) {
                let mut v = tx_json(&e.tx);
                v["status"] = json!("pending");
                v["confirmations"] = json!(0);
                v["receivedAt"] = json!(e.received);
                return Ok(v);
            }
            Err(RpcError(-32001, "transaction not found (not pending, not on the best chain)".into()))
        }
        "lyx_getAccount" => {
            let a = p_addr(p, "address")?;
            let c = node.chain.lock();
            let acc = c.state.account(&a);
            let pending = node.mempool.lock().pending_count(&a);
            Ok(json!({
                "address": a.to_string(),
                "balance": acc.balance.to_string(), "balanceLyx": format_lyx(acc.balance),
                "nonce": acc.nonce, "pendingNonce": acc.nonce + pending, "atHeight": c.height(),
                "locked": c.state.immature_of(&a).to_string(), "lockedLyx": format_lyx(c.state.immature_of(&a)),
                "inSwaps": c.state.swaps.values().filter(|l| l.sender == a).map(|l| l.amount).sum::<u128>().to_string(),
                "vault": vault_json(&c, &a),
                "pqCommit": c.state.pq.get(&a).map(hex::encode),
                "controller": c.state.controller(&a).to_string(),
                "pendingRotation": c.state.key_pending.get(&a).map(|k| json!({
                    "newKey": k.new_key.to_string(), "releaseHeight": k.release})),
                "tokens": token_balances_json(&c.state, &a),
                "inTimelocks": c.state.timelocks.values().filter(|l| l.creator == a).map(|l| l.amount).sum::<u128>().to_string(),
                "timelocksFor": c.state.timelocks.iter().filter(|(_, l)| l.beneficiary == a)
                    .map(|(id, l)| timelock_json(id, l)).collect::<Vec<_>>(),
                "contract": contract_json(&c.state, &a),
                // vaults this address is the recovery key or heir for
                "recoveryFor": c.state.vaults.iter().filter(|(_, v)| v.settings.recovery == a).map(|(o, _)| o.to_string()).collect::<Vec<_>>(),
                "heirOf": c.state.vaults.iter().filter(|(_, v)| v.settings.heir.as_ref().is_some_and(|h| h.address == a)).map(|(o, _)| o.to_string()).collect::<Vec<_>>(),
            }))
        }
        "lyx_getWork" => {
            let a = p_addr(p, "address")?;
            if crate::contract::is_system(&a) {
                return Err(bad("rewards can't go to a system address"));
            }
            let w = node.work.get(node, a).map_err(|e| RpcError(-32020, format!("can't build a block: {e}")))?;
            Ok(json!({
                "id": to_hex(&w.id), "height": w.block.header.height, "prevHash": to_hex(&w.block.header.prev_hash),
                "header": hex::encode(w.block.header.pow_input()),
                "timestampOffset": crate::work::TIMESTAMP_OFFSET, "nonceOffset": crate::work::NONCE_OFFSET,
                "seed": hex::encode(w.seed), "difficulty": w.block.header.difficulty.to_string(),
                "notBefore": w.not_before, "now": crate::chain::now(),
                "reward": block_reward(w.block.header.height, node.params).to_string(),
                "rewardLyx": format_lyx(block_reward(w.block.header.height, node.params)),
                "txCount": w.block.txs.len(),
            }))
        }
        "lyx_submitWork" => {
            let id = parse_hash(p_str(p, "id")?).map_err(bad)?;
            let num = |k: &str| -> Result<u64, RpcError> {
                match p.get(k) {
                    Some(Value::String(s)) => s.parse().map_err(|_| bad(format!("bad '{k}'"))),
                    Some(v) => v.as_u64().ok_or_else(|| bad(format!("bad '{k}'"))),
                    None => Err(bad(format!("missing '{k}'"))),
                }
            };
            let (ts, nonce) = (num("timestamp")?, num("nonce")?);
            let b = node.work.solved(&id, ts, nonce).ok_or_else(|| RpcError(-32021, "stale: that work is no longer known".into()))?;
            let (height, hash) = (b.header.height, b.hash());
            let res = node.submit_block(b, None).await;
            let status = match res {
                Ok(crate::chain::Outcome::NewTip { .. }) => "accepted",
                Ok(crate::chain::Outcome::AlreadyKnown) => "duplicate",
                Ok(crate::chain::Outcome::SideChain) => "stale",
                Ok(crate::chain::Outcome::NeedHeaders) => "orphan",
                Ok(crate::chain::Outcome::Ignored) => "stale",
                Err(crate::chain::BlockError::TooEarly(_)) => "too-early",
                Err(e) => return Err(RpcError(-32022, format!("rejected: {e}"))),
            };
            Ok(json!({"status": status, "height": height, "hash": to_hex(&hash)}))
        }
        "lyx_getVault" => {
            let a = p_addr(p, "address")?;
            let c = node.chain.lock();
            Ok(vault_json(&c, &a))
        }
        "lyx_getTimelock" => {
            let id = parse_hash(p_str(p, "id")?).map_err(bad)?;
            let c = node.chain.lock();
            c.state
                .timelocks
                .get(&id)
                .map(|l| timelock_json(&id, l))
                .ok_or_else(|| RpcError(-32001, "no open timelock with that id".into()))
        }
        "lyx_getToken" => {
            let id = parse_hash(p_str(p, "id")?).map_err(bad)?;
            let c = node.chain.lock();
            let t = c.state.tokens.get(&id).ok_or_else(|| RpcError(-32001, "no token with that id".into()))?;
            let mut v = token_json(&id, t);
            let holders = c.state.token_balances.iter().filter(|((_, x), _)| *x == id).count();
            v["holders"] = json!(holders);
            Ok(v)
        }
        "lyx_getTokens" => {
            let limit = p_u64(p, "limit").unwrap_or(50).min(200) as usize;
            let c = node.chain.lock();
            let list: Vec<Value> = c.state.tokens.iter().take(limit).map(|(id, t)| token_json(id, t)).collect();
            Ok(json!({"count": c.state.tokens.len(), "tokens": list}))
        }
        "lyx_findSwaps" => {
            // open or pending locks with this hashlock
            let want = p_str(p, "hashlock")?.trim_start_matches("0x").to_lowercase();
            let c = node.chain.lock();
            let mut ids: Vec<String> =
                c.state.swaps.iter().filter(|(_, l)| hex::encode(l.hashlock) == want).map(|(id, _)| to_hex(id)).collect();
            for (h, e) in node.mempool.lock().entries() {
                if let Some(SwapOp::Lock { hashlock, .. }) = swap::op_of(&e.tx)
                    && hex::encode(hashlock) == want
                {
                    ids.push(to_hex(h));
                }
            }
            Ok(json!(ids))
        }
        "lyx_getSwap" => {
            let id = parse_hash(p_str(p, "id")?).map_err(bad)?;
            swap_json(node, &id).ok_or_else(|| RpcError(-32001, "no swap with that id".into()))
        }
        "lyx_sendRawTransaction" => {
            let raw = hex::decode(p_str(p, "tx")?.trim_start_matches("0x")).map_err(|e| bad(e.to_string()))?;
            let tx = SignedTransaction::from_bytes(&raw).map_err(bad)?;
            let h = node.submit_tx(tx, None).map_err(|e| RpcError(-32010, format!("rejected: {e}")))?;
            Ok(json!(to_hex(&h)))
        }
        "lyx_getAddressHistory" => {
            let a = p_addr(p, "address")?;
            let limit = p_u64(p, "limit").unwrap_or(25).min(100) as usize;
            let c = node.chain.lock();
            let (items, total) = c.address_activity(&a, p_u64(p, "before"), limit);
            let rows: Vec<Value> = items
                .iter()
                .filter_map(|&(height, slot)| {
                    let bh = c.hash_at(height)?;
                    let b = c.block(&bh)?;
                    let base = json!({"height": height, "blockHash": to_hex(&bh), "timestamp": b.header.timestamp,
                                      "confirmations": c.height() - height + 1});
                    let mut v = base;
                    if slot == crate::chain::MINED {
                        let r = block_reward(height, params);
                        let fees: u128 = b.txs.iter().map(|t| paid_fee(&c, t)).sum();
                        v["kind"] = json!("mined");
                        v["amount"] = json!((r + fees).to_string());
                        v["amountLyx"] = json!(format_lyx(r + fees));
                    } else {
                        let t = b.txs.get(slot as usize)?;
                        let from = t.tx.from;
                        let kind = if from == a && t.tx.to() == a { "self" } else if from == a { "sent" } else { "received" };
                        v["kind"] = json!(kind);
                        if let Some(sw) = tx_json(t).get("swap") {
                            v["swap"] = sw.clone();
                        }
                        v["txHash"] = json!(to_hex(&t.hash()));
                        v["from"] = json!(from.to_string());
                        v["to"] = json!(t.tx.to().to_string());
                        v["amount"] = json!(t.tx.value().to_string());
                        v["amountLyx"] = json!(format_lyx(t.tx.value()));
                        v["feeLyx"] = json!(format_lyx(t.tx.fee));
                    }
                    Some(v)
                })
                .collect();
            let next = items.last().map(|x| x.0);
            Ok(json!({"address": a.to_string(), "total": total, "blocksMined": c.blocks_mined_by(&a),
                      "items": rows, "nextBefore": if items.len() == limit { next } else { None }}))
        }
        "lyx_search" => {
            // Work out what a pasted string is: address, height, block hash or tx hash.
            let q = p_str(p, "q")?.trim();
            if let Ok(a) = Address::parse(q) {
                return Ok(json!({"type": "address", "address": a.to_string()}));
            }
            if let Ok(h) = q.parse::<u64>() {
                let c = node.chain.lock();
                return if h <= c.height() { Ok(json!({"type": "block", "height": h})) } else { Ok(json!({"type": "none"})) };
            }
            if let Ok(h) = parse_hash(q) {
                let c = node.chain.lock();
                if let Some(m) = c.meta(&h) {
                    return Ok(json!({"type": "block", "height": m.header.height, "hash": to_hex(&h)}));
                }
                if c.tx_location(&h).is_some() || node.mempool.lock().contains(&h) {
                    return Ok(json!({"type": "transaction", "hash": to_hex(&h)}));
                }
            }
            Ok(json!({"type": "none"}))
        }
        "lyx_getContract" => {
            let a = p_addr(p, "address")?;
            let c = node.chain.lock();
            contract_json(&c.state, &a).ok_or_else(|| RpcError(-32001, "no contract at that address".into()))
        }
        "lyx_getCode" => {
            let a = p_addr(p, "address")?;
            let c = node.chain.lock();
            let info = c.state.contracts.get(&a).ok_or_else(|| RpcError(-32001, "no contract at that address".into()))?;
            Ok(json!(hex::encode(c.state.blobs[&info.code].as_slice())))
        }
        "lyx_getStorage" => {
            // key as hex, or as text with `text: true`
            let a = p_addr(p, "address")?;
            let k = p_str(p, "key")?;
            let key = if p.get("text").and_then(Value::as_bool).unwrap_or(false) {
                k.as_bytes().to_vec()
            } else {
                hex::decode(k.strip_prefix("0x").unwrap_or(k)).map_err(|e| bad(format!("key isn't hex: {e}")))?
            };
            let c = node.chain.lock();
            Ok(json!(c.state.storage.get(&a).and_then(|m| m.get(&key)).map(hex::encode)))
        }
        "lyx_encodeCall" => {
            let to = p_addr(p, "to")?;
            let c = node.chain.lock();
            Ok(json!(hex::encode(call_input(&c.state, &to, p)?.0)))
        }
        "lyx_encodeDeploy" => {
            let abi = crate::abi::parse(p_str(p, "abi")?).map_err(bad)?;
            let args = p.get("args").and_then(Value::as_array).cloned().unwrap_or_default();
            Ok(json!(hex::encode(crate::abi::encode_deploy(&abi, &args).map_err(bad)?)))
        }
        "lyx_call" => {
            // Run a call without sending anything: for reading a contract.
            let to = p_addr(p, "to")?;
            let from = if p.get("from").is_some() { p_addr(p, "from")? } else { Address::ZERO };
            let value = p_value(p)?;
            let c = node.chain.lock();
            if !c.state.contracts.contains_key(&to) {
                return Err(RpcError(-32001, "no contract at that address".into()));
            }
            let (input, method) = call_input(&c.state, &to, p)?;
            let r = crate::contract::simulate(&c.state, from, to, input, value, params);
            let view = RunView { ok: r.ok, gas_used: r.gas_used, output: &r.output, error: &r.error, logs: &r.changes.logs };
            Ok(run_json(&c.state, view, Some(&to), method.as_deref()))
        }
        "lyx_estimateGas" => {
            // A call ({to, method + args or input}) or a deploy ({code, abi, args or input}).
            let from = p_addr(p, "from")?;
            let value = p_value(p)?;
            let c = node.chain.lock();
            let r = if let Some(code) = p.get("code").and_then(Value::as_str) {
                let code = hex::decode(code.strip_prefix("0x").unwrap_or(code)).map_err(|e| bad(format!("code isn't hex: {e}")))?;
                let abi_text = p.get("abi").and_then(Value::as_str).unwrap_or("").to_string();
                let input = match (p.get("input").and_then(Value::as_str), p.get("args").and_then(Value::as_array)) {
                    (Some(h), _) => hex::decode(h.strip_prefix("0x").unwrap_or(h)).map_err(|e| bad(format!("input isn't hex: {e}")))?,
                    (None, Some(args)) => {
                        let abi = crate::abi::parse(&abi_text).map_err(bad)?;
                        crate::abi::encode_deploy(&abi, args).map_err(bad)?
                    }
                    _ => vec![],
                };
                crate::contract::simulate_deploy(&c.state, from, code, abi_text, input, value, params)
            } else {
                let to = p_addr(p, "to")?;
                let (input, _) = call_input(&c.state, &to, p)?;
                crate::contract::simulate(&c.state, from, to, input, value, params)
            };
            // headroom, since state can change before the transaction is mined
            let limit = (r.gas_used + r.gas_used / 5 + 5_000).min(crate::contract::MAX_TX_GAS);
            Ok(json!({
                "ok": r.ok, "error": r.error, "gasUsed": r.gas_used, "gasLimit": limit,
                "gasPrice": crate::contract::GAS_PRICE.to_string(),
                "maxGasFee": (limit as u128 * crate::contract::GAS_PRICE).to_string(),
                "maxGasFeeLyx": format_lyx(limit as u128 * crate::contract::GAS_PRICE),
            }))
        }
        "lyx_getMempool" => {
            let mp = node.mempool.lock();
            let mut v: Vec<(u64, Value)> = mp.entries().map(|(_, e)| (e.received, tx_json(&e.tx))).collect();
            v.sort_by_key(|x| std::cmp::Reverse(x.0));
            Ok(json!({"size": mp.len(), "transactions": v.into_iter().take(200).map(|x| x.1).collect::<Vec<_>>()}))
        }
        "lyx_getPeers" => {
            let peers = node.peers.lock();
            Ok(Value::Array(
                peers
                    .values()
                    .map(|x| json!({
                        "address": x.addr.to_string(), "listenAddress": x.listen_addr.to_string(),
                        "direction": if x.inbound {"inbound"} else {"outbound"},
                        "bestHeight": x.best_height, "userAgent": x.user_agent,
                        "connectedSecs": x.connected_at.elapsed().as_secs(),
                        "lastSeenSecs": x.last_seen.elapsed().as_secs(), "misbehavior": x.misbehavior,
                        "blocksOnly": x.block_only, "extra": x.extra,
                        "pingMs": x.ping_best.map(|d| d.as_millis() as u64),
                    }))
                    .collect(),
            ))
        }
        "lyx_netHealth" => {
            let now = crate::chain::now();
            let h = node.assess_health(now);
            let tip_age = now.saturating_sub(node.chain.lock().tip().header.timestamp);
            let (outbound, inbound, block_only, groups) = {
                let peers = node.peers.lock();
                let groups: std::collections::HashSet<_> =
                    peers.values().filter(|p| !p.inbound).map(|p| crate::addrman::group(&p.listen_addr)).collect();
                (
                    peers.values().filter(|p| !p.inbound).count(),
                    peers.values().filter(|p| p.inbound).count(),
                    peers.values().filter(|p| p.block_only).count(),
                    groups.len(),
                )
            };
            let a = node.addrs.lock();
            Ok(json!({
                "ok": !h.any(),
                // The key this node proves in every handshake. Compare it with the one in a
                // release's `seeds` entry: this answer comes over HTTPS, a different road.
                "nodeKey": hex::encode(node.key.public),
                "staleTip": h.stale_tip, "fewOutboundGroups": h.few_groups, "noPeers": h.no_peers,
                "tipAgeSecs": tip_age,
                "outbound": outbound, "outboundGroups": groups, "inbound": inbound, "blocksOnly": block_only,
                "addresses": {"new": a.len_new(), "tried": a.len_tried()},
            }))
        }
        "lyx_getSupply" => {
            let c = node.chain.lock();
            let h = c.height();
            let expected = issued_through(h, params);
            let circulating = c.state.circulating();
            let next_halving = ((h.max(1) - 1) / params.halving_interval + 1) * params.halving_interval + 1;
            Ok(json!({
                "height": h,
                "issued": c.state.issued.to_string(), "issuedLyx": format_lyx(c.state.issued),
                "expectedFromSchedule": expected.to_string(),
                "sumOfAllBalances": circulating.to_string(),
                "lockedRewards": c.state.immature_total().to_string(),
                "inOpenSwaps": c.state.swaps_total().to_string(), "openSwaps": c.state.swaps.len(),
                "inVaultWithdrawals": c.state.pending_total().to_string(), "vaults": c.state.vaults.len(),
                // Part of sumOfAllBalances, not on top of it: contracts hold LYX in ordinary accounts.
                "inContracts": c.state.contracts_total().to_string(), "contracts": c.state.contracts.len(),
                "quantumCommitments": c.state.pq.len(),
                "consistent": c.state.issued == expected && circulating == expected,
                "currentBlockReward": block_reward(h + 1, params).to_string(),
                "currentBlockRewardLyx": format_lyx(block_reward(h + 1, params)),
                "nextHalvingHeight": next_halving,
                "tailRewardLyx": format_lyx(params.tail_reward),
                "maxSupply": null,
                "premine": "0", "treasuryAllocation": "0", "developerAllocation": "0",
                "accounts": c.state.accounts.len(),
            }))
        }
        "lyx_getEmissionSchedule" => Ok(Value::Array(
            schedule(params, 5)
                .into_iter()
                .map(|(s, e, r)| json!({"fromHeight": s, "toHeight": e, "rewardLyx": format_lyx(r)}))
                .chain(std::iter::once(json!({"fromHeight": 5 * params.halving_interval + 1, "toHeight": null, "rewardLyx": format_lyx(params.tail_reward), "note": "tail emission, forever"})))
                .collect(),
        )),
        "lyx_getMiningInfo" => {
            let m = &node.miner;
            let c = node.chain.lock();
            let diff = c.next_difficulty_for(&c.tip().hash);
            let hr = m.hashrate();
            Ok(json!({
                "enabled": m.enabled.load(Ordering::Relaxed),
                "threads": m.threads.load(Ordering::Relaxed), "maxThreads": m.max_threads,
                "algorithm": "RandomX (light mode)",
                "coinbase": m.coinbase.lock().map(|a| a.to_string()),
                "hashrate": hr, "hashesTotal": m.hashes_total.load(Ordering::Relaxed),
                "blocksFound": m.blocks_found.load(Ordering::Relaxed),
                "blocksAcceptedLocally": m.blocks_accepted.load(Ordering::Relaxed),
                "blocksStale": m.blocks_stale.load(Ordering::Relaxed),
                "blocksRejected": m.blocks_rejected.load(Ordering::Relaxed),
                "lastAcceptedBlock": m.last_accepted.lock().map(|(h, x)| json!({"height": h, "hash": to_hex(&x)})),
                "networkDifficulty": diff.to_string(),
                // the miner sits out min_block_spacing after every block; tell the UI so it can say so
                "nextBlockDue": c.next_block_due(), "now": crate::chain::now(),
                "minBlockSpacing": c.params.min_block_spacing,
                "waiting": m.enabled.load(Ordering::Relaxed) && crate::chain::now() < c.next_block_due(),
                "networkHashrateEstimate": net_hashrate(&c, 30),
                "expectedSecondsPerBlockAtThisHashrate": if hr > 0.0 {
                    // solo: spacing + racing time. with others: your share of blocks.
                    let (t, s) = (params.target_block_time as f64, params.min_block_spacing as f64);
                    let racing = diff as f64 / hr;
                    Some((s + racing).max(racing * t / (t - s)))
                } else {
                    None
                },
                "nextBlockRewardLyx": format_lyx(block_reward(c.height() + 1, params)),
                "note": "expected time is a statistical average, not a guarantee",
            }))
        }
        "lyx_setMining" => {
            if !control {
                return Err(RpcError(-32003, CONTROL_REFUSED.into()));
            }
            let enabled = p.get("enabled").and_then(|v| v.as_bool()).ok_or_else(|| bad("missing bool 'enabled'"))?;
            let threads = p_u64(p, "threads").map(|t| t as usize);
            let coinbase = match p.get("coinbase") {
                Some(_) => Some(p_addr(p, "coinbase")?),
                None => None,
            };
            if access.from_site
                && let (Some(new), Some(old)) = (coinbase, *node.miner.coinbase.lock())
                && new != old
            {
                return Err(RpcError(
                    -32003,
                    "a website can't change where this node's rewards go. Restart the node with --coinbase".into(),
                ));
            }
            node.miner.configure(enabled, threads, coinbase).map_err(bad)?;
            Ok(json!({"enabled": enabled}))
        }
        "lyx_validateAddress" => {
            let s = p_str(p, "address")?;
            Ok(match Address::parse(s) {
                Ok(a) => json!({"valid": true, "address": a.to_string()}),
                Err(e) => json!({"valid": false, "error": e.to_string()}),
            })
        }
        "lyx_estimateFee" => Ok(json!({
            "minFeePerByte": MIN_FEE_PER_BYTE.to_string(),
            "typicalTransferBytes": 135,
            "typicalTransferFee": (135 * MIN_FEE_PER_BYTE).to_string(),
            "typicalTransferFeeLyx": format_lyx(135 * MIN_FEE_PER_BYTE),
        })),
        "" => Err(RpcError(-32600, "missing method".into())),
        m => Err(RpcError(-32601, format!("method not found: {m}"))),
    }
}

/// What a transaction actually paid: a contract transaction pays less than its fee field when it
/// doesn't use all its gas.
fn paid_fee(c: &Chain, t: &SignedTransaction) -> u128 {
    c.receipt(&t.hash()).map(|r| r.fee).unwrap_or(t.tx.fee)
}
