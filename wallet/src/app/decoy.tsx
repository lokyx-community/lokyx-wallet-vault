import { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../ui/Text';
import { Button, Group, Note, Press, Row, Screen, success } from '../ui/controls';
import { IntroHero, Feature, Features } from '../ui/Feature';
import { PasscodePad } from '../ui/Passcode';
import { toast } from '../ui/Toast';
import { C } from '../ui/theme';
import { confirmIt } from '../lib/auth';
import { decoyAddress, hasDecoy, inDecoy, removeDecoy, setupDecoy } from '../lib/wallet';
import { shortAddr } from '../lib/format';

/**
 * The decoy passcode: a second, complete wallet with its own 24 words. Typed at the lock screen it opens that
 * wallet instead of yours, and nothing of your real wallet shows inside it.
 */
export default function Decoy() {
  const insets = useSafeAreaInsets();
  const [on, setOn] = useState<boolean | null>(null);
  const [addr, setAddr] = useState<string | null>(null);
  const [step, setStep] = useState<'' | 'new' | 'again'>('');
  const [first, setFirst] = useState('');

  const refresh = async () => {
    const h = await hasDecoy();
    setOn(h);
    setAddr(h ? await decoyAddress() : null);
  };
  useEffect(() => {
    void refresh();
  }, []);

  if (inDecoy()) {
    // Inside the decoy this screen must look like a wallet that simply has no decoy.
    return (
      <Screen title="Decoy passcode" large>
        <Note>Not available on this phone.</Note>
      </Screen>
    );
  }

  return (
    <Screen title="Decoy passcode" large>
      <IntroHero icon="lock" text="If someone forces you to unlock, type the decoy passcode instead of your real one. LOKYX opens a second wallet that looks completely normal, and your real one stays hidden." />
      <Features>
        <Feature icon="face" title="Face ID always opens your real wallet" text="Only the passcode you type decides which wallet opens." />
        <Feature icon="shield" title="Nothing can be changed from inside" text="Only the decoy passcode approves payments there, and nothing of your real wallet shows." />
      </Features>

      {on ? (
        <>
          <Group title="Your decoy wallet">
            <Row
              title="Its address"
              detail={addr ? shortAddr(addr, 8, 6) : '…'}
              onPress={async () => {
                if (!addr) return;
                await Clipboard.setStringAsync(addr);
                success();
                toast('Decoy address copied', 'copy');
              }}
            />
          </Group>
          <T v="caption" dim style={{ textAlign: "center" }}>Send it a little LYX now and then, so it looks lived in.</T>
          {addr ? <Button title="Send LYX to the decoy" onPress={() => router.push(`/send?to=${addr}`)} /> : null}
          <Button title="Change the decoy passcode" kind="line" onPress={async () => (await confirmIt('Change the decoy passcode')) && setStep('new')} />
          <Button
            title="Turn off and delete the decoy"
            kind="plain"
            onPress={async () => {
              if (!(await confirmIt('Delete the decoy wallet'))) return;
              await removeDecoy();
              success();
              toast('Decoy deleted', 'trash');
              void refresh();
            }}
          />
        </>
      ) : on === false ? (
        <Button title="Set up a decoy passcode" onPress={async () => (await confirmIt('Set up a decoy passcode')) && setStep('new')} />
      ) : null}

      <Modal visible={!!step} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setStep('')}>
        <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 60, paddingBottom: insets.bottom + 16, paddingHorizontal: 24, justifyContent: 'space-between' }}>
          {step === 'new' && (
            <PasscodePad
              key="n"
              title="Decoy passcode"
              sub="Six numbers, different from your real one"
              onDone={(p) => {
                setFirst(p);
                setTimeout(() => setStep('again'), 150);
                return true;
              }}
            />
          )}
          {step === 'again' && (
            <PasscodePad
              key="a"
              title="Once more"
              sub="Type it again"
              onDone={async (p) => {
                if (p !== first) {
                  setTimeout(() => setStep('new'), 700);
                  return "They didn't match";
                }
                try {
                  // a new passcode always comes with a fresh decoy wallet; the old one is deleted
                  await setupDecoy(p);
                } catch (e) {
                  setTimeout(() => setStep('new'), 900);
                  return (e as Error).message;
                }
                setTimeout(() => {
                  setStep('');
                  toast('Decoy passcode on', 'lock');
                  void refresh();
                }, 200);
                return true;
              }}
            />
          )}
          <Press onPress={() => setStep('')} style={{ alignSelf: 'center', padding: 12 }}>
            <T v="callout" dim>Cancel</T>
          </Press>
        </View>
      </Modal>
    </Screen>
  );
}
