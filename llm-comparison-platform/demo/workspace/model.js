import { examples, reasons, scoreDecisions } from '../directions/app.js';
export { examples, reasons };
export const STORAGE_KEY = 'margin-workspace-v1';
const sides = ['A', 'B'];
const empty = () => ({ marks: {}, quotes: {}, reason: null, note: '', vote: null, edited: false });

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
    for (const side of sides) {
      const index = source?.marks?.[side];
      if (!Number.isInteger(index) || index < 0 || index >= ex.answers[side].paragraphs.length) continue;
      session.marks[side] = index;
      const quote = source?.quotes?.[side];
      if (typeof quote === 'string' && quote.trim() && ex.answers[side].paragraphs[index].text.includes(quote)) session.quotes[side] = quote;
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
