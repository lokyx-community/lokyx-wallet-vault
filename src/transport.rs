//! The encrypted transport of protocol 8: a Noise XX handshake, then length-framed ciphertext.
//!
//! A connection opens with 8 clear bytes, `LYX8` and the protocol version. After that every byte is
//! Noise: the
//! handshake (`Noise_XX_25519_ChaChaPoly_BLAKE2s`) and then messages of at most 65,519 plaintext
//! bytes, each sent as a 2-byte length and a ciphertext. The prologue binds the handshake to this
//! protocol, the chain id and the genesis hash, so a handshake between two networks fails before
//! anything is read.
//!
//! XX shows both sides' static keys during the handshake. That alone stops anyone watching or
//! rewriting plaintext; it doesn't stop a man in the middle between two strangers. Where we know
//! the key we expect (the seed nodes), `connect` takes it and hangs up before revealing ours.

use crate::crypto::Hash;
use anyhow::{Context, Result, anyhow, bail};
use snow::{Builder, StatelessTransportState};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::time::timeout;

/// First four bytes of every protocol 8 connection.
pub const MAGIC: [u8; 4] = *b"LYX8";
pub const VERSION: u32 = crate::params::PROTOCOL_VERSION;
const PATTERN: &str = "Noise_XX_25519_ChaChaPoly_BLAKE2s";
/// Plaintext bytes in one Noise message: the 65,535-byte limit less the 16-byte tag.
pub const CHUNK: usize = 65_519;
/// Largest application frame.
pub const MAX_FRAME: usize = 8 * 1024 * 1024;
/// The whole handshake, preamble included, has this long.
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// A handshake message is a few hundred bytes at most; anything bigger is not one.
const MAX_HANDSHAKE_MSG: usize = 1024;

/// What binds a handshake to one network.
#[derive(Clone, Copy, Debug)]
pub struct NetId {
    pub chain_id: u64,
    pub genesis: Hash,
}

impl NetId {
    fn prologue(&self) -> Vec<u8> {
        let mut p = b"LOKYX/p2p/8".to_vec();
        p.extend_from_slice(&self.chain_id.to_be_bytes());
        p.extend_from_slice(&self.genesis);
        p
    }
}

/// The key a peer showed in the handshake is not the one expected for its address. The dialer
/// hung up before sending anything of its own.
#[derive(Debug)]
pub struct KeyMismatch(pub [u8; 32]);

impl std::fmt::Display for KeyMismatch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "the peer's key {} is not the one expected for this address", hex::encode(self.0))
    }
}

impl std::error::Error for KeyMismatch {}

/// A node's identity: a static X25519 key, and a secret for its address tables. Not related to any
/// wallet key.
#[derive(Clone)]
pub struct NodeKey {
    private: [u8; 32],
    pub public: [u8; 32],
    pub table_secret: [u8; 32],
}

impl std::fmt::Debug for NodeKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "NodeKey({})", hex::encode(self.public))
    }
}

impl NodeKey {
    pub fn generate() -> NodeKey {
        let kp = Builder::new(PATTERN.parse().expect("pattern")).generate_keypair().expect("keypair");
        NodeKey {
            private: kp.private.try_into().expect("32 bytes"),
            public: kp.public.try_into().expect("32 bytes"),
            table_secret: rand::random(),
        }
    }

    fn to_bytes(&self) -> [u8; 96] {
        let mut b = [0u8; 96];
        b[..32].copy_from_slice(&self.private);
        b[32..64].copy_from_slice(&self.public);
        b[64..].copy_from_slice(&self.table_secret);
        b
    }

    fn from_bytes(b: &[u8]) -> Option<NodeKey> {
        if b.len() != 96 {
            return None;
        }
        let k = NodeKey {
            private: b[..32].try_into().ok()?,
            public: b[32..64].try_into().ok()?,
            table_secret: b[64..].try_into().ok()?,
        };
        // The public half has to be the one this private key makes: a file edited by hand, or half
        // overwritten, must not produce a node that handshakes with a key it can't prove.
        (derive_public(&k.private)? == k.public).then_some(k)
    }

