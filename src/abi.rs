//! Contract ABIs: a JSON description of a contract's methods, so wallets, explorers and the CLI
//! can turn `transfer(lyx1…, 5)` into input bytes and show results and events as text. The chain
//! itself never reads it.
//!
//! ```json
//! { "name": "Token",
//!   "deploy": [["supply", "amount"]],
//!   "methods": [{ "name": "transfer", "args": [["to", "address"], ["amount", "amount"]], "returns": "bool" },
//!               { "name": "balance_of", "args": [["who", "address"]], "returns": "amount", "view": true }],
//!   "events": [{ "name": "Transfer", "fields": [["from", "address"], ["to", "address"], ["amount", "amount"]] }] }
//! ```
//!
//! Types: u8 u16 u32 u64 u128 i32 i64 i128 bool string bytes address amount (a u128 of base units,
//! written as LYX like "1.5"), list<T>, option<T>. `returns` may be a list of types for a tuple.
//! The encoding is borsh, the same as contracts/sdk.

use crate::address::Address;
use crate::amount::{format_lyx, parse_lyx};
use serde_json::{Value, json};

pub fn parse(text: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("ABI isn't valid JSON: {e}"))?;
    if !v.get("methods").is_some_and(Value::is_array) {
        return Err("ABI needs a \"methods\" list".into());
    }
    Ok(v)
}

pub fn method<'a>(abi: &'a Value, name: &str) -> Result<&'a Value, String> {
    abi["methods"]
        .as_array()
        .and_then(|m| m.iter().find(|x| x["name"] == name))
        .ok_or_else(|| format!("the ABI has no method \"{name}\""))
}

fn params(list: &Value) -> Vec<(String, String)> {
    list.as_array()
        .map(|a| {
            a.iter().filter_map(|p| Some((p.get(0)?.as_str()?.to_string(), p.get(1)?.as_str()?.to_string()))).collect()
        })
        .unwrap_or_default()
}

fn int_text(v: &Value) -> Result<String, String> {
    match v {
        Value::Number(n) => Ok(n.to_string()),
        Value::String(s) => Ok(s.trim().replace('_', "")),
        _ => Err(format!("expected a number, got {v}")),
    }
}

pub fn encode_value(ty: &str, v: &Value, out: &mut Vec<u8>) -> Result<(), String> {
    macro_rules! int {
        ($t:ty) => {{
            let s = int_text(v)?;
            let n: $t = s.parse().map_err(|_| format!("\"{s}\" isn't a valid {ty}"))?;
            out.extend(n.to_le_bytes());
        }};
    }
    match ty {
        "u8" => int!(u8),
        "u16" => int!(u16),
        "u32" => int!(u32),
        "u64" => int!(u64),
        "u128" => int!(u128),
        "i32" => int!(i32),
        "i64" => int!(i64),
        "i128" => int!(i128),
        "amount" => {
            let n = parse_lyx(&int_text(v)?)?;
            out.extend(n.to_le_bytes());
        }
        "bool" => match v {
            Value::Bool(b) => out.push(*b as u8),
            Value::String(s) if s == "true" || s == "false" => out.push((s == "true") as u8),
            _ => return Err(format!("expected true or false, got {v}")),
        },
        "string" => {
            let s = v.as_str().ok_or_else(|| format!("expected text, got {v}"))?;
            out.extend((s.len() as u32).to_le_bytes());
            out.extend(s.as_bytes());
        }
        "bytes" => {
            let s = v.as_str().ok_or_else(|| format!("expected hex bytes, got {v}"))?;
            let b = hex::decode(s.strip_prefix("0x").unwrap_or(s)).map_err(|e| format!("bad hex: {e}"))?;
            out.extend((b.len() as u32).to_le_bytes());
            out.extend(b);
        }
        "address" => {
            let s = v.as_str().ok_or_else(|| format!("expected an address, got {v}"))?;
            let a = Address::parse(s).map_err(|e| format!("{s}: {e}"))?;
            out.extend(a.0);
        }
        t if t.starts_with("list<") && t.ends_with('>') => {
            let inner = &t[5..t.len() - 1];
            let items = v.as_array().ok_or_else(|| format!("expected a list, got {v}"))?;
            out.extend((items.len() as u32).to_le_bytes());
            for x in items {
                encode_value(inner, x, out)?;
            }
        }
        t if t.starts_with("option<") && t.ends_with('>') => {
            if v.is_null() {
                out.push(0);
            } else {
                out.push(1);
                encode_value(&t[7..t.len() - 1], v, out)?;
            }
        }
        _ => return Err(format!("unknown ABI type \"{ty}\"")),
    }
    Ok(())
}

