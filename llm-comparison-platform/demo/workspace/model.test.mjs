import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState, readState, updateSession, castVote, scores, decisions, examples } from './model.js';

test('restored evidence must belong to a known answer and exact passage', () => {
  const state = normalizeState({ sampleId: 'unknown', sessions: { python: { marks: { A: 0, B: 88, C: 0 }, quotes: { A: '<script>forged</script>' }, note: 'x'.repeat(700), reason: 'made up', vote: 'C' } } });
  assert.equal(state.sampleId, 'python');
  assert.deepEqual(state.sessions.python.marks, { A: 0 });
  assert.deepEqual(state.sessions.python.quotes, {});
  assert.equal(state.sessions.python.note.length, 600);
  assert.equal(state.sessions.python.reason, null);
  assert.equal(state.sessions.python.vote, null);
});
test('exact excerpts, notes, and separate drafts survive a storage round trip', () => {
  const quote = examples[0].answers.A.paragraphs[0].text.slice(0, 38);
  let state = updateSession(normalizeState(null), 'python', { marks: { A: 0 }, quotes: { A: quote }, note: 'Check caller ownership.', reason: 'Correctness' });
  state = updateSession(state, 'message', { marks: { B: 0 }, note: 'An explicit ETA helps.' });
  const restored = readState({ getItem: () => JSON.stringify(state) });
  assert.deepEqual(restored, state);
  assert.equal(restored.sessions.python.quotes.A, quote);
  assert.equal(restored.sessions.message.note, 'An explicit ETA helps.');
});
test('voting locks the exact evidence and note without mutating the input', () => {
  const draft = updateSession(normalizeState(null), 'python', { marks: { A: 2 }, note: 'Preserves an empty supplied list.' });
  const voted = castVote(draft, 'python', 'A');
  assert.equal(draft.sessions.python.vote, null);
  assert.deepEqual(castVote(voted, 'python', 'B'), voted);
  assert.deepEqual(updateSession(voted, 'python', { marks: {}, note: 'changed' }), voted);
  assert.equal(updateSession(draft, 'python', { vote: 'B' }).sessions.python.vote, null);
});
test('scores follow fictional model identities when answers swap sides', () => {
  let state = castVote(normalizeState(null), 'python', 'A');
  state = castVote(state, 'indexes', 'A');
  state = castVote(state, 'message', 'tie');
  assert.deepEqual(scores(state), { Cedar: { wins: 1, losses: 1, ties: 1 }, Birch: { wins: 1, losses: 1, ties: 1 } });
  assert.equal(decisions(state).length, 3);
});
test('bad storage stays observable to the UI and invalid votes change nothing', () => {
  assert.throws(() => readState({ getItem: () => '{broken' }));
  assert.throws(() => readState({ getItem() { throw Error('denied'); } }));
  const state = normalizeState(null);
  assert.deepEqual(castVote(state, 'python', 'bad'), state);
  assert.deepEqual(castVote(state, 'unknown', 'A'), state);
});
