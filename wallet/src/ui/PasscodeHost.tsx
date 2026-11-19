import { Modal, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { passcodeRequest } from '../lib/auth';
import { useStore } from '../lib/store';
import { checkPasscode, inDecoy } from '../lib/wallet';
import { PasscodePad } from './Passcode';
import { Press } from './controls';
import { T } from './Text';
import { C } from './theme';

/** Shows the passcode pad whenever something asks for it with askPasscode(). */
export function PasscodeHost() {
  const req = useStore(passcodeRequest);
  const insets = useSafeAreaInsets();
  const finish = (ok: boolean) => {
    req?.resolve(ok);
    passcodeRequest.set(null);
  };
  return (
    <Modal visible={!!req} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => finish(false)}>
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 60, paddingBottom: insets.bottom + 16, paddingHorizontal: 24, justifyContent: 'space-between' }}>
        {req && (
          <PasscodePad
            title="Enter passcode"
            sub={req.reason}
            onDone={async (pin) => {
              const r = await checkPasscode(pin);
              // the decoy passcode only approves things inside the decoy wallet
              if (r.ok && (!r.decoy || inDecoy())) {
                setTimeout(() => finish(true), 120);
                return true;
              }
              return r.wait ? `Too many tries. Wait ${r.wait}s.` : 'Wrong passcode';
            }}
          />
        )}
        <Press onPress={() => finish(false)} style={{ alignSelf: 'center', padding: 12 }}>
          <T v="callout" dim>Cancel</T>
        </Press>
      </View>
    </Modal>
  );
}
