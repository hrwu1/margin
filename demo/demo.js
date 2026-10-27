export const samples = [
  {
    id: 'indexes', title: 'Explain a database index', category: 'Explain a concept',
    prompt: 'Explain database indexes to someone who knows SQL but has never used an index. Use a simple analogy and include one tradeoff.',
    answers: {
      A: { model: 'Cedar', paragraphs: [
        { title: 'Think of the index at the back of a book.', text: 'If you want every page that mentions “photosynthesis,” you could read the entire book. Or you could check its index and jump straight to the right pages. A database index does something similar for your rows.' },
        { text: 'For a query like SELECT * FROM users WHERE email = \'alex@example.com\', an index on email helps the database find matching rows without checking every user. The table still holds the full data; the index is an extra structure that helps locate it.' }, // taste-skill-ignore: reserved example domain is intentional in this SQL teaching example.
        { title: 'Faster to find. A little slower to change.', text: 'Every time you insert a user or change an email, the database also has to update the index. It takes extra storage, too. Start with columns you frequently filter or join on, rather than indexing everything.' }
      ] },
      B: { model: 'Birch', paragraphs: [
        { title: 'An index is a shortcut to your data.', text: 'Imagine a library catalog: instead of walking past every shelf to find a book, you look up its location. An index stores column values in a structure the database can search efficiently.' },
        { text: 'For example, you can create an index with CREATE INDEX idx_users_email ON users(email). When you filter users by email, the query planner may use that index to locate the relevant rows. Many databases use B-tree indexes for this.' },
        { title: 'There is a cost to the shortcut.', text: 'Indexes occupy disk space and add work to inserts, updates, and deletes. They are useful for frequent lookups on larger tables, but may offer little benefit on a tiny table. Use EXPLAIN to check whether your queries actually use an index.' }
      ] }
    }
  },
  {
    id: 'message', title: 'Make a message more human', category: 'Shape the tone',
    prompt: 'Rewrite this as a friendly, clear message to a teammate: “Your PR is blocking the release. Please fix the failing tests ASAP.” Keep it under 60 words and avoid blame.',
    answers: {
      A: { model: 'Birch', paragraphs: [
        { text: 'Hey! A few tests on the PR are still failing, so we’re holding the release for now. Could you take a look when you get a chance? Happy to pair up if that would help.' }
      ] },
      B: { model: 'Cedar', paragraphs: [
        { text: 'Hey, we’re ready to release once the tests on this PR pass. Could you prioritize a fix and let me know your ETA? I’m happy to help investigate or pair on it. Thanks!' }
      ] }
    }
  },
  {
    id: 'code', title: 'Catch a subtle Python bug', category: 'Review some code',
    prompt: 'What is wrong with this Python function, and how would you fix it? Explain briefly: def add_item(item, items=[]): items.append(item); return items',
    answers: {
      A: { model: 'Cedar', paragraphs: [
        { title: 'The default list is shared across calls.', text: 'Python evaluates a default argument once, when the function is defined. Calling add_item("a") and then add_item("b") without an explicit list returns ["a", "b"] on the second call, because both calls use the same list.' },
        { title: 'Use None, then create a list inside the function.', text: 'Check explicitly for None so a caller’s empty list is still respected.', code: 'def add_item(item, items=None):\n    if items is None:\n        items = []\n    items.append(item)\n    return items' },
        { text: 'This keeps the existing behavior of updating a list that the caller provides, while giving each call without a list a fresh one.' }
      ] },
      B: { model: 'Birch', paragraphs: [
        { title: 'Avoid mutable default arguments.', text: 'A list used as a default argument can retain values from earlier calls. Use None as the default instead, and initialize a new list when needed.' },
        { text: 'This version avoids sharing the default list between calls:', code: 'def add_item(item, items=None):\n    items = items or []\n    items.append(item)\n    return items' },
        { text: 'Now add_item("a") returns ["a"] and a later add_item("b") returns ["b"]. The results no longer accumulate across those calls.' }
      ] }
    }
  }
];

export const reasons = ['Clarity', 'Depth', 'Practicality', 'Follows the prompt'];
export const STORAGE_KEY = 'margin-demo-notebook-v1';

