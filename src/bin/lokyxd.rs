//! The node.

use anyhow::Context;
use clap::Parser;
use lokyx::address::Address;
use lokyx::chain::Chain;
use lokyx::node::Node;
use lokyx::params::Network;
use lokyx::store::Store;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "lokyxd", version, about = "LOKYX full node and RandomX CPU miner")]
struct Args {
    /// devnet | testnet  (there is no mainnet until the protocol is independently audited)
    /// Make this node's identity key (node.key in the data directory) if there isn't one, print its
    /// public key and the seed entry that pins it, and exit without starting the node.
    #[arg(long)]
    node_key: bool,
    /// Check every stored block again from genesis instead of starting from the saved state.
    #[arg(long)]
    reverify: bool,
    #[arg(long, default_value = "testnet")]
    network: Network,
    /// Data directory (block database)
    #[arg(long)]
    datadir: Option<PathBuf>,
    /// P2P listen address
    #[arg(long, default_value = "0.0.0.0")]
    listen: IpAddr,
    #[arg(long)]
    p2p_port: Option<u16>,
    /// JSON-RPC bind address (keep on 127.0.0.1 unless you put an authenticating proxy in front)
    #[arg(long, default_value = "127.0.0.1")]
    rpc_bind: IpAddr,
    #[arg(long)]
    rpc_port: Option<u16>,
    /// Allow browser access to RPC from this exact origin (e.g. http://localhost:5173)
    #[arg(long)]
    rpc_cors: Option<String>,
    /// Peer to connect to (repeatable), as host:port, e.g. --peer seed1.example.org:27701
    #[arg(long = "peer")]
    peers: Vec<String>,
    /// Don't dial the network's built-in seed nodes
    #[arg(long)]
    no_seeds: bool,
    /// Turn off control RPC methods (lyx_setMining). Use this whenever RPC is behind a proxy.
    #[arg(long)]
    public_rpc: bool,
    /// File holding a secret that control RPC methods must present as `Authorization: Bearer
    /// <secret>`. With one set, control works from anywhere that has it (put TLS in front) and
    /// nowhere that doesn't, including this machine. Also read from LOKYX_RPC_TOKEN.
    #[arg(long)]
    rpc_token_file: Option<std::path::PathBuf>,
    /// Start mining immediately
    #[arg(long)]
    mine: bool,
    /// lyx1... address that receives block rewards
    #[arg(long)]
    coinbase: Option<String>,
    /// Mining threads
    #[arg(long, default_value_t = 1)]
    threads: usize,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // The cheap test PoW must never reach a real node, even by a build mistake.
    if cfg!(feature = "test-pow") {
        anyhow::bail!("this lokyxd was built with the test-pow feature and must not run");
    }
    // Older Windows consoles print colour codes as junk.
    tracing_subscriber::fmt().with_target(false).with_ansi(!cfg!(windows)).with_max_level(tracing::Level::INFO).init();
    let a = Args::parse();
    let params = a.network.params();
    let datadir = a.datadir.unwrap_or_else(|| lokyx::paths::network_dir(params.name));
    let p2p_port = a.p2p_port.unwrap_or(params.default_p2p_port);
    let rpc_port = a.rpc_port.unwrap_or(params.default_rpc_port);

    if a.node_key {
        let path = datadir.join("node.key");
        let key = lokyx::transport::NodeKey::load_or_create(&path)?;
        let public = hex::encode(key.public);
        println!("node key file: {}", path.display());
        println!("public key:    {public}");
        if let Some(seed) = params.seeds.first() {
            let host = seed.split('#').next().unwrap_or(seed);
            println!("seed entry:    {host}#{public}");
        }
        return Ok(());
    }

    tracing::info!("LOKYX {}, network {} (chain id {})", lokyx::node::USER_AGENT, params.name, params.chain_id);
    tracing::info!("initializing RandomX and loading chain from {}", datadir.display());
    let chain = Chain::open(params, Some(Store::open(&datadir.join("chain.redb"))?), a.reverify)?;
    tracing::info!("genesis {}", lokyx::crypto::to_hex(&chain.genesis_hash()));

    let mut hosts: Vec<String> = a.peers.clone();
    if !a.no_seeds {
        hosts.extend(params.seeds.iter().map(|s| s.to_string()));
    }
    let bootstrap = lokyx::net::resolve(&hosts).await;
    tracing::info!("{} bootstrap address(es) from {} host(s)", bootstrap.len(), hosts.len());
    let key = lokyx::transport::NodeKey::load_or_create(&datadir.join("node.key"))?;
    tracing::info!("node key {}", hex::encode(key.public));
    let node = Node::with_key(params, chain, p2p_port, vec![], key);
    node.load_net();
    node.add_resolved(bootstrap);
    *node.seed_hosts.lock() = hosts;
    lokyx::miner::start(node.clone());
    if a.mine {
        let cb = a.coinbase.as_deref().ok_or_else(|| anyhow::anyhow!("--mine requires --coinbase lyx1…"))?;
        let cb = Address::parse(cb).map_err(|e| anyhow::anyhow!("invalid --coinbase: {e}"))?;
        node.miner.configure(true, Some(a.threads), Some(cb)).map_err(anyhow::Error::msg)?;
        tracing::info!("mining to {cb} with {} thread(s)", a.threads);
    }

    let token = match (&a.rpc_token_file, std::env::var("LOKYX_RPC_TOKEN").ok()) {
        (Some(f), _) => {
            let t = std::fs::read_to_string(f).with_context(|| format!("reading {}", f.display()))?;
            let t = t.trim().to_string();
            if t.len() < 16 {
                anyhow::bail!("the RPC token in {} is too short; use at least 16 characters", f.display());
            }
            Some(t)
        }
        (None, Some(t)) if t.trim().len() >= 16 => Some(t.trim().to_string()),
        (None, Some(_)) => anyhow::bail!("LOKYX_RPC_TOKEN is too short; use at least 16 characters"),
        (None, None) => None,
    };
    if token.is_some() {
        tracing::info!("control RPC needs the token");
    }

    lokyx::net::start(node.clone(), SocketAddr::new(a.listen, p2p_port)).await?;
    let rpc = tokio::spawn(lokyx::rpc::serve(
        node.clone(),
        SocketAddr::new(a.rpc_bind, rpc_port),
        a.rpc_cors,
        !a.public_rpc,
        token,
    ));

    tokio::select! {
        r = rpc => { r??; }
        _ = tokio::signal::ctrl_c() => { tracing::info!("shutting down"); }
    }
    node.save_net();
    Ok(())
}
