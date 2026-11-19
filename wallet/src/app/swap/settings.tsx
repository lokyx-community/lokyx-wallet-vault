import { useState } from 'react';
import { View } from 'react-native';
import { T } from '../../ui/Text';
import { C, F } from '../../ui/theme';
import { Button, ErrorText, Field, Note, Screen, success } from '../../ui/controls';
import { Segmented } from '../../ui/Segmented';
import { confirmIt } from '../../lib/auth';
import { checkContract, deployContract, updateSwapSettings, useSwapSettings } from '../../lib/swaps';

/** Which bitcoin test network new offers use, and the swap contract on Sepolia. */
export default function SwapSettings() {
  const cfg = useSwapSettings();
  const [addr, setAddr] = useState(cfg.ethContract);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  return (
    <Screen title="Swap settings" large>
      <T v="sub" dim style={{ paddingHorizontal: 4 }}>Bitcoin network for new offers</T>
      <Segmented<'testnet4' | 'signet'> value={cfg.btcNet} onChange={(v) => updateSwapSettings({ btcNet: v })} options={[['testnet4', 'testnet4'], ['signet', 'signet']]} />
      <T v="caption" dim style={{ lineHeight: 18 }}>The LOKYX website swaps on testnet4. Use signet only to swap phone to phone.</T>

      <View style={{ gap: 12, backgroundColor: C.fill, borderRadius: 26, padding: 18 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 17 }}>Swap contract on Sepolia</T>
        <Field value={addr} onChangeText={setAddr} placeholder="0x…" autoCapitalize="none" autoCorrect={false} mono />
        <Button
          title="Check and save"
          kind="line"
          disabled={!addr.trim()}
          onPress={async () => {
            setErr('');
            setMsg('');
            try {
              if (!(await checkContract(addr.trim()))) throw new Error('That address is not the LOKYX swap contract');
              await updateSwapSettings({ ethContract: addr.trim() });
              success();
              setMsg('Saved. It is the real LOKYX swap contract.');
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        />
        <T v="caption" dim style={{ lineHeight: 18 }}>No contract yet? Put one on Sepolia from this phone. It costs a little test ETH, once. Then share its address with whoever you swap with.</T>
        <Button
          title="Create the swap contract"
          busy={busy}
          onPress={async () => {
            setErr('');
            setMsg('');
            if (!(await confirmIt('Create the swap contract on Sepolia'))) return;
            setBusy(true);
            try {
              const a = await deployContract();
              setAddr(a);
              success();
              setMsg(`Created at ${a}`);
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
      {msg ? <T v="sub" color="#3DD68C">{msg}</T> : null}
      <ErrorText>{err}</ErrorText>
    </Screen>
  );
}