    /// Read the key at `path`, or make a new one. A file that can't be read as a key is kept as
    /// `<path>.bad` and replaced, with a warning: refusing to start would turn a damaged file into
    /// an outage, and the node's identity is not worth that. (A seed whose key people have pinned
    /// should keep a backup of this file.)
    pub fn load_or_create(path: &Path) -> Result<NodeKey> {
        match std::fs::read(path) {
            Ok(b) => {
                if let Some(k) = NodeKey::from_bytes(&b) {
                    return Ok(k);
                }
                let bad = path.with_extension("key.bad");
                tracing::warn!(
                    "{} isn't a valid node key; moving it to {} and making a new one",
                    path.display(),
                    bad.display()
                );
                std::fs::rename(path, &bad).with_context(|| format!("moving {}", path.display()))?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                tracing::warn!("can't read {}: {e}; making a new node key", path.display());
            }
        }
        let k = NodeKey::generate();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        write_private(path, &k.to_bytes()).with_context(|| format!("writing {}", path.display()))?;
        tracing::info!("made a new node key {}", hex::encode(k.public));
        Ok(k)
    }
}

/// X25519 public key of a private key, through the Noise library's own key handling.
fn derive_public(private: &[u8; 32]) -> Option<[u8; 32]> {
    // The library has no call for this, so run a throwaway XX handshake against a random peer
    // and read our static key back from the responder's side.
    let net = [0u8; 8];
    let mk = |init: bool| -> Option<snow::HandshakeState> {
        let b = Builder::new(PATTERN.parse().ok()?).prologue(&net).ok()?;
        let peer = Builder::new(PATTERN.parse().ok()?).generate_keypair().ok()?;
        if init {
            b.local_private_key(private).ok()?.build_initiator().ok()
        } else {
            b.local_private_key(&peer.private).ok()?.build_responder().ok()
        }
    };
    let (mut i, mut r) = (mk(true)?, mk(false)?);
    let mut a = [0u8; 1024];
    let mut b = [0u8; 1024];
    let n = i.write_message(&[], &mut a).ok()?;
    r.read_message(&a[..n], &mut b).ok()?;
    let n = r.write_message(&[], &mut a).ok()?;
    i.read_message(&a[..n], &mut b).ok()?;
    let n = i.write_message(&[], &mut a).ok()?;
    r.read_message(&a[..n], &mut b).ok()?;
    r.get_remote_static()?.try_into().ok()
}

#[cfg(unix)]
fn write_private(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)?;
    f.write_all(data)
}

#[cfg(not(unix))]
fn write_private(path: &Path, data: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, data)
}

/// An established, encrypted connection.
pub struct Secure<S> {
    pub reader: SecureReader<ReadHalf<S>>,
    pub writer: SecureWriter<WriteHalf<S>>,
    /// The other side's static key, proven by the handshake.
    pub remote: [u8; 32],
}

async fn write_hs<W: AsyncWrite + Unpin>(w: &mut W, msg: &[u8]) -> Result<()> {
    w.write_u16(msg.len() as u16).await?;
    w.write_all(msg).await?;
    w.flush().await?;
    Ok(())
}

async fn read_hs<R: AsyncRead + Unpin>(r: &mut R) -> Result<Vec<u8>> {
    let len = r.read_u16().await? as usize;
    if len > MAX_HANDSHAKE_MSG {
        bail!("handshake message too large");
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).await?;
    Ok(buf)
}

fn builder<'a>(key: &'a NodeKey, prologue: &'a [u8]) -> Result<Builder<'a>> {
    Builder::new(PATTERN.parse().map_err(|e| anyhow!("{e}"))?)
        .local_private_key(&key.private)
        .and_then(|b| b.prologue(prologue))
        .map_err(|e| anyhow!("{e}"))
}

