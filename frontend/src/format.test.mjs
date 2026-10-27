import test from 'node:test';
import assert from 'node:assert/strict';
import { markedParts, displayParagraph, highlightId } from './format.ts';
test('overlapping excerpts keep exact Unicode text without duplicate characters', () => {
  const parts = markedParts('Hi 🌍 there', [{ start: 3, end: 4 }, { start: 3, end: 6 }]);
  assert.equal(parts.map(part => part.text).join(''), 'Hi 🌍 there');
  assert.equal(parts.filter(part => part.marked).map(part => part.text).join(''), '🌍 t');
  assert.equal(highlightId({ side: 'A', paragraph_index: 1, start: 0, end: 3 }), 'A-1-0-3');
});
test('code fences and headings retain canonical offsets across blank lines', () => {
  const paragraphs = ['## Title', '```python\nx = 1', 'print(x)\n```', 'Done.'];
  assert.deepEqual(displayParagraph(paragraphs, 0), { text: 'Title', offset: 3, code: false, heading: true });
  assert.deepEqual(displayParagraph(paragraphs, 1), { text: 'x = 1', offset: 10, code: true, heading: false });
  assert.deepEqual(displayParagraph(paragraphs, 2), { text: 'print(x)', offset: 0, code: true, heading: false });
  assert.equal(displayParagraph(paragraphs, 3).code, false);
});

import { inlineParts, sourceRange } from './format.ts';
test('formatted excerpt offsets map back to exact original source', () => {
  const raw = 'A 🌍 **bold** and `code` sample.';
  const parts = inlineParts(raw);
  assert.equal(parts.map(part => part.text).join(''), 'A 🌍 bold and code sample.');
  const range = sourceRange(parts, 4, 17);
  assert.equal(Array.from(raw).slice(range.start, range.end).join(''), 'bold** and `code');
  const code = inlineParts('**literal**', 10, true);
  assert.deepEqual(sourceRange(code, 0, 11), { start: 10, end: 21 });
  assert.equal(sourceRange(parts, 0, 999), null);
});
