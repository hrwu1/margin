import type { RankedScore } from './api';

export function rankedScores(scores: RankedScore[]) {
  const sorted = [...scores].sort((a, b) => a.average_rank - b.average_rank || a.model.localeCompare(b.model));
  return sorted.map(score => ({ ...score, place: 1 + sorted.filter(other => other.average_rank < score.average_rank).length }));
}
