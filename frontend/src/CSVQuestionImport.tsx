import { useEffect, useState } from 'react';
import { readQuestionCSV, selectCSVQuestions } from './csvQuestions';
import type { QuestionCSV } from './csvQuestions';

export function CSVQuestionImport({ file, existingCount, disabled, onImport, onCancel }: {
  file: File; existingCount: number; disabled: boolean; onImport: (questions: string[]) => void; onCancel: () => void;
}) {
  const [table, setTable] = useState<QuestionCSV | null>(null);
  const [header, setHeader] = useState(false);
  const [column, setColumn] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setTable(null); setError('');
    readQuestionCSV(file).then(value => {
      if (active) { setTable(value); setHeader(value.header); setColumn(value.column); }
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'This file could not be read.'); });
    return () => { active = false; };
  }, [file]);

  let selection: ReturnType<typeof selectCSVQuestions> | null = null;
  let validation = '';
  if (table) {
    try { selection = selectCSVQuestions(table, column, header, existingCount); }
    catch (failure) { validation = failure instanceof Error ? failure.message : 'Check your CSV.'; }
  }
  return <section className="question-import csv-import" aria-label="CSV import preview">
    <div className="csv-heading"><strong title={file.name}>{file.name}</strong><button type="button" className="quiet-button" disabled={disabled} onClick={onCancel}>Cancel import</button></div>
    <p>Review your questions before adding them. The file is read in your browser; only questions you choose to compare are sent to the models.</p>
    {!table && !error && <p role="status">Reading CSV…</p>}
    {table && <>
      <div className="csv-controls">
        <div><label htmlFor="csv-column">Question column</label><select id="csv-column" value={column ?? ''} disabled={disabled} onChange={event => setColumn(event.target.value === '' ? null : Number(event.target.value))}>
          <option value="" disabled>Choose a column…</option>
          {Array.from({ length: table.width }, (_, index) => <option key={index} value={index}>{header && table.rows[0][index]?.trim() ? `${table.rows[0][index].trim().slice(0,70)} (column ${index + 1})` : `Column ${index + 1}`}</option>)}
        </select></div>
        <label className="csv-header-toggle"><input type="checkbox" checked={header} disabled={disabled} onChange={event => setHeader(event.target.checked)}/>First row is a header</label>
      </div>
      {selection && <>
        <p role="status"><strong>{selection.questions.length} {selection.questions.length === 1 ? 'question' : 'questions'} ready to add</strong>{selection.blankRows > 0 && ` · ${selection.blankRows} empty ${selection.blankRows === 1 ? 'row' : 'rows'} skipped`}</p>
        <ol className="csv-preview">{selection.questions.slice(0,3).map((question, index) => <li key={index}>{question}</li>)}</ol>
        {selection.questions.length > 3 && <p>And {selection.questions.length - 3} more. You can edit every question after adding.</p>}
      </>}
    </>}
    {(error || validation) && <p className="csv-error" role="alert">{error || validation}</p>}
    <div className="csv-actions"><span>{existingCount ? `Adds to your ${existingCount} existing ${existingCount === 1 ? 'question' : 'questions'}.` : 'Add to your question list, then compare when ready.'}</span><button type="button" className="quiet-button" disabled={disabled || !selection} onClick={() => selection && onImport(selection.questions)}>Add {selection?.questions.length || ''} {selection?.questions.length === 1 ? 'question' : 'questions'}</button></div>
  </section>;
}
