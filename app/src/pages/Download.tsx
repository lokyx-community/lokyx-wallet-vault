import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Icon, Spinner } from '../ui';

interface FileInfo {
  platform: string;
  label: string;
  file: string;
  bytes: number;
  sha256: string;
}
interface Manifest {
  version: string;
  released: string;
  files: FileInfo[];
}
interface Apk {
  file: string;
  bytes: number;
  sha256: string;
}

const BASE = './download/';
const mb = (b: number) => `${(b / 1_000_000).toFixed(1)} MB`;

/** Best guess at the visitor's platform, for the big button. */
function guess(): string | null {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad/i.test(ua)) return null;
  if (/Windows/i.test(ua)) return 'windows-x64';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos-arm64';
  if (/Linux/i.test(ua)) return /aarch64|arm64/i.test(ua) ? 'linux-arm64' : 'linux-x64';
  return null;
}

const STEPS: Record<string, string[]> = {
  windows: [
    'Unzip the folder somewhere, for example Documents.',
    'Double-click mine.bat. If Windows says it protected your PC, click More info, then Run anyway. (The program isn\'t code-signed yet.)',
    'The first time, it makes you a wallet. Pick a password and write the 24 words on paper.',
    'Leave the window open. Rewards unlock 60 blocks later, about an hour.',
  ],
  macos: [
    'Open the download and double-click it to unpack it.',
    'Open Terminal, go into the folder, and run: xattr -dr com.apple.quarantine .   (macOS blocks programs from unidentified developers until you do.)',
    'Run ./mine.sh. The first time, it makes you a wallet: pick a password and write the 24 words on paper.',
    'Leave Terminal open. Rewards unlock 60 blocks later, about an hour.',
  ],
  linux: [
    'Unpack it: tar -xzf the file you downloaded, then cd into the folder.',
    'Run ./mine.sh. The first time, it makes you a wallet: pick a password and write the 24 words on paper.',
    'Leave it running. Rewards unlock 60 blocks later, about an hour.',
  ],
};

export default function Download() {
  const [m, setM] = useState<Manifest | null>(null);
  const [apk, setApk] = useState<Apk | null>(null);
  const [missing, setMissing] = useState(false);
  const mine = useMemo(guess, []);

  useEffect(() => {
    fetch(BASE + 'manifest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setM)
      .catch(() => setMissing(true));
    fetch(BASE + 'apk.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setApk)
      .catch(() => {});
  }, []);

  const pick = m?.files.find((f) => f.platform === mine) ?? null;
  const family = (p: string) => p.split('-')[0];
  const installCmd = `curl -fsSL ${location.origin}/install.sh | sh`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Download</h1>
          <p>The LOKYX node and wallet for your computer. Download, unpack, double-click to mine. Nothing to compile.</p>
        </div>
      </div>

      {missing ? (
        <div className="notice" style={{ maxWidth: 660 }}>
          <Icon.network />
          <p>This node doesn't have downloads set up. They're on the public site, testnet.lokyx.xyz.</p>
        </div>
      ) : !m ? (
        <Spinner />
      ) : (
        <div className="stack" style={{ gap: 56 }}>
          {pick && (
            <section className="stack" style={{ gap: 20, maxWidth: 660 }}>
              <div>
                <a className="btn primary lg" href={BASE + pick.file} download>
                  Download for {pick.label}
                </a>
              </div>
              <p className="hint">Version {m.version}, {mb(pick.bytes)}. {pick.platform === 'macos-arm64' && 'Older Intel Mac? Pick it from the list below.'}</p>
              <ol className="steps-list">
                {STEPS[family(pick.platform)].map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </section>
          )}

          <section className="stack" style={{ gap: 16 }}>
            <h2>All downloads</h2>
            <div className="dl-table">
              {m.files.map((f) => (
                <div className="dl-row" key={f.file}>
                  <div style={{ minWidth: 0 }}>
                    <a className="link" href={BASE + f.file} download>{f.label}</a>
                    <p className="faint mono" style={{ margin: '4px 0 0', fontSize: 12, overflowWrap: 'anywhere' }}>sha256 {f.sha256}</p>
                  </div>
                  <span className="muted num">{mb(f.bytes)}</span>
                </div>
              ))}
              <div className="dl-row">
                <div>
                  {apk ? <a className="link" href={BASE + apk.file}>Android phone miner</a> : <span>Android phone miner</span>}
                  <p className="faint" style={{ margin: '4px 0 0', fontSize: 13 }}>{apk ? <Link className="link" to="/phone">How it works</Link> : 'Coming back soon.'}</p>
                </div>
                <span className="muted num">{apk ? mb(apk.bytes) : ''}</span>
              </div>
            </div>
            <p className="hint">Released {m.released}. Every file is listed in <a className="link" href={BASE + 'SHA256SUMS'}>SHA256SUMS</a>, so you can check a download wasn't changed on the way.</p>
          </section>

          <section className="stack" style={{ gap: 12, maxWidth: 660 }}>
            <h2>Linux or Mac, from the terminal</h2>
            <p className="muted">Installs lokyxd, lokyx-wallet and lokyx-mine into ~/.local/bin, after checking the checksum.</p>
            <Copy text={installCmd} />
          </section>

          <section className="stack" style={{ gap: 12, maxWidth: 660 }}>
            <h2>Running a node on a server</h2>
            <p className="muted">Unpack the Linux download, copy the two programs into place, and keep the node running with systemd. It helps the network even without mining.</p>
            <pre className="code">{`sudo cp lokyxd lokyx-wallet /usr/local/bin/
sudo useradd --system --home /var/lib/lokyx --shell /usr/sbin/nologin lokyx
sudo install -d -o lokyx -g lokyx /var/lib/lokyx
sudo tee /etc/systemd/system/lokyxd.service >/dev/null <<'EOF'
[Unit]
Description=LOKYX node
After=network-online.target

[Service]
User=lokyx
ExecStart=/usr/local/bin/lokyxd --network testnet --datadir /var/lib/lokyx/node
Restart=always

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now lokyxd
sudo ufw allow 27701/tcp`}</pre>
            <p className="hint">Add <span className="mono">--mine --coinbase lyx1… --threads 2</span> to the ExecStart line to mine as well.</p>
          </section>
        </div>
      )}
    </>
  );
}
