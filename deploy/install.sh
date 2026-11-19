#!/usr/bin/env bash
# Set up or update a LOKYX testnet server on Ubuntu 20.04 or newer (or Debian 11+).
#
# Copy the server bundle to the server, unpack it and run this from inside it:
#   tar -xzf lokyx-server-<version>.tar.gz && cd lokyx-server-<version>
#   sudo DOMAIN=testnet.example.org ./install.sh
#
# What it sets up (each part can be switched off):
#   lokyxd         public testnet node + seed, P2P on 27701, RPC only on localhost
#   miner          mines to the faucet wallet so the faucet has coins (MINE_THREADS=0 to skip)
#   lokyx-faucet   hands out test LYX                                (FAUCET=0 to skip)
#   web app        wallet + explorer at https://$DOMAIN              (WEB=0 to skip)
#   downloads      the node and wallet for Windows, macOS and Linux at https://$DOMAIN/download
#   Caddy          HTTPS, serves the app and downloads, proxies /rpc and /faucet
#
# A bare seed node (no web, no faucet, no mining):
#   sudo WEB=0 FAUCET=0 MINE_THREADS=0 EXTRA_PEERS="--peer testnet.example.org:27701" ./install.sh
#
# Other options:
#   RESET=1                  wipe the chain (after a testnet reset). Wallets and node.key are kept.
#   APK=/path/to/miner.apk   publish the Android miner at https://$DOMAIN/app
#
# Re-running is safe: it reinstalls and restarts, and keeps existing data and wallets.

set -euo pipefail

DOMAIN="${DOMAIN:-}"
WEB="${WEB:-1}"
FAUCET="${FAUCET:-1}"
MINE_THREADS="${MINE_THREADS:-1}"
FAUCET_AMOUNT="${FAUCET_AMOUNT:-5}"
RESET="${RESET:-0}"
APK="${APK:-}"
P2P_PORT=27701
RPC_PORT=28701
FAUCET_PORT=8701

HERE="$(cd "$(dirname "$0")" && pwd)"
DATA=/var/lib/lokyx
ETC=/etc/lokyx
WWW=/var/www/lokyx
DL=/var/www/lokyx-download

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"
[ -f "$HERE/VERSION" ] || die "run this from inside the unpacked server bundle"
VERSION="$(cat "$HERE/VERSION")"
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) die "no build for $(uname -m)" ;;
esac
[ -x "$HERE/bin/$ARCH/lokyxd" ] || die "this bundle has no $ARCH build"
if [ "$WEB" = 1 ] || [ "$FAUCET" = 1 ]; then
  [ -n "$DOMAIN" ] || die "set DOMAIN to the hostname that points at this server, e.g. DOMAIN=testnet.example.org"
fi
[ -z "$APK" ] || [ -f "$APK" ] || die "APK file $APK not found"

say "Installing LOKYX $VERSION"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates ufw debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null

if [ "$WEB" = 1 ] && ! command -v caddy >/dev/null 2>&1; then
  say "Installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

# stop first so the binaries can be replaced
systemctl stop lokyx-faucet 2>/dev/null || true
systemctl stop lokyxd 2>/dev/null || true
install -m 0755 "$HERE"/bin/$ARCH/{lokyxd,lokyx-wallet,lokyx-faucet} /usr/local/bin/

id lokyx >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin lokyx
install -d -o lokyx -g lokyx -m 0750 "$DATA"
install -d -m 0750 -g lokyx "$ETC"

if [ "$RESET" = 1 ] && [ -d "$DATA/node" ]; then
  say "Wiping the old chain (wallets and the node key are kept)"
  # The node key is the node's identity, and releases pin the seed's. A reset must not change it.
  KEEP_KEY=""
  if [ -f "$DATA/node/node.key" ]; then
    KEEP_KEY="$(mktemp)"
    cp -p "$DATA/node/node.key" "$KEEP_KEY"
  fi
  rm -rf "$DATA/node"
  if [ -n "$KEEP_KEY" ]; then
    install -d -o lokyx -g lokyx -m 0750 "$DATA/node"
    install -m 0600 -o lokyx -g lokyx "$KEEP_KEY" "$DATA/node/node.key"
    rm -f "$KEEP_KEY"
  fi