fn finish<S: AsyncRead + AsyncWrite>(stream: S, hs: snow::HandshakeState) -> Result<Secure<S>> {
    let remote: [u8; 32] = hs
        .get_remote_static()
        .ok_or_else(|| anyhow!("no static key from peer"))?
        .try_into()
        .map_err(|_| anyhow!("bad static key"))?;
    let st = Arc::new(hs.into_stateless_transport_mode().map_err(|e| anyhow!("{e}"))?);
    let (r, w) = tokio::io::split(stream);
    Ok(Secure {
        reader: SecureReader { rd: r, st: st.clone(), nonce: 0 },
        writer: SecureWriter { wr: w, st, nonce: 0 },
        remote,
    })
}

/// Dial side. `expect`: the keys this address may have (none: no expectation); any other ends the
/// handshake before we send ours.
pub async fn connect<S: AsyncRead + AsyncWrite + Unpin>(
    mut stream: S,
    key: &NodeKey,
    net: &NetId,
    expect: &[[u8; 32]],
) -> Result<Secure<S>> {
    let run = async {
        let mut pre = [0u8; 8];
        pre[..4].copy_from_slice(&MAGIC);
        pre[4..].copy_from_slice(&VERSION.to_be_bytes());
        stream.write_all(&pre).await?;

        let pro = net.prologue();
        let mut hs = builder(key, &pro)?.build_initiator().map_err(|e| anyhow!("{e}"))?;
        let mut out = [0u8; MAX_HANDSHAKE_MSG];
        let mut scratch = [0u8; MAX_HANDSHAKE_MSG];
        let n = hs.write_message(&[], &mut out).map_err(|e| anyhow!("{e}"))?; // -> e
        write_hs(&mut stream, &out[..n]).await?;

        let m2 = read_hs(&mut stream).await.context("the peer closed during the handshake")?;
        hs.read_message(&m2, &mut scratch).map_err(|e| anyhow!("handshake failed: {e}"))?; // <- e, ee, s, es
        if !expect.is_empty() {
            let got = hs.get_remote_static().ok_or_else(|| anyhow!("no static key from peer"))?;
            if !expect.iter().any(|k| k[..] == *got) {
                return Err(KeyMismatch(got.try_into().expect("32 bytes")).into());
            }
        }
        let n = hs.write_message(&[], &mut out).map_err(|e| anyhow!("{e}"))?; // -> s, se
        write_hs(&mut stream, &out[..n]).await?;
        Ok::<_, anyhow::Error>(hs)
    };
    let hs = timeout(HANDSHAKE_TIMEOUT, run).await.map_err(|_| anyhow!("handshake timed out"))??;
    finish(stream, hs)
}

/// Listen side.
pub async fn accept<S: AsyncRead + AsyncWrite + Unpin>(mut stream: S, key: &NodeKey, net: &NetId) -> Result<Secure<S>> {
    let run = async {
        let mut magic = [0u8; 4];
        stream.read_exact(&mut magic).await?;
        if magic != MAGIC {
            bail!("not a LOKYX protocol {VERSION} connection");
        }
        let v = stream.read_u32().await?;
        if v != VERSION {
            bail!("protocol {v} is not supported (this is {VERSION})");
        }
        let pro = net.prologue();
        let mut hs = builder(key, &pro)?.build_responder().map_err(|e| anyhow!("{e}"))?;
        let mut out = [0u8; MAX_HANDSHAKE_MSG];
        let mut scratch = [0u8; MAX_HANDSHAKE_MSG];
        let m1 = read_hs(&mut stream).await?;
        hs.read_message(&m1, &mut scratch).map_err(|e| anyhow!("handshake failed: {e}"))?; // -> e
        let n = hs.write_message(&[], &mut out).map_err(|e| anyhow!("{e}"))?; // <- e, ee, s, es
        write_hs(&mut stream, &out[..n]).await?;
        let m3 = read_hs(&mut stream).await?;
        hs.read_message(&m3, &mut scratch).map_err(|e| anyhow!("handshake failed: {e}"))?; // -> s, se
        Ok::<_, anyhow::Error>(hs)
    };
    let hs = timeout(HANDSHAKE_TIMEOUT, run).await.map_err(|_| anyhow!("handshake timed out"))??;
    finish(stream, hs)
}

