//! Pending transactions, ordered by nonce per sender.

use crate::address::Address;
use crate::crypto::Hash;
use crate::params::{ChainParams, MAX_BLOCK_BYTES, MAX_TXS_PER_BLOCK};
use crate::state::State;
use crate::tx::{Op, SignedTransaction};
use std::collections::{BTreeMap, BinaryHeap, HashMap};

pub const MAX_MEMPOOL_TXS: usize = 10_000;
pub const MAX_MEMPOOL_BYTES: usize = 64 * 1024 * 1024;
/// Transactions that haven't made it into a block after this long are dropped.
pub const MEMPOOL_TTL_SECS: u64 = 3 * 3600;
pub const MAX_PENDING_PER_SENDER: usize = 64;

#[derive(Clone)]
pub struct Entry {
    pub tx: SignedTransaction,
    /// The account (`tx.from`).
    pub sender: Address,
    /// The address of the key that signed it.
    pub signer: Address,
    pub size: usize,
    pub received: u64,
}

/// How much the pool will hold. A smaller machine can run a smaller pool; the defaults suit a
/// node with a couple of gigabytes to spare.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_txs: usize,
    pub max_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { max_txs: MAX_MEMPOOL_TXS, max_bytes: MAX_MEMPOOL_BYTES }
    }
}

#[derive(Default)]
pub struct Mempool {
    txs: HashMap<Hash, Entry>,
    by_sender: HashMap<Address, BTreeMap<u64, Hash>>,
    bytes: usize,
    limits: Limits,
    /// Bumped on every change, so miners know when to rebuild their template.
    pub generation: u64,
}

impl Mempool {
    pub fn with_limits(limits: Limits) -> Self {
        Mempool { limits, ..Default::default() }
    }
    pub fn limits(&self) -> Limits {
        self.limits
    }
    pub fn len(&self) -> usize {
        self.txs.len()
    }
    pub fn is_empty(&self) -> bool {
        self.txs.is_empty()
    }
    pub fn contains(&self, h: &Hash) -> bool {
        self.txs.contains_key(h)
    }
    pub fn get(&self, h: &Hash) -> Option<&Entry> {
        self.txs.get(h)
    }
    pub fn entries(&self) -> impl Iterator<Item = (&Hash, &Entry)> {
        self.txs.iter()
    }
    pub fn pending_count(&self, a: &Address) -> u64 {
        self.by_sender.get(a).map(|m| m.len() as u64).unwrap_or(0)
    }

