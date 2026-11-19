//! Testnet faucet. Holds a normal wallet file and sends from it over RPC.

use anyhow::{Context, Result, bail};
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use clap::Parser;
use lokyx::address::Address;
use lokyx::amount::{format_lyx, parse_lyx};
use lokyx::keys::{address_of, derive_signing_key, parse_mnemonic};
use lokyx::keystore;
use lokyx::params::{ChainParams, Network};
use lokyx::tx::build_transfer;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;

#[derive(Parser)]
#[command(name = "lokyx-faucet", version, about = "Testnet faucet for LOKYX")]
struct Args {
    #[arg(long, default_value = "testnet")]
    network: Network,
    /// Faucet wallet file (password from LOKYX_WALLET_PASSWORD)
    #[arg(long)]
    wallet: PathBuf,
    /// Node RPC URL (default http://127.0.0.1:<network rpc port>)
    #[arg(long)]
    rpc: Option<String>,
    #[arg(long, default_value = "127.0.0.1:8701")]
    listen: SocketAddr,
    /// LYX per claim
    #[arg(long, default_value = "5")]
    amount: String,
    /// Hours before the same address or IP can claim again
    #[arg(long, default_value_t = 24)]
    cooldown_hours: u64,
    /// Trust X-Forwarded-For from a reverse proxy on this machine
    #[arg(long)]
    behind_proxy: bool,
    /// Allowed browser origin (repeatable)
    #[arg(long = "cors")]
    cors: Vec<String>,
}

struct Faucet {
    params: &'static ChainParams,
    sk: k256::ecdsa::SigningKey,
    address: Address,
    rpc: String,
    amount: u128,
    cooldown: Duration,
    behind_proxy: bool,
    by_address: Mutex<HashMap<Address, Instant>>,
    by_ip: Mutex<HashMap<IpAddr, Instant>>,
    /// Held while building and submitting, so nonces are used strictly in order.
    send_lock: Mutex<()>,
}

fn rpc_call(url: &str, method: &str, params: Value) -> Result<Value> {
    let resp: Value = ureq::post(url)
        .set("Content-Type", "application/json")
        .timeout(Duration::from_secs(15))
        .send_json(json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}))?
        .into_json()?;
    if let Some(e) = resp.get("error") {
        bail!("{}", e["message"].as_str().unwrap_or("rpc error"));
    }
    Ok(resp["result"].clone())
}

async fn rpc(url: &str, method: &'static str, params: Value) -> Result<Value> {
    let url = url.to_string();
    tokio::task::spawn_blocking(move || rpc_call(&url, method, params)).await?
}

fn err(code: StatusCode, msg: impl Into<String>) -> Response {
    (code, Json(json!({"error": msg.into()}))).into_response()
}

async fn info(State(f): State<Arc<Faucet>>) -> Response {
    let acct = rpc(&f.rpc, "lyx_getAccount", json!({"address": f.address.to_string()})).await;
    match acct {
        Ok(a) => Json(json!({
            "network": f.params.name,
            "address": f.address.to_string(),
            "balanceLyx": a["balanceLyx"],
            "amountLyx": format_lyx(f.amount),
            "cooldownHours": f.cooldown.as_secs() / 3600,
        }))
        .into_response(),
        Err(e) => err(StatusCode::SERVICE_UNAVAILABLE, format!("node unavailable: {e}")),
    }
}

fn client_ip(f: &Faucet, peer: SocketAddr, headers: &HeaderMap) -> IpAddr {
    if f.behind_proxy
        && peer.ip().is_loopback()
        && let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .and_then(|v| v.trim().parse().ok())
    {
        return ip;
    }
    peer.ip()
}

