//! The RPC server's rules about who may do what, driven over real HTTP.
//!
//! Reading is open to anyone who can reach the port. Control (anything that changes what the
//! node is doing rather than reading from it) needs either the node's token or a request from
//! the node's own machine, and the two are deliberately exclusive: setting a token means the
//! token is the only way in.

use lokyx::chain::Chain;
use lokyx::node::Node;
use lokyx::params::DEVNET;
use serde_json::{Value, json};
use std::net::SocketAddr;
use std::sync::Arc;

const TOKEN: &str = "a-long-enough-test-token";

/// A node with its RPC on a port of its own. `token` set means control needs it.
fn serve(token: Option<&str>) -> (SocketAddr, Arc<tokio::runtime::Runtime>) {
    lokyx::pow::test_pow::enable();
    let p = Box::leak(Box::new(DEVNET.clone()));
    let chain = Chain::new(p, None).unwrap();
    let node = Node::new(p, chain, 0, vec![]);
    let rt = Arc::new(tokio::runtime::Runtime::new().unwrap());
    // Port 0, then ask the listener which one it got, so tests don't collide.
    let listener = rt.block_on(tokio::net::TcpListener::bind("127.0.0.1:0")).unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    let token = token.map(str::to_string);
    let r = rt.clone();
    std::thread::spawn(move || {
        r.block_on(lokyx::rpc::serve(node, addr, None, true, token)).unwrap();
    });
    for _ in 0..200 {
        if std::net::TcpStream::connect(addr).is_ok() {
            return (addr, rt);
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    panic!("the rpc server never came up");
}

/// One JSON-RPC call. `bearer` is sent as an Authorization header when given.
fn call(addr: SocketAddr, method: &str, params: Value, bearer: Option<&str>) -> Value {
    let body = json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params});
    let mut req = ureq::post(&format!("http://{addr}/")).set("content-type", "application/json");
    if let Some(b) = bearer {
        req = req.set("authorization", &format!("Bearer {b}"));
    }
    match req.send_json(body) {
        Ok(r) => r.into_json().unwrap(),
        Err(ureq::Error::Status(_, r)) => r.into_json().unwrap(),
        Err(e) => panic!("{e}"),
    }
}

/// A call that pretends to have come through a reverse proxy.
fn call_proxied(addr: SocketAddr, method: &str, params: Value, bearer: Option<&str>) -> Value {
    let body = json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params});
    let mut req = ureq::post(&format!("http://{addr}/"))
        .set("content-type", "application/json")
        .set("x-forwarded-for", "203.0.113.9");
    if let Some(b) = bearer {
        req = req.set("authorization", &format!("Bearer {b}"));
    }
    match req.send_json(body) {
        Ok(r) => r.into_json().unwrap(),
        Err(ureq::Error::Status(_, r)) => r.into_json().unwrap(),
        Err(e) => panic!("{e}"),
    }
}

fn refused(v: &Value) -> String {
    v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).unwrap_or("").to_string()
}

fn mining(addr: SocketAddr, bearer: Option<&str>) -> Value {
    call(addr, "lyx_setMining", json!({"enabled": false}), bearer)
}

#[test]
fn without_a_token_control_stays_on_this_machine() {
    let (addr, _rt) = serve(None);
    // Reading works for anyone.
    assert!(call(addr, "lyx_chainInfo", json!({}), None).get("result").is_some());
    assert!(call_proxied(addr, "lyx_chainInfo", json!({}), None).get("result").is_some());

    // Control works from here...
    assert!(mining(addr, None).get("result").is_some());
    // ...and not through a proxy, which is how a request from the internet arrives.
    let e = refused(&call_proxied(addr, "lyx_setMining", json!({"enabled": false}), None));
    assert!(e.contains("not allowed"), "{e}");
    // A token nobody asked for changes nothing either way.
    assert!(mining(addr, Some("anything at all")).get("result").is_some());
}

#[test]
fn with_a_token_control_needs_it_and_nothing_else_does() {
    let (addr, _rt) = serve(Some(TOKEN));
    // Still open for reading, with or without the token.
    assert!(call(addr, "lyx_chainInfo", json!({}), None).get("result").is_some());
    assert!(call(addr, "lyx_chainInfo", json!({}), Some(TOKEN)).get("result").is_some());

    // The right token works, from this machine and through a proxy.
    assert!(mining(addr, Some(TOKEN)).get("result").is_some());
    assert!(call_proxied(addr, "lyx_setMining", json!({"enabled": false}), Some(TOKEN)).get("result").is_some());

    // Being on the node's own machine is no longer enough: that's the point of setting one.
    let local = refused(&mining(addr, None));
    assert!(local.contains("not allowed"), "{local}");

    // Wrong, nearly right, and oddly shaped tokens are all refused, and all with the same
    // message, so a caller can't tell which mistake it made.
    for bad in [
        "",
        "wrong",
        TOKEN,                     // replaced below
        &TOKEN[..TOKEN.len() - 1], // a prefix
        &format!("{TOKEN}x"),      // one character too many
        &TOKEN.to_uppercase(),     // wrong case
        &format!(" {TOKEN} "),     // spaces are trimmed, so this one passes
    ] {
        let v = mining(addr, Some(bad));
        let ok = bad.trim() == TOKEN;
        assert_eq!(v.get("result").is_some(), ok, "token {bad:?} should {}have worked", if ok { "" } else { "not " });
        if !ok {
            assert_eq!(refused(&v), local, "every refusal must read the same");
        }
    }

    // And the header has to be a bearer token, not something else.
    let v: Value = match ureq::post(&format!("http://{addr}/"))
        .set("content-type", "application/json")
        .set("authorization", TOKEN)
        .send_json(json!({"jsonrpc": "2.0", "id": 1, "method": "lyx_setMining", "params": {"enabled": false}}))
    {
        Ok(r) => r.into_json().unwrap(),
        Err(ureq::Error::Status(_, r)) => r.into_json().unwrap(),
        Err(e) => panic!("{e}"),
    };
    assert!(refused(&v).contains("not allowed"));
}

/// The refusal says what's needed without saying which part was wrong, and never echoes the
/// token back.
#[test]
fn a_refusal_gives_nothing_away() {
    let (addr, _rt) = serve(Some(TOKEN));
    let e = refused(&mining(addr, Some("wrong")));
    assert!(!e.contains(TOKEN) && !e.contains("wrong"), "{e}");
    assert!(e.contains("token") && e.contains("own machine"), "{e}");
}

/// Anyone can ask how the node's connections are doing; it is a read.
#[test]
fn the_network_health_report_is_open_and_says_what_is_wrong() {
    let (addr, _rt) = serve(None);
    let r = call_proxied(addr, "lyx_netHealth", json!({}), None);
    let h = r.get("result").unwrap_or_else(|| panic!("{r}"));
    // A node with no peers whose tip is the genesis block of a network that began long ago.
    assert_eq!(h["noPeers"], json!(true));
    assert_eq!(h["nodeKey"].as_str().map(str::len), Some(64), "the node's public key, in hex");
    assert_eq!(h["ok"], json!(false));
    for k in ["staleTip", "fewOutboundGroups", "tipAgeSecs", "outbound", "outboundGroups", "inbound", "blocksOnly"] {
        assert!(h.get(k).is_some(), "missing {k}");
    }
    assert_eq!(h["addresses"]["tried"], json!(0));
}