// Treat browser storage as untrusted: retain only known, complete decisions.
export function validateDecisions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap(row => {
    const sample = samples.find(item => item.id === row?.sampleId);
    if (!sample || seen.has(row.sampleId) || !['A', 'B', 'tie'].includes(row.vote)
      || !Number.isFinite(row.createdAt) || row.createdAt <= 0) return [];
    seen.add(row.sampleId);
    const mark = row.mark;
    const validMark = mark && ['A', 'B'].includes(mark.side) && Number.isInteger(mark.index)
      && mark.index >= 0 && mark.index < sample.answers[mark.side].paragraphs.length;
    return [{ sampleId: row.sampleId, vote: row.vote, createdAt: row.createdAt,
      reason: reasons.includes(row.reason) ? row.reason : null,
      mark: validMark ? { side: mark.side, index: mark.index } : null }];
  });
}

export function recordDecision(decisions, decision) {
  // A completed blind vote cannot be repeated after the identities are revealed.
  return validateDecisions([...decisions, decision]);
}

export function scoreDecisions(decisions) {
  const scores = Object.fromEntries(['Cedar', 'Birch'].map(model => [model, { wins: 0, ties: 0, losses: 0, compared: 0 }]));
  for (const decision of validateDecisions(decisions)) {
    const sample = samples.find(item => item.id === decision.sampleId);
    for (const side of ['A', 'B']) {
      const score = scores[sample.answers[side].model];
      score.compared += 1;
      if (decision.vote === 'tie') score.ties += 1;
      else if (decision.vote === side) score.wins += 1;
      else score.losses += 1;
    }
  }
  return scores;
}

export function readNotebook(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  return validateDecisions(JSON.parse(raw));
}

