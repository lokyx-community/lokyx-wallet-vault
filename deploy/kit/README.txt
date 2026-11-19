LOKYX
=====

What's in here
  mine.sh        start mining (makes a wallet the first time)
  lokyxd         the LOKYX node: it keeps a copy of the chain and mines
  lokyx-wallet   your wallet: run it on its own for a menu (balance, receive, send)

Start mining
  ./mine.sh

  The first time, it makes you a wallet. Choose a password and write the 24 words on
  paper. Anyone with those words can take your coins, and nobody can recover them for
  you if you lose them. Rewards can be spent after 60 more blocks (about an hour).

  On a Mac, if it says the program can't be opened because the developer can't be
  verified, run this once in the folder:   xattr -dr com.apple.quarantine .

Watch your miner at https://testnet.lokyx.xyz/#/mining (allow the browser to connect to
your computer if it asks).

Useful commands
  ./lokyx-wallet --network testnet balance
  ./lokyx-wallet --network testnet send --to lyx1... --amount 1.5
  ./lokyxd --network testnet            run a node without mining

Run it as a background service on a Linux server
  sudo cp lokyxd lokyx-wallet /usr/local/bin/
  then see https://testnet.lokyx.xyz/#/download for a systemd unit.

Your wallet and the chain are kept in ~/.lokyx/testnet
(on a Mac: ~/Library/Application Support/LOKYX/testnet).
Website, explorer and the phone miner: https://testnet.lokyx.xyz

This is a testnet: the coins have no value and the chain can be reset.
