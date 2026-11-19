//! Transactions, format v2. Signed over a domain-separated hash that includes chain_id.
//!
//! What a transaction does is an `Op`, not a magic destination address plus bytes, so an
//! operation that can't carry a value has nowhere to put one. The signature is an enum with one
//! variant defined; a later scheme (a post-quantum one) is a new variant, not a new format.
#![deny(clippy::float_arithmetic)]

use crate::address::Address;
use crate::contract::ContractOp;
use crate::crypto::{Hash, keccak256, tagged_hash};
use crate::params::{ChainParams, MAX_TX_BYTES, MIN_FEE_PER_BYTE};
use crate::pqkey::KeyOp;
use crate::swap::SwapOp;
use crate::timelock::TimelockOp;
use crate::token::TokenOp;
use crate::vault::VaultOp;
use borsh::{BorshDeserialize, BorshSerialize};
use k256::ecdsa::{RecoveryId, Signature, SigningKey, VerifyingKey};

const TX_SIGNING_TAG: &[u8] = b"LOKYX/tx/v2";

pub const TX_VERSION: u8 = 2;
pub const MAX_MEMO_BYTES: usize = 64;
pub const MAX_BATCH: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum Op {
    Transfer {
        to: Address,
        value: u128,
    },
    /// LYX only: 1 to 256 payments, none of them zero.
    Batch(Vec<(Address, u128)>),
    Swap(SwapOp),
    Vault(VaultOp),
    Key(KeyOp),
    Timelock(TimelockOp),
    Token(TokenOp),
    Deploy {
        value: u128,
        code: Vec<u8>,
        abi: String,
        input: Vec<u8>,
        gas: u64,
    },
    Call {
        to: Address,
        value: u128,
        input: Vec<u8>,
        gas: u64,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Transaction {
    pub version: u8,
    pub chain_id: u64,
    /// The account this acts on. The signature has to be from the key that controls it.
    pub from: Address,
    pub nonce: u64,
    /// The last height this may be included at. 0 means never expires.
    pub expires: u64,
    pub fee: u128,
    /// Public, opaque, at most 64 bytes.
    pub memo: Vec<u8>,
    pub op: Op,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum Sig {
    Secp256k1Recoverable { signature: [u8; 64], recovery_id: u8 },
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct SignedTransaction {
    pub tx: Transaction,
    pub sig: Sig,
}

impl Op {
    /// The LYX this takes from the sender's own balance, apart from the fee. This one function
    /// is what the vault allowance and the mempool's balance check all go by.
    /// (Saturating: `check_stateless` has already refused a batch that overflows.)
    pub fn outflow(&self) -> u128 {
        match self {
            Op::Transfer { value, .. } => *value,
            Op::Batch(v) => v.iter().fold(0u128, |a, (_, x)| a.saturating_add(*x)),
            Op::Swap(SwapOp::Lock { amount, .. }) => *amount,
            Op::Swap(_) => 0,
            Op::Vault(VaultOp::Withdraw { amount, .. }) => *amount,
            Op::Vault(_) | Op::Key(_) => 0,
            Op::Timelock(TimelockOp::Lock { amount, .. }) => *amount,
            Op::Timelock(TimelockOp::Claim { .. }) => 0,
            Op::Token(t) => t.lyx_burn(),
            Op::Deploy { value, .. } | Op::Call { value, .. } => *value,
        }
    }

    /// The part of `outflow` that leaves at once. A vault withdrawal waits out its delay, which is
    /// what the delay is for, so it doesn't count against the daily allowance.
    pub fn immediate_outflow(&self) -> u128 {
        match self {
            Op::Vault(VaultOp::Withdraw { .. }) => 0,
            _ => self.outflow(),
        }
    }

    /// Does the sender pay the fee out of their own balance? Claims and refunds pay from the lock,
    /// and a recovery key or an heir acting on a vault pays from the vault.
    pub fn sender_pays_fee(&self, from: &Address) -> bool {
        if let Op::Key(KeyOp::CancelRotate { account }) = self {
            return account == from;
        }
        !matches!(
            self,
            Op::Swap(SwapOp::Claim { .. } | SwapOp::Refund { .. })
                | Op::Timelock(TimelockOp::Claim { .. })
                | Op::Vault(VaultOp::Cancel { .. } | VaultOp::Sweep { .. } | VaultOp::HeirClaim { .. })
        )
    }

    /// What this counts against the sender's vault allowance, fee included. Must equal what
    /// applying it charges; `tests/allowance.rs` checks that for every variant.
    pub fn allowance_cost(&self, fee: u128) -> u128 {
        match self {
            Op::Swap(SwapOp::Claim { .. } | SwapOp::Refund { .. }) => 0,
            Op::Timelock(TimelockOp::Claim { .. }) => 0,
            Op::Vault(VaultOp::Create(_) | VaultOp::Sweep { .. } | VaultOp::HeirClaim { .. }) => 0,
            // the fee of a cancel comes out of the vault, but an owner's cancel still counts it
            Op::Vault(VaultOp::Cancel { .. }) => fee,
            op => op.immediate_outflow().saturating_add(fee),
        }
    }

    /// The contract operation, if this is a deploy or a call: where it goes, the value, the op.
    pub fn contract_op(&self) -> Option<(Address, u128, ContractOp)> {
        match self {
            Op::Deploy { value, code, abi, input, gas } => Some((
                crate::contract::DEPLOY_ADDRESS,
                *value,
                ContractOp::Deploy { code: code.clone(), abi: abi.clone(), input: input.clone(), gas: *gas },
            )),
            Op::Call { to, value, input, gas } => {
                Some((*to, *value, ContractOp::Call { input: input.clone(), gas: *gas }))
            }
            _ => None,
        }
    }

    /// Gas declared by a contract operation.
    pub fn gas(&self) -> Option<u64> {
        match self {
            Op::Deploy { gas, .. } | Op::Call { gas, .. } => Some(*gas),
            _ => None,
        }
    }

    /// Short name for logs and the explorer.
    pub fn kind(&self) -> &'static str {
        match self {
            Op::Transfer { .. } => "transfer",
            Op::Batch(_) => "batch",
            Op::Swap(_) => "swap",
            Op::Vault(_) => "vault",
            Op::Key(_) => "key",
            Op::Timelock(_) => "timelock",
            Op::Token(_) => "token",
            Op::Deploy { .. } => "deploy",
            Op::Call { .. } => "call",
        }
    }
}

impl Transaction {
    pub fn signing_hash(&self) -> Hash {
        tagged_hash(TX_SIGNING_TAG, &borsh::to_vec(self).expect("borsh"))
    }

    /// Where the money goes, for display and indexing: the recipient of a transfer, the contract
    /// called, or the system address of the operation. A batch has many; this is its first.
    pub fn to(&self) -> Address {
        match &self.op {
            Op::Transfer { to, .. } | Op::Call { to, .. } => *to,
            Op::Batch(v) => v.first().map(|(a, _)| *a).unwrap_or(Address::ZERO),
            Op::Swap(_) => crate::swap::SWAP_ADDRESS,
            Op::Vault(_) => crate::vault::VAULT_ADDRESS,
            Op::Key(_) => crate::pqkey::KEY_ADDRESS,
            Op::Timelock(_) => crate::timelock::TIMELOCK_ADDRESS,
            Op::Token(_) => crate::token::TOKEN_ADDRESS,
            Op::Deploy { .. } => crate::contract::DEPLOY_ADDRESS,
        }
    }

    /// Every address that gets LYX or is named by the operation, for the activity index.
    pub fn counterparties(&self) -> Vec<Address> {
        match &self.op {
            Op::Batch(v) => v.iter().map(|(a, _)| *a).collect(),
            Op::Swap(SwapOp::Lock { recipient, .. }) => vec![crate::swap::SWAP_ADDRESS, *recipient],
            Op::Vault(VaultOp::Withdraw { to, .. }) => vec![crate::vault::VAULT_ADDRESS, *to],
            Op::Vault(VaultOp::Sweep { vault } | VaultOp::HeirClaim { vault }) => {
                vec![crate::vault::VAULT_ADDRESS, *vault]
            }
            Op::Timelock(TimelockOp::Lock { beneficiary, .. }) => {
                vec![crate::timelock::TIMELOCK_ADDRESS, *beneficiary]
            }
            Op::Token(TokenOp::Transfer { to, .. }) => vec![crate::token::TOKEN_ADDRESS, *to],
            _ => vec![self.to()],
        }
    }

    /// The LYX value the operation moves, apart from the fee.
    pub fn value(&self) -> u128 {
        self.op.outflow()
    }

    /// Sign with `sk`. The key has to be the one that controls `from`; the state checks that.
    pub fn sign(self, sk: &SigningKey) -> anyhow::Result<SignedTransaction> {
        let (sig, recid) = sk.sign_prehash_recoverable(&self.signing_hash())?;
        // k256 already emits low-S; normalize defensively and fix up the recovery id if needed.
        let (sig, recid) = match sig.normalize_s() {
            Some(n) => (n, RecoveryId::new(!recid.is_y_odd(), recid.is_x_reduced())),
            None => (sig, recid),
        };
        let sig = Sig::Secp256k1Recoverable { signature: sig.to_bytes().into(), recovery_id: recid.to_byte() };
        Ok(SignedTransaction { tx: self, sig })
    }
}

impl SignedTransaction {
    pub fn hash(&self) -> Hash {
        keccak256(&self.to_bytes())
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        borsh::to_vec(self).expect("borsh")
    }

    /// Strict decode: rejects trailing bytes.
    pub fn from_bytes(b: &[u8]) -> Result<Self, String> {
        if b.len() > MAX_TX_BYTES {
            return Err("transaction too large".into());
        }
        borsh::from_slice(b).map_err(|e| format!("malformed transaction: {e}"))
    }

    pub fn size(&self) -> usize {
        self.to_bytes().len()
    }

    /// The size fee plus, for a contract operation, its gas limit at the gas price.
    pub fn min_fee(&self) -> u128 {
        let gas = self.tx.op.gas().unwrap_or(0) as u128 * crate::contract::GAS_PRICE;
        self.size() as u128 * MIN_FEE_PER_BYTE + gas
    }

    /// Recover the address of the key that signed. Rejects high-S signatures (malleability) and
    /// invalid recovery ids.
    pub fn signer(&self) -> Result<Address, String> {
        let Sig::Secp256k1Recoverable { signature, recovery_id } = &self.sig;
        let sig = Signature::from_slice(signature).map_err(|_| "invalid signature encoding")?;
        if sig.normalize_s().is_some() {
            return Err("non-canonical (high-S) signature".into());
        }
        let recid = RecoveryId::from_byte(*recovery_id).ok_or("invalid recovery id")?;
        let vk = VerifyingKey::recover_from_prehash(&self.tx.signing_hash(), &sig, recid)
            .map_err(|_| "signature verification failed")?;
        Ok(Address::from_verifying_key(&vk))
    }

    /// All checks that do not depend on chain state. Returns the address of the signing key; the
    /// state then checks that it is the key that controls `tx.from`.
    pub fn check_stateless(&self, p: &ChainParams) -> Result<Address, String> {
        let tx = &self.tx;
        if tx.version != TX_VERSION {
            return Err(format!("transaction version {} isn't supported (this is {TX_VERSION})", tx.version));
        }
        if tx.chain_id != p.chain_id {
            return Err(format!("wrong chain id {} (expected {})", tx.chain_id, p.chain_id));
        }
        if tx.memo.len() > MAX_MEMO_BYTES {
            return Err(format!("memo over {MAX_MEMO_BYTES} bytes"));
        }
        if crate::contract::is_system(&tx.from) {
            return Err("system addresses can't send transactions".into());
        }
        check_op(&tx.op)?;
        let size = self.size();
        if size > MAX_TX_BYTES {
            return Err("transaction too large".into());
        }
        let min = self.min_fee();
        if tx.fee < min {
            return Err(format!("fee {} below minimum {min}", tx.fee));
        }
        tx.op.outflow().checked_add(tx.fee).ok_or("value + fee overflows")?;
        self.signer()
    }
}

/// Checks on an operation that need no state.
fn check_op(op: &Op) -> Result<(), String> {
    use crate::contract::is_system;
    match op {
        Op::Transfer { to, .. } => {
            if is_system(to) {
                return Err("can't send to a system address".into());
            }
        }
        Op::Batch(v) => {
            if v.is_empty() || v.len() > MAX_BATCH {
                return Err(format!("a batch has 1 to {MAX_BATCH} payments"));
            }
            let mut sum: u128 = 0;
            for (a, x) in v {
                if *x == 0 {
                    return Err("a batch payment of zero".into());
                }
                if is_system(a) {
                    return Err("can't send to a system address".into());
                }
                sum = sum.checked_add(*x).ok_or("batch total overflows")?;
            }
        }
        Op::Swap(s) => {
            if let SwapOp::Lock { amount: 0, .. } = s {
                return Err("swap lock needs an amount".into());
            }
        }
        Op::Vault(_) => {}
        Op::Key(k) => k.check()?,
        Op::Timelock(t) => t.check()?,
        Op::Token(t) => t.check()?,
        Op::Deploy { .. } | Op::Call { .. } => {
            let (to, _, c) = op.contract_op().expect("contract op");
            c.check()?;
            if matches!(op, Op::Call { .. }) && is_system(&to) {
                return Err("can't call a system address".into());
            }
        }
    }
    Ok(())
}

/// What the builders take besides the operation. `fee: None` means the minimum.
#[derive(Clone, Debug, Default)]
pub struct Params {
    pub nonce: u64,
    pub expires: u64,
    pub memo: Vec<u8>,
    pub fee: Option<u128>,
}

/// Build and sign a transaction from `sk`'s account.
pub fn build_with(sk: &SigningKey, p: &ChainParams, a: Params, op: Op) -> anyhow::Result<SignedTransaction> {
    let from = Address::from_verifying_key(sk.verifying_key());
    build_from(sk, from, p, a, op)
}

/// Like `build_with`, for an account whose controlling key isn't the one its address came from.
pub fn build_from(
    sk: &SigningKey,
    from: Address,
    p: &ChainParams,
    a: Params,
    op: Op,
) -> anyhow::Result<SignedTransaction> {
    let mut tx = Transaction {
        version: TX_VERSION,
        chain_id: p.chain_id,
        from,
        nonce: a.nonce,
        expires: a.expires,
        fee: 0,
        memo: a.memo,
        op,
    };
    // Size is independent of the fee value (fixed-width u128), so one probe signature is exact.
    let probe = tx.clone().sign(sk)?;
    tx.fee = a.fee.unwrap_or_else(|| probe.min_fee());
    tx.sign(sk)
}

/// Build a correctly-priced op with the minimum fee and no expiry.
pub fn build_op(sk: &SigningKey, p: &ChainParams, nonce: u64, op: Op) -> anyhow::Result<SignedTransaction> {
    build_with(sk, p, Params { nonce, ..Default::default() }, op)
}

/// Build a correctly-priced transfer: minimum fee unless `fee` is given.
pub fn build_transfer(
    sk: &SigningKey,
    p: &ChainParams,
    nonce: u64,
    to: Address,
    value: u128,
    fee: Option<u128>,
) -> anyhow::Result<SignedTransaction> {
    build_with(sk, p, Params { nonce, fee, ..Default::default() }, Op::Transfer { to, value })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::DEVNET;
    use rand::rngs::OsRng;

    #[test]
    fn sign_recover_and_reject_tampering() {
        let sk = SigningKey::random(&mut OsRng);
        let me = Address::from_verifying_key(sk.verifying_key());
        let stx = build_transfer(&sk, &DEVNET, 0, Address([9; 20]), 5, None).unwrap();
        assert_eq!(stx.check_stateless(&DEVNET).unwrap(), me);
        assert_eq!(stx.tx.from, me);
        assert_eq!(SignedTransaction::from_bytes(&stx.to_bytes()).unwrap(), stx);

        let mut tampered = stx.clone();
        tampered.tx.op = Op::Transfer { to: Address([9; 20]), value: 6 };
        assert_ne!(tampered.signer().ok(), Some(me));

        let mut wrong_chain = stx.clone();
        wrong_chain.tx.chain_id = 1;
        assert!(wrong_chain.check_stateless(&DEVNET).is_err());

        let mut trailing = stx.to_bytes();
        trailing.push(0);
        assert!(SignedTransaction::from_bytes(&trailing).is_err());
    }

    #[test]
    fn rejects_high_s_malleated_signature() {
        let sk = SigningKey::random(&mut OsRng);
        let stx = build_transfer(&sk, &DEVNET, 0, Address([1; 20]), 1, None).unwrap();
        let Sig::Secp256k1Recoverable { signature, recovery_id } = &stx.sig;
        let sig = Signature::from_slice(signature).unwrap();
        // Construct the malleated twin (r, n - s), a valid ECDSA signature we must refuse.
        let s_neg = -*sig.s();
        let high = Signature::from_scalars(sig.r().to_bytes(), s_neg.to_bytes()).unwrap();
        let mut m = stx.clone();
        m.sig = Sig::Secp256k1Recoverable { signature: high.to_bytes().into(), recovery_id: recovery_id ^ 1 };
        assert!(m.signer().unwrap_err().contains("high-S"));
    }

    #[test]
    fn fee_floor_enforced() {
        let sk = SigningKey::random(&mut OsRng);
        let stx = build_transfer(&sk, &DEVNET, 0, Address([1; 20]), 1, Some(1)).unwrap();
        assert!(stx.check_stateless(&DEVNET).unwrap_err().contains("below minimum"));
    }
}
