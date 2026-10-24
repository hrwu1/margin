import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from './api';
import type { Comparison, HistoryPage, Score, Session, VoteInput } from './api';
import { ComparisonPanel } from './ComparisonPanel';

function routeFromHash() {
  const [view, id] = location.hash.slice(1).split('/');
  return { view: view === 'history' || view === 'scores' ? view : 'compare', id: view === 'compare' ? id : undefined };
}

export function App() {
  const [route, setRoute] = useState(routeFromHash);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [history, setHistory] = useState<HistoryPage>({ items: [], has_more: false });
  const [scores, setScores] = useState<Score[]>([]);
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const request = useRef<{ prompt: string; id: string } | null>(null);
  const overviewVersion = useRef(0);

  useEffect(() => {
    const changed = () => { setRoute(routeFromHash()); setError(''); setPollError(''); };
    window.addEventListener('hashchange', changed);
    api<Session>('/session', { method: 'POST' }).then(setSession).catch(error => setError(errorMessage(error)));
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  const refreshOverview = useCallback(async () => {
    const version = ++overviewVersion.current;
    const [nextHistory, nextScores] = await Promise.all([
      api<HistoryPage>(`/comparisons?limit=20&offset=${offset}`), api<{ items: Score[] }>('/scores'),
    ]);
    if (version !== overviewVersion.current) return;
    setHistory(nextHistory);
    setScores(nextScores.items);
  }, [offset]);

  useEffect(() => {
    if (session) void refreshOverview().catch(error => setError(errorMessage(error)));
  }, [session, refreshOverview, route.view]);

  useEffect(() => {
    setComparison(null);
    setPollError('');
    if (!session || !route.id) return;
    const controller = new AbortController();
    api<Comparison>(`/comparisons/${encodeURIComponent(route.id)}`, { signal: controller.signal })
      .then(setComparison).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); });
    return () => controller.abort();
  }, [session, route.id, refreshKey]);

  useEffect(() => {
    if (!comparison || comparison.status !== 'pending') return;
    const controller = new AbortController();
    const identifier = comparison.id;
    const deadline = Date.now() + 130000;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<Comparison>(`/comparisons/${identifier}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setComparison(next);
        if (next.status !== 'pending') { await refreshOverview(); return; }
        if (Date.now() >= deadline) { setPollError('This comparison is still pending. Refresh to check its latest saved state.'); return; }
        timer = setTimeout(poll, 750);
      } catch (error) { if (!controller.signal.aborted) setPollError(errorMessage(error)); }
    }
    timer = setTimeout(poll, 750);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [comparison?.id, comparison?.status, refreshOverview]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !prompt.trim()) return;
    const clean = prompt.trim();
    if (request.current?.prompt !== clean) request.current = { prompt: clean, id: crypto.randomUUID() };
    setSubmitting(true);
    setError('');
    try {
      const created = await api<Comparison>('/comparisons', { method: 'POST', body: JSON.stringify({ prompt: clean, request_id: request.current.id }) });
      request.current = null;
      location.hash = `compare/${created.id}`;
      await refreshOverview();
    } catch (error) { setError(errorMessage(error)); }
    finally { setSubmitting(false); }
  }

  async function vote(input: VoteInput) {
    if (!comparison) return;
    setError('');
    try {
      const saved = await api<Comparison>(`/comparisons/${comparison.id}/vote`, { method: 'POST', body: JSON.stringify(input) });
      if (routeFromHash().id === saved.id) setComparison(saved);
      await refreshOverview();
    } catch (error) { setError(errorMessage(error)); }
  }

  return <div className="app">
    <header><a className="brand" href="#compare">Margin <span>backend preview</span></a>
      <nav aria-label="Main"><a href="#compare" aria-current={route.view === 'compare' ? 'page' : undefined}>Compare</a><a href="#history" aria-current={route.view === 'history' ? 'page' : undefined}>History</a><a href="#scores" aria-current={route.view === 'scores' ? 'page' : undefined}>Scorecard</a></nav>
    </header>
    <main>
      <h1>{route.view === 'history' ? 'Your comparison history' : route.view === 'scores' ? 'Your model scorecard' : 'Compare two responses'}</h1>
      <p className="intro">Anonymous browser session · Python API · SQLite storage</p>
      {session?.provider_mode === 'mock' && <p className="notice"><strong>Local test provider.</strong> No AI models are connected yet. These deterministic responses test the backend; votes and history are saved in SQLite.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!session && !error && <p role="status">Opening your anonymous session…</p>}
      {session && route.view === 'compare' && <>
        {!route.id ? <form className="prompt-form" onSubmit={event => void submit(event)}>
          <label htmlFor="prompt">Your prompt</label><textarea id="prompt" value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={session.max_prompt_length} rows={5} placeholder="Ask a question, rewrite a message, or explain a piece of code." required />
          <div className="form-footer"><span className="hint">{prompt.length.toLocaleString()} / {session.max_prompt_length.toLocaleString()} characters</span><button className="primary" type="submit" disabled={submitting || !prompt.trim()}>{submitting ? 'Creating comparison…' : 'Compare responses'}</button></div>
        </form> : <>
          <div className="toolbar"><a href="#compare">← New comparison</a><button onClick={() => { setError(''); setRefreshKey(value => value + 1); }}>Refresh comparison</button></div>
          {pollError && <p className="error" role="alert">{pollError}</p>}
          {!comparison && !error && <p role="status">Loading the saved comparison…</p>}
          {comparison && <ComparisonPanel key={comparison.id} comparison={comparison} onVote={vote} onRetry={() => { setPrompt(comparison.prompt); location.hash = 'compare'; }} />}
        </>}
      </>}
      {session && route.view === 'history' && <section aria-label="Saved comparisons">
        <p className="hint">Only comparisons from this browser session appear here. Opening one restores its responses, vote, reason, and evidence.</p>
        {!history.items.length ? <p className="empty">No comparisons yet. <a href="#compare">Start your first comparison.</a></p> : <ul className="history">{history.items.map(item => <li key={item.id}>
          <a href={`#compare/${item.id}`}>{item.prompt.length > 180 ? `${item.prompt.slice(0, 180)}…` : item.prompt}</a>
          <span>{new Date(item.created_at).toLocaleString()} · {item.vote ? item.vote === 'tie' ? 'Voted: tie' : `Voted: ${item.vote}` : item.status === 'ready' ? 'Ready to vote' : item.status === 'pending' ? 'Generating' : 'Failed — view details'}</span>
        </li>)}</ul>}
        <div className="pagination"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</button><span>Page {Math.floor(offset / 20) + 1}</span><button disabled={!history.has_more} onClick={() => setOffset(offset + 20)}>Next</button></div>
      </section>}
      {session && route.view === 'scores' && <section aria-label="Model scores"><p className="hint">Counts come from your saved votes. A tie adds one tie to both models; failed or unvoted comparisons do not count.</p>
        <div className="table-scroll"><table><caption className="sr-only">Your model wins, ties, losses, and completed comparisons</caption><thead><tr><th>Model</th><th>Wins</th><th>Ties</th><th>Losses</th><th>Compared</th></tr></thead><tbody>{scores.map(score => <tr key={score.model}><th scope="row">{score.model}</th><td>{score.wins}</td><td>{score.ties}</td><td>{score.losses}</td><td>{score.compared}</td></tr>)}</tbody></table></div>
        {!scores.some(score => score.compared) && <p className="empty">Your first vote will update these scores.</p>}
      </section>}
    </main>
    <footer>Saved on this server, scoped to this browser. Clearing your session cookie starts a new history.</footer>
  </div>;
}
