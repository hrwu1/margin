// Keep the editor paired with the revised state contract in cached static previews.
import { examples, reasons, STORAGE_KEY, normalizeState, readState, updateSession, castVote, decisions, scores, highlightId, highlightRanges } from './model.js?v=highlights';
import { createFeedback } from '../bold/feedback.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const paths = {
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon:'<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
  compare:'<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/>',
  book:'<path d="M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4zM12 6v15"/>',
  scores:'<path d="M5 20V10M12 20V4M19 20v-6"/>',
  lock:'<rect x="6" y="10" width="12" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  quote:'<path d="M10 5H4v8h5c0 4-2 5-4 6M20 5h-6v8h5c0 4-2 5-4 6"/>',
  panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  code:'<path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16"/>',
  layers:'<path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  type:'<path d="M4 6V4h16v2M12 4v16M8 20h8"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3" fill="currentColor"/><circle cx="16" cy="17" r="3" fill="currentColor"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const button = (action, label, attributes = '', className = 'icon-button') => `<button type="button" data-action="${action}" class="${className}" ${attributes}>${label}</button>`;
const sides = ['A', 'B'];
const storage = { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) };
let state = normalizeState(null), storageError = '', drawerOpen = false, editingVote = false, mobileSide = 'A', drawerOpener = null, selection = null, toastTimer;
try { state = readState(storage); } catch { storageError = 'Saved data could not be read. This visit starts with a fresh workspace.'; }
const compact = matchMedia('(max-width: 900px)');
const sample = () => examples.find(ex => ex.id === state.sampleId);
const session = () => state.sessions[state.sampleId];
const feel = createFeedback({ view: window, doc: document, device: navigator, storage, onChange: syncPreferences });

