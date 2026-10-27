import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CSV_BYTES, parseQuestionCSV, readQuestionCSV, selectCSVQuestions } from './csvQuestions.ts';

const select = (text, existing = 0) => {
  const table = parseQuestionCSV(text);
  return selectCSVQuestions(table, table.column, table.header, existing);
};

test('question headers, UTF-8 BOM, CRLF, and escaped quotes preserve question text', () => {
  const table = parseQuestionCSV('\uFEFFQuestion,category\r\n"Why, exactly?",reasoning\r\n"Explain ""less is more"".",writing\r\n');
  assert.equal(table.header, true); assert.equal(table.column, 0);
  assert.deepEqual(selectCSVQuestions(table, 0, true, 0), { questions: ['Why, exactly?', 'Explain "less is more".'], blankRows: 0 });
});

test('multiline code stays in one question, with line endings and indentation intact', () => {
  const question = 'Review:\r\n\r\ndef average(values):\r\n    return sum(values) / len(values)';
  assert.deepEqual(select(`prompt\r\n"${question}"\r\n"Next question"`).questions, [question, 'Next question']);
});

test('headerless one-column files keep their first question and duplicates', () => {
  const table = parseQuestionCSV('Why?\nWhy?\nWhat next?');
  assert.equal(table.header, false); assert.equal(table.column, 0);
  assert.deepEqual(selectCSVQuestions(table, 0, false, 0).questions, ['Why?', 'Why?', 'What next?']);
});

test('named question columns are detected without importing other columns', () => {
  const table = parseQuestionCSV('id, PROMPTS ,private metadata\n1,Explain caching.,do not import\n2,"What about, invalidation?",do not import either');
  assert.equal(table.column, 1); assert.equal(table.header, true);
  assert.deepEqual(selectCSVQuestions(table, table.column, true, 0).questions, ['Explain caching.', 'What about, invalidation?']);
});

test('unknown and ambiguous columns require a choice; header setting remains explicit', () => {
  const table = parseQuestionCSV('id,text\n1,First question\n2,Second question');
  assert.equal(table.column, null); assert.equal(table.header, false);
  assert.throws(() => selectCSVQuestions(table, null, true, 0), /Choose the column/);
  assert.deepEqual(selectCSVQuestions(table, 1, true, 0).questions, ['First question', 'Second question']);
  assert.deepEqual(selectCSVQuestions(table, 1, false, 0).questions, ['text', 'First question', 'Second question']);
  const ambiguous = parseQuestionCSV('question,prompt\nFirst,Second');
  assert.equal(ambiguous.column, null); assert.equal(ambiguous.header, true);
  for (const column of [-1, 2, NaN, 1.5]) assert.throws(() => selectCSVQuestions(table, column, false, 0), /Choose the column/);
});

test('empty CSV rows and empty selected cells are counted, with no invented questions', () => {
  const table = parseQuestionCSV('\nquestion,tag\n,metadata only\n"",empty\n"  ",spaces\nReal question,ok\n\n');
  assert.deepEqual(selectCSVQuestions(table, 0, true, 0), { questions: ['Real question'], blankRows: 5 });
  assert.throws(() => select('question\n'), /No questions found/);
  for (const text of ['', '\uFEFF', '\n\r\n', ',,\n""']) assert.throws(() => parseQuestionCSV(text), /empty/);
});

test('malformed quoting is rejected instead of silently splitting content', () => {
  for (const text of ['question\n"missing end', 'question\n"closed"garbage', 'question\npart"quote', 'question\n"a""']) {
    assert.throws(() => parseQuestionCSV(text), /Invalid CSV/);
  }
  assert.deepEqual(select('question\n"Valid"  \n').questions, ['Valid']);
});

test('queue and per-question limits reject the whole import without truncation', () => {
  assert.equal(select(Array(20).fill('Question').join('\n')).questions.length, 19); // First cell matches the optional header.
  assert.equal(select(Array(20).fill('Question?').join('\n')).questions.length, 20);
  assert.throws(() => select(Array(21).fill('Question?').join('\n')), /adds 21 questions/);
  assert.throws(() => select('First?\nSecond?', 19), /2 questions to 19/);
  assert.equal(select('x'.repeat(12000)).questions[0].length, 12000);
  assert.throws(() => select('x'.repeat(12001)), /exceeds 12,000/);
});

test('plain text is never executed or treated as a formula', () => {
  assert.deepEqual(select('"<script>alert(1)</script>"\n"=SUM(A1:A2)"\n"中文问题 🌍"').questions,
    ['<script>alert(1)</script>', '=SUM(A1:A2)', '中文问题 🌍']);
});

test('file type, UTF-8 decoding, unreadable files, and size limits fail clearly', async () => {
  assert.deepEqual((await readQuestionCSV(new File(['question\nHello?'], 'questions.CSV'))).rows, [['question'], ['Hello?']]);
  await assert.rejects(readQuestionCSV(new File(['hello'], 'questions.xlsx')), /\.csv file/);
  await assert.rejects(readQuestionCSV(new File([new Uint8Array([0xff, 0xfe])], 'questions.csv')), /not UTF-8/);
  await assert.rejects(readQuestionCSV({name:'questions.csv', size: MAX_CSV_BYTES + 1, arrayBuffer: () => { throw new Error('must not read'); }}), /smaller than 1 MB/);
  await assert.rejects(readQuestionCSV({name:'questions.csv', size:10, arrayBuffer: async () => { throw new Error('denied'); }}), /could not be read/);
  assert.throws(() => parseQuestionCSV('x'.repeat(MAX_CSV_BYTES + 1)), /smaller than 1 MB/);
  assert.throws(() => parseQuestionCSV('question\nabc\0xyz'), /unsupported characters/);
});

test('pathological row and column counts are bounded before rendering a preview', () => {
  assert.throws(() => parseQuestionCSV('x,'.repeat(100) + 'x'), /100 columns/);
  assert.throws(() => parseQuestionCSV('x\n'.repeat(10001)), /10,000 rows/);
});
