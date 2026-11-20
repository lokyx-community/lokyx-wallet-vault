// Phone push for shared accounts. Pure code, used by watchtower/server.mjs and the app, tested in test/push-core.test.ts.
// What goes out says only that something is waiting. No amount, no name, no address: the phone opens the sealed message itself.

export const PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const MAX_PUSH_PER_TOPIC = 10;
export const PUSH_KEEP_MS = 60 * 24 * 3600 * 1000;
export const PUSH_TEXT = { title: 'LOKYX', body: 'A payment is waiting for your approval' };

const TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,80}\]$/;
export const pushTokenOk = (t: unknown): t is string => typeof t === 'string' && TOKEN_RE.test(t);

/** The messages to hand to Expo for one new item on a topic: every registered phone except the one that sent it. */
export function pushMessages(tokens: readonly string[], topic: string, skip?: string) {
  return tokens
    .filter((t) => t !== skip)
    .map((to) => ({ to, title: PUSH_TEXT.title, body: PUSH_TEXT.body, sound: 'default', priority: 'high', channelId: 'shared', data: { topic } }));
}

/** Tokens Expo says no longer exist (app removed, reinstalled). `sent` is the list in the same order as the answer's data. */
export function deadTokens(sent: readonly string[], answer: unknown): string[] {
  const data = (answer as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return sent.filter((_, i) => {
    const d = data[i] as { status?: string; details?: { error?: string } } | undefined;
    return d?.status === 'error' && d.details?.error === 'DeviceNotRegistered';
  });
}
