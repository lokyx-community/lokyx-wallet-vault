import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { T } from '../../ui/Text';
import { Button, Field, Note, Press, Screen } from '../../ui/controls';
import { usePredictAct } from '../../ui/usePredictAct';
import { C } from '../../ui/theme';
import { FEATURES } from '../../lib/features';
import { createMarket, deployment, myAddress } from '../../lib/predict';
import { CLOSE_CHOICES, MAX_TITLE_CHARS, marketForm } from '../../lib/predict-screen-core';
import { NotOn } from './index';

export default function NewMarket() {
  if (!FEATURES.predict) return <NotOn />;
  return <NewOn />;
}

function NewOn() {
  const d = deployment();
  const [title, setTitle] = useState('');
  const [closeIn, setCloseIn] = useState(CLOSE_CHOICES[1][1]);
  const [panel, setPanel] = useState('');
  const [me, setMe] = useState('');
  useEffect(() => {
    void myAddress().then(setMe).catch(() => {});
  }, []);
  const act = usePredictAct(() => {});
  const form = marketForm({ title, panel });

  const make = async () => {
    if (form.why) return;
    const unit = 10n ** BigInt(d.decimals); // one coin per winning share
    const ok = await act.run('Make this market', () => createMarket(title.trim(), Math.floor(Date.now() / 1000) + closeIn, unit, form.panel), 'Market made');
    if (ok) router.replace('/predict');
  };

  return (
    <Screen title="Make a market" large>
      <T v="sub" dim style={{ marginTop: -8 }}>Ask a question that will have a clear Yes or No answer.</T>
      <View style={{ gap: 8 }}>
        <T v="caption" dim>Question</T>
        <Field value={title} onChangeText={setTitle} multiline placeholder="Will it rain in Taipei on Saturday?" maxLength={MAX_TITLE_CHARS + 20} style={{ minHeight: 96 }} accessibilityLabel="The question" />
        <T v="caption" dim style={{ textAlign: 'right' }}>{`${title.trim().length}/${MAX_TITLE_CHARS}`}</T>
      </View>
      <View style={{ gap: 8 }}>
        <T v="caption" dim>Trading stops in</T>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {CLOSE_CHOICES.map(([label, secs]) => (
            <Press key={secs} onPress={() => setCloseIn(secs)} style={{ paddingHorizontal: 16, height: 40, borderRadius: 20, justifyContent: 'center', backgroundColor: closeIn === secs ? C.ink : C.fill2 }}>
              <T v="sub" color={closeIn === secs ? C.inkText : C.text}>{label}</T>
            </Press>
          ))}
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <T v="caption" dim>People who settle a dispute (3 to 9 addresses)</T>
        <Field value={panel} onChangeText={setPanel} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} placeholder={'0x…\n0x…\n0x…'} style={{ minHeight: 110 }} accessibilityLabel="Panel addresses" />
        <Note>They only step in if someone disputes the answer. For a test, use addresses you control.</Note>
        {me ? (
          <Press onPress={() => setPanel((p) => (p.toLowerCase().includes(me.toLowerCase()) ? p : `${p.trim()}${p.trim() ? '\n' : ''}${me}`))} style={{ alignSelf: 'flex-start' }}>
            <T v="sub" dim>+ Add my address</T>
          </Press>
        ) : null}
      </View>
      {form.why && (title.trim() || panel.trim()) ? <Note>{form.why}</Note> : null}
      <Button title="Make the market" disabled={!!form.why || !!act.busy} busy={!!act.busy} onPress={make} />
      <Note center>{`Each winning share pays 1 ${d.symbol}. Making a market costs only the network fee.`}</Note>
      {act.sheet}
    </Screen>
  );
}