async fn claim(
    State(f): State<Arc<Faucet>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Json<Value>,
) -> Response {
    let Some(to) = body.get("address").and_then(|v| v.as_str()) else {
        return err(StatusCode::BAD_REQUEST, "send {\"address\": \"lyx1…\"}");
    };
    let to = match Address::parse(to) {
        Ok(a) => a,
        Err(e) => return err(StatusCode::BAD_REQUEST, format!("invalid address: {e}")),
    };
    if to == f.address {
        return err(StatusCode::BAD_REQUEST, "that's the faucet's own address");
    }
    let ip = client_ip(&f, peer, &headers);
    let now = Instant::now();
    {
        let a = f.by_address.lock().await;
        let i = f.by_ip.lock().await;
        for last in [a.get(&to), i.get(&ip)].into_iter().flatten() {
            let since = now.duration_since(*last);
            if since < f.cooldown {
                let wait = (f.cooldown - since).as_secs();
                return err(
                    StatusCode::TOO_MANY_REQUESTS,
                    format!("already claimed; try again in {}h {}m", wait / 3600, (wait % 3600) / 60),
                );
            }
        }
    }

    let _g = f.send_lock.lock().await;
    let acct = match rpc(&f.rpc, "lyx_getAccount", json!({"address": f.address.to_string()})).await {
        Ok(a) => a,
        Err(e) => return err(StatusCode::SERVICE_UNAVAILABLE, format!("node unavailable: {e}")),
    };
    let nonce = acct["pendingNonce"].as_u64().unwrap_or(0);
    let tx = match build_transfer(&f.sk, f.params, nonce, to, f.amount, None) {
        Ok(t) => t,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };
    let balance: u128 = acct["balance"].as_str().unwrap_or("0").parse().unwrap_or(0);
    if balance < f.amount + tx.tx.fee {
        return err(StatusCode::SERVICE_UNAVAILABLE, "the faucet is empty right now; try again later");
    }
    match rpc(&f.rpc, "lyx_sendRawTransaction", json!({"tx": hex::encode(tx.to_bytes())})).await {
        Ok(h) => {
            f.by_address.lock().await.insert(to, now);
            f.by_ip.lock().await.insert(ip, now);
            tracing::info!("sent {} LYX to {to} ({ip})", format_lyx(f.amount));
            Json(json!({"txHash": h, "amountLyx": format_lyx(f.amount), "to": to.to_string()})).into_response()
        }
        Err(e) => err(StatusCode::BAD_GATEWAY, format!("node rejected the transaction: {e}")),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_target(false).with_ansi(!cfg!(windows)).init();
    let a = Args::parse();
    if a.network != Network::Testnet && a.network != Network::Devnet {
        bail!("faucets are only for test networks");
    }
    let params = a.network.params();
    let file = keystore::load(&a.wallet)?;
    let pw =
        std::env::var("LOKYX_WALLET_PASSWORD").context("set LOKYX_WALLET_PASSWORD to the faucet wallet's password")?;
    let secret = keystore::decrypt(&file, &pw)?;
    let sk = derive_signing_key(&parse_mnemonic(&secret.mnemonic)?, &secret.passphrase, 0)?;
    let address = address_of(&sk);
    let amount = parse_lyx(&a.amount).map_err(anyhow::Error::msg)?;
    let f = Arc::new(Faucet {
        params,
        sk,
        address,
        rpc: a.rpc.unwrap_or_else(|| format!("http://127.0.0.1:{}", params.default_rpc_port)),
        amount,
        cooldown: Duration::from_secs(a.cooldown_hours * 3600),
        behind_proxy: a.behind_proxy,
        by_address: Mutex::new(HashMap::new()),
        by_ip: Mutex::new(HashMap::new()),
        send_lock: Mutex::new(()),
    });

    // Forget old claims once a day so the maps don't grow forever.
    let g = f.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(3600)).await;
            let cutoff = g.cooldown;
            g.by_address.lock().await.retain(|_, t| t.elapsed() < cutoff);
            g.by_ip.lock().await.retain(|_, t| t.elapsed() < cutoff);
        }
    });

    let mut app = Router::new().route("/info", get(info)).route("/claim", post(claim)).with_state(f.clone());
    if !a.cors.is_empty() {
        let origins: Vec<HeaderValue> = a.cors.iter().map(|o| o.parse()).collect::<Result<_, _>>()?;
        app = app.layer(
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods([Method::GET, Method::POST])
                .allow_headers([header::CONTENT_TYPE]),
        );
    }
    tracing::info!("faucet for {} at {} paying {} LYX per claim", params.name, address, format_lyx(amount));
    let listener = tokio::net::TcpListener::bind(a.listen).await?;
    tracing::info!("listening on http://{}", a.listen);
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}
