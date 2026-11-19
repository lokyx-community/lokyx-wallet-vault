//! Command-line wallet.

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use lokyx::address::Address;
use lokyx::amount::{format_lyx, parse_lyx};
use lokyx::keys::{address_of, derive_signing_key, generate_mnemonic, parse_mnemonic};
use lokyx::keystore::{self, Secret};
use lokyx::params::Network;
use serde_json::{Value, json};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[derive(Parser)]
#[command(name = "lokyx-wallet", version, about = "LOKYX command-line wallet")]
struct Cli {
    #[arg(long, default_value = "testnet", global = true)]
    network: Network,
    /// Wallet file (default: wallet.json in the LOKYX folder for the network, see `paths`)
    #[arg(long, global = true)]
    wallet: Option<PathBuf>,
    /// Node RPC URL (default http://127.0.0.1:<network rpc port>)
    #[arg(long, global = true)]
    rpc: Option<String>,
    /// Leave out to get the menu (what double-clicking the program opens)
    #[command(subcommand)]
    cmd: Option<Cmd>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Create a new wallet and show its recovery phrase once
    New {
        #[arg(long, default_value_t = 24)]
        words: usize,
    },
    /// Restore a wallet from a recovery phrase (read from stdin)
    Restore,
    /// Show the receiving address
    Address,
    /// Show balance and nonce
    Balance {
        /// Any lyx1 address (defaults to this wallet)
        address: Option<String>,
    },
    /// Send LYX
    Send {
        #[arg(long)]
        to: String,
        /// Amount in LYX, e.g. 1.5
        #[arg(long)]
        amount: String,
        /// Fee in LYX (default: protocol minimum for this transaction's size)
        #[arg(long)]
        fee: Option<String>,
        /// Act for this account instead of the wallet's own address (an account whose key was rotated to this wallet)
        #[arg(long)]
        from: Option<String>,
        /// Wait until the transaction has this many confirmations
        #[arg(long, default_value_t = 1)]
        wait: u64,
    },
    /// Hand an account to another key after a delay (a vault's own delay, or one day)
    Rotate {
        /// The address of the new key's wallet (`address` in that wallet)
        #[arg(long)]
        new_key: String,
        /// The account to rotate (default: this wallet's own address)
        #[arg(long)]
        from: Option<String>,
        #[arg(long, default_value_t = 1)]
        wait: u64,
    },
    /// Stop a key rotation that hasn't happened yet
    CancelRotate {
        /// The account whose rotation to cancel (default: this wallet's own address)
        #[arg(long)]
        account: Option<String>,
        /// Send as this account: itself (default), or a vault's recovery address
        #[arg(long)]
        from: Option<String>,
        #[arg(long, default_value_t = 1)]
        wait: u64,
    },
    /// Deploy a contract (a .wasm file built from contracts/)
    Deploy {
        /// The contract's .wasm file
        wasm: PathBuf,
        /// Its ABI (default: abi.json next to the .wasm, or none)
        #[arg(long)]
        abi: Option<PathBuf>,
        /// Arguments for its deploy function, in order
        args: Vec<String>,
        /// LYX to send along, e.g. 1.5
        #[arg(long)]
        value: Option<String>,
        /// Gas limit (default: estimated by the node, plus some headroom)
        #[arg(long)]
        gas: Option<u64>,
        #[arg(long, default_value_t = 1)]
        wait: u64,
    },
    /// Call a contract method, as a transaction
    Call {
        contract: String,
        method: String,
        args: Vec<String>,
        #[arg(long)]
        value: Option<String>,
        #[arg(long)]
        gas: Option<u64>,
        #[arg(long, default_value_t = 1)]
        wait: u64,
    },
    /// Read from a contract without sending anything (free, nothing is changed)
    Read { contract: String, method: String, args: Vec<String> },
    /// Look up a transaction
    Tx { hash: String },
    /// Check whether a string is a valid lyx1 address
    Validate { address: String },
    /// Reveal the recovery phrase (requires password)
    ExportPhrase,
    /// Reveal the private key of the wallet's address (requires password)
    ExportKey,
}

