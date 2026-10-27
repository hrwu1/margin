import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import type { Comparison } from './api';
import { QuestionQueue, restoreQueue } from './questionQueue';

const storageKey = 'margin-question-queue-v1';
export function useQuestionQueue(connected: boolean, onResult: (value: Comparison) => void) {
  const [storageError, setStorageError] = useState('');
  const [queue] = useState(() => {
    let raw = null;
    try { raw = sessionStorage.getItem(storageKey); } catch { /* Storage can be disabled. */ }
    return new QuestionQueue(api<Comparison>, restoreQueue(raw));
  });
  const state = useSyncExternalStore(queue.subscribe, queue.snapshot);
  const receive = useRef(onResult);
  receive.current = onResult;
  useEffect(() => queue.subscribe(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(queue.state)); }
    catch { setStorageError('Browser storage is unavailable. Keep this tab open to retain unsent questions.'); }
  }), [queue]);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    const tick = async () => {
      let result: Comparison | undefined;
      do {
        result = await queue.step();
        if (result && active) receive.current(result);
        // Start the next pair as soon as completion is observed, without another polling delay.
      } while (active && result && result.status !== 'pending' && !queue.state.paused);
    };
    void tick();
    const timer = setInterval(() => void tick(), 750);
    return () => { active = false; clearInterval(timer); };
  }, [connected, queue]);
  return { queue, state, storageError };
}