const icons = {
  brand: '<path d="M9 3H3v24h6M21 3h6v24h-6M12 20l6-10"/>',
  compare: '<rect x="3" y="4" width="6" height="16" rx="1.5"/><rect x="15" y="4" width="6" height="16" rx="1.5"/>',
  notebook: '<path d="M7 3h13v18H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 0v18M11 8h5M11 12h5"/>',
  scores: '<path d="M4 20h16M6 16v-5M12 16V4M18 16V8"/>',
  mark: '<path d="M8 4H4v16h4M16 4h4v16h-4"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  lock: '<rect x="6" y="10" width="12" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  prompt: '<path d="m4 5 6 6-6 6M12 18h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>'
};
function icon(name) {
  return `<svg viewBox="0 0 ${name === 'brand' ? '30 30' : '24 24'}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
function paragraphText(paragraph) { return [paragraph.title, paragraph.text, paragraph.code].filter(Boolean).join(' '); }
function words(answer) { return answer.paragraphs.map(paragraphText).join(' ').trim().split(/\s+/).length; }

// The same module exposes its small state functions to the dependency-free tests.
if (typeof document !== 'undefined') initializeDemo();

function initializeDemo() {
  const app = document.querySelector('#app');
  const announcement = document.querySelector('#announcement');
  const dialog = document.querySelector('#about-dialog');
  const resetDialog = document.querySelector('#reset-dialog');
  let decisions = [];
  let storageWarning = '';
  let persistent = true;
  try { decisions = readNotebook(window.localStorage); }
  catch {
    persistent = false;
    storageWarning = 'Browser storage could not be read. You can still explore; new decisions will be kept in this tab unless saving becomes available.';
  }
  const drafts = new Map();
  let mobileSide = decisions.find(row => row.sampleId === getRoute().sample.id)?.mark?.side || 'A';
  let activeSampleId = samples[0].id;

  function announce(message) { announcement.textContent = message; }
  function getRoute() {
    const [page, id] = location.hash.slice(1).split('/');
    return { page: ['notebook', 'scores'].includes(page) ? page : 'compare',
      sample: samples.find(sample => sample.id === id) || samples[0] };
  }
  function currentDecision(id) { return decisions.find(decision => decision.sampleId === id); }
  function getDraft(id) {
    if (!drafts.has(id)) drafts.set(id, { mark: null, reason: null });
    return drafts.get(id);
  }
  function verdict(sample, decision) {
    return decision.vote === 'tie' ? 'A thoughtful tie' : `${sample.answers[decision.vote].model} was your pick`;
  }
  function render({ focus = false } = {}) {
    const { page, sample } = getRoute();
    const decision = currentDecision(sample.id);
    if (activeSampleId !== sample.id) {
      mobileSide = decision?.mark?.side || 'A';
      activeSampleId = sample.id;
    }
    const title = { compare: 'Comparison', notebook: 'Your notebook', scores: 'Your scorecard' }[page];
    document.title = `${title} · Margin`;
    app.innerHTML = `<div class="app-shell">
      <aside class="sidebar" aria-label="Workspace navigation">
        <div><a class="brand" href="#compare/${samples[0].id}" aria-label="Margin home">${icon('brand')}Margin</a><p class="brand-caption">A little context for every choice.</p></div>
        <nav class="main-nav" aria-label="Main">${[['compare', 'Compare', 'compare'], ['notebook', 'Notebook', 'notebook'], ['scores', 'Scorecard', 'scores']].map(([key, label, symbol]) => `<a href="#${key}${key === 'compare' ? `/${sample.id}` : ''}" class="nav-link" ${page === key ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${key === 'notebook' ? `<span class="nav-count">${decisions.length.toString().padStart(2, '0')}</span>` : ''}</a>`).join('')}</nav>
        <section class="recent"><h2 class="eyebrow">In your notebook</h2><div class="recent-links">${decisions.length ? [...decisions].reverse().map(decision => `<a class="recent-link" href="#compare/${decision.sampleId}">${icon('mark')}<span>${samples.find(sample => sample.id === decision.sampleId).title}</span></a>`).join('') : '<p class="recent-empty">Your decisions will find<br>a home here.</p>'}</div></section>
        <div class="sidebar-bottom"><div class="private-label">${icon('lock')}Just your perspective</div><p>${persistent ? 'Saved in this browser.' : 'Kept in this tab for now.'}<br>No account needed.</p></div>
      </aside>
      <div class="workspace"><header class="topbar"><div class="breadcrumb"><span>Personal workspace</span><span aria-hidden="true">/</span><span>${title}</span></div><div class="topbar-actions"><span class="demo-label">Interactive demo</span><button class="text-button" data-action="about">How it works</button></div></header>
      ${storageWarning ? `<p class="storage-warning" role="alert">${escapeHTML(storageWarning)}</p>` : ''}
      <main id="main" tabindex="-1">${page === 'compare' ? renderComparison(sample, decision) : page === 'notebook' ? renderNotebook() : renderScores()}
        <footer class="page-foot"><span class="foot-signature">${icon('brand')}Good answers deserve a little context.</span><span>Sample content. Real preferences.</span></footer>
      </main></div></div>`;
    // On phones, reopen the evidence inside the answer without moving the page.
    const savedPassage = app.querySelector('.passage.marked');
    const answerBody = savedPassage?.closest('.response-body');
    if (decision && answerBody?.scrollHeight > answerBody?.clientHeight) {
      answerBody.scrollTop = savedPassage.getBoundingClientRect().top - answerBody.getBoundingClientRect().top - 16;
    }
    if (focus) document.querySelector('h1').focus({ preventScroll: true });
  }

  function renderComparison(sample, decision) {
    const draft = decision || getDraft(sample.id);
    const next = samples.find(item => !currentDecision(item.id) && item.id !== sample.id);
    return `<div class="page-heading"><div><span class="eyebrow">${decision ? 'A decision, with context' : 'Read. Notice. Decide.'}</span><h1 tabindex="-1">${decision ? 'The answer. And your reason.' : 'Which answer works for you?'}</h1><p class="page-description">${decision ? 'A small record of what mattered when you made the call.' : 'Two perspectives. No names. A little room for your judgment.'}</p></div><div class="step-note">${decision ? '<strong>03</strong> / Remember the why' : '<strong>01</strong> Read &nbsp; / &nbsp; 02 Decide &nbsp; / &nbsp; 03 Remember'}</div></div>
      <section class="prompt-box" aria-label="Sample prompt"><div class="prompt-label">${icon('prompt')}<span>Prompt</span></div><div class="prompt-content"><p class="prompt-text">${escapeHTML(sample.prompt)}</p><div class="sample-meta"><label for="sample-select">Example <select id="sample-select" aria-label="Choose a sample comparison">${samples.map(item => `<option value="${item.id}" ${item.id === sample.id ? 'selected' : ''}>${item.category}</option>`).join('')}</select></label><span class="sample-separator" aria-hidden="true"></span><span>Prewritten sample · ${samples.indexOf(sample) + 1} of ${samples.length}</span></div></div></section>
      <div class="comparison-tools"><p class="instruction">${icon('mark')}<span id="mark-instruction">${decision ? (decision.mark ? 'Your marked passage is right where you left it.' : 'You saved this decision without a marked passage.') : 'Click a paragraph to keep it with your decision. Optional.'}</span></p>${!decision ? `<button class="clear-mark" data-action="clear-mark" ${draft.mark ? '' : 'hidden'}>Clear mark</button>` : '<span class="instruction">Fictional demo models</span>'}</div>
      <div class="mobile-tabs" role="tablist" aria-label="Answer to read">${['A', 'B'].map(side => `<button class="answer-tab" id="tab-${side}" role="tab" aria-selected="${mobileSide === side}" aria-controls="response-${side}" tabindex="${mobileSide === side ? 0 : -1}" data-side="${side}">Response ${side}${decision ? ` · ${sample.answers[side].model}` : ''}</button>`).join('')}</div>
      <div class="responses">${['A', 'B'].map(side => renderAnswer(sample, side, draft, decision)).join('')}</div>
      ${decision ? `<section class="receipt" aria-label="Saved decision"><div><div class="receipt-title">${icon('check')} ${verdict(sample, decision)}.</div><p>${persistent ? 'Saved to your notebook' : 'Kept in this tab'}${decision.mark ? ', with the passage you marked' : ''}${decision.reason ? ` · ${decision.reason}` : ''}.</p></div><div class="receipt-actions"><a class="text-button" href="#notebook">Open notebook</a><a class="button primary" href="${next ? `#compare/${next.id}` : '#scores'}">${next ? 'Next example' : 'View scorecard'} ${icon('arrow')}</a></div></section>` : renderVoting(draft)}`;
  }
  function renderAnswer(sample, side, draft, decision) {
    const answer = sample.answers[side];
    const winner = decision && (decision.vote === side || decision.vote === 'tie');
    return `<article class="response" id="response-${side}" aria-labelledby="answer-title-${side}" data-mobile-hidden="${mobileSide !== side}"><header class="response-header"><div class="response-heading"><span class="response-letter">${side}</span><h2 id="answer-title-${side}">${decision ? answer.model : `Response ${side}`}</h2></div><span class="response-state ${winner ? 'winner' : ''}">${icon(decision ? (winner ? 'check' : 'lock') : 'lock')}${decision ? (decision.vote === 'tie' ? 'Your tie' : winner ? 'Your pick' : 'Revealed') : 'Identity hidden'}</span></header><div class="response-body">${answer.paragraphs.map((paragraph, index) => {
      const marked = draft.mark?.side === side && draft.mark.index === index;
      const content = `${paragraph.title ? `<span class="passage-title">${escapeHTML(paragraph.title)}</span>` : ''}${escapeHTML(paragraph.text)}${paragraph.code ? `<code class="code-block">${escapeHTML(paragraph.code)}</code>` : ''}`;
      return decision ? `<div class="passage ${marked ? 'marked' : ''}" ${marked ? 'aria-label="Your saved evidence"' : ''}>${content}</div>` : `<button class="passage ${marked ? 'marked' : ''}" aria-pressed="${marked}" aria-label="${marked ? 'Unmark' : 'Mark'} passage ${index + 1} from response ${side}" aria-describedby="passage-${side}-${index}" data-mark-side="${side}" data-mark-index="${index}"><span id="passage-${side}-${index}">${content}</span></button>`;
    }).join('')}</div><footer class="response-footer"><span>${words(answer)} words</span><span class="footer-mark" data-mark-footer="${side}">${draft.mark?.side === side ? `${icon('mark')}${decision ? 'Saved evidence' : '1 passage marked'}` : 'Sample response'}</span></footer></article>`;
  }
  function renderVoting(draft) {
    return `<section class="decision-panel" aria-label="Make your choice"><div class="decision-top"><div><h2 class="decision-title">A good answer depends on what matters.</h2><p class="decision-subtitle">Choose the one you’d want to receive.</p></div><fieldset class="reasons"><legend>Your reason <span>(optional)</span></legend>${reasons.map(reason => `<button class="reason" data-reason="${reason}" aria-pressed="${draft.reason === reason}">${reason}</button>`).join('')}</fieldset></div><div class="vote-actions"><button class="vote" data-vote="A"><span class="vote-letter">A</span>I prefer A</button><button class="vote vote-tie" data-vote="tie">It’s a tie</button><button class="vote" data-vote="B"><span class="vote-letter">B</span>I prefer B</button></div><p class="bottom-note">Vote to reveal the models. Your marked passage comes with you.</p></section>`;
  }
  function renderNotebook() {
    return `<div class="page-heading"><div><span class="eyebrow">Keep the thought, not just the score</span><h1 tabindex="-1">Your comparison notebook.</h1><p class="page-description">The choices you made. The passages that stayed with you.</p></div></div><div class="notebook-intro"><span class="notebook-count">${decisions.length.toString().padStart(2, '0')} saved decision${decisions.length === 1 ? '' : 's'}</span><div class="notebook-tools"><span>${persistent ? 'Private to this browser' : 'In this tab only'} · Newest first</span>${decisions.length ? '<button class="text-button" data-action="reset">Reset demo</button>' : ''}</div></div>${decisions.length ? `<div class="notebook-list">${[...decisions].reverse().map((decision, index) => {
      const sample = samples.find(item => item.id === decision.sampleId);
      const mark = decision.mark;
      const paragraph = mark && sample.answers[mark.side].paragraphs[mark.index];
      return `<article class="notebook-entry"><span class="entry-number">${(decisions.length - index).toString().padStart(2, '0')}</span><div><h2 class="entry-title">${sample.title}</h2><p class="entry-prompt">${escapeHTML(sample.prompt)}</p>${paragraph ? `<blockquote class="evidence-quote">“${escapeHTML(paragraph.text)}”${paragraph.code ? `<code class="code-block">${escapeHTML(paragraph.code)}</code>` : ''}<cite>Marked in response ${mark.side} · ${sample.answers[mark.side].model}</cite></blockquote>` : '<p class="entry-prompt">No passage marked. Sometimes the overall answer is what matters.</p>'}<div class="entry-meta"><span>${new Date(decision.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><span aria-hidden="true">·</span><span>${decision.reason ? `Reason: ${decision.reason}` : 'No reason added'}</span></div></div><div class="entry-action"><span class="entry-verdict">${decision.vote === 'tie' ? 'A tie' : `${sample.answers[decision.vote].model} preferred`}</span><a class="reopen" href="#compare/${sample.id}">Revisit decision ${icon('arrow')}</a></div></article>`;
    }).join('')}</div>` : `<div class="empty-state"><div class="empty-mark">${icon('brand')}</div><h2>A place for your “that’s the part.”</h2><p>Make your first comparison. We’ll keep the answer you preferred and the passage that helped you choose.</p><a class="button primary" href="#compare/${samples[0].id}">Make a comparison ${icon('arrow')}</a></div>`}`;
  }
  function renderScores() {
    const scores = scoreDecisions(decisions);
    return `<div class="page-heading"><div><span class="eyebrow">A record of your preferences</span><h1 tabindex="-1">A score with some perspective.</h1><p class="page-description">Your sample votes, counted simply. Every number has a decision behind it.</p></div></div><div class="score-summary"><div><strong>${decisions.length.toString().padStart(2, '0')}</strong><span>comparison${decisions.length === 1 ? '' : 's'} in your notebook</span></div><p>Fictional models · ${samples.length} available examples</p></div><table class="score-table"><caption class="sr-only">Your demo model scores. Each tie counts once for both models.</caption><thead><tr><th scope="col">Model</th><th scope="col">Wins</th><th scope="col">Ties</th><th scope="col">Losses</th><th scope="col">Compared</th></tr></thead><tbody>${Object.entries(scores).map(([model, score]) => `<tr><th scope="row"><span class="model-name"><span class="model-symbol" aria-hidden="true">${model.slice(0,1)}</span><span><strong>${model}</strong><small>Demo model</small></span></span></th><td class="wins">${score.wins}</td><td>${score.ties}</td><td>${score.losses}</td><td>${score.compared}</td></tr>`).join('')}</tbody></table><div class="score-note"><section><h2>Preference, with a paper trail.</h2><p>Each completed comparison adds one win and one loss, or one tie to both models. <a class="reopen" href="#notebook">Revisit the decisions ${icon('arrow')}</a></p></section><section><h2>A small sample, honestly shown.</h2><p>${decisions.length ? 'These counts describe your choices across prewritten examples. They aren’t a benchmark of real model quality.' : 'No votes yet. The zeros will change after your first comparison. There are no global ratings or simulated results here.'}</p></section></div>${!decisions.length ? `<p style="margin-top:28px"><a class="button primary" href="#compare/${samples[0].id}">Compare the first pair ${icon('arrow')}</a></p>` : ''}`;
  }

  function updateMarks() {
    const { sample } = getRoute();
    const draft = getDraft(sample.id);
    for (const button of app.querySelectorAll('[data-mark-side]')) {
      const side = button.dataset.markSide;
      const index = Number(button.dataset.markIndex);
      const marked = draft.mark?.side === side && draft.mark.index === index;
      button.classList.toggle('marked', marked);
      button.setAttribute('aria-pressed', String(marked));
      button.setAttribute('aria-label', `${marked ? 'Unmark' : 'Mark'} passage ${index + 1} from response ${side}`);
    }
    for (const footer of app.querySelectorAll('[data-mark-footer]')) {
      footer.innerHTML = draft.mark?.side === footer.dataset.markFooter ? `${icon('mark')}1 passage marked` : 'Sample response';
    }
    app.querySelector('[data-action="clear-mark"]').hidden = !draft.mark;
    app.querySelector('#mark-instruction').textContent = draft.mark ? `Passage ${draft.mark.index + 1} from ${draft.mark.side} will stay with your decision.` : 'Click a paragraph to keep it with your decision. Optional.';
  }
  function setMobileSide(side, focus = false) {
    mobileSide = side;
    for (const tab of app.querySelectorAll('[role="tab"]')) {
      const selected = tab.dataset.side === side;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const response of app.querySelectorAll('.response')) response.dataset.mobileHidden = String(response.id !== `response-${side}`);
  }

  app.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.action === 'about') { dialog.showModal(); return; }
    if (target.dataset.action === 'reset') { resetDialog.returnValue = ''; resetDialog.showModal(); return; }
    const { sample } = getRoute();
    if (target.dataset.side) { setMobileSide(target.dataset.side); return; }
    if (currentDecision(sample.id)) return;
    const draft = getDraft(sample.id);
    if (target.dataset.markSide) {
      const side = target.dataset.markSide;
      const index = Number(target.dataset.markIndex);
      draft.mark = draft.mark?.side === side && draft.mark.index === index ? null : { side, index };
      updateMarks();
      announce(draft.mark ? `Passage ${index + 1} from response ${side} marked as evidence.` : 'Passage unmarked.');
    } else if (target.dataset.action === 'clear-mark') {
      const previousMark = draft.mark;
      draft.mark = null;
      updateMarks();
      app.querySelector(`[data-mark-side="${previousMark.side}"][data-mark-index="${previousMark.index}"]`)?.focus();
      announce('Passage unmarked.');
    } else if (target.dataset.reason) {
      draft.reason = draft.reason === target.dataset.reason ? null : target.dataset.reason;
      for (const button of app.querySelectorAll('[data-reason]')) button.setAttribute('aria-pressed', String(button.dataset.reason === draft.reason));
      announce(draft.reason ? `Reason selected: ${draft.reason}.` : 'Reason cleared.');
    } else if (target.dataset.vote) {
      const decision = { sampleId: sample.id, vote: target.dataset.vote, ...draft, createdAt: Date.now() };
      decisions = recordDecision(decisions, decision);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions));
        persistent = true;
        storageWarning = '';
      } catch {
        persistent = false;
        storageWarning = 'This browser couldn’t save your notebook. Your decision is kept in this tab, but may be lost when you reload or close it.';
      }
      render();
      const receipt = app.querySelector('.receipt');
      receipt.tabIndex = -1;
      receipt.focus({ preventScroll: true });
      receipt.scrollIntoView({ block: 'nearest' });
      announce(`${verdict(sample, decision)}. ${persistent ? 'Decision saved to your notebook.' : 'Decision kept in this tab only.'} Model names revealed.`);
    }
  });
  app.addEventListener('change', event => {
    if (event.target.id === 'sample-select') location.hash = `compare/${event.target.value}`;
  });
  app.addEventListener('keydown', event => {
    if (event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      setMobileSide(event.key === 'Home' ? 'A' : event.key === 'End' ? 'B' : mobileSide === 'A' ? 'B' : 'A', true);
    }
  });
  document.querySelector('.skip-link').addEventListener('click', event => {
    event.preventDefault();
    app.querySelector('main').focus();
  });
  resetDialog.addEventListener('close', () => {
    if (resetDialog.returnValue !== 'reset') return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      persistent = true;
      storageWarning = '';
    } catch {
      persistent = false;
      storageWarning = 'The demo reset in this tab, but browser storage could not be cleared. Older decisions may return after a reload.';
    }
    decisions = [];
    drafts.clear();
    render({ focus: true });
    announce('Demo notebook reset. Ready for a fresh comparison.');
  });
  window.addEventListener('hashchange', () => {
    const { sample } = getRoute();
    mobileSide = currentDecision(sample.id)?.mark?.side || 'A';
    render({ focus: true });
    window.scrollTo(0, 0);
  });
  render();
}
