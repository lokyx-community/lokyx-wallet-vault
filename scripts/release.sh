#!/usr/bin/env bash
# Build a release: the node and wallet for every platform, the web app, and the server bundle.
#
#   ./scripts/release.sh
#
# Needs Rust, zig and cargo-zigbuild (cargo install cargo-zigbuild), Node 22, and Rust's
# library source (rustup component add rust-src) for the targets rustup has no prebuilt
# library for. Everything ends up in dist/<version>/:
#
#   download/                       what the website offers miners (served at /download)
#   lokyx-server-<version>.tar.gz   copy to a server and run its install.sh

set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(grep -m1 '^version' Cargo.toml | cut -d'"' -f2)"
OUT="dist/$VERSION"
rm -rf "$OUT" && mkdir -p "$OUT/download"

echo "== tests"
cargo test --release --locked -q
if command -v cargo-audit >/dev/null 2>&1; then cargo audit; else echo "(cargo-audit isn't installed, skipping it)"; fi

# platform name, Rust target, needs std built from source
TARGETS=(
  "linux-x64 x86_64-unknown-linux-gnu.2.31 0"
  "linux-arm64 aarch64-unknown-linux-gnu.2.31 1"
  "windows-x64 x86_64-pc-windows-gnu 1"
  "macos-arm64 aarch64-apple-darwin 1"
  "macos-x64 x86_64-apple-darwin 1"
)
# RandomX is C++; on Windows zig's C++ runtime has to be linked in by hand
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS="-C link-arg=-lc++ -C link-arg=-lc++abi"

for t in "${TARGETS[@]}"; do
  read -r NAME TARGET STD <<<"$t"
  echo "== $NAME"
  if [ "$STD" = 1 ]; then
    RUSTC_BOOTSTRAP=1 cargo zigbuild --release --locked --bins --target "$TARGET" -Z build-std=std,panic_abort
  else
    cargo zigbuild --release --locked --bins --target "$TARGET"
  fi
  REL="target/${TARGET%.2.31}/release"
  DIR="$OUT/stage/lokyx-$VERSION-$NAME"
  mkdir -p "$DIR"
  if [ "$NAME" = windows-x64 ]; then
    cp "$REL"/{lokyxd,lokyx-wallet}.exe deploy/kit/mine.bat "$DIR/"
    cp deploy/kit/README-windows.txt "$DIR/README.txt"
    (cd "$OUT/stage" && zip -qr "../download/lokyx-$VERSION-$NAME.zip" "lokyx-$VERSION-$NAME")
  else
    cp "$REL"/{lokyxd,lokyx-wallet} deploy/kit/mine.sh deploy/kit/README.txt "$DIR/"
    tar -C "$OUT/stage" -czf "$OUT/download/lokyx-$VERSION-$NAME.tar.gz" "lokyx-$VERSION-$NAME"
  fi
  case "$NAME" in
    linux-x64) mkdir -p "$OUT/server/bin/x64" && cp "$REL"/{lokyxd,lokyx-wallet,lokyx-faucet} "$OUT/server/bin/x64/" ;;
    linux-arm64) mkdir -p "$OUT/server/bin/arm64" && cp "$REL"/{lokyxd,lokyx-wallet,lokyx-faucet} "$OUT/server/bin/arm64/" ;;
  esac
done

echo "== no test proof of work in any lokyxd"
./scripts/check-test-pow.sh target/*/release/lokyxd target/*/release/lokyxd.exe

echo "== checksums and manifest"
(cd "$OUT/download" && sha256sum lokyx-* > SHA256SUMS)
echo "$VERSION" > "$OUT/download/latest.txt"
cp deploy/kit/get.sh "$OUT/download/install.sh"
python3 - "$OUT/download" "$VERSION" <<'PY'
import json, os, sys, hashlib, datetime
d, v = sys.argv[1], sys.argv[2]
labels = {
  "windows-x64": "Windows (64-bit)", "macos-arm64": "Mac with Apple silicon (M1 and newer)",
  "macos-x64": "Mac with Intel", "linux-x64": "Linux (x86-64)", "linux-arm64": "Linux (ARM64, Raspberry Pi 4/5)",
}
files = []
for p, label in labels.items():
    for ext in (".zip", ".tar.gz"):
        f = f"lokyx-{v}-{p}{ext}"
        path = os.path.join(d, f)
        if os.path.exists(path):
            files.append({"platform": p, "label": label, "file": f, "bytes": os.path.getsize(path),
                          "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest()})
json.dump({"version": v, "released": datetime.date.today().isoformat(), "files": files},
          open(os.path.join(d, "manifest.json"), "w"), indent=1)
PY

echo "== web app"
(cd app && npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null)

echo "== server bundle"
S="$OUT/server"
mkdir -p "$S/web"
cp -r app/dist/. "$S/web/"
cp -r "$OUT/download" "$S/download"
cp deploy/install.sh "$S/install.sh"
echo "$VERSION" > "$S/VERSION"
mv "$S" "$OUT/lokyx-server-$VERSION"
tar -C "$OUT" -czf "$OUT/lokyx-server-$VERSION.tar.gz" "lokyx-server-$VERSION"
rm -rf "$OUT/stage" "$OUT/lokyx-server-$VERSION"
ls -la "$OUT" "$OUT/download"