fi

COINBASE=""
if [ "$FAUCET" = 1 ] || [ "$MINE_THREADS" != 0 ]; then
  if [ ! -f "$DATA/faucet.json" ]; then
    say "Creating the faucet wallet"
    PASS="$(head -c 24 /dev/urandom | base64 | tr -d '/+=')"
    printf 'LOKYX_WALLET_PASSWORD=%s\n' "$PASS" > "$ETC/faucet.env"
    chmod 0640 "$ETC/faucet.env"; chgrp lokyx "$ETC/faucet.env"
    LOKYX_WALLET_PASSWORD="$PASS" lokyx-wallet --network testnet --wallet "$DATA/faucet.json" new > /root/lokyx-faucet-recovery.txt
    chmod 0600 /root/lokyx-faucet-recovery.txt
    chown lokyx:lokyx "$DATA/faucet.json"
  fi
  COINBASE="$(lokyx-wallet --network testnet --wallet "$DATA/faucet.json" address)"
fi

MINE_ARGS=""
if [ "$MINE_THREADS" != 0 ]; then
  MINE_ARGS="--mine --coinbase $COINBASE --threads $MINE_THREADS"
fi
CORS_ARGS=""
[ "$WEB" = 1 ] && CORS_ARGS="--rpc-cors https://$DOMAIN"

# A secret for the control methods (starting and stopping mining), so the box can be managed
# without exposing them to whoever can reach the port. Kept across updates once made.
TOKEN_FILE=$ETC/rpc-token
if [ ! -s "$TOKEN_FILE" ]; then
  install -d -m 0750 -o lokyx -g lokyx "$ETC"
  openssl rand -hex 32 > "$TOKEN_FILE"
fi
chown lokyx:lokyx "$TOKEN_FILE"
chmod 0400 "$TOKEN_FILE"

say "Writing systemd services"
cat > /etc/systemd/system/lokyxd.service <<EOF
[Unit]
Description=LOKYX testnet node
After=network-online.target
Wants=network-online.target

[Service]
User=lokyx
Group=lokyx
ExecStart=/usr/local/bin/lokyxd --network testnet --datadir $DATA/node --listen 0.0.0.0 --p2p-port $P2P_PORT --rpc-bind 127.0.0.1 --rpc-port $RPC_PORT --public-rpc --rpc-token-file $TOKEN_FILE $CORS_ARGS $MINE_ARGS ${EXTRA_PEERS:-}
Restart=always
RestartSec=5
Nice=10
LimitNOFILE=65536
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF

if [ "$FAUCET" = 1 ]; then
  cat > /etc/systemd/system/lokyx-faucet.service <<EOF
[Unit]
Description=LOKYX testnet faucet
After=lokyxd.service
Requires=lokyxd.service

[Service]
User=lokyx
Group=lokyx
EnvironmentFile=$ETC/faucet.env
ExecStart=/usr/local/bin/lokyx-faucet --network testnet --wallet $DATA/faucet.json --rpc http://127.0.0.1:$RPC_PORT --listen 127.0.0.1:$FAUCET_PORT --amount $FAUCET_AMOUNT --behind-proxy --cors https://$DOMAIN
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadOnlyPaths=$DATA

[Install]
WantedBy=multi-user.target
EOF
fi

