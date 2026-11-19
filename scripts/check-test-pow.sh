#!/usr/bin/env bash
# Prove that a release build of lokyxd can't contain the cheap test proof of work.
#
#   ./scripts/check-test-pow.sh            check the normal release build
#   ./scripts/check-test-pow.sh BIN...     also check already built binaries
#
# The stand-in is the `test-pow` feature. Only the test suite turns it on, through a
# dev-dependency, and cargo only merges dev-dependency features into test builds. So
# `cargo test --release` leaves a target/release/lokyxd that has it (and refuses to start),
# while `cargo build --release` doesn't. This script checks that, rather than trusting it:
#
#   1. the feature isn't on by default, and nothing outside dev-dependencies turns it on;
#   2. a clean release build of lokyxd doesn't contain the stand-in;
#   3. a build that does contain it gets caught by the same check, and refuses to start
#      (so the check isn't passing because it can't see anything).
#
# Builds go into their own target directory so leftovers from `cargo test` can't mix in.

set -euo pipefail
cd "$(dirname "$0")/.."
MARK='LOKYX/test-pow'   # the domain tag of the stand-in hash; only compiled in with the feature
DIR="${CHECK_TARGET_DIR:-target/check-test-pow}"
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== 1. feature wiring"
python3 - <<'PY' || fail "test-pow is reachable outside tests"
import tomllib
c = tomllib.load(open("Cargo.toml", "rb"))
feats = c.get("features", {})
assert "test-pow" not in feats.get("default", []), "test-pow is a default feature"
for name, deps in feats.items():
    assert name == "test-pow" or "test-pow" not in deps, f"feature {name} turns on test-pow"
for table in ("dependencies", "build-dependencies"):
    for name, d in c.get(table, {}).items():
        if isinstance(d, dict):
            assert "test-pow" not in d.get("features", []), f"{table}.{name} turns on test-pow"
PY
if cargo tree --locked -e normal,build -e features -i lokyx 2>/dev/null | grep -q 'feature "test-pow"'; then
  fail "cargo tree shows test-pow in a normal build"
fi

echo "== 2. release build"
cargo build --release --locked --bin lokyxd --target-dir "$DIR" -q
grep -q -a "$MARK" "$DIR/release/lokyxd" && fail "release lokyxd contains the test stand-in"
for b in "$@"; do
  grep -q -a "$MARK" "$b" && fail "$b contains the test stand-in"
done

echo "== 3. the check can see it"
cargo build --release --locked --bin lokyxd --features test-pow --target-dir "$DIR/with" -q
grep -q -a "$MARK" "$DIR/with/release/lokyxd" || fail "can't detect the stand-in, so step 2 proves nothing"
# The guard runs before anything else in main, even before argument parsing.
if out="$("$DIR/with/release/lokyxd" --help 2>&1)"; then
  fail "a lokyxd with the stand-in started"
fi
grep -q "test-pow" <<<"$out" || fail "lokyxd failed for some other reason: $out"

echo "ok: release lokyxd has no test proof of work"
