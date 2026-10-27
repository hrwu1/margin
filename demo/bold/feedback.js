const PREFERENCE_KEY = 'margin-feedback-v1';
const EASE = 'cubic-bezier(.22, .75, .2, 1)';

export function readPreferences(storage) {
  try {
    const value = JSON.parse(storage.getItem(PREFERENCE_KEY));
    return { motion: value?.motion !== false, vibration: value?.vibration !== false };
  } catch { return { motion: true, vibration: true }; }
}

// Feedback never owns application state or delays a vote. Every effect is disposable.
export function createFeedback({ view, doc, device, storage, onChange = () => {} }) {
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  const touch = view.matchMedia('(any-pointer: coarse)');
  const preferences = readPreferences(storage);
  const active = new Map();
  let lastPulse = -Infinity;
  const motion = () => preferences.motion && !reduced.matches;
  const canVibrate = () => touch.matches && typeof device.vibrate === 'function';
  function cancel() {
    for (const animation of [...active.values()]) animation.cancel();
    active.clear();
  }
  function applyPreferences() {
    doc.documentElement.dataset.motion = motion() ? 'on' : 'off';
    if (!motion()) cancel();
    onChange();
  }
  function animate(element, frames, options = {}, cleanup = () => {}) {
    if (!element || !motion() || typeof element.animate !== 'function') { cleanup(); return null; }
    active.get(element)?.cancel();
    const animation = element.animate(frames, { duration: 320, easing: EASE, ...options });
    active.set(element, animation);
    const finish = () => {
      if (active.get(element) === animation) active.delete(element);
      cleanup();
    };
    animation.addEventListener('finish', () => { if (options.fill !== 'forwards') finish(); }, { once: true });
    animation.addEventListener('cancel', finish, { once: true });
    return animation;
  }
  function haptic(kind) {
    if (!preferences.vibration || reduced.matches || !canVibrate() || doc.hidden) return false;
    const now = view.performance.now();
    if (now - lastPulse < 120) return false;
    try {
      const accepted = device.vibrate(kind === 'vote' ? [12, 40, 18] : 8);
      if (accepted) lastPulse = now;
      return !!accepted;
    } catch { return false; }
  }
  function transfer(from, destination, label) {
    if (!motion() || !destination) return;
    const to = destination.getBoundingClientRect();
    const chip = doc.createElement('div');
    chip.className = 'evidence-flight';
    chip.textContent = label;
    chip.setAttribute('aria-hidden', 'true');
    const ink = view.getComputedStyle(destination);
    const startX = Math.min(Math.max(from.left + from.width / 2 - 82, 8), view.innerWidth - 172);
    const startY = Math.max(8, Math.min(from.top, view.innerHeight - 52));
    chip.style.cssText = `left:${startX}px;top:${startY}px;background:${ink.backgroundColor};color:${ink.color};`;
    doc.body.append(chip);
    const dx = to.left + to.width / 2 - startX - 82, dy = to.top + to.height / 2 - startY - 20;
    animate(chip, [
      { transform: 'translate(0,0) scale(.94)', opacity: 0, offset: 0 },
      { transform: 'translate(0,-8px) scale(1)', opacity: 1, offset: .15 },
      { transform: `translate(${dx * .65}px,${dy * .65 - 30}px) scale(.85)`, opacity: 1, offset: .66 },
      { transform: `translate(${dx}px,${dy}px) scale(.35)`, opacity: 0, offset: 1 }
    ], { duration: 560 }, () => chip.remove());
    animate(destination, [{ transform:'scale(1)' },{ transform:'scale(1.12)',offset:.7 },{ transform:'scale(1)' }], {duration:650});
  }
  function moveFrom(element, from) {
    if (!element || !from || !motion()) return;
    const to = element.getBoundingClientRect();
    if (!to.width || !to.height) return;
    animate(element, [
      { transformOrigin:'top left', transform:`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${from.width/to.width},${from.height/to.height})`, opacity:.35 },
      { transformOrigin:'top left', transform:'none', opacity:1 }
    ], {duration:480});
  }
  reduced.addEventListener('change', applyPreferences);
  touch.addEventListener('change', onChange);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) cancel(); });
  doc.documentElement.dataset.motion = motion() ? 'on' : 'off';
  return {
    preferences, animate, cancel, transfer, moveFrom, haptic,
    get motion() { return motion(); },
    get reduced() { return reduced.matches; },
    get canVibrate() { return canVibrate(); },
    toggle(key) {
      if (!['motion','vibration'].includes(key)) return;
      preferences[key] = !preferences[key];
      try { storage.setItem(PREFERENCE_KEY, JSON.stringify(preferences)); } catch { /* Visit-only preferences still work. */ }
      applyPreferences();
    }
  };
}
