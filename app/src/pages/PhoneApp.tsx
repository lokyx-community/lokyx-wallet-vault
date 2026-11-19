import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { Link } from 'react-router-dom';
import { Icon } from '../ui';

/** Always the newest APK, served by this site. */
const APK = './download/lokyx-miner.apk';

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }, [text]);
  return <div className="qr" aria-label={`QR code for ${text}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

const shots: [string, string, string][] = [
  ['mining', 'Mining', 'Hash rate in the middle, charging and temperature below.'],
  ['waiting', 'Between blocks', 'The ring fills in while the next block opens.'],
  ['paused', 'Paused', 'It says why, and what to do about it.'],
  ['rewards', 'Rewards', 'Every block found and when it unlocks.'],
];

export default function PhoneApp() {
  const short = `${location.origin}/app`;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mine on your phone</h1>
          <p>The LOKYX Miner app for Android mines while your phone charges, pauses when it gets warm, and pays every block it finds to your address.</p>
        </div>
      </div>

      <div className="phone-hero">
        <div className="stack" style={{ gap: 24 }}>
          <div className="inline">
            <a className="btn primary lg" href={APK}>Download for Android</a>
            <Link className="btn lg" to="/download">Computer downloads</Link>
          </div>
          <p className="hint">Android 8 or newer, 64-bit. It's a direct download: Google Play doesn't allow mining apps. Play Protect may warn you about that; tap More details, then Install anyway.</p>
          <div className="qr-row desktop-only">
            <Qr text={short} />
            <p className="muted">On a computer? Scan this with your phone, or open <span className="mono">{short.replace(/^https?:\/\//, '')}</span> on it.</p>
          </div>
        </div>
        <img className="phone-shot" src="./phone/mining.jpg" alt="The Mine screen of the app, showing the hash rate inside a ring of dots" width={420} height={853} />
      </div>

      <section className="section">
        <div className="section-head"><h2>How it works</h2></div>
        <ol className="how">
          <li><strong>The phone asks for work.</strong> A LOKYX node sends it the next block to work on.</li>
          <li><strong>It tries numbers.</strong> Each try is one RandomX hash. A phone does tens to a few hundred a second.</li>
          <li><strong>A hit goes back.</strong> When one meets the difficulty, the node checks it like any other block.</li>
          <li><strong>You get 10 LYX.</strong> It unlocks 60 blocks later, about an hour, and then it's yours to spend.</li>
        </ol>
        <p className="hint" style={{ marginTop: 16 }}>After every block nobody can mine for 50 seconds, so the app waits and shows a countdown instead.</p>
      </section>

      <section className="section">
        <div className="section-head"><h2>It looks after your phone</h2></div>
        <div className="care-grid">
          <div><Icon.plug /><h3>Only while charging</h3><p className="muted">Unplug and it pauses. You can change that in Settings.</p></div>
          <div><Icon.alert /><h3>Stops when warm</h3><p className="muted">At 40° battery temperature by default. It starts again 3° cooler.</p></div>
          <div><Icon.security /><h3>No keys</h3><p className="muted">It only knows your address. It can't spend anything.</p></div>
        </div>
      </section>

      <section className="section">
        <div className="shots">
          {shots.map(([f, t, d]) => (
            <figure key={f}>
              <img src={`./phone/${f}.jpg`} alt={`${t} screen`} width={420} height={853} loading="lazy" />
              <figcaption><strong>{t}</strong> {d}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="section" style={{ maxWidth: '44em' }}>
        <div className="section-head"><h2>Installing</h2></div>
        <ol className="how">
          <li>Tap <strong>Download for Android</strong> on your phone.</li>
          <li>Open the file. Allow installs from your browser when Android asks.</li>
          <li>Paste your <span className="mono">lyx1</span> address. No address yet? Make one on the Wallet page.</li>
          <li>Tap <strong>Start mining</strong> and plug in the charger.</li>
        </ol>
        <p className="hint" style={{ marginTop: 16 }}>Testnet only for now. Coins mined here have no value. The app is open source.</p>
      </section>
    </>
  );
}
