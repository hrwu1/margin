import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { api, errorMessage } from './api';
import type { Choice, Comparison, Highlight, Reason, Side } from './api';
import { displayParagraph, highlightId, markedParts, inlineParts, sourceRange } from './format';
import { useAnnotations } from './useAnnotations';
import { Icon } from './ui';
import type { Feedback } from './ui';

export type ComparisonHandle = { flush: () => Promise<boolean> };
const reasons: Reason[] = ['Correctness', 'Clarity', 'Useful detail', 'Follows the prompt'];
export function ComparisonPanel({ comparison, onSaved, drawerOpen, setDrawerOpen, onNew, nextQuestion, feedback, notify, ref }: {
  comparison: Comparison; onSaved: (value: Comparison) => void; drawerOpen: boolean; setDrawerOpen: (open: boolean) => void;
  nextQuestion?: { ready: boolean; label: string; open: () => void };
  onNew: (prompt?: string) => void; feedback: Feedback; notify: (message: string) => void; ref: Ref<ComparisonHandle>;
}) {
  const { draft, update, status, error, flush, revision, discard } = useAnnotations(comparison, onSaved);
  const [mobileSide, setMobileSide] = useState<Side>('A');
  const [compact, setCompact] = useState(matchMedia('(max-width: 900px)').matches);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voteError, setVoteError] = useState('');
  const [selection, setSelection] = useState<{ highlight: Highlight; rect: DOMRect } | null>(null);
  const drawer = useRef<HTMLElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const vote = comparison.vote;
  useImperativeHandle(ref, () => ({ flush }), [flush]);

  useEffect(() => {
    const media = matchMedia('(max-width: 900px)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!drawerOpen || !compact) return;
    const previous = document.activeElement as HTMLElement;
    const background = [...document.querySelectorAll<HTMLElement>('.sidebar,.topbar,.prompt-region,.comparison,.workspace-foot,.skip-link,.question-queue')];
    background.forEach(element => { element.inert = true; });
    drawer.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setDrawerOpen(false); }
      if (event.key !== 'Tab') return;
      const controls = [...drawer.current!.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled)')].filter(node => node.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('keydown', keys); background.forEach(element => { element.inert = false; }); previous?.focus(); };
  }, [drawerOpen, compact, setDrawerOpen]);
  useEffect(() => {
    if (!editing) return;
    document.querySelector<HTMLButtonElement>('.decision-dock button[aria-pressed=true]')?.focus();
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { setEditing(false); requestAnimationFrame(() => editButton.current?.focus()); } };
    document.addEventListener('keydown', cancel);
    return () => document.removeEventListener('keydown', cancel);
  }, [editing]);
  useEffect(() => {
    const capture = () => {
      const selected = window.getSelection();
      if (vote || saving || !selected || selected.isCollapsed || !selected.rangeCount) { setSelection(null); return; }
      const range = selected.getRangeAt(0);
      const element = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement)?.closest<HTMLElement>('[data-source]');
      if (!element || !element.contains(range.endContainer)) { setSelection(null); return; }
      const side = element.dataset.side as Side, index = Number(element.dataset.index);
      const source = comparison.responses.find(answer => answer.side === side)!.paragraphs[index];
      const prefix = range.cloneRange(); prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset);
      const suffix = range.cloneRange(); suffix.selectNodeContents(element); suffix.setEnd(range.endContainer, range.endOffset);
      const display = displayParagraph(comparison.responses.find(answer => answer.side === side)!.paragraphs, index);
      const rangeInSource = sourceRange(inlineParts(display.text, display.offset, display.code), Array.from(prefix.toString()).length, Array.from(suffix.toString()).length);
      if (!rangeInSource) { setSelection(null); return; }
      const { start, end } = rangeInSource;
      const quote = Array.from(source).slice(start, end).join('');
      if (!quote.trim()) { setSelection(null); return; }
      setSelection({ highlight: { side, paragraph_index: index, start, end, quote, note: '' }, rect: range.getBoundingClientRect() });
    };
    document.addEventListener('selectionchange', capture);
    return () => document.removeEventListener('selectionchange', capture);
  }, [comparison.responses, vote, saving]);

  function addHighlight(highlight: Highlight, rect?: DOMRect) {
    if (draft.highlights.some(item => highlightId(item) === highlightId(highlight))) { notify('This passage is already highlighted.'); setDrawerOpen(true); return; }
    if (draft.highlights.length >= 50) { notify('You can keep up to 50 highlights per comparison.'); return; }
    update({ ...draft, highlights: [...draft.highlights, highlight] });
    feedback.transfer(rect);
    setSelection(null); window.getSelection()?.removeAllRanges();
    setDrawerOpen(true);
    notify('Highlight added. Add a note if you like.');
  }
  function showSource(item: Highlight) {
    setMobileSide(item.side);
    if (matchMedia('(max-width: 900px)').matches) setDrawerOpen(false);
    requestAnimationFrame(() => {
      const element = document.getElementById(`passage-${item.side}-${item.paragraph_index}`);
      element?.scrollIntoView({ block: 'center', behavior: feedback.motion ? 'smooth' : 'auto' });
      element?.focus({ preventScroll: true });
    });
  }
  async function cast(choice: Choice) {
    if (saving) return;
    setSaving(true); setVoteError('');
    try {
      if (!await flush()) { setDrawerOpen(true); return; }
      const saved = await api<Comparison>(`/comparisons/${comparison.id}/vote`, {
        method: vote ? 'PATCH' : 'POST', body: JSON.stringify(vote ? { choice, revision: vote.revision } : { choice, annotation_revision: revision.current }),
      });
      onSaved(saved); setEditing(false); feedback.pulse(true);
      notify(vote ? 'Vote updated. Your scorecard now reflects this choice.' : 'Vote saved. Model identities revealed.');
      requestAnimationFrame(() => {
        const decision = document.getElementById('saved-decision');
        decision?.focus({ preventScroll: true });
        if (decision) feedback.animate(decision, [{ opacity: .35, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], 240);
      });
    } catch (failure) { setVoteError(errorMessage(failure)); }
    finally { setSaving(false); }
  }
  return <>
    <section className="prompt-region" aria-label="Shared prompt">
      <div className="prompt-heading"><h1>Shared prompt</h1><span className="prompt-tag">Identical input · independent responses</span><button className="quiet-button reuse-prompt" onClick={() => onNew(comparison.prompt)}>Reuse prompt</button></div>
      <p className="prompt-text">{comparison.prompt}</p>
    </section>
    <div className={`workspace-body ${drawerOpen ? 'drawer-open' : ''}`}>
      <section className="comparison" aria-label="Compare answers">
        <div className="reading-status"><span><Icon name={vote ? 'check' : 'lock'}/>{vote ? 'Models revealed · your judgment is saved' : comparison.status === 'pending' ? 'Generating both answers · identities hidden' : 'Read first. Model identities stay hidden until you vote.'}</span><span className="selection-hint">Select text or use Highlight · Optional</span></div>
        <div className="mobile-answer-tabs" data-side={mobileSide} aria-label="Visible answer">{(['A', 'B'] as const).map(side => <button key={side} aria-pressed={mobileSide === side} onClick={() => { setMobileSide(side); feedback.pulse(); }}>Answer {side}</button>)}</div>
        <div className="answers" id="answers" tabIndex={-1}>
          {comparison.responses.map(answer => <article key={answer.side} className={`answer-panel ${vote?.choice === answer.side ? 'preferred' : ''}`} data-mobile-hidden={mobileSide !== answer.side} aria-label={`Answer ${answer.side}`}>
            <header className="answer-header"><span className="letter">{answer.side}</span><div className="answer-identity"><h2>{answer.model || `Answer ${answer.side}`}</h2><small>{answer.model ? 'Identity revealed' : 'Anonymous response'}</small></div><span className="identity-icon"><Icon name={vote ? 'check' : 'lock'}/>{vote ? 'Revealed' : 'Blind'}</span></header>
            <div className="answer-scroll">
              {answer.status === 'pending' && <div className="generation-state" role="status"><span className="working-dot"/><strong>Writing answer {answer.side}</strong><p>Both models received your prompt. This answer will appear as soon as it’s ready.</p><div className="skeleton"/><div className="skeleton"/><div className="skeleton short"/></div>}
              {answer.error && <div className="generation-state error-card" role="alert"><strong>Answer {answer.side} unavailable</strong><p>{answer.error}</p><button className="quiet-button" onClick={() => onNew(comparison.prompt)}>Reuse prompt</button></div>}
              {answer.paragraphs.map((raw, index) => {
                const source = displayParagraph(answer.paragraphs, index);
                const highlights = draft.highlights.filter(item => item.side === answer.side && item.paragraph_index === index);
                const whole = { side: answer.side, paragraph_index: index, start: 0, end: Array.from(raw).length, quote: raw, note: '' };
                const already = highlights.some(item => highlightId(item) === highlightId(whole));
                const text = inlineParts(source.text, source.offset, source.code).map((token, tokenIndex) => {
                  const parts = markedParts(token.text, highlights, token.offset).map((part, i) => part.marked ? <mark key={i}>{part.text}</mark> : part.text);
                  return token.kind === 'strong' ? <strong key={tokenIndex}>{parts}</strong> : token.kind === 'code' ? <code key={tokenIndex}>{parts}</code> : <span key={tokenIndex}>{parts}</span>;
                });
                const attributes = { 'data-source': true, 'data-side': answer.side, 'data-index': index, 'data-offset': source.offset };
                return <section className={`passage ${highlights.length ? 'marked' : ''}`} key={index} id={`passage-${answer.side}-${index}`} tabIndex={-1}>
                  <div className="passage-heading"><span className="passage-index">{String(index + 1).padStart(2, '0')}</span><span className="passage-kind">{source.code ? 'Code' : source.heading ? 'Heading' : 'Passage'}</span>{!vote && <button className="keep-button" disabled={saving || already} onClick={event => addHighlight(whole, event.currentTarget.getBoundingClientRect())} aria-label={`Highlight answer ${answer.side} passage ${index + 1}`}><Icon name={already ? 'check' : 'plus'}/><span>{already ? 'Highlighted' : 'Highlight'}</span></button>}</div>
                  {source.code ? <pre><code {...attributes}>{text}</code></pre> : <div {...attributes} className={`passage-text ${source.heading ? 'text-heading' : ''}`}>{text}</div>}
                </section>;
              })}
              {answer.status === 'success' && <div className="answer-ending"><i/>End of answer {answer.side}<i/></div>}
            </div>
          </article>)}
        </div>
        {voteError && <div className="storage-warning" role="alert">{voteError}</div>}
        <section className="decision-dock" aria-label="Your decision">
          {vote && !editing ? <><div className="saved-decision" id="saved-decision" tabIndex={-1}><span className="saved-icon"><Icon name="check"/></span><div><strong>{vote.choice === 'tie' ? 'You chose a tie' : `You preferred answer ${vote.choice}`}</strong><p>{draft.highlights.length} highlights · {draft.reason || 'No reason added'}{vote.edited && <span className="edited-label">Edited after reveal</span>}</p></div></div><div className="dock-actions"><button className="quiet-button" ref={editButton} onClick={() => setEditing(true)}>Change vote</button><button className="primary" disabled={nextQuestion && !nextQuestion.ready} onClick={() => nextQuestion ? nextQuestion.open() : onNew()}>{nextQuestion?.label || 'New comparison'} <Icon name="arrow"/></button></div></> : <>
            <div className="decision-copy"><strong>{editing ? 'Change your vote' : comparison.status === 'failed' ? 'This pair is incomplete' : 'Which answer works better?'}</strong>{editing ? <button className="quiet-button cancel-vote" disabled={saving} onClick={() => { setEditing(false); requestAnimationFrame(() => editButton.current?.focus()); }}>Cancel</button> : <span>{saving ? 'Saving decision…' : comparison.status === 'pending' ? 'Voting opens when both answers finish' : comparison.status === 'failed' ? 'Both answers must succeed to vote' : 'Your choice reveals the models'}</span>}</div>
            <div className="votes">{(['A', 'tie', 'B'] as const).map(choice => <button key={choice} className={`vote-button ${choice === 'tie' ? 'tie' : ''}`} disabled={saving || comparison.status !== 'ready'} aria-pressed={editing ? vote?.choice === choice : undefined} onClick={() => void cast(choice)}>{choice === 'tie' ? 'It’s a tie' : `Prefer ${choice}`}</button>)}</div>
          </>}
        </section>
      </section>
      <div className="drawer-slot" inert={!drawerOpen} aria-hidden={!drawerOpen}><aside className="evidence-drawer" ref={drawer} id="evidence-drawer" role={compact ? 'dialog' : undefined} aria-modal={compact && drawerOpen ? true : undefined} aria-labelledby="evidence-title">
        <header className="drawer-header"><h2 id="evidence-title"><Icon name="quote"/>Highlights <small>Optional</small></h2><button className="icon-button" aria-label="Close highlights" onClick={() => setDrawerOpen(false)}><Icon name="close"/></button></header>
        <div className="drawer-scroll">
          <p className="drawer-intro">{vote ? 'The passages and notes you saved before revealing the models. Your vote can change; this snapshot stays intact.' : 'Keep useful details or mistakes that influence your vote. Select a sentence or code excerpt, or use Highlight to keep a whole passage.'}</p>
          {!draft.highlights.length && <div className="empty-evidence"><Icon name="quote"/><strong>{vote ? 'No highlights saved' : 'What influenced your choice?'}</strong><p>{vote ? 'You voted without adding highlights. That’s fine—highlights are always optional.' : 'Capture more than one passage, from either answer. Add a note to explain what stood out.'}</p>{!vote && <span>You can vote without highlighting anything.</span>}</div>}
          {draft.highlights.map(item => <section className="evidence-card" key={highlightId(item)}>
            <header><span>Answer {item.side} · Passage {item.paragraph_index + 1}</span>{!vote && <button className="icon-button" disabled={saving} aria-label={`Remove highlight from ${item.side} passage ${item.paragraph_index + 1}`} onClick={() => update({ ...draft, highlights: draft.highlights.filter(other => highlightId(other) !== highlightId(item)) })}><Icon name="close"/></button>}</header>
            <blockquote>{item.quote}</blockquote>
            <div className="highlight-note">{vote ? item.note && <div className="saved-highlight-note"><span>Your note</span><p>{item.note}</p></div> : <label>Note for this highlight <span>Optional</span><textarea aria-label={`Note for ${item.side} passage ${item.paragraph_index + 1}`} maxLength={1000} value={item.note} disabled={saving} placeholder="Why does this detail matter?" onChange={event => update({ ...draft, highlights: draft.highlights.map(other => highlightId(other) === highlightId(item) ? { ...other, note: event.target.value } : other) })}/></label>}</div>
            <button className="show-passage" onClick={() => showSource(item)}>Show in answer <Icon name="arrow"/></button>
          </section>)}
          <section className="reason-section"><fieldset disabled={Boolean(vote) || saving}><legend>Overall reason <span>Optional</span></legend><div className="reasons">{[...new Set([...reasons, ...(draft.reason ? [draft.reason] : [])])].map(reason => <button key={reason} aria-pressed={draft.reason === reason} onClick={() => update({ ...draft, reason: draft.reason === reason ? null : reason })}>{reason}</button>)}</div></fieldset>
            <label className="note-label" htmlFor="overall-note">Overall note <span>Optional</span></label><textarea id="overall-note" placeholder="What ultimately made the difference?" value={draft.note} readOnly={Boolean(vote)} disabled={saving} maxLength={2000} onChange={event => update({ ...draft, note: event.target.value })}/>
            <p className="note-status" role="status">{vote ? 'Saved with your first vote' : `${status} · changes save automatically`}</p>
            {error && <div className="annotation-error" role="alert"><p>{error}</p><button className="quiet-button" onClick={() => void flush()}>Retry saving</button><button className="quiet-button" onClick={() => { if (confirm('Reload the saved comparison and discard unsaved changes?')) { discard(); location.reload(); } }}>Reload saved version</button></div>}
          </section>
          <p className="drawer-end"><Icon name="lock"/>{vote ? 'Stored with this anonymous browser session.' : 'Highlights and notes become read-only when you first vote.'}</p>
        </div><div className="drawer-return"><button className="quiet-button" onClick={() => setDrawerOpen(false)}>Back to comparison</button></div>
      </aside></div>
    </div>
    {drawerOpen && <div className="drawer-backdrop" aria-hidden="true" onClick={() => setDrawerOpen(false)}/>}
    {selection && <div id="selection-tools" style={{ left: Math.max(8, Math.min(selection.rect.left, innerWidth - 192)), top: Math.max(8, Math.min(selection.rect.top - 46, innerHeight - 52)) }}><button id="keep-selection" onPointerDown={event => event.preventDefault()} onClick={() => addHighlight(selection.highlight, selection.rect)}>Highlight selection <Icon name="plus"/></button></div>}
  </>;
}
