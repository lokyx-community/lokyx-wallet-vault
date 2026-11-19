//! Maps that can take back what a block did to them.
//!
//! `Tracked` wraps a `BTreeMap` and, while recording, notes the previous value of every key it is
//! about to change. Playing that note back in reverse restores the map exactly, which is how the
//! chain steps a block off the tip without replaying anything from a snapshot: the cost of undoing
//! a block is the size of the block, not the size of the state.
//!
//! Reads go straight through to the map (`Deref`). Every way of changing it goes through a
//! method here, so there is no route to a change that isn't noted.
#![deny(clippy::float_arithmetic)]

use std::collections::{BTreeMap, BTreeSet};
use std::ops::Deref;

/// Previous values, oldest first. `None` means the key wasn't there.
pub type Log<K, V> = Vec<(K, Option<V>)>;

#[derive(Debug)]
pub struct Tracked<K: Ord + Clone, V: Clone> {
    map: BTreeMap<K, V>,
    log: Option<Log<K, V>>,
    /// Keys changed since `take_dirty` last ran, so the state trie can be brought up to date by
    /// touching only these. Every way of changing the map marks here.
    dirty: BTreeSet<K>,
}

impl<K: Ord + Clone, V: Clone> Default for Tracked<K, V> {
    fn default() -> Self {
        Tracked { map: BTreeMap::new(), log: None, dirty: BTreeSet::new() }
    }
}

/// A copy has the same contents and is not recording, whatever the original was doing.
impl<K: Ord + Clone, V: Clone> Clone for Tracked<K, V> {
    fn clone(&self) -> Self {
        Tracked { map: self.map.clone(), log: None, dirty: self.dirty.clone() }
    }
}

impl<K: Ord + Clone, V: Clone + PartialEq> PartialEq for Tracked<K, V> {
    fn eq(&self, other: &Self) -> bool {
        self.map == other.map
    }
}
impl<K: Ord + Clone, V: Clone + Eq> Eq for Tracked<K, V> {}

impl<K: Ord + Clone, V: Clone> Deref for Tracked<K, V> {
    type Target = BTreeMap<K, V>;
    fn deref(&self) -> &BTreeMap<K, V> {
        &self.map
    }
}

impl<'a, K: Ord + Clone, V: Clone> IntoIterator for &'a Tracked<K, V> {
    type Item = (&'a K, &'a V);
    type IntoIter = std::collections::btree_map::Iter<'a, K, V>;
    fn into_iter(self) -> Self::IntoIter {
        self.map.iter()
    }
}

impl<K: Ord + Clone, V: Clone> Tracked<K, V> {
    /// Start noting changes (discarding any earlier note).
    pub fn record(&mut self) {
        self.log = Some(Vec::new());
    }

    /// Stop noting changes and hand back the note.
    pub fn take_log(&mut self) -> Log<K, V> {
        self.log.take().unwrap_or_default()
    }

    /// Put the map back as it was before `log` was written.
    pub fn undo(&mut self, log: Log<K, V>) {
        for (k, old) in log.into_iter().rev() {
            self.dirty.insert(k.clone());
            match old {
                Some(v) => {
                    self.map.insert(k, v);
                }
                None => {
                    self.map.remove(&k);
                }
            }
        }
    }

    /// The keys changed since the last call, in order. Empties the set.
    pub fn take_dirty(&mut self) -> BTreeSet<K> {
        std::mem::take(&mut self.dirty)
    }

    fn note(&mut self, k: &K) {
        self.dirty.insert(k.clone());
        if let Some(log) = &mut self.log {
            log.push((k.clone(), self.map.get(k).cloned()));
        }
    }

    pub fn insert(&mut self, k: K, v: V) -> Option<V> {
        self.note(&k);
        self.map.insert(k, v)
    }

    pub fn remove(&mut self, k: &K) -> Option<V> {
        if self.map.contains_key(k) {
            self.note(k);
        }
        self.map.remove(k)
    }