    pub fn add(&mut self, tx: SignedTransaction, state: &State, p: &ChainParams) -> Result<Hash, String> {
        let h = tx.hash();
        if self.txs.contains_key(&h) {
            return Err("already in mempool".into());
        }
        let signer = tx.check_stateless(p)?;
        let sender = tx.tx.from;
        state.check_common(&tx, signer, state.height + 1, false)?;
        let acct = state.account(&sender);
        let queue = self.by_sender.get(&sender);
        let pending = queue.map(|q| q.len() as u64).unwrap_or(0);
        if tx.tx.nonce < acct.nonce {
            return Err(format!("nonce too low (account nonce is {})", acct.nonce));
        }
        // Same sender, same nonce as something already waiting: a replacement, if it pays enough.
        let replacing = queue.and_then(|q| q.get(&tx.tx.nonce)).copied();
        if let Some(old) = replacing {
            let was = self.txs[&old].tx.tx.fee;
            // It has to beat the old fee by at least what it costs the network to carry the new
            // one, so replacing is never cheaper than having sent the right fee to begin with.
            let need = was.checked_add(tx.min_fee()).ok_or("fee overflow")?;
            if tx.tx.fee < need {
                return Err(format!(
                    "to replace a pending transaction the fee must be at least {} LYX (it pays {})",
                    crate::amount::format_lyx(need),
                    crate::amount::format_lyx(tx.tx.fee)
                ));
            }
        } else {
            let expected = acct.nonce + pending;
            if tx.tx.nonce != expected {
                return Err(format!("nonce gap: expected {expected}"));
            }
            if pending as usize >= MAX_PENDING_PER_SENDER {
                return Err("too many pending transactions from this sender".into());
            }
        }
        match &tx.tx.op {
            Op::Swap(_) => {
                state.check_swap(&tx, sender, state.height + 1)?;
            }
            Op::Vault(_) => {
                state.check_vault(&tx, sender, state.height + 1, p)?;
            }
            Op::Deploy { .. } | Op::Call { .. } => {
                if !p.contracts_active(state.height + 1) {
                    return Err(crate::state::CONTRACTS_OFF.into());
                }
                state.check_contract(&tx, sender)?;
            }
            Op::Key(k) => {
                state.check_key(&tx, sender)?;
                // One of each kind waiting per account: a second would fail once the first is mined.
                let kind = std::mem::discriminant(k);
                if self.by_sender.get(&sender).is_some_and(|q| {
                    q.iter().any(|(n, h)| {
                        Some(*h) != replacing
                            && *n != tx.tx.nonce
                            && matches!(&self.txs[h].tx.tx.op, Op::Key(o) if std::mem::discriminant(o) == kind)
                    })
                }) {
                    return Err("a key operation of this kind from this account is already pending".into());
                }
            }
            Op::Timelock(_) => {
                state.check_timelock(&tx, sender, state.height + 1, p)?;
            }
            Op::Token(_) => {
                state.check_token(&tx, sender)?;
            }
            Op::Transfer { to, .. } => state.check_payee(to)?,
            Op::Batch(v) => {
                for (to, _) in v {
                    state.check_payee(to)?;
                }
            }
        }
        let mut spend: u128 = own_spend(&tx);
        let mut daily: u128 = allowance_cost(&tx);
        if let Some(q) = queue {
            // A replacement stands in for the one it replaces, so that one isn't counted.
            for th in q.values().filter(|th| Some(**th) != replacing) {
                spend = spend.saturating_add(own_spend(&self.txs[th].tx));
                daily = daily.saturating_add(allowance_cost(&self.txs[th].tx));
            }
        }
        if spend > acct.balance {
            return Err("insufficient balance (including pending transactions)".into());
        }
        if let Some(left) = state.allowance_left(&sender, state.height + 1, p)
            && daily > left
        {
            return Err(format!(
                "over the vault's daily allowance ({} LYX left today), use a withdrawal",
                crate::amount::format_lyx(left)
            ));
        }
        let size = tx.size();
        if let Some(old) = replacing {
            self.drop_one(&old);
        } else if !self.make_room(size, rate(tx.tx.fee, size), sender) {
            return Err("mempool full, and this fee is below everything already waiting".into());
        }
        self.by_sender.entry(sender).or_default().insert(tx.tx.nonce, h);
        self.bytes += size;
        self.txs.insert(h, Entry { tx, sender, signer, size, received: crate::chain::now() });
        self.generation += 1;
        Ok(h)
    }

    /// Make space for one more transaction, by dropping the worst-paying ones if the pool is
    /// full. Returns false if nothing waiting pays less than `incoming`, in which case the new
    /// transaction is the one that should be turned away.
    ///
    /// Dropping is per sender from a nonce upward: anything after a dropped nonce could never be
    /// mined anyway, so leaving it would just hold space for a gap.
    fn make_room(&mut self, size: usize, incoming: u128, from: Address) -> bool {
        let full = |m: &Self| m.txs.len() >= m.limits.max_txs || m.bytes + size > m.limits.max_bytes;
        if !full(self) {
            return true;
        }
        loop {
            // The worst sender is the one whose cheapest transaction is cheapest of all; its tail
            // from that nonce goes together.
            let worst = self
                .by_sender
                .iter()
                .filter(|(a, _)| **a != from)
                .filter_map(|(a, q)| {
                    let (n, h) = q.iter().min_by_key(|(_, h)| rate(self.txs[*h].tx.tx.fee, self.txs[*h].size))?;
                    Some((rate(self.txs[h].tx.tx.fee, self.txs[h].size), *a, *n))
                })
                .min_by(|x, y| x.0.cmp(&y.0).then(x.1.cmp(&y.1)));
            let Some((worst_rate, addr, nonce)) = worst else { return false };
            if worst_rate >= incoming {
                return false; // everything waiting pays at least as well
            }
            let tail: Vec<Hash> = self.by_sender[&addr].range(nonce..).map(|(_, h)| *h).collect();
            for h in tail {
                self.drop_one(&h);
            }
            if !full(self) {
                return true;
            }
        }
    }

    /// Forget one transaction, keeping the byte count and the per-sender queue in step.
    fn drop_one(&mut self, h: &Hash) {
        let Some(e) = self.txs.remove(h) else { return };
        self.bytes -= e.size;
        if let Some(q) = self.by_sender.get_mut(&e.sender) {
            q.remove(&e.tx.tx.nonce);
            if q.is_empty() {
                self.by_sender.remove(&e.sender);
            }
        }
    }