if [ "$WEB" = 1 ]; then
  say "Installing the web app and downloads"
  install -d "$WWW" "$DL"
  rm -rf "${WWW:?}"/*
  cp -r "$HERE/web/." "$WWW/"
  # keep a published APK across updates unless a new one is given
  find "$DL" -mindepth 1 ! -name 'lokyx-miner.apk' -delete
  cp -r "$HERE/download/." "$DL/"
  sed -i "s|https://testnet.lokyx.xyz|https://$DOMAIN|g" "$DL/install.sh" "$DL"/*.txt 2>/dev/null || true
  [ -n "$APK" ] && install -m 0644 "$APK" "$DL/lokyx-miner.apk"
  if [ -f "$DL/lokyx-miner.apk" ]; then
    SUM="$(sha256sum "$DL/lokyx-miner.apk" | cut -d' ' -f1)"
    SIZE="$(stat -c %s "$DL/lokyx-miner.apk")"
    printf '{"file":"lokyx-miner.apk","bytes":%s,"sha256":"%s"}\n' "$SIZE" "$SUM" > "$DL/apk.json"
    printf '%s  lokyx-miner.apk\n' "$SUM" >> "$DL/SHA256SUMS"
  fi

  say "Configuring Caddy (HTTPS certificates are automatic)"
  mkdir -p /etc/caddy/sites.d
  cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode zstd gzip
	@small not path /spoke/v1/media
	request_body @small {
		max_size 1MB
	}
	request_body /spoke/v1/media {
		max_size 9MB
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		X-Frame-Options DENY
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		Content-Security-Policy "default-src 'self'; connect-src 'self' blob: data: http://127.0.0.1:* http://localhost:* https://mempool.space https://ethereum-sepolia-rpc.publicnode.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; frame-ancestors 'none'"
	}
	handle_path /rpc* {
		reverse_proxy 127.0.0.1:$RPC_PORT
	}
	handle_path /faucet* {
		reverse_proxy 127.0.0.1:$FAUCET_PORT
	}
	# downloads: the node and wallet for each platform, checksums, and the phone app
	handle_path /download/* {
		root * $DL
		header Cache-Control "no-cache"
		file_server
	}
	# curl -fsSL https://$DOMAIN/install.sh | sh
	handle /install.sh {
		root * $DL
		header Content-Type "text/plain; charset=utf-8"
		file_server
	}
	# easy link for the phone app
	redir /app /download/lokyx-miner.apk 302
	# short links: /tx/<hash>, /address/<addr>, /block/<n>; the app routes after the #
	@explorer path_regexp ex ^/(tx|address|block)/([0-9A-Za-z]+)$
	redir @explorer /#/{re.ex.1}/{re.ex.2} 302
	# other apps on this server (Spoke puts its routes here)
	import /etc/caddy/sites.d/*.caddy
	handle {
		root * $WWW
		try_files {path} /index.html
		file_server
	}
}
EOF
  caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || die "Caddy didn't accept the config: run 'caddy validate --config /etc/caddy/Caddyfile' to see why"
  systemctl reload caddy || systemctl restart caddy
fi

say "Opening the firewall"
ufw allow OpenSSH >/dev/null
ufw allow $P2P_PORT/tcp >/dev/null
[ "$WEB" = 1 ] && { ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; }
ufw --force enable >/dev/null

systemctl daemon-reload
systemctl enable --now lokyxd >/dev/null
systemctl restart lokyxd
if [ "$FAUCET" = 1 ]; then systemctl enable --now lokyx-faucet >/dev/null; systemctl restart lokyx-faucet; fi

PUBLIC_IP="$(curl -fsS4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
say "Done: LOKYX $VERSION"
echo "  Node:       lokyxd on port $P2P_PORT   (logs: journalctl -u lokyxd -f)"
[ "$MINE_THREADS" != 0 ] && echo "  Mining:     $MINE_THREADS thread(s) to $COINBASE"
[ "$FAUCET" = 1 ] && echo "  Faucet:     https://$DOMAIN/faucet  (pays $FAUCET_AMOUNT LYX; it fills up as this server mines)"
if [ "$WEB" = 1 ]; then
  echo "  Web app:    https://$DOMAIN"
  echo "  Downloads:  https://$DOMAIN/#/download"
  [ -f "$DL/lokyx-miner.apk" ] && echo "  Phone app:  https://$DOMAIN/app" || echo "  Phone app:  not published yet (re-run with APK=/path/to/lokyx-miner.apk)"
fi
echo "  Seed:       ${DOMAIN:-$PUBLIC_IP}:$P2P_PORT"
echo "  RPC token:  $TOKEN_FILE  (needed to start or stop mining over RPC)"
if [ -f /root/lokyx-faucet-recovery.txt ]; then
  echo
  echo "  The faucet wallet's recovery phrase is in /root/lokyx-faucet-recovery.txt."
  echo "  Copy it somewhere offline, then delete that file."
fi