    pub fn get_mut(&mut self, k: &K) -> Option<&mut V> {
        if self.map.contains_key(k) {
            self.note(k);
        }
        self.map.get_mut(k)
    }

    pub fn entry(&mut self, k: K) -> Entry<'_, K, V> {
        Entry { map: self, key: k }
    }

    pub fn retain(&mut self, mut keep: impl FnMut(&K, &V) -> bool) {
        let gone: Vec<K> = self.map.iter().filter(|(k, v)| !keep(k, v)).map(|(k, _)| k.clone()).collect();
        for k in gone {
            self.remove(&k);
        }
    }

    pub fn clear(&mut self) {
        let all: Vec<K> = self.map.keys().cloned().collect();
        for k in all {
            self.remove(&k);
        }
    }

    pub fn extend(&mut self, items: impl IntoIterator<Item = (K, V)>) {
        for (k, v) in items {
            self.insert(k, v);
        }
    }
}

pub struct Entry<'a, K: Ord + Clone, V: Clone> {
    map: &'a mut Tracked<K, V>,
    key: K,
}

impl<'a, K: Ord + Clone, V: Clone + Default> Entry<'a, K, V> {
    pub fn or_default(self) -> &'a mut V {
        self.map.note(&self.key);
        self.map.map.entry(self.key).or_default()
    }
}

/// Contract storage: contract -> key -> value. Changed one slot at a time, so undoing a block that
/// touched three slots of a large contract notes three slots, not the contract.
#[derive(Debug, Default)]
pub struct Storage {
    map: BTreeMap<crate::address::Address, BTreeMap<Vec<u8>, Vec<u8>>>,
    log: Option<StorageLog>,
    dirty: BTreeSet<(crate::address::Address, Vec<u8>)>,
}

pub type StorageLog = Vec<(crate::address::Address, Vec<u8>, Option<Vec<u8>>)>;

impl Clone for Storage {
    fn clone(&self) -> Self {
        Storage { map: self.map.clone(), log: None, dirty: self.dirty.clone() }
    }
}
impl PartialEq for Storage {
    fn eq(&self, other: &Self) -> bool {
        self.map == other.map
    }
}
impl Eq for Storage {}

impl Deref for Storage {
    type Target = BTreeMap<crate::address::Address, BTreeMap<Vec<u8>, Vec<u8>>>;
    fn deref(&self) -> &Self::Target {
        &self.map
    }
}

impl Storage {
    pub fn record(&mut self) {
        self.log = Some(Vec::new());
    }

    pub fn take_log(&mut self) -> StorageLog {
        self.log.take().unwrap_or_default()
    }

    pub fn undo(&mut self, log: StorageLog) {
        for (c, k, old) in log.into_iter().rev() {
            self.put_raw(c, k, old);
        }
    }

    /// The slots changed since the last call. Empties the set.
    pub fn take_dirty(&mut self) -> BTreeSet<(crate::address::Address, Vec<u8>)> {
        std::mem::take(&mut self.dirty)
    }

    fn put_raw(&mut self, c: crate::address::Address, k: Vec<u8>, v: Option<Vec<u8>>) {
        self.dirty.insert((c, k.clone()));
        match v {
            Some(v) => {
                self.map.entry(c).or_default().insert(k, v);
            }
            None => {
                if let Some(m) = self.map.get_mut(&c) {
                    m.remove(&k);
                    if m.is_empty() {
                        self.map.remove(&c);
                    }
                }
            }
        }
    }

    /// Set a slot, or clear it with `None`. A contract with no slots left has no entry at all.
    pub fn put(&mut self, c: crate::address::Address, k: Vec<u8>, v: Option<Vec<u8>>) {
        if let Some(log) = &mut self.log {
            let old = self.map.get(&c).and_then(|m| m.get(&k)).cloned();
            log.push((c, k.clone(), old));
        }
        self.put_raw(c, k, v);
    }
}
