import test from 'node:test';
import assert from 'node:assert/strict';
import { rankedScores } from './scoreSummary.ts';
import { rankingLabel, validRanking } from './format.ts';

const score = (model, average_rank, compared = 1) => ({ model, average_rank, compared });

test('lower average ranks lead; equal averages share places regardless of sample size', () => {
  const input = [score('c', 3), score('b', 1.5, 4), score('a', 1.5, 2)];
  const before = structuredClone(input);
  assert.deepEqual(rankedScores(input).map(({ model, place }) => [model, place]), [['a', 1], ['b', 1], ['c', 3]]);
  assert.deepEqual(input, before);
  assert.deepEqual(rankedScores([]), []);
});

test('complete rankings require each participant and a first rank, and allow ties and gaps', () => {
  assert.ok(validRanking({ A: 1, B: 2 }, ['A', 'B']));
  assert.ok(validRanking({ A: 1, B: 1, C: 1 }, ['A', 'B', 'C']));
  assert.ok(validRanking({ A: 1, B: 3, C: 3 }, ['A', 'B', 'C']));
  for (const ranks of [{ A: 1 }, { A: 1, C: 2 }, { A: 2, B: 2 }, { A: 1, B: 3 }, { A: 1, B: 1.5 }, { A: 1, B: 2, C: 3 }]) {
    assert.equal(validRanking(ranks, ['A', 'B']), false);
  }
});

test('history labels show full preference including tied groups', () => {
  assert.equal(rankingLabel({ C: 2, B: 1, A: 1 }), 'A = B > C');
  assert.equal(rankingLabel({ A: 2, B: 1 }), 'B > A');
  assert.equal(rankingLabel({ A: 1, B: 2, C: 2 }), 'A > B = C');
  assert.equal(rankingLabel({ A: 1, B: 1, C: 1 }), 'A = B = C');
});
