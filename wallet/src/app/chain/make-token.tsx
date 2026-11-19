import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { encodeDeployData } from 'viem';
import { T } from '../../ui/Text';
import { Field, Screen, success } from '../../ui/controls';
import { Panel, GRow, Primary, Secondary } from '../../ui/Glass';
import { toast } from '../../ui/Toast';
import { confirmIt } from '../../lib/auth';
import { activeNets, addToken, ethCreated, sendEthCall } from '../../lib/multichain';
import { ETH_NETS, parseUnits } from '../../lib/multichain-core';
import { ERC20_BYTECODE, ERC20_DEPLOY_ABI } from '../../lib/erc20-code';

/** Your own ERC-20 on Ethereum: a name, a symbol, how many. All of it starts in your wallet; nobody can make more. */
export default function MakeEthToken() {
  const net = activeNets().eth;
  const [name, setName] = useState('');
  const [sym, setSym] = useState('');
  const [supply, setSupply] = useState('1000000');
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState('');
  const [made, setMade] = useState('');

  useEffect(() => {
    if (!tx || made) return;
    const t = setInterval(async () => {
      try {
        const a = await ethCreated(net, tx);
        if (a) {
          setMade(a);
          await addToken({ chainId: ETH_NETS[net].chainId, contract: a, symbol: sym.trim().toUpperCase(), decimals: 18 });
          success();
        }
      } catch (e) {
        toast((e as Error).message, 'info');
        setTx('');
      }
    }, 5000);
    return () => clearInterval(t);
  }, [tx, made, net, sym]);

  const go = async () => {
    if (!(await confirmIt(`Make ${sym.trim().toUpperCase()} on ${ETH_NETS[net].label}`, { keyFollows: true }))) return;
    setBusy(true);
    try {
      const data = encodeDeployData({ abi: ERC20_DEPLOY_ABI, bytecode: ERC20_BYTECODE, args: [name.trim(), sym.trim().toUpperCase(), parseUnits(supply.trim(), 18)] });
      setTx(await sendEthCall(null, data));
    } catch (e) {
      toast((e as Error).message, 'info');
    } finally {
      setBusy(false);
    }
  };

  if (made)
    return (
      <Screen title="" close>
        <T v="display">{`${name.trim()} is live`}</T>
        <T v="sub" dim>{`All ${supply} ${sym.toUpperCase()} are in your Ethereum wallet. Others add it with this contract address.`}</T>
        <Panel><GRow title="Contract" sub={made} /></Panel>
        <Primary title={`Send ${sym.toUpperCase()}`} onPress={() => router.replace(`/chain/send?chain=eth&token=${made}`)} />
        <Secondary title="Done" onPress={() => router.back()} />
      </Screen>
    );

  return (
    <Screen title="Make a token on Ethereum" large>
      <T v="sub" dim style={{ lineHeight: 20 }}>{`A standard ERC-20 on ${ETH_NETS[net].label}, so any Ethereum wallet can hold it. No owner and no way to make more after this. You pay the network fee once.`}</T>
      <Field value={name} onChangeText={setName} placeholder="Name, like Maya Coin" maxLength={40} />
      <Field value={sym} onChangeText={(x) => setSym(x.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12))} placeholder="Symbol, like MAYA" autoCapitalize="characters" />
      <Field value={supply} onChangeText={setSupply} placeholder="How many" keyboardType="number-pad" />
      <Primary title={tx ? 'Being made… (a few blocks)' : `Make ${sym.toUpperCase() || 'it'}`} busy={busy} disabled={!name.trim() || !sym.trim() || !supply.trim() || !!tx} onPress={go} />
      <T v="caption" dim style={{ lineHeight: 18 }}>Source: contracts/LokyxToken.sol in the wallet repo, so anyone can check what it does.</T>
    </Screen>
  );
}
