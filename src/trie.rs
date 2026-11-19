//! A Merkle trie over the state, with proofs.
//!
//! Keys are 32-byte hashes, values are 32-byte hashes. The tree is binary and compressed: a node
//! exists only where two keys part ways, so its depth follows the number of entries, not the
//! length of the key. The shape depends only on which keys are present, never on the order they
//! went in, so two nodes holding the same state compute the same root.
//!
//!   leaf    H(0x00 || key || value)
//!   branch  H(0x01 || depth || prefix || left || right)
//!   empty   H(0x02)
//!
//! A branch commits to the bit it splits on (`depth`) and to every bit of the key before it
//! (`prefix`), so a proof can't present a node as if it sat somewhere else in the tree.
//!
//! A proof is the siblings along the path (bottom first) plus what the path ends in: the leaf
//! itself, another leaf, or a branch the key doesn't belong under. The last two prove the key is
//! absent. `verify` returns the proven value, `None` for proven absent, or an error if the proof
//! doesn't reach the root it was given.
//!
//! Nothing commits to this root yet: the block header still carries the old flat state root, and
//! the header changes once, in the Phase 4 format freeze.
#![deny(clippy::float_arithmetic)]

use crate::crypto::{Hash, keccak256};

const LEAF: u8 = 0x00;
const BRANCH: u8 = 0x01;
const EMPTY: u8 = 0x02;

/// Bit `i` of a key, most significant first.
fn bit(k: &Hash, i: usize) -> usize {
    ((k[i / 8] >> (7 - i % 8)) & 1) as usize
}

/// Index of the first bit where two keys differ, or 256 if they are equal.
fn first_diff(a: &Hash, b: &Hash) -> usize {
    for i in 0..32 {
        let x = a[i] ^ b[i];
        if x != 0 {
            return i * 8 + x.leading_zeros() as usize;
        }
    }
    256
}

/// The first `depth` bits of a key, the rest zero.
fn prefix_of(k: &Hash, depth: usize) -> Hash {
    let mut out = [0u8; 32];
    let full = depth / 8;
    out[..full].copy_from_slice(&k[..full]);
    if !depth.is_multiple_of(8) {
        out[full] = k[full] & (0xffu8 << (8 - depth % 8));
    }
    out
}

fn leaf_hash(key: &Hash, value: &Hash) -> Hash {
    let mut b = [0u8; 65];
    b[0] = LEAF;
    b[1..33].copy_from_slice(key);
    b[33..].copy_from_slice(value);
    keccak256(&b)
}

fn branch_hash(depth: usize, prefix: &Hash, left: &Hash, right: &Hash) -> Hash {
    let mut b = [0u8; 1 + 2 + 32 + 64];
    b[0] = BRANCH;
    b[1..3].copy_from_slice(&(depth as u16).to_be_bytes());
    b[3..35].copy_from_slice(prefix);
    b[35..67].copy_from_slice(left);
    b[67..].copy_from_slice(right);
    keccak256(&b)
}

pub fn empty_root() -> Hash {
    keccak256(&[EMPTY])
}

#[derive(Clone, Debug)]
enum Node {
    Leaf { key: Hash, value: Hash, hash: Hash },
    Branch { depth: usize, prefix: Hash, kids: Box<[Node; 2]>, hash: Hash },
}

impl Node {
    fn leaf(key: Hash, value: Hash) -> Node {
        Node::Leaf { key, value, hash: leaf_hash(&key, &value) }
    }

    fn branch(depth: usize, prefix: Hash, kids: [Node; 2]) -> Node {
        let hash = branch_hash(depth, &prefix, kids[0].hash(), kids[1].hash());
        Node::Branch { depth, prefix, kids: Box::new(kids), hash }
    }

