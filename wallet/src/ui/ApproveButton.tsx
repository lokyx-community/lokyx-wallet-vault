import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { T } from './Text';
import { Icon } from './Icon';
import { Press } from './controls';
import { C, F } from './theme';
import { bioName, biometricKind, confirmIt, type Bio } from '../lib/auth';
import { useWallet } from '../lib/wallet';

/**
 * The one way a payment is approved: Face ID, or the fingerprint on phones without it, or the passcode.
 * `onApproved` runs only after the check passes.
 */
export function ApproveButton({ reason, onApproved, busy, disabled }: { reason: string; onApproved: () => unknown; busy?: boolean; disabled?: boolean }) {
  const w = useWallet();
  const [bio, setBio] = useState<Bio>(null);
  useEffect(() => {
    biometricKind().then((b) => setBio(w.settings.biometrics ? b : null));
  }, [w.settings.biometrics]);
  const go = async () => {
    if (busy || disabled) return;
    if (!(await confirmIt(reason))) return;
    await onApproved();
  };
  const label = busy ? 'Sending…' : bio === 'face' ? 'Look at your phone to send' : bio ? 'Touch the sensor to send' : 'Enter your passcode to send';
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Press onPress={go} disabled={busy || disabled} accessibilityLabel={bio ? `Send with ${bioName(bio)}` : 'Send with your passcode'} scaleTo={0.94} style={{ alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 30, opacity: busy || disabled ? 0.45 : 1 }}>
        <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: 'rgba(10,132,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={bio === 'face' ? 'face' : bio ? 'finger' : 'lock'} size={40} color={C.blue} width={1.8} />
        </View>
        <T style={{ fontFamily: F.semibold, fontSize: 16 }}>{label}</T>
      </Press>
      {bio ? <T v="caption" dim>{bioName(bio)} not working? Your passcode works too.</T> : null}
    </View>
  );
}
