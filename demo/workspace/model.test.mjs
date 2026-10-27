import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState, readState, updateSession, castVote, scores, decisions, examples, highlightId, highlightRanges } from './model.js';

test('restored evidence must belong to a known answer and exact passage', () => {
  const state = normalizeState({ sampleId: 'unknown', sessions: { python: { marks: { A: 0, B: 88, C: 0 }, quotes: { A: '<script>forged</script>' }, note: 'x'.repeat(700), reason: 'made up', vote: 'C' } } });
  assert.equal(state.sampleId, 'python');
  assert.deepEqual(state.sessions.python.highlights, [{ side: 'A', index: 0, field: 'passage', note: '' }]);
  assert.equal(state.sessions.python.note.length, 600);
  assert.equal(state.sessions.python.reason, null);
  assert.equal(state.sessions.python.vote, null);
});
test('exact excerpts, notes, and separate drafts survive a storage round trip', () => {
  const quote = examples[0].answers.A.paragraphs[0].text.slice(0, 38);
  let state = updateSession(normalizeState(null), 'python', { highlights: [{ side: 'A', index: 0, field: 'text', start: 0, end: quote.length, quote, note: 'Created only once.' }], note: 'Check caller ownership.', reason: 'Correctness' });
  state = updateSession(state, 'message', { highlights: [{ side: 'B', index: 0, field: 'passage' }], note: 'An explicit ETA helps.' });
  const restored = readState({ getItem: () => JSON.stringify(state) });
  assert.deepEqual(restored, state);
  assert.equal(restored.sessions.python.highlights[0].quote, quote);
  assert.equal(restored.sessions.message.note, 'An explicit ETA helps.');
});
test('voting locks the exact evidence and note without mutating the input', () => {
  const draft = updateSession(normalizeState(null), 'python', { highlights: [{ side: 'A', index: 2, field: 'passage', note: 'Preserves ownership.' }], note: 'Preserves an empty supplied list.' });
  const voted = castVote(draft, 'python', 'A');
  assert.equal(draft.sessions.python.vote, null);
  assert.deepEqual(castVote(voted, 'python', 'A'), voted);
  assert.equal(voted.sessions.python.edited, false);
  assert.deepEqual(updateSession(voted, 'python', { highlights: [], note: 'changed' }), voted);
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
  const draft = updateSession(normalizeState(null), 'python', { highlights: [{ side: 'A', index: 0, field: 'text', start: 0, end: quote.length, quote, note: 'Exact detail.' }, { side: 'A', index: 2, field: 'passage' }, { side: 'B', index: 1, field: 'passage' }], note: 'Keep this reasoning.', reason: 'Correctness' });
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


test('legacy highlights migrate once while preserving saved votes, excerpts and decision notes', () => {
  const quote = examples[0].answers.A.paragraphs[0].text.slice(7, 25);
  const state = normalizeState({ sessions: { python: { marks: { A: 0, B: 2 }, quotes: { A: quote }, note: 'Original note.', vote: 'B', edited: true } } });
  const saved = state.sessions.python;
  assert.equal(saved.highlights.length, 2);
  assert.deepEqual(saved.highlights[0], { side: 'A', index: 0, field: 'text', start: 7, end: 25, quote, note: '' });
  assert.equal(saved.note, 'Original note.');
  assert.equal(saved.vote, 'B');
  assert.equal(saved.edited, true);
  assert.deepEqual(normalizeState(state), state);
  assert.equal(normalizeState({ sessions: { python: { marks: { A: 0 }, highlights: [] } } }).sessions.python.highlights.length, 0, 'removed migrated highlights must not return');
});

test('multiple highlights keep independent notes and stable source ranges', () => {
  const text = examples[0].answers.A.paragraphs[0].text;
  const excerpt = (start, end, note) => ({ side: 'A', index: 0, field: 'text', start, end, quote: text.slice(start, end), note });
  const code = examples[0].answers.B.paragraphs[1].code;
  const highlights = [excerpt(0, 20, 'First'), excerpt(10, 30, 'Overlap'), excerpt(50, 60, 'Separate'), { side: 'A', index: 2, field: 'passage', note: 'Another paragraph' }, { side: 'B', index: 1, field: 'code', start: 0, end: 18, quote: code.slice(0, 18), note: 'Code' }];
  let state = updateSession(normalizeState(null), 'python', { highlights });
  assert.equal(state.sessions.python.highlights.length, 5);
  assert.deepEqual(highlightRanges(state.sessions.python.highlights, 'A', 0, 'text'), [{ start: 0, end: 30 }, { start: 50, end: 60 }]);
  const id = highlightId(highlights[1]);
  state = updateSession(state, 'python', { highlights: state.sessions.python.highlights.map(item => highlightId(item) === id ? { ...item, note: 'Updated independently' } : item) });
  assert.equal(state.sessions.python.highlights[0].note, 'First');
  assert.equal(state.sessions.python.highlights[1].note, 'Updated independently');
  state = updateSession(state, 'python', { highlights: state.sessions.python.highlights.filter(item => highlightId(item) !== id) });
  assert.equal(state.sessions.python.highlights.length, 4);
  assert.deepEqual(highlightRanges(state.sessions.python.highlights, 'A', 0, 'text'), [{ start: 0, end: 20 }, { start: 50, end: 60 }]);
  assert.deepEqual(readState({ getItem: () => JSON.stringify(state) }), state);
});

test('highlight validation removes duplicates and rejects forged or invalid source ranges', () => {
  const text = examples[0].answers.A.paragraphs[0].text;
  const valid = { side: 'A', index: 0, field: 'text', start: 0, end: 15, quote: text.slice(0, 15), note: 'Keep my note' };
  const highlights = [null, valid, { ...valid, note: 'Duplicate must not replace note' }, { ...valid, start: -1 }, { ...valid, end: 9999 }, { ...valid, quote: 'forged' }, { ...valid, side: 'C' }, { ...valid, index: 2.5 }, { ...valid, field: 'code' }, { side: 'B', index: 1, field: 'passage', note: 'x'.repeat(900) }];
  const state = normalizeState({ sessions: { python: { highlights } } });
  assert.equal(state.sessions.python.highlights.length, 2);
  assert.equal(state.sessions.python.highlights[0].note, 'Keep my note');
  assert.equal(state.sessions.python.highlights[1].note.length, 600);
});