    fn hash(&self) -> &Hash {
        match self {
            Node::Leaf { hash, .. } | Node::Branch { hash, .. } => hash,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Trie {
    root: Option<Node>,
    len: usize,
}

impl Trie {
    pub fn new() -> Trie {
        Trie::default()
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn root(&self) -> Hash {
        self.root.as_ref().map(|n| *n.hash()).unwrap_or_else(empty_root)
    }

    pub fn get(&self, key: &Hash) -> Option<Hash> {
        let mut at = self.root.as_ref()?;
        loop {
            match at {
                Node::Leaf { key: k, value, .. } => return (k == key).then_some(*value),
                Node::Branch { depth, prefix, kids, .. } => {
                    if prefix_of(key, *depth) != *prefix {
                        return None;
                    }
                    at = &kids[bit(key, *depth)];
                }
            }
        }
    }

    /// Set a key, replacing its value if it is there. Returns true if the key is new.
    pub fn insert(&mut self, key: Hash, value: Hash) -> bool {
        let mut added = false;
        let root = self.root.take();
        self.root = Some(insert(root, key, value, &mut added));
        if added {
            self.len += 1;
        }
        added
    }

    /// Remove a key. Returns true if it was there.
    pub fn remove(&mut self, key: &Hash) -> bool {
        let mut removed = false;
        let root = self.root.take();
        self.root = remove(root, key, &mut removed);
        if removed {
            self.len -= 1;
        }
        removed
    }

    /// A proof for `key`: of its value if it is present, of its absence if not.
    pub fn prove(&self, key: &Hash) -> Proof {
        let mut steps = Vec::new();
        let Some(mut at) = self.root.as_ref() else {
            return Proof { steps, end: End::Empty };
        };
        loop {
            match at {
                Node::Leaf { key: k, value, .. } => {
                    steps.reverse();
                    return Proof { steps, end: End::Leaf { key: *k, value: *value } };
                }
                Node::Branch { depth, prefix, kids, .. } => {
                    if prefix_of(key, *depth) != *prefix {
                        steps.reverse();
                        return Proof {
                            steps,
                            end: End::Branch {
                                depth: *depth as u16,
                                prefix: *prefix,
                                left: *kids[0].hash(),
                                right: *kids[1].hash(),
                            },
                        };
                    }
                    let b = bit(key, *depth);
                    steps.push(Step { depth: *depth as u16, sibling: *kids[1 - b].hash() });
                    at = &kids[b];
                }
            }
        }
    }
}

fn insert(node: Option<Node>, key: Hash, value: Hash, added: &mut bool) -> Node {
    let Some(node) = node else {
        *added = true;
        return Node::leaf(key, value);
    };
    // Where does the new key part ways with this node's subtree?
    let (cut, here) = match &node {
        Node::Leaf { key: k, .. } => (first_diff(k, &key), 256),
        // `prefix` is zero past `depth`, and so is `prefix_of`, so a difference below `depth` is a
        // real one and no difference means the key belongs under this branch.
        Node::Branch { depth, prefix, .. } => (first_diff(prefix, &prefix_of(&key, *depth)).min(*depth), *depth),
    };
    if cut == 256 {
        // The same key: replace the value.
        return Node::leaf(key, value);
    }
    if cut < here {
        // The key leaves this subtree above its root: a new branch where they part.
        *added = true;
        let fresh = Node::leaf(key, value);
        let kids = if bit(&key, cut) == 0 { [fresh, node] } else { [node, fresh] };
        return Node::branch(cut, prefix_of(&key, cut), kids);
    }
    let Node::Branch { depth, prefix, kids, .. } = node else { unreachable!("a leaf always cuts above itself") };
    let [l, r] = *kids;
    let kids = if bit(&key, depth) == 0 {
        [insert(Some(l), key, value, added), r]
    } else {
        [l, insert(Some(r), key, value, added)]
    };
    Node::branch(depth, prefix, kids)
}

fn remove(node: Option<Node>, key: &Hash, removed: &mut bool) -> Option<Node> {
    let node = node?;
    match node {
        Node::Leaf { key: k, .. } if k == *key => {
            *removed = true;
            None
        }
        Node::Leaf { .. } => Some(node),
        Node::Branch { depth, prefix, kids, hash } => {
            if prefix_of(key, depth) != prefix {
                return Some(Node::Branch { depth, prefix, kids, hash });
            }
            let b = bit(key, depth);
            let [l, r] = *kids;
            let (mine, other) = if b == 0 { (l, r) } else { (r, l) };
            match remove(Some(mine), key, removed) {
                // One side is empty now, so this branch is no longer a place where keys part:
                // its remaining child takes its place. That keeps the shape canonical.
                None => Some(other),
                Some(m) => {
                    let kids = if b == 0 { [m, other] } else { [other, m] };
                    Some(Node::branch(depth, prefix, kids))
                }
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Step {
    pub depth: u16,
    pub sibling: Hash,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum End {
    /// The tree is empty.
    Empty,
    /// The path ends in this leaf: the key's own if the keys match, another key's if not.
    Leaf { key: Hash, value: Hash },
    /// The path ends in a branch that the key doesn't belong under.
    Branch { depth: u16, prefix: Hash, left: Hash, right: Hash },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proof {
    /// Siblings from the bottom of the path to the top.
    pub steps: Vec<Step>,
    pub end: End,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ProofError {
    #[error("the proof doesn't lead to the root")]
    WrongRoot,
    #[error("the proof is malformed")]
    Malformed,
}

/// Check `proof` for `key` against `root`. `Ok(Some(v))`: the key is there with value `v`.
/// `Ok(None)`: the key is not in the tree. `Err`: the proof proves nothing about this root.
pub fn verify(root: &Hash, key: &Hash, proof: &Proof) -> Result<Option<Hash>, ProofError> {
    let (mut acc, found) = match &proof.end {
        End::Empty => {
            if !proof.steps.is_empty() {
                return Err(ProofError::Malformed);
            }
            return if *root == empty_root() { Ok(None) } else { Err(ProofError::WrongRoot) };
        }
        End::Leaf { key: k, value } => (leaf_hash(k, value), (k == key).then_some(*value)),
        End::Branch { depth, prefix, left, right } => {
            let d = *depth as usize;
            // A branch the key *does* belong under proves nothing about it.
            if d >= 256 || prefix_of(key, d) == *prefix {
                return Err(ProofError::Malformed);
            }
            (branch_hash(d, prefix, left, right), None)
        }
    };
    for s in &proof.steps {
        let d = s.depth as usize;
        if d >= 256 {
            return Err(ProofError::Malformed);
        }
        let prefix = prefix_of(key, d);
        acc = if bit(key, d) == 0 {
            branch_hash(d, &prefix, &acc, &s.sibling)
        } else {
            branch_hash(d, &prefix, &s.sibling, &acc)
        };
    }
    if acc == *root { Ok(found) } else { Err(ProofError::WrongRoot) }
}

impl Trie {
    /// A reference root computed straight from sorted entries, with no incremental updates. The
    /// tests compare the trie against this.
    pub fn reference_root(entries: &[(Hash, Hash)]) -> Hash {
        let mut e = entries.to_vec();
        e.sort();
        e.dedup_by_key(|x| x.0);
        fn build(e: &[(Hash, Hash)], from: usize) -> Hash {
            // `from`: bits before this are shared by every entry here.
            if e.len() == 1 {
                return leaf_hash(&e[0].0, &e[0].1);
            }
            // They are sorted, so the first and last differ at the first bit any two do.
            let d = first_diff(&e[0].0, &e[e.len() - 1].0);
            debug_assert!(d >= from);
            let split = e.partition_point(|x| bit(&x.0, d) == 0);
            branch_hash(d, &prefix_of(&e[0].0, d), &build(&e[..split], d + 1), &build(&e[split..], d + 1))
        }
        if e.is_empty() { empty_root() } else { build(&e, 0) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{Rng, SeedableRng, rngs::StdRng, seq::SliceRandom};

    fn k(rng: &mut StdRng) -> Hash {
        rng.r#gen()
    }

    fn filled(rng: &mut StdRng, n: usize) -> (Trie, Vec<(Hash, Hash)>) {
        let mut t = Trie::new();
        let mut e = Vec::new();
        for _ in 0..n {
            let (key, v) = (k(rng), k(rng));
            t.insert(key, v);
            e.push((key, v));
        }
        (t, e)
    }

    #[test]
    fn the_root_does_not_depend_on_the_order() {
        let mut rng = StdRng::seed_from_u64(1);
        let (t, mut e) = filled(&mut rng, 300);
        for _ in 0..5 {
            e.shuffle(&mut rng);
            let mut t2 = Trie::new();
            for (key, v) in &e {
                t2.insert(*key, *v);
            }
            assert_eq!(t2.root(), t.root());
        }
        assert_eq!(t.root(), Trie::reference_root(&e));
    }

    #[test]
    fn the_incremental_trie_matches_the_reference_through_inserts_updates_and_removals() {
        let mut rng = StdRng::seed_from_u64(2);
        let mut t = Trie::new();
        let mut model: std::collections::BTreeMap<Hash, Hash> = Default::default();
        let mut keys: Vec<Hash> = Vec::new();
        for round in 0..2000 {
            match rng.gen_range(0..4) {
                0 | 1 => {
                    let key = k(&mut rng);
                    let v = k(&mut rng);
                    assert_eq!(t.insert(key, v), model.insert(key, v).is_none());
                    keys.push(key);
                }
                2 if !keys.is_empty() => {
                    let key = keys[rng.gen_range(0..keys.len())];
                    let v = k(&mut rng);
                    t.insert(key, v);
                    model.insert(key, v);
                }
                _ if !keys.is_empty() => {
                    let key = keys.swap_remove(rng.gen_range(0..keys.len()));
                    assert_eq!(t.remove(&key), model.remove(&key).is_some());
                }
                _ => {}
            }
            assert_eq!(t.len(), model.len());
            if round % 50 == 0 {
                let e: Vec<_> = model.iter().map(|(a, b)| (*a, *b)).collect();
                assert_eq!(t.root(), Trie::reference_root(&e), "round {round}");
            }
        }
        // Removing everything gives back the empty root, and removing what isn't there changes nothing.
        assert!(!t.remove(&[0xaa; 32]));
        for key in model.keys().copied().collect::<Vec<_>>() {
            assert!(t.remove(&key));
        }
        assert_eq!(t.root(), empty_root());
        assert!(t.is_empty());
    }

    #[test]
    fn removal_leaves_the_same_tree_as_never_adding() {
        let mut rng = StdRng::seed_from_u64(3);
        let (mut t, e) = filled(&mut rng, 100);
        let before = t.root();
        let extra = k(&mut rng);
        t.insert(extra, k(&mut rng));
        assert_ne!(t.root(), before);
        t.remove(&extra);
        assert_eq!(t.root(), before);
        assert_eq!(t.root(), Trie::reference_root(&e));
    }

    #[test]
    fn any_change_to_any_entry_changes_the_root() {
        let mut rng = StdRng::seed_from_u64(4);
        let (t, e) = filled(&mut rng, 50);
        let root = t.root();
        for (key, v) in &e {
            let mut t2 = t.clone();
            let mut other = *v;
            other[31] ^= 1;
            t2.insert(*key, other);
            assert_ne!(t2.root(), root);
            // the same key with its value moved to a neighbouring key is different too
            let mut t3 = t.clone();
            t3.remove(key);
            let mut moved = *key;
            moved[31] ^= 1;
            t3.insert(moved, *v);
            assert_ne!(t3.root(), root);
        }
    }

    #[test]
    fn proofs_of_presence_and_absence_verify() {
        let mut rng = StdRng::seed_from_u64(5);
        for n in [0usize, 1, 2, 3, 17, 400] {
            let (t, e) = filled(&mut rng, n);
            let root = t.root();
            for (key, v) in &e {
                let p = t.prove(key);
                assert_eq!(verify(&root, key, &p), Ok(Some(*v)), "n={n}");
            }
            for _ in 0..50 {
                let missing = k(&mut rng);
                let p = t.prove(&missing);
                assert_eq!(verify(&root, &missing, &p), Ok(None), "n={n}");
            }
        }
    }

    #[test]
    fn keys_that_share_a_long_prefix_still_prove() {
        // Keys differing only in the last bits make the deepest paths there are.
        let mut t = Trie::new();
        let mut keys = Vec::new();
        for i in 0..8u8 {
            let mut key = [0xabu8; 32];
            key[31] = i;
            t.insert(key, [i; 32]);
            keys.push(key);
        }
        let root = t.root();
        for (i, key) in keys.iter().enumerate() {
            assert_eq!(verify(&root, key, &t.prove(key)), Ok(Some([i as u8; 32])));
        }
        let mut gone = [0xabu8; 32];
        gone[31] = 200;
        assert_eq!(verify(&root, &gone, &t.prove(&gone)), Ok(None));
        let mut far = [0xabu8; 32];
        far[0] = 0x01;
        assert_eq!(verify(&root, &far, &t.prove(&far)), Ok(None));
    }

    #[test]
    fn a_proof_cannot_be_bent_into_saying_something_else() {
        let mut rng = StdRng::seed_from_u64(6);
        let (t, e) = filled(&mut rng, 64);
        let root = t.root();
        let (key, v) = e[10];
        let good = t.prove(&key);
        assert_eq!(verify(&root, &key, &good), Ok(Some(v)));

        // Another root.
        let mut other = root;
        other[0] ^= 1;
        assert_eq!(verify(&other, &key, &good), Err(ProofError::WrongRoot));

        // Every byte of every sibling, and of the end, matters.
        for i in 0..good.steps.len() {
            let mut p = good.clone();
            p.steps[i].sibling[5] ^= 1;
            assert!(verify(&root, &key, &p).is_err(), "sibling {i}");
            let mut p = good.clone();
            p.steps[i].depth ^= 1;
            assert!(verify(&root, &key, &p).is_err(), "depth {i}");
        }
        let mut p = good.clone();
        if let End::Leaf { value, .. } = &mut p.end {
            value[0] ^= 1;
        }
        assert!(verify(&root, &key, &p).is_err());

        // A proof for one key doesn't prove anything about another.
        let (key2, _) = e[11];
        assert!(verify(&root, &key2, &good).is_err());

        // Dropping steps, or adding some, breaks it.
        let mut p = good.clone();
        p.steps.pop();
        assert!(verify(&root, &key, &p).is_err());
        let mut p = good.clone();
        p.steps.push(p.steps[0].clone());
        assert!(verify(&root, &key, &p).is_err());

        // A proof of absence for a key that is present: show some other leaf as the end.
        let (other_key, other_v) = e[20];
        let mut lie = good.clone();
        lie.end = End::Leaf { key: other_key, value: other_v };
        assert!(verify(&root, &key, &lie).is_err());

        // Absence can't be claimed for a key by pointing at a branch it does belong under.
        let mut p = t.prove(&key);
        p.end = End::Branch { depth: 0, prefix: [0; 32], left: [0; 32], right: [0; 32] };
        assert!(verify(&root, &key, &p).is_err());

        // The empty proof proves only the empty tree.
        let empty = Proof { steps: vec![], end: End::Empty };
        assert!(verify(&root, &key, &empty).is_err());
        assert_eq!(verify(&empty_root(), &key, &empty), Ok(None));
    }

    /// The attack on absence proofs: take a key that is there, present the real branch just above
    /// its leaf as "the node the key doesn't belong under", and claim it isn't in the tree. With
    /// the branch's true prefix that is a branch the key does belong under; with a made-up prefix
    /// the key looks like it doesn't, so the prefix has to be part of what the branch hashes to.
    #[test]
    fn a_present_key_cannot_be_proven_absent() {
        let mut rng = StdRng::seed_from_u64(8);
        let (t, e) = filled(&mut rng, 40);
        let root = t.root();
        for (key, v) in &e {
            let good = t.prove(key);
            assert_eq!(verify(&root, key, &good), Ok(Some(*v)));
            let (parent, above) = good.steps.split_first().unwrap();
            let d = parent.depth as usize;
            let own = leaf_hash(key, v);
            let (left, right) = if bit(key, d) == 0 { (own, parent.sibling) } else { (parent.sibling, own) };
            // The real prefix: the key belongs under it.
            let truth = Proof {
                steps: above.to_vec(),
                end: End::Branch { depth: parent.depth, prefix: prefix_of(key, d), left, right },
            };
            assert_eq!(verify(&root, key, &truth), Err(ProofError::Malformed));
            // A false prefix: it no longer hashes to the root.
            let mut fake_prefix = prefix_of(key, d);
            fake_prefix[0] ^= 0x80;
            let lie = Proof {
                steps: above.to_vec(),
                end: End::Branch { depth: parent.depth, prefix: fake_prefix, left, right },
            };
            assert_eq!(verify(&root, key, &lie), Err(ProofError::WrongRoot));
        }
    }

    #[test]
    fn a_leaf_cannot_pass_for_a_branch() {
        // 65 bytes of leaf preimage vs 99 of branch, and different tags: but check it directly.
        let a = [1u8; 32];
        let b = [2u8; 32];
        assert_ne!(leaf_hash(&a, &b), branch_hash(0, &[0; 32], &a, &b));
        assert_ne!(empty_root(), leaf_hash(&[0; 32], &[0; 32]));
    }

    #[test]
    fn first_diff_and_prefix_agree() {
        let mut rng = StdRng::seed_from_u64(7);
        for _ in 0..500 {
            let a = k(&mut rng);
            let mut b = a;
            let i = rng.gen_range(0..256);
            b[i / 8] ^= 0x80 >> (i % 8);
            assert_eq!(first_diff(&a, &b), i);
            assert_eq!(prefix_of(&a, i), prefix_of(&b, i));
            assert_ne!(prefix_of(&a, i + 1), prefix_of(&b, i + 1));
        }
        assert_eq!(first_diff(&[3; 32], &[3; 32]), 256);
        assert_eq!(prefix_of(&[0xff; 32], 0), [0; 32]);
        assert_eq!(prefix_of(&[0xff; 32], 256), [0xff; 32]);
    }
}
