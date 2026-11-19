#!/usr/bin/env bash
# Launch a local 3-node LOKYX devnet: two miners and one non-mining node, all peered.
# Usage: scripts/devnet.sh [data_dir]      Stop: scripts/devnet.sh stop [data_dir]
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${2:-${1:-./devnet-data}}"
[ "${1:-}" = "stop" ] && { pkill -f "lokyxd --network devnet --datadir $DIR" || true; exit 0; }

BIN=./target/release
[ -x "$BIN/lokyxd" ] || cargo build --release
mkdir -p "$DIR"
export LOKYX_WALLET_PASSWORD="${LOKYX_WALLET_PASSWORD:-devnet-password}"

for w in miner1 miner2 user; do
  [ -f "$DIR/$w.json" ] || $BIN/lokyx-wallet --wallet "$DIR/$w.json" new > "$DIR/$w.phrase.txt"
done
M1=$($BIN/lokyx-wallet --wallet "$DIR/miner1.json" address)
M2=$($BIN/lokyx-wallet --wallet "$DIR/miner2.json" address)

start() { # name p2p rpc extra...
  local n=$1 p=$2 r=$3; shift 3
  nohup $BIN/lokyxd --network devnet --datadir "$DIR/$n" --p2p-port "$p" --rpc-port "$r" \
    --rpc-cors "${LOKYX_WEB_ORIGIN:-http://localhost:5173}" "$@" > "$DIR/$n.log" 2>&1 &
}
start node1 17701 18701 --mine --coinbase "$M1" --threads 1
start node2 17702 18702 --peer 127.0.0.1:17701 --mine --coinbase "$M2" --threads 1
start node3 17703 18703 --peer 127.0.0.1:17701 --peer 127.0.0.1:17702

echo "devnet starting in $DIR"
echo "  node1 rpc http://127.0.0.1:18701  (mining to $M1)"
echo "  node2 rpc http://127.0.0.1:18702  (mining to $M2)"
echo "  node3 rpc http://127.0.0.1:18703  (validator only)"
echo "logs: $DIR/node*.log"
echo "web app: cd app && npm install && npm run dev"
