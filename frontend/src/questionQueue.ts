import type { Comparison } from './api';

export const MAX_QUESTIONS = 20;
export type QueueItem = {
  requestId: string; prompt: string; id?: string;
  status: 'queued' | 'starting' | Comparison['status'];
};
export type QueueState = { items: QueueItem[]; paused: boolean; error: string };
export const emptyQueue = (): QueueState => ({ items: [], paused: true, error: '' });
export const splitQuestions = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

export function restoreQueue(raw: string | null): QueueState {
  try {
    const value = JSON.parse(raw || 'null');
    const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
    if (!value || !Array.isArray(value.items) || value.items.length > MAX_QUESTIONS) return emptyQueue();
    if (!value.items.every((item: QueueItem) => item && typeof item.prompt === 'string' && item.prompt.trim() && item.prompt.length <= 12000
      && typeof item.requestId === 'string' && uuid.test(item.requestId)
      && ['queued', 'starting', 'pending', 'ready', 'failed'].includes(item.status)
      && (item.id === undefined || typeof item.id === 'string' && uuid.test(item.id))
      && (!['pending', 'ready', 'failed'].includes(item.status) || !!item.id))) return emptyQueue();
    return { items: value.items, paused: true, error: '' };
  } catch { return emptyQueue(); }
}

// The API owns generation and idempotency; this tab only schedules the next pair.
export class QuestionQueue {
  state: QueueState;
  private busy = false;
  private listeners = new Set<() => void>();
  private request: (path: string, options?: RequestInit) => Promise<Comparison>;

  constructor(request: (path: string, options?: RequestInit) => Promise<Comparison>, state = emptyQueue()) {
    this.request = request;
    this.state = state;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private update(state: QueueState) { this.state = state; this.listeners.forEach(listener => listener()); }
  get unfinished() { return this.state.items.some(item => !['ready', 'failed'].includes(item.status)); }
  start(prompts: string[]) {
    if (this.busy || this.unfinished) throw new Error('Finish or clear the current question list first.');
    if (!prompts.length || prompts.length > MAX_QUESTIONS || prompts.some(prompt => !prompt.trim() || prompt.trim().length > 12000)) {
      throw new Error('Add 1–20 questions, each between 1 and 12,000 characters.');
    }
    this.update({ items: prompts.map(prompt => ({ prompt: prompt.trim(), requestId: crypto.randomUUID(), status: 'queued' })), paused: false, error: '' });
  }
  pause() { this.update({ ...this.state, paused: true }); }
  resume() { this.update({ ...this.state, paused: false, error: '' }); }
  clear() {
    // An unknown POST outcome must be reconciled before its request ID can be lost.
    if (this.busy || this.state.items.some(item => item.status === 'starting' || item.status === 'pending')) return false;
    this.update(emptyQueue()); return true;
  }
  async step(): Promise<Comparison | undefined> {
    if (this.busy || this.state.error) return;
    const index = this.state.items.findIndex(item => item.status === 'pending' || !this.state.paused && ['queued', 'starting'].includes(item.status));
    if (index < 0) return;
    this.busy = true;
    let item = this.state.items[index];
    try {
      if (!item.id) {
        item = { ...item, status: 'starting' };
        this.update({ ...this.state, items: this.state.items.map((value, i) => i === index ? item : value) });
      }
      const result = await this.request(item.id ? `/comparisons/${item.id}` : '/comparisons', item.id ? undefined : {
        method: 'POST', body: JSON.stringify({ prompt: item.prompt, request_id: item.requestId }),
      });
      this.update({ ...this.state,
        items: this.state.items.map((value, i) => i === index ? { ...value, id: result.id, status: result.status } : value),
        paused: this.state.paused || result.status === 'failed',
        error: result.status === 'failed' ? `Question ${index + 1} has an incomplete answer. Review it, then continue with the remaining questions.` : '',
      });
      return result;
    } catch (error) {
      this.update({ ...this.state, paused: true, error: error instanceof Error ? error.message : 'Could not connect. Resume to reconnect safely.' });
    } finally { this.busy = false; }
  }
}
