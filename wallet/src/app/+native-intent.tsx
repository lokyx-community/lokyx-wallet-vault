// lokyx:lyx1…?amount=2 links (from other apps or a QR code) open the send screen.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    const cap = path.match(/capsule[/=:](lyx1[02-9ac-hj-np-z]{20,90})/i);
    if (cap) return `/capsule/${cap[1].toLowerCase()}`;
    const m = path.match(/(lyx1[02-9ac-hj-np-z]{20,90})(?:\?(.*))?$/i);
    if (m) {
      const q = new URLSearchParams(m[2] ?? '');
      const amount = q.get('amount');
      return `/send?to=${m[1].toLowerCase()}${amount ? `&amount=${encodeURIComponent(amount)}` : ''}`;
    }
  } catch {
    /* fall through */
  }
  return path;
}
