import { useState } from 'react';
import type { Score } from './api';
import { summarizeScores, winRate } from './scoreSummary';
import { Icon } from './ui';

const percentage = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });
const count = (value: number) => value.toLocaleString();

export function Scorecard({ scores, unavailable, onNotebook, onCompare }: {
  scores: Score[] | null; unavailable: boolean; onNotebook: () => void; onCompare: () => void;
}) {
  const [includeTies, setIncludeTies] = useState(true);
  if (!scores) return <div className="scorecard"><p className="library-intro" role="status">{unavailable ? 'Your scorecard could not be loaded.' : 'Loading your results…'}</p></div>;
  const summary = summarizeScores(scores);
  const headline = !summary.total ? 'No votes yet' : summary.leader || (summary.decisive ? 'An even match so far' : 'No clear preference yet');
  const explanation = !summary.total ? 'Compare two answers and choose a favorite. Your decisions build the picture here.'
    : summary.leader ? `Leads by ${count(summary.lead)} ${summary.lead === 1 ? 'win' : 'wins'} in your saved decisions.`
      : summary.decisive ? 'No model has an outright lead in wins.' : 'Every decision so far is a tie. No model has a win yet.';

  return <div className="scorecard">
    <section className="scorecard-summary" aria-label="Overall result">
      <div className="scorecard-kicker"><span>Your preferences</span><span>Browser session</span></div>
      <h3>{headline}</h3><p>{explanation}</p>
      {!summary.total && <button className="primary" onClick={onCompare}>Compare answers <Icon name="arrow"/></button>}
      <dl className="scorecard-totals">
        <div><dt>Voted comparisons</dt><dd>{count(summary.total)}</dd></div>
        <div><dt>Decisive votes</dt><dd>{count(summary.decisive)}</dd></div>
        <div><dt>Ties</dt><dd>{count(summary.ties)}</dd></div>
      </dl>
    </section>

    <section aria-labelledby="model-results-heading">
      <div className="scorecard-toolbar"><h3 id="model-results-heading">Model results</h3>
        <label className="scorecard-filter"><input type="checkbox" checked={includeTies} onChange={event => setIncludeTies(event.target.checked)}/>Include ties in win rate</label>
      </div>
      <p className="scorecard-formula">{includeTies ? 'Win rate = wins ÷ all voted comparisons. Ties count as comparisons, not wins.' : 'Win rate = wins ÷ decisive votes. Ties are excluded from the percentage.'}</p>
      <div className="scorecard-models" aria-live="polite" aria-atomic="true">
        {scores.map(score => {
          const rate = winRate(score, includeTies);
          return <article className="scorecard-model" key={score.model} aria-label={`${score.model} results`}>
            <header><h4>{score.model}</h4>{summary.leader === score.model && <span className="scorecard-leader"><Icon name="check"/>Most wins</span>}</header>
            <div className="scorecard-rate"><strong>{rate.value === null ? '—' : percentage.format(rate.value)}</strong><span>win rate</span></div>
            <p className="scorecard-sample">{rate.denominator ? `${count(score.wins)} ${score.wins === 1 ? 'win' : 'wins'} from ${count(rate.denominator)} ${includeTies ? 'voted comparison' : 'decisive vote'}${rate.denominator === 1 ? '' : 's'}` : includeTies ? 'Waiting for your first vote' : 'No decisive votes yet'}</p>
            <div className="scorecard-bar" role="img" aria-label={`${score.model}. Wins: ${count(score.wins)}. Ties: ${count(score.ties)}. Losses: ${count(score.losses)}. Voted comparisons: ${count(score.compared)}.`}>
              {(['wins', 'ties', 'losses'] as const).map(outcome => <span key={outcome} className={`scorecard-${outcome}`} style={{ width: `${score.compared ? score[outcome] / score.compared * 100 : 0}%` }}/>) }
            </div>
            <dl className="scorecard-outcomes">{(['wins', 'ties', 'losses'] as const).map(outcome => <div key={outcome}><dt><i className={`scorecard-${outcome}`} aria-hidden="true"/>{outcome}</dt><dd>{count(score[outcome])}</dd></div>)}</dl>
          </article>;
        })}
      </div>
      <p className="scorecard-caption">Outcome bars always show all votes, including ties.</p>
    </section>

    <div className="scorecard-context"><Icon name="book"/><div><strong>Look back at your decisions.</strong><p>Each comparison counts once, using your latest vote. This is a personal record, not a universal ranking.</p></div><button className="quiet-button" onClick={onNotebook}>Review decisions <Icon name="arrow"/></button></div>
  </div>;
}
