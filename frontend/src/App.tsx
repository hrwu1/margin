import { MotionSettings } from './MotionSettings';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, latestComparison } from './api';
import type { Comparison, HistoryPage, ModelCatalog, ScoreGroup, Session } from './api';
import { ComparisonPanel } from './ComparisonPanel';
import { Scorecard } from './Scorecard';
import { QuestionList, QuestionQueueBar } from './QuestionList';
import { useQuestionQueue } from './useQuestionQueue';
import type { ComparisonHandle } from './ComparisonPanel';
import { dateLabel, rankingLabel } from './format';
import { Dialog, Icon, useFeedback } from './ui';

const currentId = () => location.hash.match(/^#compare\/([a-f\d-]{36})$/i)?.[1] || null;
const starters = [
  { title: 'Explain a tradeoff', prompt: 'When should a small application use SQLite instead of PostgreSQL? Explain the tradeoffs and give a concrete example. Keep the answer under 250 words.' },
  { title: 'Review a function', prompt: 'Review this Python function. Identify its bug, explain a minimal fix, and show the corrected code:\n\ndef average(values):\n    return sum(values) / len(values)' },
  { title: 'Make a message clearer', prompt: 'Rewrite this message to be clear, warm, and concise without changing its meaning: “We have reviewed the implementation and there are a number of things that still need to be addressed before we can consider this to be ready to ship.” Explain your main edit in one sentence.' },
];
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [models, setModels] = useState<string[]>(['', '']);
  const [modelError, setModelError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelReload, setModelReload] = useState(0);
  const [id, setId] = useState(currentId);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [prompts, setPrompts] = useState(['']);
  const [listMode, setListMode] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const prompt = prompts[0];
  const setPrompt = (value: string) => setPrompts(previous => [value, ...previous.slice(1)]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [overviewError, setOverviewError] = useState('');
  const [history, setHistory] = useState<HistoryPage>({ items: [], has_more: false });
  const [recent, setRecent] = useState<HistoryPage['items']>([]);
  const [offset, setOffset] = useState(0);
  const [scores, setScores] = useState<ScoreGroup[] | null>(null);
  const [dialog, setDialog] = useState<'Notebook' | 'Scorecard' | 'Motion & feedback' | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light');
  const [toast, setToast] = useState('');
  const [reload, setReload] = useState(0);
  const panel = useRef<ComparisonHandle>(null);
  const creation = useRef<{ key: string; id: string } | null>(null);
  const overviewVersion = useRef(0);
  const navigationVersion = useRef(0);
  const feedback = useFeedback();
  useEffect(() => feedback.cancel, [id, dialog, feedback.cancel]);
  const visible = comparison?.id === id ? comparison : null;
  const validModels = !modelsLoading && !modelError && new Set(models).size === models.length && models.every(model => catalog?.items.includes(model));
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 3200); return () => clearTimeout(timer); } }, [toast]);
  const refreshOverview = useCallback(async (page = 0) => {
    const version = ++overviewVersion.current;
    try {
      const [nextHistory, nextScores] = await Promise.all([api<HistoryPage>(`/comparisons?limit=20&offset=${page}`), api<{ groups: ScoreGroup[] }>('/scorecards')]);
      if (version !== overviewVersion.current) return;
      setHistory(nextHistory); setScores(nextScores.groups); setOffset(page); setOverviewError('');
      if (page === 0) setRecent(nextHistory.items);
    } catch (failure) { if (version === overviewVersion.current) setOverviewError(errorMessage(failure)); }
  }, []);
  const { queue, state: queueState, storageError } = useQuestionQueue(!!session, value => {
    setComparison(previous => previous?.id === value.id ? latestComparison(previous, value) : previous);
    if (value.status !== 'pending') void refreshOverview();
  });
  useEffect(() => { if (visible) queue.observe(visible); }, [visible?.id, visible?.attempt, visible?.status, queue]);
  const queuedIndex = queueState.items.findIndex(item => item.id === id);
  const nextQuestion = queuedIndex >= 0 ? queueState.items[queuedIndex + 1] : undefined;
  const queuePolling = !queueState.error && (queueState.retry?.comparisonId === id || queuedIndex >= 0 && queueState.items[queuedIndex].status === 'pending');
  useEffect(() => {
    let active = true;
    api<Session>('/session', { method: 'POST' }).then(value => { if (active) { setSession(value); void refreshOverview(); } }).catch(failure => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; };
  }, [refreshOverview]);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setModelsLoading(true); setModelError('');
    api<ModelCatalog>('/models', { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setCatalog(value);
      setModels(previous => {
        const selected: string[] = [];
        for (let index = 0; index < previous.length; index++) {
          selected.push(value.items.includes(previous[index]) && !selected.includes(previous[index]) ? previous[index]
            : [...value.defaults, ...value.items].find(model => !selected.includes(model)) || '');
        }
        return selected;
      });
    }).catch(failure => { if (!controller.signal.aborted) setModelError(errorMessage(failure)); })
      .finally(() => { if (!controller.signal.aborted) setModelsLoading(false); });
    return () => controller.abort();
  }, [session, modelReload]);
  useEffect(() => {
    const change = async () => {
      const next = currentId();
      const version = ++navigationVersion.current;
      if (next === id) return;
      if (panel.current && !await panel.current.flush()) { location.replace(id ? `#compare/${id}` : '#'); notify('Save your changes before leaving this comparison.'); return; }
      if (version !== navigationVersion.current) return;
      setId(next); setDrawerOpen(false); setError(''); setPollError('');
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, [id, notify]);
  useEffect(() => {
    if (!session || !id) return;
    const controller = new AbortController();
    setError('');
    api<Comparison>(`/comparisons/${id}`, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setComparison(previous => latestComparison(previous, value));
    }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [id, session, reload]);
  useEffect(() => {
    if (!visible || visible.status !== 'pending' || queuePolling) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<Comparison>(`/comparisons/${visible.id}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setComparison(previous => latestComparison(previous, next)); setPollError('');
        if (next.status !== 'pending') { void refreshOverview(); return; }
      } catch (failure) { if (controller.signal.aborted) return; setPollError(errorMessage(failure)); }
      timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 650);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [visible?.id, visible?.status, visible?.attempt, queuePolling, refreshOverview]);

  async function navigate(next: string | null, text = '') {
    ++navigationVersion.current;
    if (panel.current && !await panel.current.flush()) { notify('Your changes could not be saved. Retry from Highlights.'); setDrawerOpen(true); return; }
    setDialog(null); setDrawerOpen(false); setError(''); setPollError('');
    if (!next) { setPrompts([text]); setListMode(false); setComparison(null); creation.current = null; }
    location.hash = next ? `compare/${next}` : '';
    setId(next);
    if (!next) requestAnimationFrame(() => document.getElementById('prompt')?.focus());
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || submitting || !session || queue.unfinished || !validModels || importPending) return;
    if (listMode) {
      setSubmitting(true); setError('');
      try {
        queue.start(prompts, models);
        const version = navigationVersion.current;
        const created = await queue.step();
        if (created && version === navigationVersion.current) {
          setComparison(created); location.hash = `compare/${created.id}`; setId(created.id);
          feedback.pulse(); void refreshOverview();
        }
      } catch (failure) { setError(errorMessage(failure)); }
      finally { setSubmitting(false); }
      return;
    }
    const key = JSON.stringify([text, [...models].sort()]);
    if (creation.current?.key !== key) creation.current = { key, id: crypto.randomUUID() };
    setSubmitting(true); setError('');
    try {
      const created = await api<Comparison>('/comparisons', { method: 'POST', body: JSON.stringify({ prompt: text, models, request_id: creation.current.id }) });
      setComparison(created); location.hash = `compare/${created.id}`; setId(created.id);
      creation.current = null; feedback.pulse(); void refreshOverview();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setSubmitting(false); }
  }
  function saved(value: Comparison) {
    setComparison(previous => previous?.id === value.id ? latestComparison(previous, value) : previous);
    if (value.vote) void refreshOverview();
  }
  async function retry(value?: Comparison) {
    const result = await queue.retry(value);
    if (result) {
      saved(result);
      void refreshOverview();
    } else if (queue.state.error) throw new Error(queue.state.error);
  }
  function changeModelCount(count: number) {
    setModels(previous => {
      const next = previous.slice(0, count);
      while (next.length < count) next.push(catalog?.items.find(model => !next.includes(model)) || '');
      return next;
    });
  }
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next); document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#ffffff' : '#08090a');
    try { localStorage.setItem('margin-workspace-theme-v1', next); } catch { notify('Theme changed for this visit. Browser storage is unavailable.'); }
  }
  return <>
    <button className="skip-link" onClick={() => document.getElementById(visible ? 'answers' : 'prompt')?.focus()}>Skip to workspace</button>
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="wordmark"><span className="brand-symbol" aria-hidden="true"><i/><i/><i/></span><span className="brand-name">margin</span></div>
        <nav className="sidebar-section" aria-label="Workspace">
          <button className="nav-button active" title="New comparison" onClick={() => void navigate(null)}><Icon name="compare"/><span>New comparison</span></button>
          <button className="nav-button" title="Notebook" onClick={() => { setDialog('Notebook'); void refreshOverview(); }}><Icon name="book"/><span>Notebook</span></button>
          <button className="nav-button" title="Scorecard" onClick={() => { setDialog('Scorecard'); void refreshOverview(); }}><Icon name="scores"/><span>Scorecard</span></button>
        </nav>
        <nav className="sidebar-section recent-list" aria-label="Recent comparisons"><p className="section-label">Recent comparisons</p>{recent.slice(0, 8).map(item => <button key={item.id} className="sample-button" title={item.prompt} aria-current={item.id === id} onClick={() => void navigate(item.id)}><Icon name={item.ranks ? 'check' : 'compare'}/><span className="recent-copy">{item.prompt.slice(0, 70)}{item.prompt.length > 70 ? '…' : ''}<small>{dateLabel(item.created_at)} · {item.participant_count} models · {item.ranks ? rankingLabel(item.ranks) : item.status === 'ready' ? 'Ready to compare' : item.status === 'failed' ? 'Incomplete' : 'Generating'}</small></span></button>)}</nav>
        <div className="sidebar-bottom"><div className="session-label"><Icon name="lock"/><span>Anonymous session</span></div><button className="nav-button" title="Motion & feedback" onClick={() => setDialog('Motion & feedback')}><Icon name="settings"/><span>Motion & feedback</span></button></div>
      </aside>
      <main className="workspace" id="main">
        <header className="topbar"><div className="breadcrumb"><span>Comparisons</span><span className="slash">/</span><strong>{visible ? visible.vote ? 'Saved decision' : 'Workspace' : 'New comparison'}</strong></div><button className="mobile-brand" aria-label="New comparison" onClick={() => void navigate(null)}>margin</button>
          <div className="header-tools"><span className="demo-label">{session?.provider_mode === 'openai' ? 'Live models' : session ? 'Offline fixtures' : 'Connecting…'}</span><button className="icon-button theme-toggle" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'}/></button>
          {visible && <button className="evidence-toggle" id="evidence-toggle" aria-controls="evidence-drawer" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(!drawerOpen)}><Icon name="panel"/>Highlights <span className="evidence-count">{visible.annotations.highlights.length}</span></button>}</div>
        </header>
        {!!queueState.items.length && <QuestionQueueBar state={queueState} currentId={id} onOpen={next => void navigate(next)} onPause={() => queue.pause()} onResume={() => queue.resume()} onClear={() => { if (!queue.clear()) notify('Wait for the current request to finish, or reconnect it before clearing.'); }}/>}
        {queueState.retry && <div className="storage-warning" role={queueState.error ? 'alert' : 'status'}>{queueState.error || 'Retry in progress. Remaining questions stay paused.'} <button className="quiet-button" onClick={() => void navigate(queueState.retry!.comparisonId)}>Open comparison</button>{queueState.error && <button className="quiet-button" onClick={() => void retry().catch(failure => notify(errorMessage(failure)))}>Reconnect retry</button>}</div>}
        {storageError && <div className="storage-warning" role="status">{storageError}</div>}
        {(error || pollError || overviewError) && <div className="storage-warning" role="alert">{error || pollError || overviewError} <button className="quiet-button" onClick={() => { if (!session) location.reload(); else { setReload(value => value + 1); void refreshOverview(); } }}>Reconnect</button></div>}
        {id ? visible ? <ComparisonPanel key={visible.id} ref={panel} comparison={visible} onSaved={saved} onRetry={() => retry(visible)} retrying={!!queueState.retry} drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen} onNew={text => void navigate(null, text)} nextQuestion={nextQuestion ? { ready: !!nextQuestion.id, label: nextQuestion.status === 'ready' ? 'Next question' : nextQuestion.id ? 'Next · generating' : 'Next · queued', open: () => nextQuestion.id && void navigate(nextQuestion.id) } : undefined} feedback={feedback} notify={notify}/> : <div className="loading-workspace" role="status">{error ? 'This comparison could not be opened.' : 'Opening comparison…'}<button className="quiet-button" onClick={() => void navigate(null)}>New comparison</button></div> : <section className="composer-region">
          <div className="composer-intro"><span className="eyebrow">A comparison worth keeping</span><h1>{listMode ? `Your list. ${models.length === 2 ? 'Two' : 'Three'} perspectives.` : <>One prompt.<br/>{models.length === 2 ? 'Two' : 'Three'} perspectives.</>}</h1><p>{listMode ? 'Add your questions once. Read and compare at your own pace.' : <>Read without a label. Highlight what matters.<br/>Decide which answer works better for you.</>}</p></div>
          <div className="composer-mode" role="group" aria-label="Prompt entry mode"><button aria-pressed={!listMode} disabled={submitting} onClick={() => setListMode(false)}>Single prompt</button><button aria-pressed={listMode} disabled={submitting} onClick={() => setListMode(true)}>Question list</button></div>
          <form className="prompt-composer" onSubmit={submit} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.currentTarget.requestSubmit(); } }}>
            <fieldset className="model-picker" disabled={!session || submitting || modelsLoading || !!modelError || !catalog?.items.length} aria-describedby="model-help">
              <legend>{session?.provider_mode === 'mock' ? 'Choose offline fixtures' : 'Choose OpenAI models'}</legend>
              <label className="model-count" htmlFor="model-count">Number of models <select id="model-count" value={models.length} onChange={event => changeModelCount(Number(event.target.value))}><option value={2}>2 models</option><option value={3}>3 models</option></select></label>
              <div className="model-fields" style={{ gridTemplateColumns: `repeat(${models.length}, minmax(0, 1fr))` }}>{models.map((_, index) => <label key={index} htmlFor={`model-${index}`}>{`Model ${index + 1}`}
                <select id={`model-${index}`} value={models[index]} required onChange={event => setModels(previous => previous.map((model, i) => i === index ? event.target.value : model))}>
                  <option value="" disabled>Select a model</option>
                  {catalog?.items.map(model => <option key={model} value={model} disabled={models.some((selected, i) => i !== index && selected === model)}>{model}</option>)}
                </select>
              </label>)}</div>
            </fieldset>
            <div className="model-help" id="model-help">
              {modelsLoading ? <p role="status">Loading available models…</p> : modelError ? <p role="alert">{modelError}</p>
                : (catalog?.items.length || 0) < models.length ? <p role="alert">At least {models.length} available models are needed for this comparison.</p>
                  : <p>{catalog?.items.length} available · Answer order is randomized and hidden until you rank.</p>}
              <button type="button" className="quiet-button" disabled={!session || submitting || modelsLoading} onClick={() => setModelReload(value => value + 1)}>{modelError ? 'Retry model list' : 'Reload model list'}</button>
            </div>
            {listMode ? <QuestionList prompts={prompts} onChange={setPrompts} disabled={submitting} onImportPending={setImportPending}/> : <><label htmlFor="prompt">What would you like to compare?</label><textarea id="prompt" value={prompt} maxLength={session?.max_prompt_length || 12000} onChange={event => setPrompt(event.target.value)} placeholder="Ask a question, paste some code, or give the models a task…" required disabled={submitting}/></>}
            {listMode && <p className="queue-explainer">All selected models answer each question together. The next question starts when these answers finish, while you read or rank. Pause anytime.</p>}
            <div className="composer-actions"><span>{listMode ? `${prompts.length} questions · ${prompts.length * models.length} model calls` : `${prompt.length.toLocaleString()} / 12,000 · ${models.length} model calls`} <kbd>⌘ / Ctrl ↵</kbd></span><button className="primary" disabled={!session || submitting || !validModels || queue.unfinished || importPending || (listMode ? prompts.some(value => !value.trim()) : !prompt.trim())}>{submitting ? 'Starting…' : listMode ? `Compare ${prompts.length} ${prompts.length === 1 ? 'question' : 'questions'}` : 'Compare answers'} <Icon name="arrow"/></button></div>
            {queue.unfinished && <p className="queue-explainer">A question list is in progress. Finish it, or pause and discard its unsent questions, before starting another comparison.</p>}
          </form>
          <div className="prompt-starters"><span>Try a starting point</span>{starters.map(item => <button className="quiet-button" key={item.title} disabled={submitting} onClick={() => { setPrompt(item.prompt); document.getElementById('prompt')?.focus(); }}>{item.title} <Icon name="arrow"/></button>)}</div>
          <p className="session-explainer">{session?.provider_mode === 'mock' ? 'Offline development mode. Responses are deterministic fixtures; no AI model is called.' : 'Each comparison sends your prompt to the selected OpenAI models. API costs vary by model. Comparisons and notes are saved in this app’s database; your browser cookie keeps your history connected.'}{listMode && ' Unsent questions are kept in this tab. Keep it open to run the list; reloading pauses new requests.'}</p>
        </section>}
        <footer className="workspace-foot"><span><Icon name="lock"/>{session?.provider_mode === 'openai' ? 'Private to this browser session' : 'Local fixture mode'}</span><span>Highlights are optional · Your scorecard reflects your rankings</span><div className="mobile-library"><button onClick={() => { setDialog('Notebook'); void refreshOverview(); }}>Notebook</button> · <button onClick={() => { setDialog('Scorecard'); void refreshOverview(); }}>Scores</button> · <button onClick={() => setDialog('Motion & feedback')}>Motion & feedback</button></div></footer>
      </main>
    </div>
    {dialog && <Dialog title={dialog} close={() => setDialog(null)} small={dialog === 'Motion & feedback'}>
      {dialog === 'Notebook' && <><p className="library-intro">Your prompts, decisions, and supporting highlights. Reopen a comparison to pick up where you left off. History belongs to this browser session.</p>{!history.items.length ? <div className="empty-library"><h3>Your notebook starts with a question.</h3><p>Compare your first set of answers to save it here.</p><button className="primary" onClick={() => void navigate(null)}>New comparison</button></div> : history.items.map(item => <button className="history-item" key={item.id} onClick={() => void navigate(item.id)}><span>{item.prompt}<small>{dateLabel(item.created_at)} · {item.participant_count} models · {item.ranks ? rankingLabel(item.ranks) : item.status === 'ready' ? 'Ready to rank' : item.status === 'failed' ? 'Incomplete comparison' : 'Generating'}{item.edited ? ' · Edited after reveal' : ''}</small></span><Icon name="arrow"/></button>)}<div className="pagination"><button className="quiet-button" disabled={!offset} onClick={() => void refreshOverview(Math.max(0, offset - 20))}>Newer</button><span>Page {offset / 20 + 1}</span><button className="quiet-button" disabled={!history.has_more} onClick={() => void refreshOverview(offset + 20)}>Older</button></div></>}
      {dialog === 'Scorecard' && <Scorecard scores={scores} unavailable={!!overviewError} onNotebook={() => { setDialog('Notebook'); void refreshOverview(); }} onCompare={() => void navigate(null)}/>}
      {dialog === 'Motion & feedback' && <MotionSettings feedback={feedback}/>}
      {overviewError && <div role="alert" className="annotation-error"><p>{overviewError} {scores ? 'Showing the last loaded results.' : 'Results have not loaded yet.'}</p><button className="quiet-button" onClick={() => void refreshOverview(offset)}>Retry loading</button></div>}
    </Dialog>}
    <div id="toast" className={toast ? 'visible' : ''} role="status" aria-live="polite">{toast}</div>
  </>;
}
