import { useState } from 'react';
import type { ScoreGroup } from './api';
import { rankedScores } from './scoreSummary';
import { Icon } from './ui';

const count = (value: number) => value.toLocaleString();
const average = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3, minimumFractionDigits: 1 });

export function Scorecard({ scores, unavailable, onNotebook, onCompare }: {
  scores: ScoreGroup[] | null; unavailable: boolean; onNotebook: () => void; onCompare: () => void;
}) {
  const [size, setSize] = useState<number | null>(null);
  if (!scores) return <div className="scorecard"><p className="library-intro" role="status">{unavailable ? 'Your scorecard could not be loaded.' : 'Loading your results…'}</p></div>;
  const group = scores.find(group => group.participant_count === (size ?? scores.find(group => group.comparisons > 0)?.participant_count ?? 2));
  const items = rankedScores(group?.items || []);
  const leaders = items.filter(item => item.place === 1);
  const selectedSize = group?.participant_count || 2;
  return <div className="scorecard">
    <div className="composer-mode" role="group" aria-label="Comparison format">{[2, 3].map(value => <button key={value} aria-pressed={selectedSize === value} onClick={() => setSize(value)}>{value}-model comparisons</button>)}</div>
    <section className="scorecard-summary" aria-label="Overall result">
      <div className="scorecard-kicker"><span>Your preferences</span><span>Lower rank is better</span></div>
      <h3>{leaders.length === 1 ? leaders[0].model : leaders.length ? 'A shared lead' : 'No rankings yet'}</h3>
      <p>{items.length ? 'Ordered by average rank across your saved decisions.' : `Rank a ${selectedSize}-model comparison to start this scorecard.`}</p>
      {!items.length && <button className="primary" onClick={onCompare}>Compare answers <Icon name="arrow"/></button>}
      <dl className="scorecard-totals"><div><dt>Ranked comparisons</dt><dd>{count(group?.comparisons || 0)}</dd></div><div><dt>Models ranked</dt><dd>{count(items.length)}</dd></div><div><dt>Answers per comparison</dt><dd>{selectedSize}</dd></div></dl>
    </section>
    <section aria-labelledby="model-results-heading">
      <div className="scorecard-toolbar"><h3 id="model-results-heading">Model results</h3><span>Average rank · lower is better</span></div>
      <p className="scorecard-formula">Tied answers share the average of their positions. {selectedSize === 3 ? 'Two tied first score 1.5 each; the remaining answer scores 3. An all-answer tie scores 2 each.' : 'A winner scores 1 and the other answer 2. A tie scores 1.5 each.'} Scores are averaged across comparisons.</p>
      <div className="scorecard-models" aria-live="polite">
        {items.map(score => <article className="scorecard-model" key={score.model} aria-label={`${score.model} results`}>
          <header><h4>{score.model}</h4><span className={score.place === 1 ? 'scorecard-leader' : ''}>#{score.place}</span></header>
          <div className="scorecard-rate"><strong>{average.format(score.average_rank)}</strong><span>average rank</span></div>
          <p className="scorecard-sample">From {count(score.compared)} ranked {score.compared === 1 ? 'comparison' : 'comparisons'}</p>
          {selectedSize === 2 && <dl className="scorecard-outcomes">{(['wins', 'ties', 'losses'] as const).map(outcome => <div key={outcome}><dt><i className={`scorecard-${outcome}`} aria-hidden="true"/>{outcome}</dt><dd>{count(score[outcome])}</dd></div>)}</dl>}
        </article>)}
      </div>
    </section>
    <div className="scorecard-context"><Icon name="book"/><div><strong>Each decision counts once.</strong><p>Your latest ranking counts. Two-model and three-model results stay separate. Historical votes are included with their equivalent ranks.</p></div><button className="quiet-button" onClick={onNotebook}>Review decisions <Icon name="arrow"/></button></div>
  </div>;
}
