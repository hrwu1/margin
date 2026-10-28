import type { Comparison, ModelPair } from './api';

export const MAX_QUESTIONS = 20;
export type QueueItem = {
  requestId: string; prompt: string; id?: string;
  models?: ModelPair; attempt?: number;
  status: 'queued' | 'starting' | Comparison['status'];
};
export type RetryOperation = { comparisonId: string; requestId: string; attempt: number; accepted?: boolean };
export type QueueState = { items: QueueItem[]; paused: boolean; error: string; retry?: RetryOperation };
export const emptyQueue = (): QueueState => ({ items: [], paused: true, error: '' });
export const splitQuestions = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const validModels = (models: unknown): models is ModelPair => Array.isArray(models) && [2, 3].includes(models.length)
  && models.every(model => typeof model === 'string' && model.length > 0 && model.length <= 200) && new Set(models).size === models.length;

export function restoreQueue(raw: string | null): QueueState {
  try {
    const value = JSON.parse(raw || 'null');
    const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
    if (!value || !Array.isArray(value.items) || value.items.length > MAX_QUESTIONS) return emptyQueue();
    if (!value.items.every((item: QueueItem) => item && typeof item.prompt === 'string' && item.prompt.trim() && item.prompt.length <= 12000
      && typeof item.requestId === 'string' && uuid.test(item.requestId)
      && (item.models === undefined || validModels(item.models))
      && (item.attempt === undefined || Number.isInteger(item.attempt) && item.attempt >= 0)
      && ['queued', 'starting', 'pending', 'ready', 'failed'].includes(item.status)
      && (item.id === undefined || typeof item.id === 'string' && uuid.test(item.id))
      && (!['pending', 'ready', 'failed'].includes(item.status) || !!item.id))) return emptyQueue();
    if (value.retry !== undefined && (!value.retry || !uuid.test(value.retry.comparisonId) || !uuid.test(value.retry.requestId)
      || !Number.isInteger(value.retry.attempt) || value.retry.attempt < 0
      || value.retry.accepted !== undefined && typeof value.retry.accepted !== 'boolean')) return emptyQueue();
    return { items: value.items, paused: true, error: '', ...(value.retry ? { retry: value.retry } : {}) };
  } catch { return emptyQueue(); }
}

// The API owns generation and idempotency; this tab schedules comparisons and explicit retries.
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
  get unfinished() { return Boolean(this.state.retry) || this.state.items.some(item => !['ready', 'failed'].includes(item.status)); }
  start(prompts: string[], models: ModelPair) {
    if (this.busy || this.unfinished) throw new Error('Finish or clear the current question list first.');
    if (!validModels(models)) throw new Error('Choose two or three distinct models.');
    if (!prompts.length || prompts.length > MAX_QUESTIONS || prompts.some(prompt => !prompt.trim() || prompt.trim().length > 12000)) {
      throw new Error('Add 1–20 questions, each between 1 and 12,000 characters.');
    }
    this.update({ items: prompts.map(prompt => ({ prompt: prompt.trim(), models: [...models], requestId: crypto.randomUUID(), status: 'queued' })), paused: false, error: '' });
  }
  pause() { this.update({ ...this.state, paused: true }); }
  resume() { this.update({ ...this.state, paused: Boolean(this.state.retry), error: '' }); }
  async retry(comparison?: Comparison): Promise<Comparison | undefined> {
    if (this.busy) return;
    if (this.state.retry) {
      if (comparison && comparison.id !== this.state.retry.comparisonId) throw new Error('Resolve the current retry before retrying another comparison.');
    } else {
      if (!comparison || comparison.status !== 'failed' || comparison.vote) throw new Error('Only an incomplete, unranked comparison can be retried.');
      if (this.state.items.some(item => item.status === 'starting' || item.status === 'pending')) throw new Error('Wait for the current comparison to finish before retrying.');
      this.update({ ...this.state, retry: { comparisonId: comparison.id, requestId: crypto.randomUUID(), attempt: comparison.attempt }, paused: true, error: '' });
    }
    this.update({ ...this.state, paused: true, error: '' });
    return this.step();
  }
  clear() {
    // An unknown POST outcome must be reconciled before its request ID can be lost.
    if (this.busy || this.state.retry || this.state.items.some(item => item.status === 'starting' || item.status === 'pending')) return false;
    this.update(emptyQueue()); return true;
  }
  async step(): Promise<Comparison | undefined> {
    if (this.busy || this.state.error) return;
    if (this.state.retry) return this.stepRetry();
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
        method: 'POST', body: JSON.stringify({ prompt: item.prompt, models: item.models, request_id: item.requestId }),
      });
      this.update({ ...this.state,
        items: this.state.items.map((value, i) => i === index ? { ...value, id: result.id, status: result.status, attempt: result.attempt || 0 } : value),
        paused: this.state.paused || result.status === 'failed',
        error: result.status === 'failed' ? `Question ${index + 1} has an incomplete answer. Review it, then continue with the remaining questions.` : '',
      });
      return result;
    } catch (error) {
      this.update({ ...this.state, paused: true, error: error instanceof Error ? error.message : 'Could not connect. Resume to reconnect safely.' });
    } finally { this.busy = false; }
  }
  private async stepRetry(): Promise<Comparison | undefined> {
    const retry = this.state.retry!;
    this.busy = true;
    try {
      // Read first to reconcile a lost acknowledgement or a retry accepted in another tab.
      let result = await this.request(`/comparisons/${retry.comparisonId}`);
      if (!retry.accepted && result.attempt === retry.attempt && result.status === 'failed') {
        result = await this.request(`/comparisons/${retry.comparisonId}/retry`, {
          method: 'POST', body: JSON.stringify({ request_id: retry.requestId, attempt: retry.attempt }),
        });
      }
      this.update({ ...this.state,
        retry: result.status === 'pending' ? { ...retry, accepted: true } : undefined,
        items: this.state.items.map(item => item.id === result.id ? { ...item, status: result.status, attempt: result.attempt } : item),
        paused: true,
        error: result.status === 'failed' ? 'Some answers are still incomplete. Retry failed answers or resume the remaining questions.' : '',
      });
      return result;
    } catch (error) {
      this.update({ ...this.state, paused: true, error: error instanceof Error ? error.message : 'Could not connect. Retry to reconnect safely.' });
    } finally { this.busy = false; }
  }
}
