#!/bin/sh
# Install the LOKYX node and wallet on Linux or macOS:
#   curl -fsSL https://testnet.lokyx.xyz/install.sh | sh
# Puts lokyxd, lokyx-wallet and lokyx-mine in ~/.local/bin (or $LOKYX_BIN).
set -eu
SITE="${LOKYX_SITE:-https://testnet.lokyx.xyz}"
BIN="${LOKYX_BIN:-$HOME/.local/bin}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) P=linux-x64 ;;
  Linux-aarch64 | Linux-arm64) P=linux-arm64 ;;
  Darwin-arm64) P=macos-arm64 ;;
  Darwin-x86_64) P=macos-x64 ;;
  *) echo "Sorry, there's no LOKYX build for $(uname -s) $(uname -m) yet." >&2; exit 1 ;;
esac

VERSION="$(curl -fsSL "$SITE/download/latest.txt")"
FILE="lokyx-$VERSION-$P.tar.gz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "Downloading LOKYX $VERSION for $P"
curl -fsSL "$SITE/download/$FILE" -o "$TMP/$FILE"
curl -fsSL "$SITE/download/SHA256SUMS" -o "$TMP/SHA256SUMS"
EXPECTED="$(grep " $FILE\$" "$TMP/SHA256SUMS" | cut -d' ' -f1)"
if command -v sha256sum >/dev/null 2>&1; then GOT="$(sha256sum "$TMP/$FILE" | cut -d' ' -f1)"; else GOT="$(shasum -a 256 "$TMP/$FILE" | cut -d' ' -f1)"; fi
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$GOT" ] || { echo "The download doesn't match its checksum. Not installing." >&2; exit 1; }

tar -xzf "$TMP/$FILE" -C "$TMP"
DIR="$TMP/lokyx-$VERSION-$P"
mkdir -p "$BIN"
install -m 0755 "$DIR/lokyxd" "$DIR/lokyx-wallet" "$BIN/"
install -m 0755 "$DIR/mine.sh" "$BIN/lokyx-mine"
[ "$(uname -s)" = Darwin ] && xattr -d com.apple.quarantine "$BIN/lokyxd" "$BIN/lokyx-wallet" 2>/dev/null || true

echo
echo "Installed lokyxd, lokyx-wallet and lokyx-mine in $BIN"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Add it to your PATH first:  export PATH=\"$BIN:\$PATH\"" ;; esac
echo "Start mining:  lokyx-mine"