pub struct SecureReader<R> {
    rd: R,
    st: Arc<StatelessTransportState>,
    nonce: u64,
}

pub struct SecureWriter<W> {
    wr: W,
    st: Arc<StatelessTransportState>,
    nonce: u64,
}

impl<R: AsyncRead + Unpin> SecureReader<R> {
    /// The next application frame. Ends in an error on anything that doesn't decrypt, on a frame
    /// declared larger than `MAX_FRAME`, and on a chunk that makes no progress.
    pub async fn read_frame(&mut self) -> Result<Vec<u8>> {
        let mut plain: Vec<u8> = Vec::new();
        let mut chunk = vec![0u8; CHUNK + 16];
        loop {
            let len = self.rd.read_u16().await? as usize;
            if len < 17 {
                // Smaller than a tag plus a byte: an empty chunk would let a peer hold us forever.
                bail!("malformed chunk");
            }
            let mut ct = vec![0u8; len];
            self.rd.read_exact(&mut ct).await?;
            let n = self.st.read_message(self.nonce, &ct, &mut chunk).map_err(|_| anyhow!("decryption failed"))?;
            self.nonce = self.nonce.checked_add(1).ok_or_else(|| anyhow!("nonce exhausted"))?;
            plain.extend_from_slice(&chunk[..n]);
            if plain.len() >= 4 {
                let total = u32::from_be_bytes(plain[..4].try_into().expect("4")) as usize;
                if total > MAX_FRAME {
                    bail!("frame too large ({total} bytes)");
                }
                match plain.len().cmp(&(4 + total)) {
                    std::cmp::Ordering::Equal => return Ok(plain.split_off(4)),
                    std::cmp::Ordering::Greater => bail!("data past the end of a frame"),
                    std::cmp::Ordering::Less => {}
                }
            }
        }
    }
}

impl<W: AsyncWrite + Unpin> SecureWriter<W> {
    pub async fn write_frame(&mut self, data: &[u8]) -> Result<()> {
        if data.len() > MAX_FRAME {
            bail!("refusing to send oversized frame");
        }
        let mut plain = Vec::with_capacity(4 + data.len());
        plain.extend_from_slice(&(data.len() as u32).to_be_bytes());
        plain.extend_from_slice(data);
        for piece in plain.chunks(CHUNK) {
            let wire = self.encrypt_chunk(piece)?;
            self.wr.write_all(&wire).await?;
        }
        self.wr.flush().await?;
        Ok(())
    }

    /// One Noise message as it goes on the wire: a 2-byte length, then the ciphertext.
    fn encrypt_chunk(&mut self, piece: &[u8]) -> Result<Vec<u8>> {
        let mut out = vec![0u8; piece.len() + 16];
        let n = self.st.write_message(self.nonce, piece, &mut out).map_err(|e| anyhow!("encryption failed: {e}"))?;
        self.nonce = self.nonce.checked_add(1).ok_or_else(|| anyhow!("nonce exhausted"))?;
        let mut wire = Vec::with_capacity(2 + n);
        wire.extend_from_slice(&(n as u16).to_be_bytes());
        wire.extend_from_slice(&out[..n]);
        Ok(wire)
    }
}

#[cfg(test)]
mod tests {
    //! The reader's defences against a peer that speaks Noise correctly and framing badly. These
    //! need the private parts, so they live here; the handshake and the node-level behaviour are in
    //! tests/transport.rs.
    use super::*;
    use tokio::io::DuplexStream;

    fn net() -> NetId {
        NetId { chain_id: 1, genesis: [7; 32] }
    }

