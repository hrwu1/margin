import { MAX_QUESTIONS } from './questionQueue.ts';

export const MAX_CSV_BYTES = 1024 * 1024;
export type QuestionCSV = { rows: string[][]; width: number; blankRows: number; header: boolean; column: number | null };

export function parseQuestionCSV(source: string): QuestionCSV {
  const text = source.replace(/^\uFEFF/, '');
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) throw new Error('Choose a CSV file smaller than 1 MB.');
  if (text.includes('\0')) throw new Error('Use a UTF-8 CSV file. This file contains unsupported characters.');
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false, blankRows = 0, width = 0;
  const endField = () => {
    row.push(field); field = ''; closed = false;
    if (row.length > 100) throw new Error('Keep CSV files within 100 columns. Export only the columns you need.');
  };
  const endRow = () => {
    endField();
    if (row.some(value => value.trim())) {
      rows.push(row); width = Math.max(width, row.length);
      if (rows.length > 10000) throw new Error('Keep CSV files within 10,000 rows. Export only the rows you need.');
    }
    else blankRows++;
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === ',') endField();
    else if (char === '\n' || char === '\r') {
      endRow();
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (closed) {
      if (char !== ' ' && char !== '\t') throw new Error('Invalid CSV: unexpected text after a closing quote.');
    } else if (char === '"') {
      if (field) throw new Error('Invalid CSV: quote a whole cell and use two quotes for a quote inside it.');
      quoted = true;
    } else field += char;
  }
  if (quoted) throw new Error('Invalid CSV: a quoted cell is missing its closing quote.');
  if (field || row.length || closed) endRow();
  if (!rows.length) throw new Error('This CSV is empty. Add at least one question.');
  const matches = rows[0].map((value, index) => /^(questions?|prompts?)$/i.test(value.trim()) ? index : -1).filter(index => index >= 0);
  return { rows, width, blankRows, header: matches.length > 0, column: matches.length === 1 ? matches[0] : width === 1 ? 0 : null };
}

export async function readQuestionCSV(file: File): Promise<QuestionCSV> {
  if (!/\.csv$/i.test(file.name)) throw new Error('Choose a .csv file. Export spreadsheets as CSV (UTF-8) first.');
  if (file.size > MAX_CSV_BYTES) throw new Error('Choose a CSV file smaller than 1 MB.');
  let bytes: ArrayBuffer;
  try { bytes = await file.arrayBuffer(); } catch { throw new Error('This file could not be read. Choose it again.'); }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('This file is not UTF-8. Export it as CSV (UTF-8) and try again.'); }
  return parseQuestionCSV(text);
}

export function selectCSVQuestions(table: QuestionCSV, column: number | null, header: boolean, existingCount: number) {
  if (column === null || !Number.isInteger(column) || column < 0 || column >= table.width) throw new Error('Choose the column containing your questions.');
  const cells = table.rows.slice(header ? 1 : 0).map(row => (row[column] || '').trim());
  const questions = cells.filter(Boolean);
  const blankRows = table.blankRows + cells.length - questions.length;
  if (!questions.length) throw new Error('No questions found in this column. Check the column and header setting.');
  const tooLong = questions.findIndex(question => question.length > 12000);
  if (tooLong >= 0) throw new Error(`Imported question ${tooLong + 1} exceeds 12,000 characters. Shorten it before importing.`);
  if (questions.length + existingCount > MAX_QUESTIONS) throw new Error(`This file adds ${questions.length} questions to ${existingCount} already in your list. Keep the total within ${MAX_QUESTIONS}; no rows have been imported.`);
  return { questions, blankRows };
}
