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
  assert.deepEqual(castVote(voted, 'python', 'A'), voted);
  assert.equal(voted.sessions.python.edited, false);
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

test('every vote revision preserves evidence and counts only the latest model choice', () => {
  const quote = examples[0].answers.A.paragraphs[0].text.slice(0, 38);
  const draft = updateSession(normalizeState(null), 'python', { marks: { A: 0, B: 1 }, quotes: { A: quote }, note: 'Keep this reasoning.', reason: 'Correctness' });
  for (const initial of ['A', 'B', 'tie']) {
    const original = castVote(draft, 'python', initial);
    for (const choice of ['A', 'B', 'tie']) {
      const revised = castVote(original, 'python', choice);
      assert.equal(original.sessions.python.vote, initial);
      assert.deepEqual(revised.sessions.python, { ...original.sessions.python, vote: choice, edited: choice !== initial });
      assert.equal(decisions(revised).length, 1);
      const score = scores(revised);
      assert.deepEqual(score.Cedar, { wins: +(choice === 'A'), losses: +(choice === 'B'), ties: +(choice === 'tie') });
      assert.deepEqual(score.Birch, { wins: +(choice === 'B'), losses: +(choice === 'A'), ties: +(choice === 'tie') });
      assert.deepEqual(readState({ getItem: () => JSON.stringify(revised) }), revised);
      assert.deepEqual(castVote(revised, 'python', 'bad'), revised);
    }
  }
  let state = castVote(castVote(draft, 'python', 'A'), 'python', 'B');
  state = castVote(state, 'python', 'A');
  assert.equal(state.sessions.python.edited, true, 'returning to the first choice is still an edit after reveal');
  state = castVote(castVote(state, 'indexes', 'A'), 'indexes', 'B');
  assert.deepEqual(scores(state).Cedar, { wins: 2, losses: 0, ties: 0 });
  assert.equal(decisions(state).length, 2);
});
test('legacy votes load unedited and draft or malformed edit markers are ignored', () => {
  const state = normalizeState({ sessions: { python: { vote: 'A' }, indexes: { vote: 'B', edited: 'true' }, message: { vote: null, edited: true } } });
  for (const value of Object.values(state.sessions)) assert.equal(value.edited, false);
  const revised = castVote(state, 'python', 'tie');
  assert.equal(revised.sessions.python.edited, true);
  assert.deepEqual(updateSession(revised, 'python', { note: 'changed', edited: false }), revised);
});
