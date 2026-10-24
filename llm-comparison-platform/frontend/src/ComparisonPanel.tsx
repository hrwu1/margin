import { useState } from 'react';
import type { Choice, Comparison, Evidence, Reason, VoteInput } from './api';

const reasons: Reason[] = ['Clarity', 'Depth', 'Practicality', 'Follows the prompt'];

export function ComparisonPanel({ comparison, onVote, onRetry }: {
  comparison: Comparison; onVote: (vote: VoteInput) => Promise<void>; onRetry: () => void;
}) {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [saving, setSaving] = useState(false);
  const vote = comparison.vote;
  const marked = vote?.evidence || evidence;

  async function cast(choice: Choice) {
    setSaving(true);
    try { await onVote({ choice, reason, evidence }); }
    finally { setSaving(false); }
  }

  return <section aria-label="Current comparison">
    <div className="section-heading"><h2>Compare the responses</h2><span className="status">{comparison.status === 'pending' ? 'Generating…' : comparison.status === 'failed' ? 'Incomplete pair' : vote ? 'Vote saved' : 'Ready to vote'}</span></div>
    <p className="prompt-display">{comparison.prompt}</p>
    <p className="hint">{vote ? 'Your decision and marked passage are stored in the database.' : 'Model names stay hidden until you vote. Mark a paragraph if it helps explain your choice.'}</p>
    <div className="responses">
      {comparison.responses.map(answer => <article className="response" key={answer.side} aria-label={`Response ${answer.side}`}>
        <h3>Response {answer.side}{answer.model && <span className="model">{answer.model}</span>}</h3>
        {answer.status === 'pending' && <p className="loading" role="status">Waiting for this response…</p>}
        {answer.error && <p className="error">{answer.error}</p>}
        {answer.paragraphs.map((paragraph, index) => {
          const selected = marked?.side === answer.side && marked.paragraph_index === index;
          const content = <span id={`passage-${answer.side}-${index}`}>{paragraph}</span>;
          return vote ? <p className={`passage ${selected ? 'marked' : ''}`} key={index}>{content}{selected && <small>Saved evidence</small>}</p>
            : <button key={index} className={`passage ${selected ? 'marked' : ''}`} aria-pressed={selected}
                aria-label={`${selected ? 'Unmark' : 'Mark'} response ${answer.side} paragraph ${index + 1}`} aria-describedby={`passage-${answer.side}-${index}`}
                onClick={() => setEvidence(selected ? null : { side: answer.side, paragraph_index: index })}>
                {content}{selected && <small>Marked for your decision</small>}
              </button>;
        })}
      </article>)}
    </div>
    {vote ? <section className="receipt" aria-label="Saved vote" role="status">
      <h3>{vote.choice === 'tie' ? 'You chose a tie.' : `You preferred response ${vote.choice}.`}</h3>
      <p>{vote.reason ? `Reason: ${vote.reason}` : 'No reason added.'}</p>
      {vote.evidence && <blockquote>{vote.evidence.quote}</blockquote>}
      <a href="#scores">View your scorecard →</a>
    </section> : <section className="vote-panel" aria-label="Voting">
      <label>Reason (optional)<select value={reason || ''} onChange={event => setReason(event.target.value as Reason || null)} disabled={saving}>
        <option value="">No reason</option>{reasons.map(value => <option key={value}>{value}</option>)}
      </select></label>
      <div className="vote-actions">{(['A', 'tie', 'B'] as const).map(choice => <button key={choice} disabled={comparison.status !== 'ready' || saving}
        onClick={() => void cast(choice)}>{choice === 'tie' ? 'It’s a tie' : `I prefer ${choice}`}</button>)}</div>
      <p className="hint">{saving ? 'Saving your decision…' : comparison.status !== 'ready' ? 'Voting is available only when both responses succeed.' : 'One vote per comparison. Your choice reveals the models.'}</p>
    </section>}
    {comparison.status === 'failed' && <button onClick={onRetry}>Start a new comparison with this prompt</button>}
  </section>;
}
