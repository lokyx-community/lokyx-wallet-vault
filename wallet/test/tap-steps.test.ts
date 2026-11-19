import test from 'node:test';
import assert from 'node:assert/strict';
import { TAP_HELP, TAP_SHARED, TAP_STEPS } from '../src/lib/tap-steps.ts';

test('the tap screen gives three steps and each has words', () => {
  assert.equal(TAP_STEPS.length, 3);
  for (const s of [...TAP_STEPS, ...TAP_HELP]) assert.ok(s.title.length > 3 && s.text.length > 10);
});

test('the help says what really limits tapping, and the privacy line makes no larger promise than the code keeps', () => {
  const all = TAP_HELP.map((h) => h.title + h.text).join(' ');
  assert.match(all, /Android 12/);
  assert.match(all, /iPhones cannot tap/);
  assert.match(all, /Bluetooth/);
  assert.match(TAP_SHARED, /address and an amount/);
  assert.match(TAP_SHARED, /Never your keys or words/);
});