fn take<'a>(r: &mut &'a [u8], n: usize) -> Result<&'a [u8], String> {
    if r.len() < n {
        return Err("output is shorter than the ABI says".into());
    }
    let (a, b) = r.split_at(n);
    *r = b;
    Ok(a)
}

pub fn decode_value(ty: &Value, r: &mut &[u8]) -> Result<Value, String> {
    if let Some(list) = ty.as_array() {
        return list.iter().map(|t| decode_value(t, r)).collect::<Result<Vec<_>, _>>().map(Value::Array);
    }
    let ty = ty.as_str().ok_or("bad type in ABI")?;
    macro_rules! int {
        ($t:ty, $n:expr, $big:expr) => {{
            let x = <$t>::from_le_bytes(take(r, $n)?.try_into().unwrap());
            if $big { json!(x.to_string()) } else { json!(x) }
        }};
    }
    Ok(match ty {
        "u8" => int!(u8, 1, false),
        "u16" => int!(u16, 2, false),
        "u32" => int!(u32, 4, false),
        "u64" => int!(u64, 8, false),
        "i32" => int!(i32, 4, false),
        "i64" => int!(i64, 8, false),
        "u128" => int!(u128, 16, true),
        "i128" => int!(i128, 16, true),
        "amount" => json!(format_lyx(u128::from_le_bytes(take(r, 16)?.try_into().unwrap()))),
        "bool" => json!(take(r, 1)?[0] != 0),
        "string" | "bytes" => {
            let n = u32::from_le_bytes(take(r, 4)?.try_into().unwrap()) as usize;
            let b = take(r, n)?;
            if ty == "string" { json!(String::from_utf8_lossy(b)) } else { json!(format!("0x{}", hex::encode(b))) }
        }
        "address" => json!(Address(take(r, 20)?.try_into().unwrap()).to_string()),
        t if t.starts_with("list<") && t.ends_with('>') => {
            let n = u32::from_le_bytes(take(r, 4)?.try_into().unwrap()) as usize;
            let inner = json!(&t[5..t.len() - 1]);
            Value::Array((0..n).map(|_| decode_value(&inner, r)).collect::<Result<_, _>>()?)
        }
        t if t.starts_with("option<") && t.ends_with('>') => match take(r, 1)?[0] {
            0 => Value::Null,
            _ => decode_value(&json!(&t[7..t.len() - 1]), r)?,
        },
        _ => return Err(format!("unknown ABI type \"{ty}\"")),
    })
}

fn encode_args(list: &Value, args: &[Value], what: &str) -> Result<Vec<u8>, String> {
    let ps = params(list);
    if ps.len() != args.len() {
        return Err(format!("{what} takes {} argument(s), got {}", ps.len(), args.len()));
    }
    let mut out = Vec::new();
    for ((name, ty), v) in ps.iter().zip(args) {
        encode_value(ty, v, &mut out).map_err(|e| format!("{name}: {e}"))?;
    }
    Ok(out)
}

/// Input for calling `name` with `args`: the method name, then the arguments.
pub fn encode_call(abi: &Value, name: &str, args: &[Value]) -> Result<Vec<u8>, String> {
    let m = method(abi, name)?;
    let mut out = Vec::new();
    encode_value("string", &json!(name), &mut out)?;
    out.extend(encode_args(&m["args"], args, name)?);
    Ok(out)
}

pub fn encode_deploy(abi: &Value, args: &[Value]) -> Result<Vec<u8>, String> {
    encode_args(&abi["deploy"], args, "deploy")
}

/// What `name` returned, as JSON. Null if the ABI doesn't say what it returns.
pub fn decode_return(abi: &Value, name: &str, out: &[u8]) -> Result<Value, String> {
    let m = method(abi, name)?;
    let Some(ty) = m.get("returns").filter(|t| !t.is_null()) else { return Ok(Value::Null) };
    let mut r = out;
    let v = decode_value(ty, &mut r)?;
    if !r.is_empty() {
        return Err("output is longer than the ABI says".into());
    }
    Ok(v)
}

/// An event's fields by name, if the ABI describes it.
pub fn decode_event(abi: &Value, name: &str, data: &[u8]) -> Option<Value> {
    let e = abi["events"].as_array()?.iter().find(|e| e["name"] == name)?;
    let mut r = data;
    let mut obj = serde_json::Map::new();
    for (field, ty) in params(&e["fields"]) {
        obj.insert(field, decode_value(&json!(ty), &mut r).ok()?);
    }
    r.is_empty().then_some(Value::Object(obj))
}