    async fn pair() -> (Secure<DuplexStream>, Secure<DuplexStream>) {
        let (a, b) = tokio::io::duplex(1 << 16);
        let (ka, kb) = (NodeKey::generate(), NodeKey::generate());
        let n = net();
        let (c, s) = tokio::join!(connect(a, &ka, &n, &[]), accept(b, &kb, &n));
        let s = s.unwrap();
        (c.unwrap(), s)
    }

    async fn read_err(r: &mut SecureReader<ReadHalf<DuplexStream>>) -> String {
        match timeout(Duration::from_secs(2), r.read_frame()).await {
            Ok(Ok(f)) => panic!("accepted a frame of {} bytes", f.len()),
            Ok(Err(e)) => e.to_string(),
            Err(_) => panic!("the reader sat waiting instead of refusing"),
        }
    }

    #[tokio::test]
    async fn a_frame_declared_larger_than_the_limit_is_refused_unread() {
        let (mut c, mut s) = pair().await;
        let mut plain = ((MAX_FRAME + 1) as u32).to_be_bytes().to_vec();
        plain.extend_from_slice(&[0u8; 10]);
        let wire = c.writer.encrypt_chunk(&plain).unwrap();
        c.writer.wr.write_all(&wire).await.unwrap();
        assert!(read_err(&mut s.reader).await.contains("too large"));
    }

    #[tokio::test]
    async fn an_empty_chunk_is_refused_not_waited_on() {
        let (mut c, mut s) = pair().await;
        let wire = c.writer.encrypt_chunk(&[]).unwrap();
        c.writer.wr.write_all(&wire).await.unwrap();
        assert!(read_err(&mut s.reader).await.contains("malformed"));
    }

    #[tokio::test]
    async fn bytes_past_the_end_of_a_frame_are_refused() {
        let (mut c, mut s) = pair().await;
        let mut plain = 2u32.to_be_bytes().to_vec();
        plain.extend_from_slice(&[1u8; 10]); // says 2 bytes, brings 10
        let wire = c.writer.encrypt_chunk(&plain).unwrap();
        c.writer.wr.write_all(&wire).await.unwrap();
        assert!(read_err(&mut s.reader).await.contains("past the end"));
    }

    #[tokio::test]
    async fn a_replayed_chunk_does_not_decrypt() {
        let (mut c, mut s) = pair().await;
        let mut plain = 3u32.to_be_bytes().to_vec();
        plain.extend_from_slice(b"abc");
        let wire = c.writer.encrypt_chunk(&plain).unwrap();
        c.writer.wr.write_all(&wire).await.unwrap();
        assert_eq!(s.reader.read_frame().await.unwrap(), b"abc");
        // The same bytes again: the reader expects the next nonce.
        c.writer.wr.write_all(&wire).await.unwrap();
        assert!(read_err(&mut s.reader).await.contains("decryption failed"));
    }

    #[tokio::test]
    async fn chunks_cannot_be_reordered() {
        let (mut c, mut s) = pair().await;
        let mut one = 1u32.to_be_bytes().to_vec();
        one.push(b'1');
        let first = c.writer.encrypt_chunk(&one).unwrap();
        let second = c.writer.encrypt_chunk(&one).unwrap();
        c.writer.wr.write_all(&second).await.unwrap();
        c.writer.wr.write_all(&first).await.unwrap();
        assert!(read_err(&mut s.reader).await.contains("decryption failed"));
    }

    #[test]
    fn a_key_file_survives_a_round_trip_and_rejects_a_forged_public_half() {
        let k = NodeKey::generate();
        let back = NodeKey::from_bytes(&k.to_bytes()).unwrap();
        assert_eq!(back.public, k.public);
        let mut forged = k.to_bytes();
        forged[32] ^= 1;
        assert!(NodeKey::from_bytes(&forged).is_none());
        assert!(NodeKey::from_bytes(&forged[..95]).is_none());
    }
}
