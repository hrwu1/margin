export const directions = {
  fieldnotes: { name: 'Fieldnotes', number: '01', short: 'A notebook for your judgment.', description: 'Unhurried reading. A useful passage becomes a reason worth keeping.', interaction: 'Mark a passage. Watch it become a note.', strength: 'Personal, thoughtful, easy to return to.', tradeoff: 'More space for reading; less information at a glance.', title: 'Read between the answers.', label: 'The considered choice' },
  lens: { name: 'Lens', number: '02', short: 'Less noise. A closer look.', description: 'A quiet dark reading room. Bring two passages into focus before you choose.', interaction: 'Use Close reading to compare passage by passage.', strength: 'Focused reading with a memorable interaction.', tradeoff: 'Focused mode adds a step when you want the whole answer.', title: 'Find the difference that matters.', label: 'The focused choice' },
  workbench: { name: 'Workbench', number: '03', short: 'Put your reasoning on the record.', description: 'Answers on the desk. Evidence at your side. A clear trail from reading to decision.', interaction: 'Collect a passage from each answer in the evidence tray.', strength: 'Evidence and judgment stay visible together.', tradeoff: 'Denser on desktop; the tray moves below answers on phones.', title: 'Review the reasoning.', label: 'The analytical choice' }
};

export const examples = [
  { id: 'python', title: 'The list that remembers', category: 'Code review', question: 'Why does this Python function remember items from earlier calls? Fix it without changing what happens when I pass in my own list.', snippet: 'def add_item(item, items=[]):\n    items.append(item)\n    return items',
    answers: {
      A: { model: 'Cedar', paragraphs: [
        { title: 'The default is created once.', text: 'Python creates the default list when the function is defined, not every time you call it. Later calls without a list reuse that same object.' },
        { title: 'Make a new list only when none was supplied.', text: 'Use an explicit None check:', code: 'def add_item(item, items=None):\n    if items is None:\n        items = []\n    items.append(item)\n    return items' },
        { title: 'Keep the caller’s list.', text: 'An empty list is still a list the caller gave you. Checking for None preserves that object, so add_item("a", my_list) also updates my_list.' }
      ] },
      B: { model: 'Birch', paragraphs: [
        { title: 'Avoid a mutable default.', text: 'A list used as a default argument retains changes across calls. Replacing it with None prevents accidental sharing between separate calls.' },
        { title: 'Initialize the list inside the function.', text: 'This version creates a list when needed:', code: 'def add_item(item, items=None):\n    items = items or []\n    items.append(item)\n    return items' },
        { title: 'Each call starts fresh.', text: 'Now add_item("a") returns ["a"], and a later add_item("b") returns ["b"]. Earlier values no longer appear in new calls.' }
      ] }
    }
  },
  { id: 'indexes', title: 'A shortcut, with a cost', category: 'Explain a concept', question: 'Explain a database index to someone who knows SQL. Use a simple analogy and include the tradeoff.',
    answers: {
      A: { model: 'Birch', paragraphs: [
        { title: 'Think of a library catalog.', text: 'Instead of walking past every shelf, you look up a book’s location. A database index does a similar job: it helps locate rows without scanning the entire table.' },
        { title: 'Build it for the queries you run.', text: 'If you often look up people by email, an index on that column can make those lookups faster.', code: 'CREATE INDEX users_email\nON users(email);' },
        { title: 'The catalog needs maintenance.', text: 'Indexes use storage and add work when rows change. Use EXPLAIN to check that your real queries benefit before adding more.' }
      ] },
      B: { model: 'Cedar', paragraphs: [
        { title: 'Think of the index in a book.', text: 'To find a topic, you can read every page or use the index to jump to the right one. A database index offers a faster route to matching data.' },
        { title: 'The table still holds the data.', text: 'The index is an extra structure containing searchable column values. The database can use it to find the rows a query needs.', code: 'SELECT * FROM users\nWHERE email = :email;' },
        { title: 'Faster reads, extra work on writes.', text: 'Inserts and updates may also need to update an index. It occupies storage, too. Start with columns you frequently filter or join on.' }
      ] }
    }
  },
  { id: 'message', title: 'Clear without the blame', category: 'Writing', question: 'Rewrite this message to a teammate: “Your PR is blocking the release. Fix the failing tests ASAP.” Keep it friendly, clear, and under 60 words.',
    answers: {
      A: { model: 'Cedar', paragraphs: [
        { title: 'A little room to collaborate.', text: 'Hey! A few tests on the PR are still failing, so we’re holding the release for now. Could you take a look when you get a chance? Happy to pair up if that would help.' }
      ] },
      B: { model: 'Birch', paragraphs: [
        { title: 'A clear next step.', text: 'Hey, we’re ready to release once the tests on this PR pass. Could you prioritize a fix and let me know your ETA? I’m happy to help investigate or pair on it. Thanks!' }
      ] }
    }
  }
];
export const reasons = ['Correctness', 'Clarity', 'Useful detail', 'Follows the prompt'];
export const STORAGE_KEY = 'margin-design-directions-v1';
const sides = ['A', 'B'];
const emptyStore = () => ({ preferred: null, decisions: { fieldnotes: [], lens: [], workbench: [] } });

