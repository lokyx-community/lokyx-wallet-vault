//! Simple fungible tokens: create, transfer, burn. The whole supply is made once, when the token
//! is created, and goes to the creator. There is no mint afterwards.
//!
//! A token's id is the hash of the transaction that created it. Symbols aren't unique, so
//! wallets show the id and warn about a symbol that is already taken. Making a token burns a
//! fixed amount of LYX (a fee would go back to the miner, who could then make tokens for free);
//! the burn is counted in `State::burned` so the books still balance.
//!
//! Vault accounts can't create or hold tokens, and tokens can't be sent to a vault: otherwise
//! anyone could drop dust into a vault, and a sweep would have no end. An account that holds
//! tokens can't become a vault.
#![deny(clippy::float_arithmetic)]

use crate::address::Address;
use crate::crypto::Hash;
use crate::params::COIN;
use borsh::{BorshDeserialize, BorshSerialize};

/// Reserved so that nobody can send to it. Token operations don't use it for routing.
pub const TOKEN_ADDRESS: Address = Address([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 6]);

/// LYX burned to make a token. PLACEHOLDER: to be set together with the emission numbers.
pub const TOKEN_CREATE_BURN: u128 = 5 * COIN;

pub const MAX_SYMBOL: usize = 8;
pub const MAX_NAME: usize = 32;
pub const MAX_DECIMALS: u8 = 18;

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum TokenOp {
    Create { symbol: String, name: String, decimals: u8, supply: u128 },
    Transfer { token: Hash, to: Address, amount: u128 },
    Burn { token: Hash, amount: u128 },
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Token {
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
    /// What exists now: the amount made, less what has been burned.
    pub supply: u128,
    pub creator: Address,
    /// Height of the block that created it.
    pub height: u64,
}

impl TokenOp {
    /// The LYX this takes from the sender, apart from the fee.
    pub fn lyx_burn(&self) -> u128 {
        match self {
            TokenOp::Create { .. } => TOKEN_CREATE_BURN,
            TokenOp::Transfer { .. } | TokenOp::Burn { .. } => 0,
        }
    }

    /// Checks that need no state.
    pub fn check(&self) -> Result<(), String> {
        match self {
            TokenOp::Create { symbol, name, decimals, supply } => {
                if symbol.is_empty() || symbol.len() > MAX_SYMBOL {
                    return Err(format!("a token symbol is 1 to {MAX_SYMBOL} characters"));
                }
                if !symbol.bytes().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
                    return Err("a token symbol is capital letters and digits".into());
                }
                if name.is_empty() || name.len() > MAX_NAME || name.chars().any(|c| c.is_control()) {
                    return Err(format!("a token name is 1 to {MAX_NAME} printable characters"));
                }
                if *decimals > MAX_DECIMALS {
                    return Err(format!("a token has at most {MAX_DECIMALS} decimals"));
                }
                if *supply == 0 {
                    return Err("a token needs a supply".into());
                }
                Ok(())
            }
            TokenOp::Transfer { to, amount, .. } => {
                if *amount == 0 {
                    return Err("a token transfer of zero".into());
                }
                if crate::contract::is_system(to) {
                    return Err("can't send tokens to a system address".into());
                }
                Ok(())
            }
            TokenOp::Burn { amount, .. } => {
                if *amount == 0 {
                    return Err("a token burn of zero".into());
                }
                Ok(())
            }
        }
    }
}
