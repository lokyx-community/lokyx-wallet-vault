import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { T } from '../ui/Text';
import { Button, Group, Note, Row, Screen, Switch, success } from '../ui/controls';
import { toast } from '../ui/Toast';
import { C, F } from '../ui/theme';
import { Icon } from '../ui/Icon';
import { confirmIt } from '../lib/auth';
import { askSigningOff, keepSigningOn, useSigningProtection } from '../lib/signing';
import { protectionActive } from '../lib/signing-core';
import { waitText } from '../lib/guard-core';

const STOPS = [
  'Approvals for all of a coin, with no end, to an address you have never used',
  'Signatures that quietly hand over a coin later (permits and orders)',
  'Anything that gives another address control of an account',
  'Gifts of a whole collection to a stranger',
];

export default function SigningProtection() {
  const p = useSigningProtection();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const on = protectionActive(p, now);
  const pending = p.on && p.offAt !== undefined && p.offAt > now;

  const toggle = async (v: boolean) => {
    if (!v) {
      if (!(await confirmIt('Ask to turn off signing protection'))) return;
      await askSigningOff();
      toast('It will switch off in 24 hours', 'info');
    } else {
      await keepSigningOn();
      success();
      toast('Signing protection is on', 'check');
    }
  };

  return (
    <Screen title="Signing protection" large>
      <Group>
        <Row
          icon="shield"
          title="Check what you sign"
          sub={on ? 'Dangerous approvals and signatures are stopped before you can sign them.' : 'Off. Anything a site asks you to sign is up to you.'}
          right={<Switch on={on || pending} label="Signing protection" onChange={toggle} />}
        />
      </Group>
      {pending ? (
        <Group>
          <View style={{ padding: 16, gap: 12 }}>
            <T v="callout">Switching off in {waitText(p.offAt! - now)}</T>
            <T v="sub" dim>The wait is on purpose. If someone else has your unlocked phone, they can't turn this off and sign at once.</T>
            <Button title="Keep it on" kind="line" onPress={() => { keepSigningOn().then(() => toast('Staying on', 'check')); }} />
          </View>
        </Group>
      ) : null}
      <Group title="What gets stopped">
        {STOPS.map((s) => (
          <View key={s} style={{ flexDirection: 'row', gap: 12, padding: 16, alignItems: 'flex-start' }}>
            <Icon name="check" size={16} color={C.good} width={2.4} />
            <T v="sub" style={{ flex: 1, fontFamily: F.regular, color: C.soft }}>{s}</T>
          </View>
        ))}
      </Group>
      <Note>A fixed amount, for a short time, to an app you already use goes straight through. Turning protection off takes 24 hours.</Note>
    </Screen>
  );
}
