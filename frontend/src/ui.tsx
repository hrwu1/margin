import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const icons: Record<string, ReactNode> = {
  compare: <><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/></>,
  book: <path d="M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4zM12 6v15"/>,
  scores: <path d="M5 20V10M12 20V4M19 20v-6"/>,
  lock: <><rect x="6" y="10" width="12" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  check: <path d="m5 12 4 4L19 6"/>, close: <path d="m6 6 12 12M6 18 18 6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  quote: <path d="M10 5H4v8h5c0 4-2 5-4 6M20 5h-6v8h5c0 4-2 5-4 6"/>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></>,
  settings: <><path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>,
};
export function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name] || icons.compare}</svg>;
}
export function Dialog({ title, children, close, small = false }: { title: string; children: ReactNode; close: () => void; small?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog className={`dialog ${small ? 'settings-dialog' : ''}`} ref={ref} aria-labelledby="dialog-title" onCancel={close} onClose={close}>
    <header className="dialog-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label={`Close ${title}`} onClick={close}><Icon name="close"/></button></header>
    <div className="library-content">{children}</div>
    <footer className="dialog-footer"><button className="quiet-button" onClick={close}>Back to comparison</button></footer>
  </dialog>;
}
export function useFeedback() {
  const [preferences, setPreferences] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem('margin-feedback-v1') || '{}'); return { motion: saved.motion !== false, vibration: saved.vibration !== false }; }
    catch { return { motion: true, vibration: true }; }
  });
  const [reduced, setReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const animations = useRef(new Set<Animation>());
  const lastPulse = useRef(0);
  const motion = preferences.motion && !reduced;
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = motion ? 'on' : 'off';
    if (!motion) for (const animation of animations.current) animation.cancel();
  }, [motion]);
  useEffect(() => {
    const active = animations.current;
    const cancel = () => { if (document.hidden) for (const animation of active) animation.cancel(); };
    document.addEventListener('visibilitychange', cancel);
    return () => { document.removeEventListener('visibilitychange', cancel); for (const animation of active) animation.cancel(); };
  }, []);
  const pulse = (vote = false) => {
    if (!preferences.vibration || reduced || document.hidden || !matchMedia('(any-pointer: coarse)').matches || !navigator.vibrate || performance.now() - lastPulse.current < 120) return;
    try { navigator.vibrate(vote ? [12, 40, 18] : 8); lastPulse.current = performance.now(); } catch { /* Visible feedback remains available. */ }
  };
  const transfer = (from?: DOMRect) => {
    pulse();
    const target = document.querySelector('#evidence-toggle');
    if (!motion || !from || !target) return;
    const to = target.getBoundingClientRect();
    const chip = document.createElement('div');
    chip.className = 'evidence-flight'; chip.textContent = 'Highlight'; chip.setAttribute('aria-hidden', 'true');
    chip.style.left = `${Math.max(8, Math.min(from.left, innerWidth - 110))}px`;
    chip.style.top = `${Math.max(8, Math.min(from.top, innerHeight - 40))}px`;
    document.body.append(chip);
    const start = chip.getBoundingClientRect();
    const animation = chip.animate([
      { transform: 'translate(0,0) scale(.95)', opacity: 0 },
      { transform: 'translate(0,-8px)', opacity: 1, offset: .2 },
      { transform: `translate(${to.left - start.left}px,${to.top - start.top}px) scale(.3)`, opacity: 0 },
    ], { duration: 540, easing: 'cubic-bezier(.22,.75,.2,1)' });
    animations.current.add(animation);
    const clean = () => { chip.remove(); animations.current.delete(animation); };
    animation.onfinish = clean; animation.oncancel = clean;
  };
  const toggle = (key: 'motion' | 'vibration') => {
    const next = { ...preferences, [key]: !preferences[key] }; setPreferences(next);
    try { localStorage.setItem('margin-feedback-v1', JSON.stringify(next)); } catch { /* Visit-only preference. */ }
  };
  return { preferences, reduced, motion, pulse, transfer, toggle };
}
export type Feedback = ReturnType<typeof useFeedback>;
