LOKYX for Windows
=================

What's in here
  mine.bat          double-click to start mining (makes a wallet the first time)
  lokyxd.exe        the LOKYX node: it keeps a copy of the chain and mines
  lokyx-wallet.exe  your wallet: double-click it to see your balance, receive and send

Start mining
  1. Unzip this folder somewhere, for example your Documents.
  2. Double-click mine.bat.
     Windows may say "Windows protected your PC" because the program isn't signed yet.
     Click "More info", then "Run anyway".
  3. The first time, it makes you a wallet. Choose a password and write the 24 words
     on paper. Anyone with those words can take your coins, and nobody can recover them
     for you if you lose them.
  4. Leave the window open. Rewards can be spent after 60 more blocks (about an hour).
  5. To watch your miner, open https://testnet.lokyx.xyz/#/mining in your browser.
     If the browser asks to connect to devices on your network, allow it.

The wallet
  Double-click lokyx-wallet.exe. It shows your balance and lets you receive and send.
  It uses the node on this computer if mine.bat is running, otherwise the public node.

The same from a Command Prompt in this folder
  lokyx-wallet.exe --network testnet balance
  lokyx-wallet.exe --network testnet send --to lyx1... --amount 1.5
  lokyx-wallet.exe --network testnet address

Your wallet and the chain are kept in %APPDATA%\LOKYX\testnet.
Website, explorer and the phone miner: https://testnet.lokyx.xyz

This is a testnet: the coins have no value and the chain can be reset.
