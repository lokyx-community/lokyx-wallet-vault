// Turns what a phone, a network or a contract says into a sentence a person can act on. Our own messages
// (already written for people) pass through untouched; only technical ones are rewritten.

const OFFLINE =
  /UnknownHost|Unable to resolve host|Network request failed|network error|fetch failed|Failed to fetch|ECONN|ENOTFOUND|ETIMEDOUT|timed? ?out|Software caused connection abort|Could not connect|offline/i;

export function plainError(e: unknown, where = "the network"): string {
  const raw = String(
    (e as { shortMessage?: string; message?: string })?.shortMessage ??
      (e as { message?: string })?.message ??
      e ??
      "",
  ).trim();
  if (!raw) return "Something went wrong. Try again.";
  if (OFFLINE.test(raw))
    return `Can't reach ${where} right now. Check your connection and try again.`;
  if (/answered (429|503|502|504)|rate.?limit|too many requests/i.test(raw))
    return `${where.replace(/^./, (c) => c.toUpperCase())} is busy. Wait a moment and try again.`;
  if (/insufficient funds for (gas|intrinsic)|insufficient funds/i.test(raw))
    return "Your everyday address doesn't have enough ETH to pay the network fee.";
  if (/Could not execute ether transfer/i.test(raw))
    return "The vault doesn't hold enough ETH for that. Send some to the vault address first.";
  if (/Could not (execute|pay out) token transfer/i.test(raw))
    return "The vault doesn't hold enough of that coin for that. Send some to the vault address first.";
  if (
    /nonce too low|replacement transaction underpriced|already known/i.test(raw)
  )
    return "The network is still processing your last transaction. Wait a minute and try again.";
  if (/user (rejected|denied|cancel)/i.test(raw)) return "Cancelled.";
  const m = /^(?:execution reverted|reverted)[:\s]*(.*)$/i.exec(raw);
  if (m)
    return m[1]
      ? `The network turned it down: ${m[1].replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())}.`.replace(
          /\.\.$/,
          ".",
        )
      : "The network turned it down.";
  return raw;
}
