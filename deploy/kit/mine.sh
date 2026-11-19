#!/bin/sh
# Mine LOKYX testnet coins on this computer. Makes a wallet first if there isn't one.
set -e
cd "$(dirname "$0")"
NET=testnet
if [ -x ./lokyxd ]; then BIN=.; else BIN="$(dirname "$(command -v lokyxd)")"; fi

ADDR="$("$BIN/lokyx-wallet" --network $NET address 2>/dev/null || true)"
if [ -z "$ADDR" ]; then
  echo
  echo "You don't have a LOKYX wallet on this computer yet, so let's make one."
  echo "It will ask for a password, then show 24 words. Write the words on paper:"
  echo "they are the only way to get your coins back if this computer breaks."
  echo
  "$BIN/lokyx-wallet" --network $NET new
  ADDR="$("$BIN/lokyx-wallet" --network $NET address)"
  printf '\nPress Enter to start mining. '
  read -r _
fi

CORES="$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)"
THREADS="${THREADS:-$((CORES / 2))}"
[ "$THREADS" -ge 1 ] || THREADS=1
echo
echo "Mining to $ADDR with $THREADS threads (set THREADS=n to change)."
echo "The first start takes a minute while it downloads the chain. Ctrl+C stops it."
echo "Watch it at https://testnet.lokyx.xyz/#/mining  Your wallet: run lokyx-wallet"
echo
exec "$BIN/lokyxd" --network $NET --mine --coinbase "$ADDR" --threads "$THREADS" --rpc-cors https://testnet.lokyx.xyz
