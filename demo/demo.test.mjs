import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDecisions, recordDecision, scoreDecisions, readNotebook, STORAGE_KEY } from './demo.js';

const first = { sampleId: 'indexes', vote: 'A', createdAt: 1000, reason: 'Clarity', mark: { side: 'A', index: 2 } };

test('saved decisions preserve evidence while stripping unexpected content', () => {
  assert.deepEqual(validateDecisions([{ ...first, injected: '<script>' }]), [first]);
  const invalidMark = validateDecisions([{ ...first, reason: '<img>', mark: { side: 'B', index: -1 } }])[0];
  assert.equal(invalidMark.reason, null);
  assert.equal(invalidMark.mark, null);
  for (const value of [null, {}, 'bad', [null], [{ ...first, sampleId: 'unknown' }], [{ ...first, vote: 'C' }], [{ ...first, createdAt: null }]]) {
    assert.deepEqual(validateDecisions(value), []);
  }
});

test('a comparison records only its first vote after model reveal', () => {
  const initial = [first];
  assert.deepEqual(recordDecision(initial, { ...first, vote: 'B', createdAt: 2000 }), [first]);
  assert.deepEqual(initial, [first], 'does not mutate the original notebook');
});

test('scores follow model identity, even when the model changes sides', () => {
  const decisions = [first, { ...first, sampleId: 'message', vote: 'A', mark: null }, { ...first, sampleId: 'code', vote: 'tie' }];
  assert.deepEqual(scoreDecisions(decisions), {
    Cedar: { wins: 1, ties: 1, losses: 1, compared: 3 },
    Birch: { wins: 1, ties: 1, losses: 1, compared: 3 }
  });
  assert.deepEqual(scoreDecisions([]), {
    Cedar: { wins: 0, ties: 0, losses: 0, compared: 0 },
    Birch: { wins: 0, ties: 0, losses: 0, compared: 0 }
  });
});

test('persistence round-trip validates data and exposes storage errors to the UI', () => {
  assert.deepEqual(readNotebook({ getItem: key => key === STORAGE_KEY ? JSON.stringify([first]) : null }), [first]);
  assert.deepEqual(readNotebook({ getItem: () => null }), []);
  assert.throws(() => readNotebook({ getItem: () => '{broken' }), SyntaxError);
  assert.throws(() => readNotebook({ getItem: () => { throw new Error('Storage blocked'); } }), /Storage blocked/);
});
