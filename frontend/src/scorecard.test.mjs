import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeScores, winRate } from './scoreSummary.ts';

const score = (model, wins, ties, losses) => ({ model, wins, ties, losses, compared: wins + ties + losses });

test('each comparison counts once and ties affect only the selected denominator', () => {
  const scores = [score('first', 2, 1, 1), score('second', 1, 1, 2)];
  assert.deepEqual(summarizeScores(scores), { total: 4, decisive: 3, ties: 1, lead: 1, leader: 'first' });
  assert.deepEqual(winRate(scores[0], true), { denominator: 4, value: .5 });
  assert.deepEqual(winRate(scores[0], false), { denominator: 3, value: 2 / 3 });
});

test('empty and all-tie sessions have no leader or invented decisive percentage', () => {
  for (const scores of [[], [score('a', 0, 0, 0), score('b', 0, 0, 0)]]) {
    assert.deepEqual(summarizeScores(scores), { total: 0, decisive: 0, ties: 0, lead: 0, leader: null });
  }
  const tied = score('a', 0, 3, 0);
  assert.deepEqual(summarizeScores([tied, score('b', 0, 3, 0)]), { total: 3, decisive: 0, ties: 3, lead: 0, leader: null });
  assert.deepEqual(winRate(tied, true), { denominator: 3, value: 0 });
  assert.deepEqual(winRate(tied, false), { denominator: 0, value: null });
  assert.equal(winRate(score('a', 0, 0, 0), true).value, null);
});

test('equal wins have no leader, and input model order is preserved', () => {
  const scores = [score('b', 3, 2, 3), score('a', 3, 2, 3)];
  const before = structuredClone(scores);
  assert.equal(summarizeScores(scores).leader, null);
  assert.deepEqual(scores, before);
});

test('a revised vote changes the leader without adding a comparison', () => {
  const before = summarizeScores([score('a', 1, 1, 0), score('b', 0, 1, 1)]);
  const after = summarizeScores([score('a', 0, 1, 1), score('b', 1, 1, 0)]);
  assert.equal(before.leader, 'a');
  assert.equal(after.leader, 'b');
  assert.equal(after.total, before.total);
  assert.equal(summarizeScores([score('a', 0, 2, 0), score('b', 0, 2, 0)]).total, before.total);
});

test('historical model pairs still count once and unplayed models cannot lead', () => {
  const scores = [score('a', 2, 0, 0), score('b', 0, 1, 1), score('c', 0, 1, 1), score('new', 0, 0, 0)];
  assert.deepEqual(summarizeScores(scores), { total: 3, decisive: 2, ties: 1, lead: 2, leader: 'a' });
});
