// Some libraries ask Node's "crypto" for random bytes. Phones don't have Node, so this hands
// them the phone's own secure random generator instead (set up in index.js).
exports.randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