$('#workspace-app').innerHTML = `<div class="app-shell">
  <aside class="sidebar" aria-label="Workspace navigation">
    <div class="wordmark"><span class="brand-symbol" aria-hidden="true"><i></i><i></i><i></i></span><span class="brand-name">margin</span></div>
    <nav class="sidebar-section" aria-label="Workspace">
      ${button('compare', `${icon('compare')}<span>Compare</span>`, 'aria-current="page" title="Compare"', 'nav-button active')}
      ${button('notebook', `${icon('book')}<span>Notebook</span><span class="count" id="decision-count">0</span>`, 'title="Notebook"', 'nav-button')}
      ${button('scores', `${icon('scores')}<span>Scorecard</span>`, 'title="Scorecard"', 'nav-button')}
    </nav>
    <nav class="sidebar-section" aria-label="Example comparisons"><p class="section-label">Try a comparison</p>${examples.map((ex, i) => button('sample', `${icon(['code', 'layers', 'type'][i])}<span>${escape(ex.title)}<small>${escape(ex.category)}</small></span><span class="sample-check"></span>`, `data-sample="${ex.id}" title="${escape(ex.title)}" aria-current="false"`, 'sample-button')).join('')}</nav>
    <div class="sidebar-bottom"><div class="session-label">${icon('lock')}<span>Anonymous session</span></div>${button('settings', `${icon('settings')}<span>Interaction settings</span>`, 'title="Interaction settings"', 'nav-button')}</div>
  </aside>
  <main class="workspace" id="main">
    <header class="topbar"><div class="breadcrumb"><span>Comparisons</span><span class="slash">/</span><strong id="category"></strong></div><span class="mobile-brand">margin</span><select class="mobile-picker" aria-label="Example comparison">${examples.map(ex => `<option value="${ex.id}">${escape(ex.category)}</option>`).join('')}</select><div class="header-tools"><span class="demo-label">Interactive demo</span>${button('theme', '', 'id="theme-toggle"', 'icon-button theme-toggle')}${button('drawer', `${icon('panel')} Highlights <span class="evidence-count">0</span>`, 'id="evidence-toggle" aria-expanded="false" aria-controls="evidence-drawer"', 'evidence-toggle')}</div></header>
    <p class="storage-warning" role="alert" hidden></p>
    <section class="prompt-region" aria-label="Shared prompt"></section>
    <div class="workspace-body">
      <section class="comparison" aria-label="Compare answers">
        <div class="reading-status"><span id="identity-status"></span><span class="selection-hint">Select text or use Highlight · Optional</span></div>
        <div class="mobile-answer-tabs" aria-label="Visible answer">${sides.map(side => button('tab', `Answer ${side}`, `data-side="${side}" aria-pressed="${side === 'A'}"`, '')).join('')}</div>
        <div id="answers" class="answers" tabindex="-1"></div>
        <section class="decision-dock" aria-label="Your decision"></section>
      </section>
      <div class="drawer-slot"><aside class="evidence-drawer" id="evidence-drawer" aria-labelledby="evidence-title" aria-hidden="true" inert><header class="drawer-header"><h2 id="evidence-title" tabindex="-1">${icon('quote')} Highlights <small>Optional</small></h2>${button('close-drawer', icon('close'), 'aria-label="Close highlights"')}</header><div class="drawer-scroll"></div><div class="drawer-return">${button('close-drawer', 'Back to comparison', '', 'quiet-button')}</div></aside></div>
    </div>
    <footer class="workspace-foot"><span>Static examples · fictional models</span><span id="save-status"></span><div class="mobile-library">${button('notebook', 'Notebook', '', '')} · ${button('scores', 'Scores', '', '')} · ${button('settings', 'Settings', '', '')}</div></footer>
    <div class="drawer-backdrop" aria-hidden="true"></div>
  </main>
</div>
<dialog id="library" class="dialog" aria-labelledby="library-title"><header class="dialog-heading"><h2 id="library-title"></h2>${button('close-dialog', icon('close'), 'aria-label="Close notebook or scorecard"')}</header><div class="library-content"></div><footer class="dialog-footer">${button('close-dialog', 'Back to comparison', '', 'quiet-button')}</footer></dialog>
<dialog id="settings" class="dialog settings-dialog" aria-labelledby="settings-title"><header class="dialog-heading"><h2 id="settings-title">Interaction settings</h2>${button('close-dialog', icon('close'), 'aria-label="Close settings"')}</header><div class="settings-content"><div class="preference"><span>Fluid motion</span>${button('preference', '', 'data-preference="motion" aria-label="Fluid motion"', '')}</div><div class="preference"><span>Touch vibration</span>${button('preference', '', 'data-preference="vibration" aria-label="Touch vibration"', '')}</div><p id="motion-help"></p><p>Vibration requires a supported touch device and browser. Every action also has visible feedback.</p></div></dialog>`;

function syncTheme() {
  const light = document.documentElement.dataset.theme === 'light';
  const control = $('#theme-toggle');
  control.innerHTML = icon(light ? 'moon' : 'sun');
  control.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
  control.title = light ? 'Switch to dark mode' : 'Switch to light mode';
  $('meta[name="theme-color"]').content = light ? '#ffffff' : '#08090a';
}
function toggleTheme() {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  syncTheme();
  try { storage.setItem('margin-workspace-theme-v1', theme); }
  catch { toast('Theme changed for this visit. Browser storage is unavailable.'); }
}

