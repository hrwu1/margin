import type { Score } from './api';

export function summarizeScores(scores: Score[]) {
  // Each comparison contributes two model results, but only one decision.
  const decisive = scores.reduce((sum, score) => sum + score.wins, 0);
  const ties = scores.reduce((sum, score) => sum + score.ties, 0) / 2;
  const ranked = scores.filter(score => score.compared > 0).sort((a, b) => b.wins - a.wins);
  const lead = ranked.length > 1 ? ranked[0].wins - ranked[1].wins : 0;
  return { total: decisive + ties, decisive, ties, lead, leader: lead > 0 ? ranked[0].model : null };
}

export function winRate(score: Score, includeTies: boolean) {
  const denominator = includeTies ? score.compared : score.wins + score.losses;
  return { denominator, value: denominator ? score.wins / denominator : null };
}
