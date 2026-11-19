# The relay (inside the watchtower)

Shared accounts need the people on them to pass a payment around until enough of them signed. The relay is a mailbox for that.
It runs inside `watchtower/server.mjs`, so it is one server for alerts and for this.

## What it can and cannot do

- It stores sealed bytes under a hashed topic for 7 days. It cannot read them: the key stays on the phones (a group key handed over in the setup invite).
- It holds no wallet key and cannot sign, move or cancel anything.
- A phone checks every payment against the owners' signatures before showing it, so a lying relay can only fail to deliver.
- A ping (optional) only says "A payment is waiting". It never carries the payment.

## Run it (Node 22.6+, no packages)

```
cd wallet
RELAY_FILE=/var/lib/lokyx/relay.json PORT=8787 node --experimental-strip-types watchtower/server.mjs
```

Add `NODE_RPC=https://your-node/rpc` as well if this server should also send vault alerts. Without it only the relay runs.

## Put HTTPS in front

The app only talks to `https://` addresses, and a certificate needs a name, not a bare IP. Point a domain (for example `relay.example.com`) at the server, then with Caddy:

```
relay.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

## systemd

```
[Unit]
Description=LOKYX watchtower and relay
After=network.target

[Service]
User=lokyx
WorkingDirectory=/opt/lokyx/wallet
Environment=PORT=8787 RELAY_FILE=/var/lib/lokyx/relay.json
ExecStart=/usr/bin/node --experimental-strip-types watchtower/server.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

Check it: `curl https://relay.example.com/health` answers `{"ok":true,...}`.

## Limits

200 messages per topic, 20,000 topics, 12 KB per message, a rate limit per address. Messages older than a week are dropped.

## In the app

- The relay used is `https://relay.naptunemist.xyz` unless `w.relayUrl` holds another https address.
- A new Ethereum/BNB or Bitcoin shared account gets a random group key. Ethereum/BNB: it is in the setup message and the others paste it
  under "I've been added". Bitcoin: one person shares it from the new-account screen and the others paste it there.
- "Sign and share" and "Approve" also leave the payment on the relay. Each phone checks the relay every 8 seconds while that account's screen is open,
  merges the copies, drops anything that is not a plain coin or token payment for that account, and opens the newest one. Signatures are still checked against the owners.
- Accounts made before this have no key and keep using the share sheet. If the relay does not answer, the share sheet opens instead.
- Not done: background pings (a phone only learns of a payment while it has that screen open), a screen to change the relay address, and LOKYX accounts (those are on chain and need no relay).
