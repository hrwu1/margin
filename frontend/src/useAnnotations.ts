import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';
import type { Annotations, Comparison } from './api';

// Serialize saves so an older acknowledgement cannot overwrite newer typing.
export function useAnnotations(comparison: Comparison, onSaved: (value: Comparison) => void) {
  const [draft, setDraft] = useState(comparison.annotations);
  const [status, setStatus] = useState('Saved');
  const [error, setError] = useState('');
  const current = useRef(draft);
  const saved = useRef(JSON.stringify(draft));
  const revision = useRef(comparison.annotation_revision);
  const pending = useRef<Promise<boolean> | null>(null);
  const callback = useRef(onSaved);
  callback.current = onSaved;
  const update = (next: Annotations) => {
    current.current = next;
    setDraft(next);
    setStatus('Unsaved changes');
  };
  const flush = useCallback(async (): Promise<boolean> => {
    if (pending.current) return pending.current;
    const save = async () => {
      setError('');
      try {
        while (JSON.stringify(current.current) !== saved.current) {
          const snapshot = JSON.stringify(current.current);
          setStatus('Saving…');
          const result = await api<Comparison>(`/comparisons/${comparison.id}/annotations`, {
            method: 'PUT', body: JSON.stringify({ ...JSON.parse(snapshot), revision: revision.current }),
          });
          saved.current = snapshot;
          revision.current = result.annotation_revision;
          callback.current(result);
        }
        setStatus('Saved');
        return true;
      } catch (failure) {
        setError(errorMessage(failure));
        setStatus('Not saved');
        return false;
      }
    };
    pending.current = save();
    const success = await pending.current;
    pending.current = null;
    return success;
  }, [comparison.id]);
  useEffect(() => {
    if (comparison.vote || JSON.stringify(draft) === saved.current) return;
    const timer = setTimeout(() => void flush(), 650);
    return () => clearTimeout(timer);
  }, [draft, comparison.vote, flush]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(current.current) !== saved.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return { draft, update, status, error, flush, revision, discard: () => { current.current = JSON.parse(saved.current); } };
}
