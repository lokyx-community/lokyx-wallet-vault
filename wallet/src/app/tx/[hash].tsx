import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from '../../ui/Text';
import { Press, Screen, success } from '../../ui/controls';
import { TxView } from '../../ui/TxView';
import { toast } from '../../ui/Toast';
import { C } from '../../ui/theme';
import { siteUrl, usePoll, type TxInfo } from '../../lib/rpc';
import { currentAddress } from '../../lib/wallet';
import { labelFor, niceLyx } from '../../lib/format';
import { DUR, EASE_OUT } from '../../ui/motion';
import { CoinLogo } from '../../ui/CoinLogo';
import { receiptText } from '../../lib/slip-core';

const SETTLED = 6;

export default function TxScreen() {
  const { hash } = useLocalSearchParams<{ hash: string }>();
  const tx = usePoll<TxInfo>('lyx_getTransaction', { hash }, 4000);
  const t = tx.data;
  const me = currentAddress();
  const out = t?.from === me;
  const pending = t?.status === 'pending';
  const conf = t?.confirmations ?? 0;
  const call = t?.contract;
  const failed = !!(t?.receipt && !t.receipt.ok);

  return (
    <Screen title="Payment">
      {!t ? (
        <View style={{ paddingTop: 80, alignItems: 'center', gap: 12 }}>
          {tx.error ? <T v="sub" dim>{tx.error.message}</T> : <ActivityIndicator color={C.sub} />}
        </View>
      ) : (
        <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)} style={{ gap: 14 }}>
          <TxView
            state={failed ? 'failed' : pending ? 'pending' : conf >= SETTLED ? 'settled' : 'block'}
            sign={out ? '−' : '+'}
            mark={<CoinLogo chain="lyx" size={34} />}
            label={`${out ? 'Sent' : 'Received'} · LOKYX testnet`}
            hash={t.hash}
            qrUrl={`${siteUrl()}/#/tx/${t.hash}`}
            shareText={receiptText(`${out ? 'Sent' : 'Received'} ${niceLyx(t.valueLyx, 6)} LYX`, [['From', t.from ?? ''], ['To', t.to ?? ''], ['Network', 'LOKYX testnet'], ['Network fee', `${niceLyx(t.receipt?.feeLyx ?? t.feeLyx, 8)} LYX`]], t.hash, `${siteUrl()}/#/tx/${t.hash}`, 'Test network, no market value')}
            amount={niceLyx(t.valueLyx, 6)}
            unit="LYX"
            line={call ? (call.kind === 'deploy' ? 'Made a contract' : `Called ${call.method ?? 'a contract'}`) : out ? `to ${labelFor(t.to)}` : `from ${labelFor(t.from)}`}
            failMsg={failed ? `Didn't go through: ${t.receipt?.error ?? 'the contract said no'}` : undefined}
            steps={
              failed
                ? [{ title: 'Sent', state: 'done' }, { title: 'Did not go through', sub: 'Only the network fee was spent', state: 'failed' }]
                : [
                    { title: out ? 'Sent' : 'Seen', sub: t.from === me ? 'Main' : undefined, state: 'done' },
                    { title: 'In a block', sub: pending ? 'Blocks come about once a minute on testnet' : `Block ${t.blockHeight?.toLocaleString('en-US')}`, state: pending ? 'now' : 'done' },
                    { title: 'Settled', sub: pending ? undefined : `${conf.toLocaleString('en-US')} ${conf === 1 ? 'block' : 'blocks'} on top`, state: pending ? 'next' : conf >= SETTLED ? 'done' : 'now' },
                  ]
            }
            rows={[
              ['From', labelFor(t.from)],
              ['To', labelFor(t.to)],
              ['Network fee', `${niceLyx(t.receipt?.feeLyx ?? t.feeLyx, 8)} LYX`],
              ...(t.receipt ? ([['Gas used', t.receipt.gasUsed.toLocaleString('en-US')]] as [string, string][]) : []),
            ]}
            onCopy={async () => {
              await Clipboard.setStringAsync(t.hash);
              success();
              toast('Copied');
            }}
            onAgain={out && t.to && !call ? () => router.push(`/send?to=${t.to}&amount=${niceLyx(t.valueLyx, 6).replace(/,/g, '')}`) : undefined}
            onExplorer={() => router.push(`/browser?url=${encodeURIComponent(`${siteUrl()}/#/tx/${t.hash}`)}`)}
            extra={!out && t.from ? <Press onPress={() => router.push(`/send?to=${t.from}`)} style={{ alignItems: 'center', padding: 8 }}><T v="callout" dim>Send back</T></Press> : null}
          />
        </Animated.View>
      )}
    </Screen>
  );
}