export function validateStore(value) {
  const clean = emptyStore();
  if (Object.hasOwn(directions, value?.preferred)) clean.preferred = value.preferred;
  for (const style of Object.keys(directions)) {
    const rows = value?.decisions?.[style];
    if (!Array.isArray(rows)) continue;
    const seen = new Set();
    for (const row of rows) {
      const sample = examples.find(e => e.id === row?.sampleId);
      if (!sample || seen.has(sample.id) || !['A', 'B', 'tie'].includes(row.vote)) continue;
      seen.add(sample.id);
      const marks = {};
      for (const side of sides) {
        const index = row.marks?.[side];
        if (Number.isInteger(index) && index >= 0 && index < sample.answers[side].paragraphs.length) marks[side] = index;
      }
      clean.decisions[style].push({ sampleId: sample.id, vote: row.vote, marks,
        reason: reasons.includes(row.reason) ? row.reason : null });
    }
  }
  return clean;
}
export function recordVote(store, style, decision) {
  const next = validateStore(store);
  if (Object.hasOwn(directions, style)) next.decisions[style].push(decision);
  return validateStore(next);
}
export function scoreDecisions(rows) {
  const scores = { Cedar: { wins: 0, ties: 0, losses: 0 }, Birch: { wins: 0, ties: 0, losses: 0 } };
  for (const row of rows) {
    const example = examples.find(e => e.id === row.sampleId);
    for (const side of sides) {
      const score = scores[example.answers[side].model];
      if (row.vote === 'tie') score.ties++;
      else if (row.vote === side) score.wins++;
      else score.losses++;
    }
  }
  return scores;
}
export function excerpt(example, side, index) {
  const p = example.answers[side].paragraphs[index];
  return [p.title, p.text, p.code].filter(Boolean).join(' ');
}
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  mark: '<path d="M8 3H4v18h4M16 3h4v18h-4M9 12h6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  book: '<path d="M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4zM12 6v15"/>',
  compare: '<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/>',
  scores: '<path d="M5 20V10M12 20V4M19 20v-6"/>',
  focus: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="6" y="10" width="12" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  reset: '<path d="M4 11a8 8 0 1 1 1 6M4 4v7h7"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const brand = () => `<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>margin<span class="brand-period">.</span></span>`;

if (typeof document !== 'undefined') initialize();

