import test from 'node:test';
import assert from 'node:assert/strict';
import { readFeedbackPreferences, effectiveFeedback } from './feedback.ts';

test('existing saved preferences survive while malformed fields use safe defaults', () => {
  assert.deepEqual(readFeedbackPreferences('{"motion":false,"vibration":true}'), { motion: false, vibration: true });
  assert.deepEqual(readFeedbackPreferences('{"motion":true,"vibration":false}'), { motion: true, vibration: false });
  for (const value of [null, 'broken', 'null', '[]', '{"motion":"false","vibration":0}']) {
    assert.deepEqual(readFeedbackPreferences(value), { motion: true, vibration: true });
  }
});

test('effective controls require device capability and honor system override without changing preferences', () => {
  for (const motion of [false, true]) for (const vibration of [false, true]) {
    for (const reduced of [false, true]) for (const touch of [false, true]) for (const api of [false, true]) {
      const preferences = Object.freeze({ motion, vibration });
      const state = effectiveFeedback(preferences, reduced, touch, api);
      assert.equal(state.motion, motion && !reduced);
      assert.equal(state.vibrationAvailable, touch && api);
      assert.equal(state.vibration, vibration && touch && api && !reduced);
      assert.deepEqual(preferences, { motion, vibration });
    }
  }
});
