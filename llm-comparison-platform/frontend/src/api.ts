export type Side = 'A' | 'B';
export type Choice = Side | 'tie';
export type Reason = 'Clarity' | 'Depth' | 'Practicality' | 'Follows the prompt';
export type Evidence = { side: Side; paragraph_index: number };
export type VoteInput = { choice: Choice; reason: Reason | null; evidence: Evidence | null };
export type Comparison = {
  id: string;
  prompt: string;
  status: 'pending' | 'ready' | 'failed';
  created_at: string;
  responses: { side: Side; status: 'pending' | 'success' | 'error'; model: string | null; paragraphs: string[]; error: string | null }[];
  vote: (Omit<VoteInput, 'evidence'> & { created_at: string; evidence: (Evidence & { quote: string }) | null }) | null;
};
export type HistoryPage = { items: (Pick<Comparison, 'id' | 'prompt' | 'status' | 'created_at'> & { vote: Choice | null })[]; has_more: boolean };
export type Score = { model: string; wins: number; ties: number; losses: number; compared: number };
export type Session = { provider_mode: string; max_prompt_length: number };

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Margin-Client': 'web', ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(response.status === 401
      ? 'Your anonymous session is unavailable. Allow cookies for this site and reload.'
      : data.detail || 'The request failed. Please try again.');
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
