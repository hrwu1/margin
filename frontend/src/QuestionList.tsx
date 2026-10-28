import { useEffect, useRef, useState } from 'react';
import { MAX_QUESTIONS, splitQuestions } from './questionQueue';
import type { QueueState } from './questionQueue';
import { Icon } from './ui';
import { CSVQuestionImport } from './CSVQuestionImport';

export function QuestionList({ prompts, onChange, disabled, onImportPending }: { prompts: string[]; onChange: (values: string[]) => void; disabled: boolean; onImportPending: (pending: boolean) => void }) {
  const [paste, setPaste] = useState<string | null>(null);
  const [csv, setCSV] = useState<File | null>(null);
  const [importNotice, setImportNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { onImportPending(csv !== null); return () => onImportPending(false); }, [csv, onImportPending]);
  const imported = splitQuestions(paste || '');
  return <div className="question-list-editor">
    <div className="question-list-heading"><span>{prompts.length} / {MAX_QUESTIONS} questions</span><div className="question-list-actions">
      <button type="button" className="quiet-button" disabled={disabled} onClick={() => { setCSV(null); setImportNotice(''); setPaste(paste === null ? '' : null); }}>{paste === null ? 'Paste a list' : 'Cancel paste'}</button>
      <button type="button" className="quiet-button" ref={uploadButton} disabled={disabled} onClick={() => fileInput.current?.click()}>Upload CSV</button>
      <input ref={fileInput} className="sr-only" type="file" accept=".csv,text/csv" aria-label="CSV file" tabIndex={-1} disabled={disabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) { setCSV(file); setPaste(null); setImportNotice(''); } }}/>
    </div></div>
    {csv && <CSVQuestionImport file={csv} existingCount={prompts.filter(prompt => prompt.trim()).length} disabled={disabled} onCancel={() => { setCSV(null); uploadButton.current?.focus(); }} onImport={questions => {
      const existing = prompts.filter(prompt => prompt.trim());
      onChange([...existing, ...questions]); setCSV(null); setImportNotice(`Added ${questions.length} ${questions.length === 1 ? 'question' : 'questions'} from CSV. Review or edit them below, then start your comparison.`);
      requestAnimationFrame(() => document.getElementById(existing.length ? `prompt-${existing.length}` : 'prompt')?.focus());
    }}/>}
    {importNotice && <p className="csv-notice" role="status">{importNotice}</p>}
    {paste !== null && <div className="question-import"><label htmlFor="question-import">One question per line</label><textarea id="question-import" value={paste} onChange={event => setPaste(event.target.value)} placeholder={'Why is the sky blue?\nHow does a database index work?'} disabled={disabled}/><p>Use individual question fields below for code or prompts with multiple lines.</p><button type="button" className="quiet-button" disabled={disabled || !imported.length || imported.length + prompts.filter(prompt => prompt.trim()).length > MAX_QUESTIONS || imported.some(prompt => prompt.length > 12000)} onClick={() => { onChange([...prompts.filter(prompt => prompt.trim()), ...imported]); setPaste(null); }}>Add {imported.length || ''} questions</button>{imported.length + prompts.filter(prompt => prompt.trim()).length > MAX_QUESTIONS && <p role="alert">Keep the list within {MAX_QUESTIONS} questions.</p>}{imported.some(prompt => prompt.length > 12000) && <p role="alert">Keep each question within 12,000 characters.</p>}</div>}
    {prompts.map((prompt, index) => <div className="question-field" key={index}><div><label htmlFor={index ? `prompt-${index}` : 'prompt'}>Question {index + 1}</label>{prompts.length > 1 && <button type="button" className="quiet-button" disabled={disabled} aria-label={`Remove question ${index + 1}`} onClick={() => { onChange(prompts.filter((_, i) => i !== index)); requestAnimationFrame(() => document.getElementById(index > 1 ? `prompt-${index - 1}` : 'prompt')?.focus()); }}>Remove</button>}</div><textarea id={index ? `prompt-${index}` : 'prompt'} value={prompt} maxLength={12000} required disabled={disabled} placeholder="Ask a question, paste code, or give the models a task…" onChange={event => onChange(prompts.map((value, i) => i === index ? event.target.value : value))}/></div>)}
    <button type="button" className="quiet-button add-question" disabled={disabled || prompts.length >= MAX_QUESTIONS} onClick={() => { onChange([...prompts, '']); requestAnimationFrame(() => document.getElementById(`prompt-${prompts.length}`)?.focus()); }}>+ Add question</button>
  </div>;
}

export function QuestionQueueBar({ state, currentId, onOpen, onPause, onResume, onClear }: {
  state: QueueState; currentId: string | null; onOpen: (id: string) => void; onPause: () => void; onResume: () => void; onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const current = state.items.findIndex(item => item.id === currentId);
  const done = state.items.filter(item => ['ready', 'failed'].includes(item.status)).length;
  const running = state.items.findIndex(item => ['starting', 'pending'].includes(item.status));
  const next = current >= 0 ? state.items[current + 1] : undefined;
  const open = (id: string) => { onOpen(id); setExpanded(false); };
  const summary = state.error ? 'Queue paused' : done === state.items.length ? 'List complete' : state.paused ? running >= 0 ? 'Pausing after this comparison' : 'Queue paused' : `Generating question ${running >= 0 ? running + 1 : done + 1}`;
  return <section className="question-queue" aria-label="Question queue">
    <div className="queue-toolbar"><button className="queue-summary" aria-expanded={expanded} aria-controls="queue-questions" onClick={() => setExpanded(!expanded)}><Icon name="compare"/><span><strong>{current >= 0 ? `Question ${current + 1} of ${state.items.length}` : `${state.items.length} questions`}</strong><small role="status">{summary} · {done}/{state.items.length} finished</small></span><span aria-hidden="true">{expanded ? '−' : '+'}</span></button>
      <div className="queue-actions">{done < state.items.length && <button className="quiet-button" onClick={state.paused ? onResume : onPause}>{state.paused ? 'Resume queue' : 'Pause queue'}</button>}{done === state.items.length && <button className="quiet-button" onClick={onClear}>Close list</button>}{next && <button className="quiet-button queue-next" disabled={!next.id} onClick={() => next.id && open(next.id)}>{next.status === 'ready' ? 'Next question' : next.id ? 'Next · generating' : 'Next · queued'} <Icon name="arrow"/></button>}</div>
    </div>
    {state.error && <p className="queue-error" role="alert">{state.error} <button className="quiet-button" onClick={onResume}>Continue queue</button></p>}
    {expanded && <div id="queue-questions" className="queue-questions">{state.items.map((item, index) => <button key={item.requestId} disabled={!item.id} aria-current={item.id === currentId} title={item.prompt} onClick={() => item.id && open(item.id)}><span className="queue-number">{index + 1}</span><span className="queue-prompt">{item.prompt}</span><small>{item.status === 'ready' ? 'Ready' : item.status === 'failed' ? 'Incomplete' : item.status === 'pending' || item.status === 'starting' ? 'Generating' : 'Queued'}</small></button>)}{state.paused && running < 0 && done < state.items.length && <button className="quiet-button" onClick={onClear}>Discard unsent questions</button>}</div>}
  </section>;
}
