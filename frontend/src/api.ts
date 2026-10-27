export type Side = 'A' | 'B';
export type Choice = Side | 'tie';
export type Reason = 'Correctness' | 'Clarity' | 'Useful detail' | 'Follows the prompt' | 'Depth' | 'Practicality';
export type Highlight = { side: Side; paragraph_index: number; start: number; end: number; quote: string; note: string };
export type Annotations = { highlights: Highlight[]; reason: Reason | null; note: string };
export type Comparison = {
  id: string; prompt: string; status: 'pending' | 'ready' | 'failed'; created_at: string;
  responses: { side: Side; status: 'pending' | 'success' | 'error'; model: string | null; paragraphs: string[]; error: string | null }[];
  annotations: Annotations; annotation_revision: number;
  vote: { choice: Choice; created_at: string; edited: boolean; revision: number; updated_at: string | null } | null;
};
export type HistoryPage = { items: (Pick<Comparison, 'id' | 'prompt' | 'status' | 'created_at'> & { vote: Choice | null; edited: number })[]; has_more: boolean };
export type Score = { model: string; wins: number; ties: number; losses: number; compared: number };
export type Session = { provider_mode: string; max_prompt_length: number };
export type ModelCatalog = { items: string[]; defaults: string[] };

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, {
    ...options, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Margin-Client': 'web', ...options.headers },
  }); } catch (failure) {
    if (failure instanceof DOMException && failure.name === 'AbortError') throw failure;
    throw new Error('Cannot reach the server. Check the connection and try again.');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The server is unavailable. Check the connection and try again.');
  const data = await response.json();
  if (!response.ok) throw new Error(response.status === 401
    ? 'Your anonymous session is unavailable. Allow cookies for this site and reload.'
    : data.detail || 'The request failed. Please try again.');
  return data as T;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