    /// After the tip changes: drop mined/invalidated txs, re-admit reorged-out ones.
    pub fn on_new_tip(&mut self, state: &State, p: &ChainParams, returned: Vec<SignedTransaction>) {
        let cutoff = crate::chain::now().saturating_sub(MEMPOOL_TTL_SECS);
        let mut all: Vec<SignedTransaction> =
            self.txs.drain().filter(|(_, e)| e.received >= cutoff).map(|(_, e)| e.tx).collect();
        all.extend(returned);
        self.by_sender.clear();
        self.bytes = 0;
        // Re-add in (sender, nonce) order so per-sender sequences reconnect.
        let mut keyed: Vec<(Address, u64, SignedTransaction)> =
            all.into_iter().map(|t| (t.tx.from, t.tx.nonce, t)).collect();
        keyed.sort_by_key(|a| (a.0, a.1));
        for (_, _, t) in keyed {
            let _ = self.add(t, state, p);
        }
        self.generation += 1;
    }

    /// Pick transactions for a block: highest fee-per-byte first, respecting each sender's nonce
    /// order. Every pick is applied to a scratch state, so the result is guaranteed valid.
    pub fn select(&self, state: &State, p: &ChainParams) -> Vec<SignedTransaction> {
        #[derive(PartialEq, Eq)]
        struct Head(u128, Address, u64);
        impl Ord for Head {
            fn cmp(&self, o: &Self) -> std::cmp::Ordering {
                self.0.cmp(&o.0).then_with(|| o.1.cmp(&self.1))
            }
        }
        impl PartialOrd for Head {
            fn partial_cmp(&self, o: &Self) -> Option<std::cmp::Ordering> {
                Some(self.cmp(o))
            }
        }
        let rate = |e: &Entry| e.tx.tx.fee / e.size.max(1) as u128;
        let mut scratch = state.clone();
        // the block-start releases (vault withdrawals, key rotations) happen before any of its txs
        if scratch.begin_block(state.height + 1).is_err() {
            return vec![];
        }
        let mut heap = BinaryHeap::new();
        for (sender, q) in &self.by_sender {
            if let Some((&n, h)) = q.iter().next() {
                heap.push(Head(rate(&self.txs[h]), *sender, n));
            }
        }
        let mut out = Vec::new();
        let mut bytes = 512; // header + framing headroom
        let mut gas = 0u64;
        while let Some(Head(_, sender, nonce)) = heap.pop() {
            if out.len() >= MAX_TXS_PER_BLOCK {
                break;
            }
            let e = &self.txs[&self.by_sender[&sender][&nonce]];
            let signer = e.signer;
            if bytes + e.size > MAX_BLOCK_BYTES {
                continue;
            }
            let g = crate::state::contract_gas(&e.tx).unwrap_or(0);
            if gas + g > crate::contract::BLOCK_GAS_LIMIT {
                continue;
            }
            if scratch.apply_tx(&e.tx, signer, state.height + 1, p).is_err() {
                continue; // drops this sender's remaining txs too (nonce chain broken)
            }
            bytes += e.size;
            gas += g;
            out.push(e.tx.clone());
            if let Some((&n, h)) = self.by_sender[&sender].range(nonce + 1..).next() {
                heap.push(Head(rate(&self.txs[h]), sender, n));
            }
        }
        let _ = p;
        out
    }
}

/// Fee per byte, which is how transactions are ranked against each other.
pub fn rate(fee: u128, size: usize) -> u128 {
    fee / size.max(1) as u128
}

/// What a pending tx takes out of the sender's own balance. Swap claims and refunds pay their fee
/// from the lock, and a recovery key or heir pays from the vault, so they take no fee here.
fn own_spend(t: &SignedTransaction) -> u128 {
    let fee = if t.tx.op.sender_pays_fee(&t.tx.from) { t.tx.fee } else { 0 };
    t.tx.op.outflow().saturating_add(fee)
}

