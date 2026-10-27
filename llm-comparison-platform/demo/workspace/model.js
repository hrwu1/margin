import { examples, reasons, scoreDecisions } from '../directions/app.js';
export { examples, reasons };
export const STORAGE_KEY = 'margin-workspace-v1';
const sides = ['A', 'B'];
const empty = () => ({ highlights: [], reason: null, note: '', vote: null, edited: false });
export const highlightId = item => `${item.side}-${item.index}-${item.field}${item.field === 'passage' ? '' : `-${item.start}-${item.end}`}`;

export function normalizeState(value) {
  const result = { sampleId: examples.some(e => e.id === value?.sampleId) ? value.sampleId : 'python', sessions: {} };
  for (const ex of examples) {
    const source = value?.sessions?.[ex.id], session = empty();
    if (['A', 'B', 'tie'].includes(source?.vote)) {
      session.vote = source.vote;
      session.edited = source.edited === true;
    }
    if (reasons.includes(source?.reason)) session.reason = source.reason;
    if (typeof source?.note === 'string') session.note = source.note.slice(0, 600);
    // Existing saved passages/excerpts become highlights without changing their vote or notes.
    const legacy = sides.flatMap(side => {
      const index = source?.marks?.[side], p = ex.answers[side].paragraphs[index];
      if (!Number.isInteger(index) || !p) return [];
      const quote = source?.quotes?.[side];
      const start = typeof quote === 'string' && quote.trim() ? p.text.indexOf(quote) : -1;
      return [{ side, index, field: start >= 0 ? 'text' : 'passage', start, end: start + (quote?.length || 0), quote }];
    });
    const seen = new Set();
    for (const item of Array.isArray(source?.highlights) ? source.highlights : legacy) {
      if (!item || !sides.includes(item.side) || !Number.isInteger(item.index) || item.index < 0) continue;
      const p = ex.answers[item.side].paragraphs[item.index];
      if (!p || !['passage', 'text', 'code'].includes(item.field)) continue;
      const highlight = { side: item.side, index: item.index, field: item.field, note: typeof item.note === 'string' ? item.note.slice(0, 600) : '' };
      if (item.field !== 'passage') {
        const text = p[item.field];
        if (typeof text !== 'string' || !Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 0 || item.end <= item.start || item.end > text.length) continue;
        const quote = text.slice(item.start, item.end);
        if (!quote.trim() || quote !== item.quote) continue;
        Object.assign(highlight, { start: item.start, end: item.end, quote });
      }
      const key = highlightId(highlight);
      if (seen.has(key)) continue;
      seen.add(key);
      session.highlights.push(highlight);
    }
    result.sessions[ex.id] = session;
  }
  return result;
}
export function readState(storage) {
  return normalizeState(JSON.parse(storage.getItem(STORAGE_KEY)));
}
export function updateSession(state, id, patch) {
  const next = normalizeState(state);
  if (!next.sessions[id] || next.sessions[id].vote) return next;
  // Voting is a separate operation: draft updates cannot reveal model identities.
  next.sessions[id] = { ...next.sessions[id], ...patch, vote: null };
  return normalizeState(next);
}
export function castVote(state, id, choice) {
  const next = normalizeState(state);
  const session = next.sessions[id];
  if (session && ['A', 'B', 'tie'].includes(choice)) {
    if (session.vote && session.vote !== choice) session.edited = true;
    session.vote = choice;
  }
  return next;
}
export function decisions(state) {
  return examples.filter(ex => state.sessions[ex.id].vote).map(ex => ({ sampleId: ex.id, ...state.sessions[ex.id] }));
}
export const scores = state => scoreDecisions(decisions(state));

// Merge visual ranges only; overlapping highlights keep their own notes and remove actions.
export function highlightRanges(highlights, side, index, field) {
  const ranges = highlights.filter(item => item.side === side && item.index === index && item.field === field)
    .map(({ start, end }) => ({ start, end })).sort((a, b) => a.start - b.start);
  return ranges.reduce((merged, range) => {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push(range);
    return merged;
  }, []);
}