fn rpc(url: &str, method: &str, params: Value) -> Result<Value> {
    let resp: Value = ureq::post(url)
        .set("Content-Type", "application/json")
        .timeout(Duration::from_secs(30))
        .send_json(json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
        .with_context(|| format!("cannot reach node at {url}, is lokyxd running?"))?
        .into_json()?;
    if let Some(e) = resp.get("error") {
        bail!("{}", e["message"].as_str().unwrap_or("rpc error"));
    }
    Ok(resp["result"].clone())
}

/// A command-line argument as JSON: numbers, true/false, lists and quoted strings as themselves,
/// anything else (like an address) as a string.
fn arg_json(a: &str) -> Value {
    serde_json::from_str(a).unwrap_or_else(|_| Value::String(a.to_string()))
}

fn wait_for(url: &str, h: &str, wait: u64) -> Result<Option<Value>> {
    if wait == 0 {
        return Ok(None);
    }
    let start = Instant::now();
    loop {
        std::thread::sleep(Duration::from_secs(2));
        match rpc(url, "lyx_getTransaction", json!({"hash": h})) {
            Ok(v) if v["confirmations"].as_u64().unwrap_or(0) >= wait => {
                println!("Confirmed in block {} ({} confirmation(s))", v["blockHeight"], v["confirmations"]);
                return Ok(Some(v));
            }
            Ok(v) => eprint!("\r{}, {} confirmation(s)…", v["status"].as_str().unwrap_or("?"), v["confirmations"]),
            Err(e) => eprint!("\r{e}"),
        }
        if start.elapsed() > Duration::from_secs(600) {
            println!("\nStill not confirmed after 10 minutes; check later with `lokyx-wallet tx {h}`");
            return Ok(None);
        }
    }
}

fn print_receipt(tx: &Value) {
    let r = &tx["receipt"];
    if r.is_null() {
        return;
    }
    if r["ok"].as_bool() == Some(true) {
        println!("Worked. Gas used: {}  Fee paid: {} LYX", r["gasUsed"], r["feeLyx"].as_str().unwrap_or("?"));
        if let Some(c) = r["contract"].as_str() {
            println!("Contract address: {c}");
        }
        if !r["result"].is_null() {
            println!("Returned: {}", r["result"]);
        }
    } else {
        println!(
            "Failed: {}  (gas used: {}, fee paid: {} LYX)",
            r["error"].as_str().unwrap_or("?"),
            r["gasUsed"],
            r["feeLyx"].as_str().unwrap_or("?")
        );
    }
    for l in r["logs"].as_array().into_iter().flatten() {
        let body = if l["fields"].is_null() { l["data"].clone() } else { l["fields"].clone() };
        println!("Event {}: {}", l["event"].as_str().unwrap_or("?"), body);
    }
}

fn send_contract_tx(url: &str, tx: lokyx::tx::SignedTransaction, balance: u128, wait: u64) -> Result<()> {
    if tx.tx.value() + tx.tx.fee > balance {
        bail!(
            "insufficient balance: have {} LYX, need up to {} LYX",
            format_lyx(balance),
            format_lyx(tx.tx.value() + tx.tx.fee)
        );
    }
    println!("Most it can cost: {} LYX (unused gas comes back)", format_lyx(tx.tx.fee));
    let h = rpc(url, "lyx_sendRawTransaction", json!({"tx": hex::encode(tx.to_bytes())}))?;
    let h = h.as_str().unwrap_or("").to_string();
    println!("Broadcast: {h}");
    if let Some(v) = wait_for(url, &h, wait)? {
        print_receipt(&v);
    }
    Ok(())
}

/// What to tell anyone who is about to rotate a key.
const KEY_THEFT_NOTICE: &str = "Key stolen? Rotation won't save your funds. Sweep your vault or move your funds now.\nRotation is for planned key changes and lost-device cases.";

fn account_arg(a: Option<String>, default: Address) -> Result<Address> {
    match a {
        Some(a) => Address::parse(&a).map_err(|e| anyhow::anyhow!("account: {e}")),
        None => Ok(default),
    }
}

/// Sign and broadcast any operation for `account`, which `sk` must control. Returns the hash.
fn send_op(
    url: &str,
    p: &lokyx::params::ChainParams,
    sk: &k256::ecdsa::SigningKey,
    account: Address,
    op: lokyx::tx::Op,
) -> Result<String> {
    let acct = rpc(url, "lyx_getAccount", json!({"address": account.to_string()}))?;
    let nonce = acct["pendingNonce"].as_u64().context("bad nonce from node")?;
    let height = rpc(url, "lyx_chainInfo", json!({}))?["height"].as_u64().context("bad height from node")?;
    let expires = height + 86_400 / p.target_block_time;
    let tx = lokyx::tx::build_from(sk, account, p, lokyx::tx::Params { nonce, expires, ..Default::default() }, op)?;
    println!(
        "Sending a {} operation for {account}\nFee: {} LYX  Nonce: {nonce}",
        tx.tx.op.kind(),
        format_lyx(tx.tx.fee)
    );
    let h = rpc(url, "lyx_sendRawTransaction", json!({"tx": hex::encode(tx.to_bytes())}))?;
    let h = h.as_str().unwrap_or("").to_string();
    println!("Broadcast: {h}");
    Ok(h)
}

/// Sign and broadcast a transfer. Returns the transaction hash.
fn send(
    url: &str,
    p: &lokyx::params::ChainParams,
    sk: &k256::ecdsa::SigningKey,
    me: Address,
    to: Address,
    value: u128,
    fee: Option<u128>,
) -> Result<String> {
    let acct = rpc(url, "lyx_getAccount", json!({"address": me.to_string()}))?;
    let nonce = acct["pendingNonce"].as_u64().context("bad nonce from node")?;
    // A transfer that isn't mined within a day is dropped rather than left to surprise anyone.
    let height = rpc(url, "lyx_chainInfo", json!({}))?["height"].as_u64().context("bad height from node")?;
    let expires = height + 86_400 / p.target_block_time;
    let tx = lokyx::tx::build_from(
        sk,
        me,
        p,
        lokyx::tx::Params { nonce, expires, fee, ..Default::default() },
        lokyx::tx::Op::Transfer { to, value },
    )?;
    let balance: u128 = acct["balance"].as_str().unwrap_or("0").parse()?;
    if value + tx.tx.fee > balance {
        bail!(
            "insufficient balance: have {} LYX, need {} LYX (incl. fee)",
            format_lyx(balance),
            format_lyx(value + tx.tx.fee)
        );
    }
    println!("Sending {} LYX to {to}\nFee: {} LYX  Nonce: {nonce}", format_lyx(value), format_lyx(tx.tx.fee));
    let h = rpc(url, "lyx_sendRawTransaction", json!({"tx": hex::encode(tx.to_bytes())}))?;
    let h = h.as_str().unwrap_or("").to_string();
    println!("Broadcast: {h}");
    Ok(h)
}

fn password(prompt: &str) -> Result<String> {
    if let Ok(p) = std::env::var("LOKYX_WALLET_PASSWORD") {
        return Ok(p);
    }
    Ok(rpassword::prompt_password(prompt)?)
}

fn read_line_stdin(prompt: &str) -> Result<String> {
    eprint!("{prompt}");
    std::io::stderr().flush()?;
    let mut s = String::new();
    if std::io::stdin().lock().read_line(&mut s)? == 0 {
        bail!("no more input");
    }
    Ok(s.trim().to_string())
}

fn create(path: &std::path::Path, mnemonic: &bip39::Mnemonic, passphrase: &str) -> Result<Address> {
    if path.exists() {
        bail!("{} already exists, refusing to overwrite a wallet", path.display());
    }
    let addr = address_of(&derive_signing_key(mnemonic, passphrase, 0)?);
    let pw = password("Choose a wallet password (min 8 chars): ")?;
    if std::env::var("LOKYX_WALLET_PASSWORD").is_err() && password("Repeat password: ")? != pw {
        bail!("passwords do not match");
    }
    let secret = Secret { mnemonic: mnemonic.to_string(), passphrase: passphrase.to_string() };
    keystore::save(path, &keystore::encrypt(&secret, &addr.to_string(), &pw)?)?;
    Ok(addr)
}

fn unlock(path: &std::path::Path) -> Result<(k256::ecdsa::SigningKey, Address)> {
    let f = keystore::load(path)?;
    let s = keystore::decrypt(&f, &password("Wallet password: ")?)?;
    let sk = derive_signing_key(&parse_mnemonic(&s.mnemonic)?, &s.passphrase, 0)?;
    let a = address_of(&sk);
    if a.to_string() != f.address {
        bail!("wallet file address does not match its key, file may be corrupted");
    }
    Ok((sk, a))
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let p = cli.network.params();
    let path = cli.wallet.clone().unwrap_or_else(|| lokyx::paths::network_dir(p.name).join("wallet.json"));
    let url = cli.rpc.clone().unwrap_or_else(|| format!("http://127.0.0.1:{}", p.default_rpc_port));

    let Some(cmd) = cli.cmd else {
        let r = menu::run(p, &path, cli.rpc.as_deref());
        if let Err(e) = &r {
            println!("\n{e}");
        }
        menu::pause();
        return Ok(());
    };
    match cmd {
        Cmd::New { words } => {
            let m = generate_mnemonic(words)?;
            let addr = create(&path, &m, "")?;
            println!("Wallet created: {}", path.display());
            println!("Address: {addr}\n");
            println!("RECOVERY PHRASE, write it down offline. Anyone with it controls your funds.");
            println!("It will not be shown again (use `export-phrase` with your password).\n");
            for (i, w) in m.words().enumerate() {
                print!("{:>2}. {:<10}", i + 1, w);
                if (i + 1) % 4 == 0 {
                    println!();
                }
            }
        }
        Cmd::Restore => {
            let phrase = read_line_stdin("Recovery phrase: ")?;
            let m = parse_mnemonic(&phrase)?;
            let pass = std::env::var("LOKYX_BIP39_PASSPHRASE").unwrap_or_default();
            let addr = create(&path, &m, &pass)?;
            println!("Wallet restored: {}\nAddress: {addr}", path.display());
        }
        Cmd::Address => println!("{}", keystore::load(&path)?.address),
        Cmd::Balance { address } => {
            let a = match address {
                Some(s) => Address::parse(&s).map_err(|e| anyhow::anyhow!("{e}"))?.to_string(),
                None => keystore::load(&path)?.address,
            };
            let r = rpc(&url, "lyx_getAccount", json!({"address": a}))?;
            println!(
                "Address: {}\nBalance: {} LYX\nNonce:   {} (next: {})\nAt height {}",
                r["address"].as_str().unwrap_or(""),
                r["balanceLyx"].as_str().unwrap_or("?"),
                r["nonce"],
                r["pendingNonce"],
                r["atHeight"]
            );
        }
        Cmd::Send { to, amount, fee, from, wait } => {
            let to = Address::parse(&to).map_err(|e| anyhow::anyhow!("recipient: {e}"))?;
            let value = parse_lyx(&amount).map_err(anyhow::Error::msg)?;
            let fee = fee.map(|f| parse_lyx(&f)).transpose().map_err(anyhow::Error::msg)?;
            let (sk, me) = unlock(&path)?;
            let account = account_arg(from, me)?;
            let h = send(&url, p, &sk, account, to, value, fee)?;
            wait_for(&url, &h, wait)?;
        }
        Cmd::Rotate { new_key, from, wait } => {
            let new_key = Address::parse(&new_key).map_err(|e| anyhow::anyhow!("new key: {e}"))?;
            let (sk, me) = unlock(&path)?;
            let account = account_arg(from, me)?;
            println!("{KEY_THEFT_NOTICE}\n");
            let h = send_op(&url, p, &sk, account, lokyx::tx::Op::Key(lokyx::pqkey::KeyOp::Rotate { new_key }))?;
            wait_for(&url, &h, wait)?;
        }
        Cmd::CancelRotate { account, from, wait } => {
            let (sk, me) = unlock(&path)?;
            let sender = account_arg(from, me)?;
            let account = account_arg(account, sender)?;
            let h = send_op(&url, p, &sk, sender, lokyx::tx::Op::Key(lokyx::pqkey::KeyOp::CancelRotate { account }))?;
            wait_for(&url, &h, wait)?;
        }
        Cmd::Deploy { wasm, abi, args, value, gas, wait } => {
            let code = std::fs::read(&wasm).with_context(|| format!("reading {}", wasm.display()))?;
            let abi_path = abi.or_else(|| {
                let guess = wasm.with_extension("abi.json");
                let beside = wasm.parent().map(|d| d.join("abi.json"));
                [Some(guess), beside].into_iter().flatten().find(|p| p.exists())
            });
            let abi_text = match &abi_path {
                Some(p) => std::fs::read_to_string(p).with_context(|| format!("reading {}", p.display()))?,
                None => String::new(),
            };
            let args: Vec<Value> = args.iter().map(|a| arg_json(a)).collect();
            let input = if abi_text.is_empty() {
                if !args.is_empty() {
                    bail!("deploy arguments need an ABI to encode them; pass --abi");
                }
                vec![]
            } else {
                let abi = lokyx::abi::parse(&abi_text).map_err(anyhow::Error::msg)?;
                lokyx::abi::encode_deploy(&abi, &args).map_err(anyhow::Error::msg)?
            };
            let value = value.map(|v| parse_lyx(&v)).transpose().map_err(anyhow::Error::msg)?.unwrap_or(0);
            let (sk, me) = unlock(&path)?;
            let gas = match gas {
                Some(g) => g,
                None => {
                    let e = rpc(
                        &url,
                        "lyx_estimateGas",
                        json!({"from": me.to_string(), "code": hex::encode(&code), "abi": abi_text, "input": hex::encode(&input), "value": value.to_string()}),
                    )?;
                    if e["ok"].as_bool() != Some(true) {
                        bail!("the deploy would fail: {}", e["error"].as_str().unwrap_or("?"));
                    }
                    e["gasLimit"].as_u64().context("bad estimate")?
                }
            };
            let acct = rpc(&url, "lyx_getAccount", json!({"address": me.to_string()}))?;
            let nonce = acct["pendingNonce"].as_u64().context("bad nonce from node")?;
            let balance: u128 = acct["balance"].as_str().unwrap_or("0").parse()?;
            let tx = lokyx::contract::build_deploy(&sk, p, nonce, code, abi_text, input, gas, value)?;
            println!("Deploying {} ({} bytes), gas limit {gas}", wasm.display(), tx.size());
            println!("It will be at {}", lokyx::contract::contract_address(&me, nonce));
            send_contract_tx(&url, tx, balance, wait)?;
        }
        Cmd::Call { contract, method, args, value, gas, wait } => {
            let to = Address::parse(&contract).map_err(|e| anyhow::anyhow!("contract: {e}"))?;
            let args: Vec<Value> = args.iter().map(|a| arg_json(a)).collect();
            let input = hex::decode(
                rpc(&url, "lyx_encodeCall", json!({"to": to.to_string(), "method": method, "args": args}))?
                    .as_str()
                    .unwrap_or(""),
            )?;
            let value = value.map(|v| parse_lyx(&v)).transpose().map_err(anyhow::Error::msg)?.unwrap_or(0);
            let (sk, me) = unlock(&path)?;
            let gas = match gas {
                Some(g) => g,
                None => {
                    let e = rpc(
                        &url,
                        "lyx_estimateGas",
                        json!({"from": me.to_string(), "to": to.to_string(), "input": hex::encode(&input), "value": value.to_string()}),
                    )?;
                    if e["ok"].as_bool() != Some(true) {
                        bail!("the call would fail: {}", e["error"].as_str().unwrap_or("?"));
                    }
                    e["gasLimit"].as_u64().context("bad estimate")?
                }
            };
            let acct = rpc(&url, "lyx_getAccount", json!({"address": me.to_string()}))?;
            let nonce = acct["pendingNonce"].as_u64().context("bad nonce from node")?;
            let balance: u128 = acct["balance"].as_str().unwrap_or("0").parse()?;
            let tx = lokyx::contract::build_call(&sk, p, nonce, to, input, gas, value)?;
            println!("Calling {method} on {to}, gas limit {gas}");
            send_contract_tx(&url, tx, balance, wait)?;
        }
        Cmd::Read { contract, method, args } => {
            let args: Vec<Value> = args.iter().map(|a| arg_json(a)).collect();
            let r = rpc(&url, "lyx_call", json!({"to": contract, "method": method, "args": args}))?;
            if r["ok"].as_bool() == Some(true) {
                println!("{}", if r["result"].is_null() { json!(r["output"]) } else { r["result"].clone() });
            } else {
                bail!("{}", r["error"].as_str().unwrap_or("call failed"));
            }
        }
        Cmd::Tx { hash } => {
            let v = rpc(&url, "lyx_getTransaction", json!({"hash": hash}))?;
            println!("{}", serde_json::to_string_pretty(&v)?);
            print_receipt(&v);
        }
        Cmd::Validate { address } => match Address::parse(&address) {
            Ok(a) => println!("valid LOKYX address {a}"),
            Err(e) => {
                println!("INVALID: {e}");
                std::process::exit(1);
            }
        },
        Cmd::ExportPhrase => {
            let f = keystore::load(&path)?;
            let s = keystore::decrypt(&f, &password("Wallet password: ")?)?;
            println!("{}", s.mnemonic);
        }
        Cmd::ExportKey => {
            let (sk, a) = unlock(&path)?;
            eprintln!("Private key for {a}. Anyone who has it controls this address.");
            println!("{}", hex::encode(sk.to_bytes()));
        }
    }
    Ok(())
}

/// The wallet you get by double-clicking the program: a menu instead of commands.
mod menu {
    use super::*;
    use lokyx::params::ChainParams;

    /// Public nodes a wallet can fall back to when there's no node on this computer.
    fn public_node(p: &ChainParams) -> Option<&'static str> {
        (p.name == "testnet").then_some("https://testnet.lokyx.xyz/rpc")
    }

    fn reachable(url: &str) -> bool {
        ureq::post(url)
            .set("Content-Type", "application/json")
            .timeout(Duration::from_secs(3))
            .send_json(json!({"jsonrpc":"2.0","id":1,"method":"lyx_chainInfo","params":{}}))
            .is_ok()
    }

    pub fn pause() {
        // A double-clicked console window closes the moment the program ends.
        if cfg!(windows) {
            let _ = read_line_stdin("\nPress Enter to close. ");
        }
    }

    fn ask(prompt: &str) -> Result<String> {
        read_line_stdin(prompt)
    }

    fn line() {
        println!("{}", "-".repeat(56));
    }

    pub fn run(p: &'static ChainParams, path: &std::path::Path, rpc_flag: Option<&str>) -> Result<()> {
        println!("\nLOKYX wallet ({})", p.name);
        line();
        let local = format!("http://127.0.0.1:{}", p.default_rpc_port);
        let url = match rpc_flag {
            Some(u) => u.to_string(),
            None if reachable(&local) => {
                println!("Connected to the node on this computer.");
                local
            }
            None => match public_node(p) {
                Some(u) if reachable(u) => {
                    println!("Connected to the public node at {}.", u.trim_end_matches("/rpc"));
                    println!("(Start mine.bat or lokyxd to use your own node instead.)");
                    u.to_string()
                }
                _ => bail!("Can't reach a LOKYX node. Start mine.bat or lokyxd first, then open the wallet again."),
            },
        };

        if !path.exists() {
            println!("\nThere's no wallet on this computer yet.\n");
            println!("  1  Make a new wallet");
            println!("  2  Restore a wallet from its 24 words");
            println!("  0  Exit");
            match ask("\nChoose: ")?.as_str() {
                "1" => {
                    let m = generate_mnemonic(24)?;
                    let addr = create(path, &m, "")?;
                    println!("\nYour address: {addr}\n");
                    println!("Write these 24 words on paper, in order. They are the only way to get your");
                    println!("coins back if this computer breaks, and anyone who sees them can take your coins.\n");
                    for (i, w) in m.words().enumerate() {
                        print!("{:>2}. {:<10}", i + 1, w);
                        if (i + 1) % 4 == 0 {
                            println!();
                        }
                    }
                    ask("\nPress Enter once you've written them down. ")?;
                }
                "2" => {
                    let phrase = ask("Type the 24 words, separated by spaces: ")?;
                    let m = parse_mnemonic(&phrase)?;
                    let addr = create(path, &m, "")?;
                    println!("\nRestored. Your address: {addr}");
                }
                _ => return Ok(()),
            }
        }

        let me = keystore::load(path)?.address;
        loop {
            println!();
            line();
            match rpc(&url, "lyx_getAccount", json!({"address": me})) {
                Ok(a) => {
                    println!("Address  {me}");
                    println!("Balance  {} LYX", a["balanceLyx"].as_str().unwrap_or("?"));
                    let locked = a["lockedLyx"].as_str().unwrap_or("0");
                    if locked != "0" {
                        println!("Locked   {locked} LYX (mining rewards, spendable 60 blocks after they're mined)");
                    }
                    println!("Block    {}", a["atHeight"]);
                }
                Err(e) => println!("Couldn't load the balance: {e}"),
            }
            line();
            println!("  1  Receive (show my address)");
            println!("  2  Send LYX");
            println!("  3  Recent activity");
            println!("  4  Refresh");
            println!("  5  Show my 24 words");
            println!("  0  Exit");
            let choice = ask("\nChoose: ")?;
            let r = match choice.as_str() {
                "1" => {
                    println!("\nYour address (give this to whoever is paying you):\n\n    {me}");
                    ask("\nPress Enter to go back. ").map(|_| ())
                }
                "2" => send_menu(&url, p, path),
                "3" => history(&url, &me),
                "4" => Ok(()),
                "5" => {
                    let f = keystore::load(path)?;
                    keystore::decrypt(&f, &password("Wallet password: ")?)
                        .map(|s| {
                            println!("\n{}\n\nKeep these private.", s.mnemonic);
                        })
                        .and_then(|_| ask("Press Enter to go back. ").map(|_| ()))
                }
                "0" | "q" | "exit" => return Ok(()),
                _ => Ok(()),
            };
            if let Err(e) = r {
                println!("\n{e}");
            }
        }
    }

    fn send_menu(url: &str, p: &'static ChainParams, path: &std::path::Path) -> Result<()> {
        let to = ask("\nSend to (lyx1 address): ")?;
        let to = Address::parse(&to).map_err(|e| anyhow::anyhow!("that address isn't valid: {e}"))?;
        let amount = ask("Amount in LYX (for example 1.5): ")?;
        let value = parse_lyx(&amount).map_err(anyhow::Error::msg)?;
        if value == 0 {
            bail!("the amount has to be more than 0");
        }
        if ask(&format!("Send {} LYX to {to}? Type yes to confirm: ", format_lyx(value)))?.to_lowercase() != "yes" {
            println!("Not sent.");
            return Ok(());
        }
        let (sk, me) = unlock(path)?;
        let h = send(url, p, &sk, me, to, value, None)?;
        if p.name == "testnet" {
            println!("Follow it at https://testnet.lokyx.xyz/tx/{h}");
        }
        println!("It confirms when the next block is mined, usually within a minute or two.");
        Ok(())
    }

    fn history(url: &str, me: &str) -> Result<()> {
        let h = rpc(url, "lyx_getAddressHistory", json!({"address": me, "limit": 10}))?;
        let items = h["items"].as_array().cloned().unwrap_or_default();
        println!();
        if items.is_empty() {
            println!("Nothing yet.");
        }
        for i in items {
            let kind = i["kind"].as_str().unwrap_or("?");
            let amount = i["amountLyx"].as_str().unwrap_or("?");
            let what = match kind {
                "mined" => format!("mined a block     +{amount} LYX"),
                "received" => format!("received          +{amount} LYX from {}", i["from"].as_str().unwrap_or("?")),
                "sent" => format!("sent              -{amount} LYX to {}", i["to"].as_str().unwrap_or("?")),
                _ => format!("{kind} {amount} LYX"),
            };
            println!("block {:>7}  {what}", i["height"]);
        }
        ask("\nPress Enter to go back. ").map(|_| ())
    }
}
