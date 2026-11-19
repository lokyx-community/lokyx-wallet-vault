//! Block storage on disk (redb): the best chain, plus side-chain blocks close enough to the tip
//! to matter. Side branches that fall too far behind are deleted (see `Chain::prune`).

use crate::block::{Block, BlockHeader};
use crate::contract::Receipt;
use crate::crypto::Hash;
use anyhow::Result;
use redb::{Database, ReadableTable, TableDefinition};
use std::path::Path;

const BLOCKS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("blocks");
/// Small named values. "tip": the hash of our best chain's tip, so a restart picks the same chain
/// when two branches have equal work (the first one seen wins, and a restart must not change that).
const META: TableDefinition<&str, &[u8]> = TableDefinition::new("meta");

/// Receipts of contract transactions on the best chain, by transaction hash.
const RECEIPTS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("receipts");

pub struct Store {
    db: Database,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let db = Database::create(path)?;
        let w = db.begin_write()?;
        w.open_table(BLOCKS)?;
        w.open_table(META)?;
        w.open_table(RECEIPTS)?;
        w.commit()?;
        Ok(Store { db })
    }

    pub fn put_block(&self, hash: &Hash, block: &Block) -> Result<()> {
        let w = self.db.begin_write()?;
        {
            let mut t = w.open_table(BLOCKS)?;
            t.insert(&hash[..], &block.to_bytes()[..])?;
        }
        w.commit()?;
        Ok(())
    }

    /// Forget a block (a pruned side branch, or one found invalid).
    pub fn delete_block(&self, hash: &Hash) -> Result<()> {
        self.delete_blocks(std::slice::from_ref(hash))
    }

    /// Forget many blocks in one write.
    pub fn delete_blocks(&self, hashes: &[Hash]) -> Result<()> {
        let w = self.db.begin_write()?;
        {
            let mut t = w.open_table(BLOCKS)?;
            for h in hashes {
                t.remove(&h[..])?;
            }
        }
        w.commit()?;
        Ok(())
    }

    pub fn set_tip(&self, hash: &Hash) -> Result<()> {
        let w = self.db.begin_write()?;
        {
            let mut t = w.open_table(META)?;
            t.insert("tip", &hash[..])?;
        }
        w.commit()?;
        Ok(())
    }

    /// The tip recorded by `set_tip`, if any (databases from before v6 have none).
    pub fn tip(&self) -> Result<Option<Hash>> {
        let r = self.db.begin_read()?;
        let t = r.open_table(META)?;
        Ok(t.get("tip")?.and_then(|v| v.value().try_into().ok()))
    }

    /// All stored blocks, sorted by height (parents always precede children).
    pub fn load_all(&self) -> Result<Vec<Block>> {
        let r = self.db.begin_read()?;
        let t = r.open_table(BLOCKS)?;
        let mut out = Vec::new();
        for item in t.iter()? {
            let (_, v) = item?;
            out.push(Block::from_bytes(v.value()).map_err(anyhow::Error::msg)?);
        }
        out.sort_by_key(|b| b.header.height);
        Ok(out)
    }

    /// One stored block.
    pub fn get_block(&self, hash: &Hash) -> Result<Option<Block>> {
        let r = self.db.begin_read()?;
        let t = r.open_table(BLOCKS)?;
        match t.get(&hash[..])? {
            Some(v) => Ok(Some(Block::from_bytes(v.value()).map_err(anyhow::Error::msg)?)),
            None => Ok(None),
        }
    }

    /// Every stored header, in no particular order. Reads the whole table once, keeping only the
    /// headers, so the bodies never sit in memory together.
    pub fn headers(&self) -> Result<Vec<BlockHeader>> {
        let r = self.db.begin_read()?;
        let t = r.open_table(BLOCKS)?;
        let mut out = Vec::new();
        for item in t.iter()? {
            let (_, v) = item?;
            out.push(Block::from_bytes(v.value()).map_err(anyhow::Error::msg)?.header);
        }
        Ok(out)
    }

    /// A small named value (the address tables, the anchors), replacing the previous one.
    pub fn put_meta(&self, name: &str, value: &[u8]) -> Result<()> {
        let w = self.db.begin_write()?;
        {
            let mut t = w.open_table(META)?;
            t.insert(name, value)?;
        }
        w.commit()?;
        Ok(())
    }

    pub fn meta(&self, name: &str) -> Result<Option<Vec<u8>>> {
        let r = self.db.begin_read()?;
        let t = r.open_table(META)?;
        Ok(t.get(name)?.map(|v| v.value().to_vec()))
    }

    /// Keep a copy of the state as of block `hash` at `height`, replacing the previous one. The
    /// node starts from it instead of replaying the whole chain.
    pub fn put_state(&self, height: u64, hash: &Hash, state: &crate::state::State) -> Result<()> {
        let mut v = Vec::new();
        v.extend_from_slice(&height.to_le_bytes());
        v.extend_from_slice(hash);
        v.extend_from_slice(&state.to_bytes());
        let w = self.db.begin_write()?;
        {
            let mut t = w.open_table(META)?;
            t.insert("state", &v[..])?;
        }
        w.commit()?;
        Ok(())
    }

    /// The state kept by `put_state`: (height, block hash, state). None if there isn't one or it
    /// can't be read.
    pub fn state(&self) -> Result<Option<(u64, Hash, crate::state::State)>> {
        let r = self.db.begin_read()?;
        let t = r.open_table(META)?;
        let Some(v) = t.get("state")? else { return Ok(None) };
        let v = v.value();
        if v.len() < 40 {
            return Ok(None);
        }
        let height = u64::from_le_bytes(v[..8].try_into().expect("8"));
        let hash: Hash = v[8..40].try_into().expect("32");
        Ok(crate::state::State::from_bytes(&v[40..]).ok().map(|s| (height, hash, s)))
    }

    pub fn put_receipts(&self, rs: &[(Hash, Receipt)]) -> Result<()> {
        if rs.is_empty() {
            return Ok(());
        }
        let w = self.db.begin_write()?;
        {
            let mut t = w.open_table(RECEIPTS)?;
            for (h, r) in rs {
                t.insert(&h[..], &borsh::to_vec(r)?[..])?;
            }
        }
        w.commit()?;
        Ok(())
    }

    pub fn delete_receipts(&self, hashes: &[Hash]) -> Result<()> {
        if hashes.is_empty() {
            return Ok(());
        }
        let w = self.db.begin_write()?;
        {
            let mut t = w.open_table(RECEIPTS)?;
            for h in hashes {
                t.remove(&h[..])?;
            }
        }
        w.commit()?;
        Ok(())
    }

    pub fn receipts(&self) -> Result<Vec<(Hash, Receipt)>> {
        let r = self.db.begin_read()?;
        let t = r.open_table(RECEIPTS)?;
        let mut out = Vec::new();
        for item in t.iter()? {
            let (k, v) = item?;
            let (Ok(h), Ok(rc)) = (<Hash>::try_from(k.value()), borsh::from_slice::<Receipt>(v.value())) else {
                continue;
            };
            out.push((h, rc));
        }
        Ok(out)
    }
}