function initialize() {
  const app = document.querySelector('#app');
  const announcement = document.querySelector('#announcement');
  let store = emptyStore(), storageError = '';
  try { store = validateStore(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { storageError = 'Browser storage is unavailable. You can explore; choices will last for this visit.'; }
  let sampleId = examples[0].id;
  let mode = 'focus', passage = 0, mobileSide = 'A', promptOpen = false;
  const drafts = new Map();
  const route = () => {
    const [style, page] = location.hash.slice(1).split('/');
    return { style: Object.hasOwn(directions, style) ? style : null,
      page: ['notebook', 'scores'].includes(page) ? page : 'compare' };
  };
  const sample = () => examples.find(e => e.id === sampleId);
  const decision = style => store.decisions[style].find(row => row.sampleId === sampleId);
  function draft(style) {
    const key = `${style}/${sampleId}`;
    if (!drafts.has(key)) drafts.set(key, { marks: {}, reason: null });
    return drafts.get(key);
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); storageError = ''; }
    catch { storageError = 'Could not save in this browser. Your choices are kept for this visit.'; }
  }
  function announce(message) { announcement.textContent = message; }
  function control(action, content, extra = '', className = '') {
    return `<button type="button" data-action="${action}" ${extra} class="${className}">${content}</button>`;
  }
  function reviewBar(style) {
    return `<header class="review-bar"><a href="#" class="review-home">${icon('grid')}<span>Design review</span></a><nav aria-label="Design directions"><a href="#" ${!style ? 'aria-current="page"' : ''}>Overview</a>${Object.entries(directions).map(([key,d]) => `<a href="#${key}" ${style === key ? 'aria-current="page"' : ''}><span>${d.number}</span> ${d.name}</a>`).join('')}</nav><div class="review-choice">${style ? control('choose', store.preferred === style ? `${icon('check')} Your choice` : `Choose ${directions[style].name}`, `id="choose-direction" aria-pressed="${store.preferred === style}"`, 'choose-button') : `<span>${store.preferred ? `Your pick: <strong>${directions[store.preferred].name}</strong>` : 'Three ways to compare.'}</span>`}</div></header>`;
  }
  function nav(style, page, mini = false) {
    return `<nav class="product-nav" aria-label="${mini ? 'Preview ' : ''}Product">${[['compare','compare','Compare'],['notebook','book','Notebook'],['scores','scores','Scorecard']].map(([key,ico,label]) => `<a href="#${style}/${key}" ${page === key ? 'aria-current="page"' : ''}>${icon(ico)}<span>${label}</span></a>`).join('')}</nav>`;
  }
  function productHeader(style, page, mini) {
    const d = directions[style];
    if (style === 'lens') return `<header class="product-top"><a class="wordmark" href="#${style}">${brand()}</a>${nav(style,page,mini)}<span class="session-note">${icon('lock')} Anonymous session</span></header>`;
    return `<aside class="sidebar"><a class="wordmark" href="#${style}">${brand()}</a><p class="workspace-label">${style === 'fieldnotes' ? 'Your thinking, kept.' : 'Personal workspace'}</p>${nav(style,page,mini)}${style === 'workbench' ? `<div class="queue"><p class="muted">Sample comparisons</p>${examples.map(e => control('sample', `<span class="queue-dot ${e.id === sampleId ? 'current' : ''}"></span><span>${e.title}</span>`, `data-sample="${e.id}" aria-pressed="${e.id === sampleId}"`)).join('')}</div>` : `<div class="sidebar-note"><span class="small-bracket">[ ]</span><p>A choice is more useful<br>when you keep the why.</p></div>`}<div class="sidebar-foot"><span>${icon('lock')} Anonymous session</span><p>Static sample · ${d.name}</p></div></aside>`;
  }
  function sampleSelect(mini) {
    return `<label class="sample-picker"><span>Try an example</span><select ${mini ? '' : 'id="sample-select"'}>${examples.map(e => `<option value="${e.id}" ${e.id === sampleId ? 'selected' : ''}>${e.category}</option>`).join('')}</select></label>`;
  }
  function prompt(style, ex) {
    return `<section class="prompt"><div class="prompt-label">${icon('compare')}<span>${style === 'workbench' ? 'Prompt under review' : 'The question'}</span></div><div class="prompt-content"><p>${escape(ex.question)}</p>${ex.snippet ? `<pre><code>${escape(ex.snippet)}</code></pre>` : ''}</div></section><details class="phone-prompt" ${promptOpen ? 'open' : ''}><summary><span>The question</span><strong>${escape(ex.title)}</strong></summary><div><p>${escape(ex.question)}</p>${ex.snippet ? `<pre><code>${escape(ex.snippet)}</code></pre>` : ''}</div></details>`;
  }
  function answer(style, ex, side, state, mini) {
    const answer = ex.answers[side];
    const complete = Boolean(state.vote);
    const focused = style === 'lens' && (mini || mode === 'focus');
    return `<article class="answer ${mobileSide === side ? 'mobile-active' : ''}" data-side="${side}"><header class="answer-heading"><div class="answer-identity"><span class="side-letter">${side}</span><div><h2>${complete ? answer.model : `Answer ${side}`}</h2><span>${complete ? 'Fictional sample model' : 'Identity hidden until you vote'}</span></div></div>${complete && state.vote === side ? `<span class="winner">${icon('check')} Your choice</span>` : complete ? '' : icon('lock')}</header><div class="answer-copy">${answer.paragraphs.map((p,index) => {
      if (focused && index !== passage) return '';
      const selected = state.marks?.[side] === index;
      return `<section class="passage ${selected ? 'marked' : ''}"><div class="passage-copy"><h3>${escape(p.title)}</h3><p>${escape(p.text)}</p>${p.code ? `<pre><code>${escape(p.code)}</code></pre>` : ''}</div>${!complete ? control('mark', `${selected ? icon('check') : icon('mark')}<span>${selected ? 'Kept' : 'Keep'}</span>`, `data-side="${side}" data-index="${index}" ${mini ? '' : `id="mark-${side}-${index}"`} aria-label="${selected ? 'Remove' : 'Keep'} passage ${index + 1} from answer ${side}" aria-pressed="${selected}"`, 'mark-button') : `<span class="passage-number">${selected ? icon('check') : String(index+1).padStart(2,'0')}</span>`}</section>`;
    }).join('')}</div><footer class="answer-foot"><span>${complete ? 'Read with the evidence in view.' : 'A useful line? Keep it with your decision.'}</span><span>${answer.paragraphs.length} ${answer.paragraphs.length === 1 ? 'passage' : 'passages'}</span></footer></article>`;
  }
  function evidence(style, ex, state) {
    const entries = sides.filter(side => Number.isInteger(state.marks?.[side]));
    return `<div class="evidence"><div class="evidence-title">${icon('mark')}<h3>${style === 'workbench' ? 'Evidence tray' : style === 'fieldnotes' ? 'In the margin' : 'What stood out'}</h3><span>${entries.length} kept</span></div>${entries.length ? `<div class="evidence-list">${entries.map(side => `<blockquote><span class="quote-label">Answer ${side} · passage ${state.marks[side]+1}</span><p>${escape(ex.answers[side].paragraphs[state.marks[side]].text)}</p>${ex.answers[side].paragraphs[state.marks[side]].code ? `<pre><code>${escape(ex.answers[side].paragraphs[state.marks[side]].code)}</code></pre>` : ''}</blockquote>`).join('')}</div>` : `<p class="empty-evidence">${style === 'workbench' ? 'Keep a passage from either answer. The exact words will stay with your vote.' : 'Keep the line that changes your mind. Or simply choose an answer below.'}</p>`}</div>`;
  }
  function reasonPicker(state, mini) {
    return `<fieldset class="reason-picker"><legend>What mattered? <span>Optional</span></legend><div>${reasons.map((reason,index) => control('reason', escape(reason), `data-reason="${reason}" ${mini ? '' : `id="reason-${index}"`} aria-pressed="${state.reason === reason}"`)).join('')}</div></fieldset>`;
  }
  function decisionPanel(style, ex, state, mini) {
    const completed = Boolean(state.vote);
    return `<section class="decision-panel ${completed ? 'complete' : ''}" aria-label="Your decision">${evidence(style,ex,state)}${completed ? `<div class="decision-receipt" tabindex="-1"><span class="receipt-check">${icon('check')}</span><div><h2>${state.vote === 'tie' ? 'Too close to call.' : `You chose ${ex.answers[state.vote].model}.`}</h2><p>${state.reason ? `${escape(state.reason)} · ` : ''}Your decision and evidence are in the notebook.</p></div><a class="button primary" href="#${style}/notebook">Open notebook ${icon('arrow')}</a></div>` : `<div class="decision-controls">${reasonPicker(state,mini)}<div class="vote-row"><div><h3>${style === 'workbench' ? 'Record your judgment' : 'Which answer would you use?'}</h3><span>Vote to reveal the sample models.</span></div><div class="vote-buttons">${control('vote', 'Answer A', 'data-vote="A"', 'button')}${control('vote', 'It’s a tie', 'data-vote="tie"', 'button tie')}${control('vote', 'Answer B', 'data-vote="B"', 'button')}</div></div></div>`}</section>`;
  }
  function focusControls(ex) {
    const count = Math.max(...sides.map(s => ex.answers[s].paragraphs.length));
    return `<div class="focus-toolbar"><div class="segmented" aria-label="Reading mode">${control('mode','Full answers','data-mode="full" id="mode-full" aria-pressed="'+(mode==='full')+'"')}${control('mode',`${icon('focus')} Close reading`,'data-mode="focus" id="mode-focus" aria-pressed="'+(mode==='focus')+'"')}</div>${mode === 'focus' ? `<div class="passage-stepper">${control('step',icon('back'),`id="passage-previous" data-step="-1" aria-label="Previous passage" ${passage === 0 ? 'disabled' : ''}`)}<span>Passage ${passage+1} of ${count}</span>${control('step',icon('arrow'),`id="passage-next" data-step="1" aria-label="Next passage" ${passage === count-1 ? 'disabled' : ''}`)}</div>` : `<p>Bring one passage from each answer into focus.</p>`}</div>`;
  }
  function compare(style, mini = false) {
    const ex = sample(), d = directions[style];
    const state = mini ? { marks: style === 'workbench' ? { A: 2 } : {}, reason: null } : decision(style) || draft(style);
    return `<div class="screen-heading"><div><p class="screen-context">${style === 'workbench' ? 'Review desk / ' : ''}${ex.category}</p><h1>${d.title}</h1></div>${sampleSelect(mini)}</div>${prompt(style,ex)}${style === 'lens' ? focusControls(ex) : `<div class="reading-caption"><span>${icon('lock')} ${state.vote ? 'Your decision, with the models revealed.' : 'Two answers. Equal space. No names.'}</span><span>${state.vote ? 'Decision saved' : 'Keep a passage with the bracket button.'}</span></div>`}<div class="mobile-answer-tabs" aria-label="Visible answer">${sides.map(side => control('side',`Answer ${side}`,`id="mobile-${side}" data-side="${side}" aria-pressed="${mobileSide === side}"`)).join('')}</div><div class="comparison-layout"><div class="answers">${sides.map(side => answer(style,ex,side,state,mini)).join('')}</div>${decisionPanel(style,ex,state,mini)}</div>`;
  }
  function notebook(style) {
    const rows = store.decisions[style];
    return `<div class="screen-heading"><div><p class="screen-context">Your personal record</p><h1>${style === 'fieldnotes' ? 'Good reasons, kept.' : 'Decision notebook'}</h1></div><a class="button" href="#${style}">Compare again ${icon('arrow')}</a></div><p class="view-intro">${rows.length} ${rows.length === 1 ? 'decision' : 'decisions'} · The answer, your choice, and the words behind it.</p>${rows.length ? `<div class="notebook-grid">${rows.map(row => { const ex = examples.find(e=>e.id===row.sampleId); return `<article class="notebook-entry"><header><span>${ex.category}</span><span>${row.vote === 'tie' ? 'Tie' : `${ex.answers[row.vote].model} preferred`}</span></header><h2>${ex.title}</h2><p>${ex.question}</p>${evidence(style,ex,row)}<footer><span>${row.reason || 'No reason added'}</span>${control('revisit', `Revisit ${icon('arrow')}`,`data-sample="${ex.id}"`, 'text-button')}</footer></article>`; }).join('')}</div>` : `<div class="empty-state">${icon('book')}<h2>A notebook starts with a choice.</h2><p>Compare two answers, keep something useful, and cast your first vote.</p><a class="button primary" href="#${style}">Make a comparison ${icon('arrow')}</a></div>`}`;
  }
  function scores(style) {
    const rows = store.decisions[style], scores = scoreDecisions(rows);
    return `<div class="screen-heading"><div><p class="screen-context">Your preferences</p><h1>A small, honest scorecard.</h1></div><a href="#${style}" class="button">Keep comparing ${icon('arrow')}</a></div><p class="view-intro">Based on your ${rows.length} sample ${rows.length === 1 ? 'decision' : 'decisions'} in ${directions[style].name}. These are fictional models, not a public ranking.</p><section class="score-sheet"><table><caption>Your sample model results</caption><thead><tr><th scope="col">Model</th><th scope="col">Wins</th><th scope="col">Ties</th><th scope="col">Losses</th></tr></thead><tbody>${Object.entries(scores).map(([model,score])=>`<tr><th scope="row"><span class="model-symbol">${model === 'Cedar' ? 'C' : 'B'}</span>${model}</th><td>${score.wins}</td><td>${score.ties}</td><td>${score.losses}</td></tr>`).join('')}</tbody></table><p>${rows.length ? 'Each saved decision counts once for each model.' : 'No votes yet. Real zeros until you make a choice.'}</p></section>`;
  }
  function product(style, page, mini = false) {
    return `<div class="product ${style} ${mini ? 'mini-product' : ''}" ${mini ? 'aria-hidden="true" inert' : ''}>${productHeader(style,page,mini)}<div class="canvas">${page === 'notebook' ? notebook(style) : page === 'scores' ? scores(style) : compare(style,mini)}<footer class="product-footer"><span>Prewritten examples · fictional models · saved in this browser</span>${!mini && page === 'compare' ? control('restart',`${icon('reset')} Try this example again`, '', 'text-button') : ''}</footer></div></div>`;
  }
  function gallery() {
    return `<main id="main" tabindex="-1" class="gallery"><div class="gallery-intro"><div><p>Margin / a design study</p><h1>A better answer deserves<br>a better way to choose.</h1></div><div class="gallery-brief"><p>Three directions. The same question.<br>Try the reading, the evidence, and the reveal.</p><span>Choose the experience you’d want to use.</span></div></div><div class="directions-grid">${Object.entries(directions).map(([key,d])=>`<article class="direction-card"><div class="preview-link"><div class="preview-frame">${product(key,'compare',true)}</div><a href="#${key}" aria-label="Explore ${d.name}"><span class="preview-open">Explore ${d.name} ${icon('arrow')}</span></a></div><div class="direction-description"><div class="direction-title"><span>${d.number}</span><h2>${d.name}</h2>${store.preferred === key ? `<span class="chosen-label">${icon('check')} Your pick</span>` : ''}</div><h3>${d.short}</h3><p>${d.description}</p><div class="direction-actions"><a href="#${key}" class="text-button">Try this direction ${icon('arrow')}</a>${control('choose',store.preferred === key ? 'Selected' : 'Choose',`id="choose-${key}" data-style="${key}" aria-label="Choose ${d.name}" aria-pressed="${store.preferred === key}"`,'gallery-choose')}</div></div></article>`).join('')}</div><section class="review-notes"><h2>Judge the moment after the vote.</h2><p>All three keep your chosen passage with the decision. The difference is how naturally they get you there.</p><div>${Object.values(directions).map(d=>`<article><h3>${d.name}</h3><p>${d.interaction}</p><span>${d.tradeoff}</span></article>`).join('')}</div></section><footer class="gallery-footer"><span>Static prototypes. Your design choice stays in this browser.</span><a href="../">Open the earlier design ${icon('arrow')}</a></footer></main>`;
  }
  function render(preserveFocus = false) {
    const focusedId = preserveFocus ? document.activeElement?.id : null;
    const {style,page} = route();
    document.body.dataset.direction = style || 'gallery';
    document.title = style ? `${directions[style].name} · Margin design review` : 'Margin · Three design directions';
    app.innerHTML = reviewBar(style) + (storageError ? `<p class="storage-warning" role="alert">${storageError}</p>` : '') + (style ? `<main id="main" tabindex="-1">${product(style,page)}</main><aside class="direction-note"><strong>${directions[style].name}</strong><p>${directions[style].strength}</p><a href="#">Compare all directions ${icon('arrow')}</a></aside>` : gallery());
    if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
  }
  app.addEventListener('toggle', event => {
    if (event.target.matches('.phone-prompt')) promptOpen = event.target.open;
  }, true);
  app.addEventListener('change', event => {
    if (event.target.id === 'sample-select') {
      sampleId = event.target.value; passage = 0; mobileSide = 'A'; promptOpen = false; render(true);
      announce(`Loaded ${sample().title}.`);
    }
  });
  app.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const {style} = route();
    const action = button.dataset.action;
    if (action === 'choose') {
      const selected = button.dataset.style || style;
      store.preferred = selected; save(); render(true);
      announce(`${directions[selected].name} is your selected direction. You can change your choice.`); return;
    }
    if (!style) return;
    if (action === 'sample' || action === 'revisit') {
      sampleId = button.dataset.sample; passage = 0; mobileSide = 'A';
      if (route().page !== 'compare') location.hash = style;
      else render();
      announce(`Opened ${sample().title}.`); return;
    }
    if (action === 'mode') { mode = button.dataset.mode; render(true); announce(mode === 'focus' ? 'Close reading. One passage from each answer.' : 'Full answers.'); return; }
    if (action === 'step') { passage += Number(button.dataset.step); render(true); announce(`Passage ${passage+1}.`); return; }
    if (action === 'side') { mobileSide = button.dataset.side; render(true); announce(`Showing answer ${mobileSide}.`); return; }
    if (action === 'restart') {
      // These are disposable prototype decisions; reset only the open sample in this direction.
      store.decisions[style] = store.decisions[style].filter(row=>row.sampleId!==sampleId);
      drafts.delete(`${style}/${sampleId}`); passage = 0; save();
      if (route().page !== 'compare') location.hash = style; else render();
      window.scrollTo({top:0,behavior:'instant'});
      document.querySelector('#main')?.focus({preventScroll:true});
      announce('This sample is ready to try again. Other decisions are kept.'); return;
    }
    if (decision(style)) return;
    const state = draft(style);
    if (action === 'mark') {
      const side = button.dataset.side, index = Number(button.dataset.index);
      if (state.marks[side] === index) delete state.marks[side]; else state.marks[side] = index;
      render(true); announce(Number.isInteger(state.marks[side]) ? `Passage ${index+1} from answer ${side} kept with your decision.` : 'Passage removed.');
    } else if (action === 'reason') {
      state.reason = state.reason === button.dataset.reason ? null : button.dataset.reason;
      render(true);
    } else if (action === 'vote') {
      store = recordVote(store,style,{sampleId,vote:button.dataset.vote,reason:state.reason,marks:{...state.marks}});
      save(); render();
      document.querySelector('.decision-receipt')?.focus({preventScroll:true});
      document.querySelector('.decision-receipt')?.scrollIntoView({behavior:'instant',block:'nearest'});
      announce('Decision saved. Answer A is '+sample().answers.A.model+'. Answer B is '+sample().answers.B.model+'.');
    }
  });
  document.querySelector('.skip').addEventListener('click',event=>{ event.preventDefault(); document.querySelector('#main').focus(); document.querySelector('#main').scrollIntoView(); });
  window.addEventListener('hashchange',()=>{ render(); window.scrollTo({top:0,behavior:'instant'}); document.querySelector('#main').focus({preventScroll:true}); });
  render();
}