/// What a pending tx counts against a vault's daily allowance if the sender is a vault. Delayed
/// withdrawals only count their fee.
fn allowance_cost(t: &SignedTransaction) -> u128 {
    t.tx.op.allowance_cost(t.tx.fee)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::address_of;
    use crate::params::{COIN, ChainParams, DEVNET};
    use crate::tx::build_transfer;
    use k256::ecdsa::SigningKey;
    use rand::rngs::OsRng;

    #[test]
    fn nonce_and_balance_rules() {
        let p = &ChainParams { coinbase_maturity: 0, ..DEVNET.clone() };
        let sk = SigningKey::random(&mut OsRng);
        let a = address_of(&sk);
        let mut s = State::default();
        s.apply_body(1, a, &[], p).unwrap();
        let mut mp = Mempool::default();
        let to = Address([5; 20]);
        mp.add(build_transfer(&sk, p, 0, to, 4 * COIN, None).unwrap(), &s, p).unwrap();
        // Same nonce again at the same fee is a replacement that doesn't pay enough.
        assert!(mp.add(build_transfer(&sk, p, 0, to, COIN, None).unwrap(), &s, p).unwrap_err().contains("to replace"));
        assert!(mp.add(build_transfer(&sk, p, 2, to, COIN, None).unwrap(), &s, p).unwrap_err().contains("gap"));
        mp.add(build_transfer(&sk, p, 1, to, 4 * COIN, None).unwrap(), &s, p).unwrap();
        // 4 + 4 + 4 > 10 -> rejected even though each alone is affordable.
        assert!(
            mp.add(build_transfer(&sk, p, 2, to, 4 * COIN, None).unwrap(), &s, p).unwrap_err().contains("insufficient")
        );

        let picked = mp.select(&s, p);
        assert_eq!(picked.len(), 2);
        assert_eq!(picked[0].tx.nonce, 0);

        // Mine the first one; the pool must keep only the second.
        s.apply_body(2, Address([9; 20]), &picked[..1], p).unwrap();
        mp.on_new_tip(&s, p, vec![]);
        assert_eq!(mp.len(), 1);
    }
    /// Raising the fee on a transaction that's stuck: it takes the old one's place, and the old
    /// one is gone.
    #[test]
    fn a_higher_fee_replaces_a_stuck_transaction() {
        let p = &ChainParams { coinbase_maturity: 0, ..DEVNET.clone() };
        let sk = SigningKey::random(&mut OsRng);
        let a = address_of(&sk);
        let mut s = State::default();
        s.apply_body(1, a, &[], p).unwrap();
        let mut mp = Mempool::default();
        let to = Address([5; 20]);

        let slow = build_transfer(&sk, p, 0, to, COIN, None).unwrap();
        let h1 = mp.add(slow.clone(), &s, p).unwrap();
        let need = slow.tx.fee + slow.min_fee();

        // A penny short is refused, and the original stays.
        let nearly = build_transfer(&sk, p, 0, to, COIN, Some(need - 1)).unwrap();
        assert!(mp.add(nearly, &s, p).unwrap_err().contains("to replace"));
        assert!(mp.contains(&h1));
        assert_eq!(mp.len(), 1);

        // Enough: the new one is in, the old one is out, and the byte count follows.
        let fast = build_transfer(&sk, p, 0, to, COIN, Some(need)).unwrap();
        let h2 = mp.add(fast, &s, p).unwrap();
        assert!(mp.contains(&h2) && !mp.contains(&h1));
        assert_eq!(mp.len(), 1);
        assert_eq!(mp.bytes, mp.entries().map(|(_, e)| e.size).sum::<usize>());
        assert_eq!(mp.pending_count(&a), 1);

        // A replacement still has to be affordable alongside everything else pending.
        mp.add(build_transfer(&sk, p, 1, to, COIN, None).unwrap(), &s, p).unwrap();
        let greedy = build_transfer(&sk, p, 0, to, 9 * COIN, Some(need * 4)).unwrap();
        assert!(mp.add(greedy, &s, p).unwrap_err().contains("insufficient"));
        assert!(mp.contains(&h2), "the refused replacement must not have removed anything");
        assert_eq!(mp.len(), 2);
    }

    /// A full mempool keeps the best-paying transactions: a better fee pushes out the worst one,
    /// and a worse fee is turned away rather than displacing anything.
    #[test]
    fn a_full_mempool_keeps_the_best_fees() {
        let p = &ChainParams { coinbase_maturity: 0, ..DEVNET.clone() };
        let n = 8;
        let keys: Vec<SigningKey> = (0..n + 2).map(|_| SigningKey::random(&mut OsRng)).collect();
        let mut s = State::default();
        for (i, k) in keys.iter().enumerate() {
            s.apply_body(i as u64 + 1, address_of(k), &[], p).unwrap();
        }
        let mut mp = Mempool::with_limits(Limits { max_txs: n, max_bytes: MAX_MEMPOOL_BYTES });
        let to = Address([5; 20]);
        let fee = |k: u128| (200 + k * 40) * crate::params::MIN_FEE_PER_BYTE;

        // Fill it, cheapest sender first.
        let mut hashes = Vec::new();
        for (i, k) in keys.iter().take(n).enumerate() {
            hashes.push(mp.add(build_transfer(k, p, 0, to, COIN, Some(fee(i as u128 + 1))).unwrap(), &s, p).unwrap());
        }
        assert_eq!(mp.len(), n);

        // Something cheaper than everything waiting is turned away, and nothing is lost.
        let cheap = build_transfer(&keys[n], p, 0, to, COIN, Some(fee(0))).unwrap();
        assert!(mp.add(cheap, &s, p).unwrap_err().contains("mempool full"));
        assert_eq!(mp.len(), n);
        assert!(hashes.iter().all(|h| mp.contains(h)));

        // Something dearer takes the cheapest one's place.
        let rich = build_transfer(&keys[n + 1], p, 0, to, COIN, Some(fee(100))).unwrap();
        let h = mp.add(rich, &s, p).unwrap();
        assert_eq!(mp.len(), n);
        assert!(mp.contains(&h));
        assert!(!mp.contains(&hashes[0]), "the cheapest should have gone");
        assert!(hashes[1..].iter().all(|x| mp.contains(x)), "nothing else should have");
        assert_eq!(mp.bytes, mp.entries().map(|(_, e)| e.size).sum::<usize>());
        // And the pool is still internally consistent.
        assert_eq!(mp.by_sender.values().map(|q| q.len()).sum::<usize>(), mp.len());
    }

    /// When the worst-paying sender is pushed out, its later nonces go with it: with a gap in
    /// front of them they could never be mined, so keeping them would just hold space.
    #[test]
    fn eviction_takes_the_whole_tail() {
        let p = &ChainParams { coinbase_maturity: 0, ..DEVNET.clone() };
        let keys: Vec<SigningKey> = (0..5).map(|_| SigningKey::random(&mut OsRng)).collect();
        let mut s = State::default();
        for (i, k) in keys.iter().enumerate() {
            s.apply_body(i as u64 + 1, address_of(k), &[], p).unwrap();
        }
        let fee = |k: u128| (200 + k * 40) * crate::params::MIN_FEE_PER_BYTE;
        let to = Address([5; 20]);
        let mut mp = Mempool::with_limits(Limits { max_txs: 6, max_bytes: MAX_MEMPOOL_BYTES });

        // The cheap sender has three waiting, the others one each.
        let poor = &keys[0];
        for n in 0..3 {
            mp.add(build_transfer(poor, p, n, to, COIN, Some(fee(1))).unwrap(), &s, p).unwrap();
        }
        for (i, k) in keys[1..4].iter().enumerate() {
            mp.add(build_transfer(k, p, 0, to, COIN, Some(fee(i as u128 + 5))).unwrap(), &s, p).unwrap();
        }
        assert_eq!(mp.len(), 6);
        assert_eq!(mp.pending_count(&address_of(poor)), 3);

        let rich = build_transfer(&keys[4], p, 0, to, COIN, Some(fee(100))).unwrap();
        mp.add(rich, &s, p).unwrap();
        assert_eq!(mp.pending_count(&address_of(poor)), 0, "the whole tail should have gone, not just nonce 0");
        assert_eq!(mp.len(), 4);
        assert_eq!(mp.bytes, mp.entries().map(|(_, e)| e.size).sum::<usize>());
        assert_eq!(mp.by_sender.values().map(|q| q.len()).sum::<usize>(), mp.len());
    }

    /// Dropping a transaction takes the sender's later nonces with it: they could never be mined
    /// with a gap in front of them.
    #[test]
    fn dropping_a_nonce_drops_the_ones_after_it() {
        let p = &ChainParams { coinbase_maturity: 0, ..DEVNET.clone() };
        let sk = SigningKey::random(&mut OsRng);
        let a = address_of(&sk);
        let mut s = State::default();
        s.apply_body(1, a, &[], p).unwrap();
        let mut mp = Mempool::default();
        let to = Address([5; 20]);
        for n in 0..3 {
            mp.add(build_transfer(&sk, p, n, to, COIN, None).unwrap(), &s, p).unwrap();
        }
        assert_eq!(mp.pending_count(&a), 3);
        let first = mp.by_sender[&a][&0];
        mp.drop_one(&first);
        assert_eq!(mp.len(), 2);
        assert_eq!(mp.bytes, mp.entries().map(|(_, e)| e.size).sum::<usize>());
    }
}
