# Deploying the prediction market (testnets only)

Nothing here is deployed yet. Deploying needs your keys and test coins, so it is done by you.

## BNB testnet (USDT)
1. Get test BNB for gas from the BNB Chain testnet faucet. There is no dependable USDT on testnet, so deploy our play one first:
   `forge script script/DeployToken.s.sol --rpc-url <rpc> --broadcast --private-key $KEY` and note the `TestUSDT:` address.
   Then mint yourself some: `cast send <TestUSDT> "mint(address,uint256)" <your address> 1000000000000000000000 --rpc-url <rpc> --private-key $KEY`.
2. `cd wallet/contracts/evm && git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std`
3. `TOKEN=<usdt address> forge script script/Deploy.s.sol --rpc-url https://data-seed-prebsc-1-s1.bnbchain.org:8545 --broadcast --private-key $KEY`
4. Note the printed `PredictionMarket:` address. The app will read it from a setting.

## LOKYX
1. Take `market.wasm.b64` and `market/abi.json` from the `market-contracts` workflow run (artifact `market-wasm`).
2. Put them in `wallet/src/lib/contracts-wallet.ts` as `MARKET_WASM` / `MARKET_ABI` and add `market` to `KINDS`
   in `wcontracts.ts` (the app code can then call `deploy('market', [])`).
3. Deploy once from the wallet with a funded LYX test account and note the contract address.
