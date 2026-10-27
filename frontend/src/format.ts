// Offsets use Unicode code points, matching Python's source validation.
export function highlightId(item: { side: string; paragraph_index: number; start: number; end: number }) {
  return `${item.side}-${item.paragraph_index}-${item.start}-${item.end}`;
}
export function markedParts(text: string, ranges: { start: number; end: number }[], offset = 0) {
  const characters = Array.from(text);
  const parts: { text: string; marked: boolean }[] = [];
  for (let i = 0; i < characters.length; i++) {
    const marked = ranges.some(range => range.start <= i + offset && range.end > i + offset);
    if (parts.length && parts[parts.length - 1].marked === marked) parts[parts.length - 1].text += characters[i];
    else parts.push({ text: characters[i], marked });
  }
  return parts;
}
export function displayParagraph(paragraphs: string[], index: number) {
  const raw = paragraphs[index];
  const previousFences = paragraphs.slice(0, index).join('\n\n').match(/^```/gm)?.length || 0;
  const opener = raw.match(/^```[^\n]*\n/);
  const code = Boolean(opener) || previousFences % 2 === 1;
  const heading = !code ? raw.match(/^#{1,6} /)?.[0] || '' : '';
  const prefix = opener?.[0] || heading;
  const text = raw.slice(prefix.length).replace(code ? /\n?```\s*$/ : /$^/, '');
  return { text, offset: Array.from(prefix).length, code, heading: Boolean(heading) };
}
export function dateLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// A small, safe display subset; unsupported Markdown remains readable source text.
export function inlineParts(text: string, offset = 0, code = false) {
  const result: { text: string; offset: number; kind: 'text' | 'strong' | 'code' }[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let cursor = 0;
  if (!code) for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) result.push({ text: text.slice(cursor, match.index), offset: offset + Array.from(text.slice(0, cursor)).length, kind: 'text' });
    const delimiter = match[0][0] === '`' ? 1 : 2;
    result.push({ text: match[0].slice(delimiter, -delimiter), offset: offset + Array.from(text.slice(0, match.index)).length + delimiter, kind: delimiter === 1 ? 'code' : 'strong' });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor), offset: offset + Array.from(text.slice(0, cursor)).length, kind: 'text' });
  return result;
}
export function sourceRange(parts: ReturnType<typeof inlineParts>, start: number, end: number) {
  const positions = parts.flatMap(part => Array.from(part.text, (_, index) => part.offset + index));
  if (start < 0 || end <= start || end > positions.length) return null;
  return { start: positions[start], end: positions[end - 1] + 1 };
}