function persist() {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); storageError = ''; }
  catch { storageError = 'Browser storage is unavailable. Your changes will last for this visit.'; }
  syncSaveStatus();
}
function syncSaveStatus() {
  $('.storage-warning').hidden = !storageError;
  $('.storage-warning').textContent = storageError;
  $('#save-status').innerHTML = `${icon(storageError ? 'info' : 'check')} ${storageError ? 'This visit only' : session().vote ? 'Decision saved on this device' : 'Draft saved on this device'}`;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2000);
}
function syncNavigation() {
  $('#decision-count').textContent = decisions(state).length;
  $$('.sample-button').forEach(node => {
    node.setAttribute('aria-current', node.dataset.sample === state.sampleId);
    $('.sample-check', node).innerHTML = state.sessions[node.dataset.sample].vote ? icon('check') : '';
  });
  $('.mobile-picker').value = state.sampleId;
  $('#category').textContent = sample().category;
}
function renderSample() {
  const ex = sample();
  feel.cancel();
  hideSelection();
  $('.prompt-region').innerHTML = `<div class="prompt-heading"><h1>Shared prompt</h1><span class="prompt-tag">Same question. Two perspectives.</span></div><p class="prompt-text">${escape(ex.question)}</p>${ex.snippet ? `<details class="source-code"><summary>View original code</summary><pre><code>${escape(ex.snippet)}</code></pre></details>` : ''}`;
  $('#answers').innerHTML = sides.map(side => `<article class="answer-panel" data-side="${side}" aria-labelledby="answer-${side}-title"><header class="answer-header"></header><div class="answer-scroll">${ex.answers[side].paragraphs.map((p, index) => `<section class="passage" data-side="${side}" data-index="${index}" id="passage-${side}-${index}" tabindex="-1"><div class="passage-heading"><span class="passage-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><h3>${escape(p.title)}</h3>${button('keep', '', `data-side="${side}" data-index="${index}"`, 'keep-button')}</div><p class="passage-text">${escape(p.text)}</p>${p.code ? `<pre><code class="passage-code">${escape(p.code)}</code></pre>` : ''}</section>`).join('')}<div class="answer-ending"><span>End of answer</span><i></i></div></div></article>`).join('');
  syncHeaders(); syncPassages(); renderDock(); renderHighlights(); syncNavigation(); syncSaveStatus(); syncMobile();
}
function syncHeaders() {
  const saved = session().vote;
  sides.forEach(side => {
    const panel = $(`.answer-panel[data-side="${side}"]`);
    panel.classList.toggle('preferred', saved === side);
    $('.answer-header', panel).innerHTML = `<span class="letter">${side}</span><div class="answer-identity"><h2 id="answer-${side}-title">${saved ? sample().answers[side].model : `Answer ${side}`}</h2><small>${saved ? 'Fictional sample model' : 'Read without the label'}</small></div><span class="identity-icon">${icon(saved ? 'check' : 'lock')} ${saved ? saved === side ? 'Your choice' : saved === 'tie' ? 'Tied' : 'Revealed' : 'Anonymous'}</span>`;
  });
  $('#identity-status').innerHTML = `${icon(saved ? 'check' : 'lock')} ${saved ? 'Decision saved. Models revealed.' : 'Identities hidden until your vote'}`;
  $('.selection-hint').textContent = saved ? 'Your highlights explain your choice' : 'Select text or use Highlight · Optional';
}
function syncPassages() {
  const current = session();
  $$('.passage').forEach(node => {
    const { side } = node.dataset, index = Number(node.dataset.index);
    const highlights = current.highlights.filter(item => item.side === side && item.index === index);
    const whole = highlights.some(item => item.field === 'passage');
    node.classList.toggle('marked', highlights.length > 0);
    const keep = $('.keep-button', node);
    keep.disabled = !!current.vote;
    keep.setAttribute('aria-pressed', whole);
    const label = `${current.vote ? whole ? 'Highlighted' : 'Unhighlighted' : whole ? 'Remove highlight from' : 'Highlight'} paragraph ${index + 1} from answer ${side}`;
    keep.setAttribute('aria-label', label); keep.title = label;
    keep.innerHTML = `${icon(whole ? 'check' : 'plus')}<span>${whole ? 'Highlighted' : 'Highlight'}</span>`;
    for (const field of ['text', 'code']) {
      const target = $(`.passage-${field}`, node), text = sample().answers[side].paragraphs[index][field];
      if (!target) continue;
      let cursor = 0, html = '';
      for (const range of highlightRanges(highlights, side, index, field)) {
        html += `${escape(text.slice(cursor, range.start))}<mark>${escape(text.slice(range.start, range.end))}</mark>`;
        cursor = range.end;
      }
      target.innerHTML = html + escape(text.slice(cursor));
    }
  });
  $('.evidence-count').textContent = current.highlights.length;
}
function renderHighlights() {
  const current = session();
  $('.drawer-scroll').innerHTML = `<p class="drawer-intro">${current.vote ? 'Highlights help you revisit the details behind a decision.' : 'Save the useful details or mistakes behind your choice.'}</p><div class="evidence-list">${current.highlights.length ? current.highlights.map(item => {
    const p = sample().answers[item.side].paragraphs[item.index], key = highlightId(item);
    return `<article class="evidence-card" data-highlight="${key}"><header><span>Answer ${item.side} · paragraph ${item.index + 1}${item.field === 'passage' ? '' : ' · excerpt'}</span>${current.vote ? icon('lock') : button('remove', icon('close'), `data-highlight="${key}" aria-label="Remove highlight from answer ${item.side}, paragraph ${item.index + 1}: ${escape((item.quote || p.text).slice(0, 35))}"`)}</header><blockquote>${item.field === 'code' ? `<pre><code>${escape(item.quote)}</code></pre>` : escape(item.quote || p.text)}${item.field === 'passage' && p.code ? `<pre><code>${escape(p.code)}</code></pre>` : ''}</blockquote>${current.vote ? item.note ? `<div class="highlight-note saved-highlight-note"><span>Your note</span><p>${escape(item.note)}</p></div>` : '' : `<div class="highlight-note"><label for="note-${key}">Why this matters <span>Optional</span></label><textarea id="note-${key}" data-highlight="${key}" aria-label="Note for answer ${item.side}, paragraph ${item.index + 1}: ${escape((item.quote || p.text).slice(0, 35))}" rows="2" maxlength="600" placeholder="A useful detail, a mistake, or what stood out…">${escape(item.note)}</textarea><span class="highlight-note-status">${storageError ? 'This visit only' : item.note ? 'Saved on this device' : 'Saves as you type'}</span></div>`}${button('jump', `Show in answer ${icon('arrow')}`, `data-side="${item.side}" data-index="${item.index}" data-highlight="${key}"`, 'show-passage')}</article>`;
  }).join('') : current.vote ? `<div class="empty-evidence">${icon('quote')}<strong>No highlights saved.</strong><p>You voted without highlights. They are optional.</p></div>` : `<div class="empty-evidence">${icon('quote')}<strong>What stands out to you?</strong><p>Select words in an answer or code block, then choose <b>Highlight selection</b>. Use <b>Highlight</b> beside a heading to save the whole paragraph.</p>${button('start-highlighting', 'Try highlighting a paragraph', '', 'quiet-button')}</div>`}</div><p class="highlight-help">${current.vote ? 'Highlights and notes stay as they were when you voted. You can still change your vote.' : 'Keep multiple highlights from either answer, with a note for each. You can also vote without highlights.'}</p><div class="reason-section"><fieldset><legend>What mattered overall? <span>Optional</span></legend><div class="reasons">${reasons.map(reason => button('reason', escape(reason), `data-reason="${escape(reason)}" aria-pressed="${current.reason === reason}" ${current.vote ? 'disabled' : ''}`, '')).join('')}</div></fieldset><label for="decision-note" class="note-label">Your overall reasoning <span>Optional</span></label><textarea id="decision-note" maxlength="600" rows="4" placeholder="Why would you choose one answer over the other?" ${current.vote ? 'readonly' : ''}>${escape(current.note)}</textarea><p class="note-status">${current.vote ? 'Saved with your vote' : 'Saves as you type'} · ${current.note.length}/600</p></div><div class="drawer-end">${icon(current.vote ? 'lock' : 'info')}<p>${current.vote ? 'Your vote can change. Your original highlights and notes stay saved.' : 'Highlights and notes become read-only when you vote. You can still change your vote.'}</p></div>`;
}
function renderDock() {
  const current = session(), completed = decisions(state).length;
  if (current.vote && !editingVote) {
    $('.decision-dock').innerHTML = `<div class="saved-decision" tabindex="-1"><span class="saved-icon">${icon('check')}</span><div><strong>${current.vote === 'tie' ? 'You called it a tie.' : `You chose ${sample().answers[current.vote].model}.`}</strong><p>${current.reason ? `${escape(current.reason)} · ` : ''}Saved in your notebook with ${current.highlights.length} ${current.highlights.length === 1 ? 'highlight' : 'highlights'}.${current.edited ? '<span class="edited-label">Edited after reveal</span>' : ''}</p></div></div><div class="dock-actions">${button('change-vote', 'Change vote', '', 'quiet-button')}${button(completed < examples.length ? 'next' : 'notebook', `${completed < examples.length ? 'Next comparison' : 'View notebook'} ${icon('arrow')}`, '', 'primary')}</div>`;
    return;
  }
  $('.decision-dock').innerHTML = `<div class="decision-copy"><strong>${editingVote ? 'Change your vote' : 'Which answer would you use?'}</strong>${editingVote ? button('cancel-vote', 'Cancel', '', 'quiet-button cancel-vote') : '<span>Vote to reveal · Highlights optional</span>'}</div><div class="votes">${['A', 'tie', 'B'].map(choice => button('vote', choice === 'tie' ? 'It’s a tie' : `<span>${choice}</span> Answer ${choice}`, `data-vote="${choice}" ${editingVote ? `aria-pressed="${current.vote === choice}"` : ''}`, `vote-button${choice === 'tie' ? ' tie' : ''}`)).join('')}</div>`;
}
function setVoteEditing(editing) {
  if (!session().vote) return;
  editingVote = editing;
  renderDock();
  $(editing ? `[data-vote="${session().vote}"]` : '[data-action="change-vote"]').focus({ preventScroll: true });
}
function syncMobile() {
  $$('.answer-panel').forEach(node => node.dataset.mobileHidden = compact.matches && node.dataset.side !== mobileSide);
  $$('[data-action="tab"]').forEach(node => node.setAttribute('aria-pressed', node.dataset.side === mobileSide));
  const modal = compact.matches && drawerOpen, drawer = $('#evidence-drawer');
  drawer.setAttribute('role', modal ? 'dialog' : 'complementary');
  if (modal) drawer.setAttribute('aria-modal', 'true'); else drawer.removeAttribute('aria-modal');
  for (const region of ['.sidebar', '.topbar', '.prompt-region', '.comparison', '.workspace-foot']) $(region).inert = modal;
  if (modal && !drawer.contains(document.activeElement)) $('[data-action="close-drawer"]').focus({ preventScroll: true });
}
function setDrawer(open, focus = false) {
  if (open && !drawerOpen) drawerOpener = document.activeElement;
  drawerOpen = open;
  $('.workspace-body').classList.toggle('drawer-open', open);
  $('#evidence-toggle').setAttribute('aria-expanded', open);
  $('#evidence-drawer').inert = !open;
  $('#evidence-drawer').setAttribute('aria-hidden', !open);
  syncMobile();
  if (open && focus) $('#evidence-title').focus({ preventScroll: true });
  if (!open && $('#evidence-drawer').contains(document.activeElement)) {
    const target = drawerOpener?.isConnected && !drawerOpener.disabled ? drawerOpener : $('#evidence-toggle');
    target.focus({ preventScroll: true });
  }
  hideSelection();
}
function keep(item) {
  if (session().vote) return;
  const key = highlightId(item);
  if (session().highlights.some(highlight => highlightId(highlight) === key)) {
    if (item.field === 'passage') removeHighlight(key);
    else toast('This excerpt is already highlighted.');
    return;
  }
  state = updateSession(state, state.sampleId, { highlights: [...session().highlights, item] }); persist();
  syncPassages(); renderHighlights(); setDrawer(true);
  const card = $(`.evidence-card[data-highlight="${key}"]`);
  if (card) {
    // Scroll the drawer only, leaving the two answer panes at their reading positions.
    $('.drawer-scroll').scrollTo({ top: card.offsetTop - $('.drawer-scroll').offsetTop - 12, behavior: feel.motion ? 'smooth' : 'instant' });
    feel.animate(card, [{ transform: 'translateY(12px)', opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: 200 });
  }
  feel.haptic('keep');
  toast('Highlight added. You can add a note in Highlights.');
}
function removeHighlight(key) {
  if (session().vote) return;
  const fromDrawer = $('#evidence-drawer').contains(document.activeElement);
  const highlights = session().highlights, index = highlights.findIndex(item => highlightId(item) === key);
  if (index < 0) return;
  const nearby = highlights[index + 1] || highlights[index - 1];
  state = updateSession(state, state.sampleId, { highlights: highlights.filter(item => highlightId(item) !== key) }); persist();
  syncPassages(); renderHighlights();
  if (fromDrawer) (nearby ? $(`.evidence-card[data-highlight="${highlightId(nearby)}"] [data-action="remove"]`) : $('#evidence-title')).focus({ preventScroll: true });
  toast('Highlight removed. Your other highlights are unchanged.');
}
function vote(choice) {
  const previous = session().vote;
  if (previous && !editingVote) return;
  state = castVote(state, state.sampleId, choice); editingVote = false;
  persist(); hideSelection();
  syncHeaders(); syncPassages(); renderHighlights(); renderDock(); syncNavigation();
  if (!previous) sides.forEach((side, index) => feel.animate($(`.answer-panel[data-side="${side}"] .answer-identity`), [{ transform: 'translateY(6px)', opacity: .2 }, { transform: 'none', opacity: 1 }], { duration: 240, delay: index * 40 }));
  $('.saved-decision').focus({ preventScroll: true });
  if (choice !== previous) feel.haptic('vote');
  toast(previous ? choice === previous ? 'Vote unchanged.' : 'Vote updated. Your highlights and notes are preserved.' : 'Decision saved. Model identities revealed.');
}
function changeSample(id) {
  if (!examples.some(ex => ex.id === id)) return;
  if (compact.matches) setDrawer(false);
  state.sampleId = id; mobileSide = 'A'; editingVote = false; persist(); renderSample();
  feel.animate($('#answers'), [{ transform: 'translateX(10px)', opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: 200 });
}
function openLibrary(page) {
  const rows = decisions(state);
  $('#library-title').textContent = page === 'scores' ? 'Your scorecard' : 'Your notebook';
  $('.library-content').innerHTML = page === 'scores' ? `<p class="library-intro">A record of your choices across these three examples. Model names are fictional; this is your session, not a public ranking. Scores reflect your latest votes.</p><table class="scores"><caption>${rows.length} of ${examples.length} comparisons completed</caption><thead><tr><th scope="col">Model</th><th scope="col">Wins</th><th scope="col">Ties</th><th scope="col">Losses</th></tr></thead><tbody>${Object.entries(scores(state)).map(([model, score]) => `<tr><th scope="row">${model}</th><td>${score.wins}</td><td>${score.ties}</td><td>${score.losses}</td></tr>`).join('')}</tbody></table>` : rows.length ? `<p class="library-intro">Your decisions, with the reasoning attached. Reopen a comparison to see its highlights and notes.</p>${rows.map(row => { const ex = examples.find(e => e.id === row.sampleId); return button('revisit', `<span>${escape(ex.title)}<small>${row.vote === 'tie' ? 'Tie' : `${ex.answers[row.vote].model} preferred`} · ${row.highlights.length} ${row.highlights.length === 1 ? 'highlight' : 'highlights'}${row.reason ? ` · ${escape(row.reason)}` : ''}${row.edited ? '<br>Edited after reveal' : ''}${row.note ? `<br>${escape(row.note)}` : ''}</small></span>${icon('arrow')}`, `data-sample="${ex.id}"`, 'history-item'); }).join('')}` : `<div class="empty-library"><h3>Your first decision starts here.</h3><p>Compare the answers, optionally highlight useful details or mistakes, and vote. The reasoning will be here when you come back.</p>${button('close-dialog', 'Back to comparison', '', 'quiet-button')}</div>`;
  openDialog($('#library'));
}
function openDialog(dialog) {
  hideSelection(); dialog.showModal();
  feel.animate(dialog, [{ transform: 'translateY(12px)', opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: 240 });
}
function syncPreferences() {
  if (!$('[data-preference="motion"]')) return;
  const motion = $('[data-preference="motion"]'), vibration = $('[data-preference="vibration"]');
  motion.textContent = feel.reduced ? 'System off' : feel.preferences.motion ? 'On' : 'Off';
  motion.disabled = feel.reduced; motion.setAttribute('aria-pressed', feel.motion);
  vibration.textContent = feel.canVibrate ? feel.preferences.vibration ? 'On' : 'Off' : 'Unavailable';
  vibration.disabled = !feel.canVibrate || feel.reduced; vibration.setAttribute('aria-pressed', feel.canVibrate && feel.preferences.vibration && !feel.reduced);
  $('#motion-help').textContent = feel.reduced ? 'Your system’s reduced-motion preference is active. Motion and vibration are off.' : 'Panels move in place and controls respond to your touch. Turn motion off at any time.';
}
function hideSelection() { selection = null; $('#selection-tools').hidden = true; }
function inspectSelection() {
  if (session().vote || $('dialog[open]') || (compact.matches && drawerOpen)) return hideSelection();
  const selected = window.getSelection();
  if (!selected?.rangeCount || selected.isCollapsed) return hideSelection();
  const element = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const range = selected.getRangeAt(0);
  const start = element(range.startContainer)?.closest('.passage-text, .passage-code'), end = element(range.endContainer)?.closest('.passage-text, .passage-code');
  const raw = range.toString(), quote = raw.trim();
  if (!start || start !== end || !quote) return hideSelection();
  const before = range.cloneRange(); before.selectNodeContents(start); before.setEnd(range.startContainer, range.startOffset);
  const offset = before.toString().length + raw.length - raw.trimStart().length;
  const passage = start.closest('.passage'), rect = range.getBoundingClientRect();
  selection = { side: passage.dataset.side, index: Number(passage.dataset.index), field: start.matches('.passage-code') ? 'code' : 'text', start: offset, end: offset + quote.length, quote };
  const tools = $('#selection-tools'); tools.hidden = false;
  tools.style.left = `${Math.min(Math.max(rect.left, 8), innerWidth - tools.offsetWidth - 8)}px`;
  tools.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - 140))}px`;
}

$('#workspace-app').addEventListener('click', event => {
  const target = event.target.closest('button[data-action]');
  if (!target || target.disabled) return;
  const { action, side, index } = target.dataset;
  if (action === 'theme') toggleTheme();
  if (action === 'drawer') setDrawer(!drawerOpen, true);
  if (action === 'close-drawer') setDrawer(false);
  if (action === 'keep') keep({ side, index: Number(index), field: 'passage' });
  if (action === 'remove') removeHighlight(target.dataset.highlight);
  if (action === 'start-highlighting') {
    setDrawer(false);
    $(`.answer-panel[data-side="${mobileSide}"] .keep-button`).focus({ preventScroll: true });
  }
  if (action === 'reason' && !session().vote) {
    state = updateSession(state, state.sampleId, { reason: session().reason === target.dataset.reason ? null : target.dataset.reason }); persist();
    $$('[data-action="reason"]').forEach(node => node.setAttribute('aria-pressed', node.dataset.reason === session().reason));
  }
  if (action === 'vote') vote(target.dataset.vote);
  if (action === 'change-vote') setVoteEditing(true);
  if (action === 'cancel-vote') setVoteEditing(false);
  if (action === 'sample') changeSample(target.dataset.sample);
  if (action === 'tab') { mobileSide = side; syncMobile(); hideSelection(); feel.animate($(`.answer-panel[data-side="${side}"]`), [{ opacity: .3, transform: `translateX(${side === 'A' ? -8 : 8}px)` }, { opacity: 1, transform: 'none' }], { duration: 200 }); }
  if (action === 'next') { const next = examples.find(ex => !state.sessions[ex.id].vote); if (next) { changeSample(next.id); $('#answers').focus(); } }
  if (action === 'notebook' || action === 'scores') openLibrary(action);
  if (action === 'settings') { syncPreferences(); openDialog($('#settings')); }
  if (action === 'preference') feel.toggle(target.dataset.preference);
  if (action === 'close-dialog') target.closest('dialog').close();
  if (action === 'compare') { setDrawer(false); $('#answers').focus(); }
  if (action === 'revisit') {
    $('#library').close(); changeSample(target.dataset.sample);
    const first = session().highlights[0];
    if (first) mobileSide = first.side;
    syncMobile(); if (!compact.matches) setDrawer(true);
    const destination = first ? $(`#passage-${first.side}-${first.index}`) : $('#answers');
    destination.focus({ preventScroll: true }); destination.scrollIntoView({ block: 'center' });
  }
  if (action === 'jump') {
    mobileSide = side; syncMobile(); if (compact.matches) setDrawer(false);
    const passage = $(`#passage-${side}-${index}`);
    passage.focus({ preventScroll: true }); passage.scrollIntoView({ block: 'center', behavior: feel.motion ? 'smooth' : 'instant' });
    feel.animate(passage, [{ opacity: .45 }, { opacity: 1 }], { duration: 320 });
  }
});
$('#workspace-app').addEventListener('input', event => {
  if (session().vote) return;
  if (event.target.matches('textarea[data-highlight]')) {
    const key = event.target.dataset.highlight;
    state = updateSession(state, state.sampleId, { highlights: session().highlights.map(item => highlightId(item) === key ? { ...item, note: event.target.value } : item) }); persist();
    $('.highlight-note-status', event.target.parentElement).textContent = storageError ? 'This visit only' : 'Saved on this device';
  } else if (event.target.id === 'decision-note') {
    state = updateSession(state, state.sampleId, { note: event.target.value }); persist();
    $('.note-status').textContent = `${storageError ? 'This visit only' : 'Saved on this device'} · ${session().note.length}/600`;
  }
});
$('.mobile-picker').addEventListener('change', event => changeSample(event.target.value));
$('.drawer-backdrop').addEventListener('click', () => setDrawer(false));
$('#keep-selection').addEventListener('pointerdown', event => event.preventDefault());
$('#keep-selection').addEventListener('click', () => {
  if (!selection) return;
  const item = selection, { side, index } = item;
  window.getSelection()?.removeAllRanges(); keep(item); hideSelection();
  if (!compact.matches) $(`#passage-${side}-${index} .keep-button`).focus({ preventScroll: true });
});
document.addEventListener('pointerup', event => { if (!event.target.closest('#selection-tools')) inspectSelection(); });
document.addEventListener('keyup', event => { if (event.key === 'Shift') inspectSelection(); });
document.addEventListener('scroll', hideSelection, true);
document.addEventListener('keydown', event => {
  if ($('dialog[open]')) return;
  if (event.key === 'Escape') { if (selection) { hideSelection(); window.getSelection()?.removeAllRanges(); } else if (drawerOpen) setDrawer(false); else if (editingVote) setVoteEditing(false); }
  if (event.key === 'Tab' && drawerOpen && compact.matches) {
    const focusable = $$('button:not(:disabled),textarea', $('#evidence-drawer')).filter(node => node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === $('#evidence-title'))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
compact.addEventListener('change', () => { hideSelection(); syncMobile(); });
window.addEventListener('resize', hideSelection);
renderSample(); syncPreferences(); syncTheme();
