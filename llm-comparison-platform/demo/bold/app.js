import { examples, reasons, validateStore, recordVote, scoreDecisions } from '../directions/app.js';

// Keep the proven demo storage contract; each new direction has its own isolated bucket.
export const designs = {
  aperture: { bucket: 'lens', name: 'Aperture', number: '01', title: 'Two answers.<br>One <em>closer look.</em>', short: 'The screening room', description: 'Dark surrounds. Illuminated answers. A spotlight on the passage that changes your mind.', move: 'Bring a passage into the spotlight, then save the reason behind your choice.', tradeoff: 'The most cinematic. A dark surface makes long reading a matter of preference.' },
  frequency: { bucket: 'workbench', name: 'Frequency', number: '02', title: 'LESS NOISE.<br><em>MORE SIGNAL.</em>', short: 'The comparison studio', description: 'Electric cobalt. Bright reading surfaces. A crisp path from signal to decision.', move: 'Use the passage rail to isolate one part of both answers.', tradeoff: 'The most energetic. Strong color lives around the reading area.' },
  folio: { bucket: 'fieldnotes', name: 'Folio', number: '03', title: 'A matter of<br><em>judgment.</em>', short: 'The editorial edition', description: 'Oxblood and paper. A generous reading spread. Evidence worth putting on the record.', move: 'Clip a passage into the decision slip and keep it with your vote.', tradeoff: 'The most distinctive in print-like detail. More scrolling, more room to read.' }
};
export const STORAGE_KEY = 'margin-cinematic-directions-v1';
export const styleForBucket = bucket => Object.keys(designs).find(key => designs[key].bucket === bucket) || null;
export function parseRoute(hash) {
  const [style, page] = hash.replace(/^#/, '').split('/');
  return { style: Object.hasOwn(designs, style) ? style : null, page: ['notebook', 'scores'].includes(page) ? page : 'compare' };
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arrow = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
const mark = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3H4v18h4m8-18h4v18h-4M9 12h6"/></svg>';
const check = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>';
const logo = '<span class="logo-mark" aria-hidden="true">m<span>·</span></span><span>margin</span>';
const button = (action, text, attrs = '', cls = '') => `<button type="button" data-action="${action}" ${attrs} class="${cls}">${text}</button>`;

if (typeof document !== 'undefined' && document.querySelector('#bold-app')) initialize();
function initialize() {
  const app = document.querySelector('#bold-app');
  let store = validateStore(null), warning = '';
  try { store = validateStore(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { warning = 'Storage is unavailable. Your choices will last for this visit.'; }
  let sampleId = 'python', focus = false, passage = 1, mobileSide = 'A';
  const drafts = new Map();
  const current = () => examples.find(ex => ex.id === sampleId);
  const rows = style => store.decisions[designs[style].bucket];
  const saved = style => rows(style).find(row => row.sampleId === sampleId);
  const state = style => {
    const id = `${style}/${sampleId}`;
    if (!drafts.has(id)) drafts.set(id, { marks: {}, reason: null });
    return saved(style) || drafts.get(id);
  };
  const announce = text => { document.querySelector('#announcement').textContent = text; };
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); warning = ''; }
    catch { warning = 'Could not save to this browser. Your choices are kept for this visit.'; }
  }
  function reviewNav(style) {
    return `<header class="review-nav"><a href="#" class="review-home" aria-label="Design study">${mark}<span>Design study</span></a><nav aria-label="Design directions">${Object.entries(designs).map(([key,d]) => `<a href="#${key}" ${key === style ? 'aria-current="page"' : ''}><span>${d.number}</span> ${d.name}</a>`).join('')}</nav>${style ? button('choose', store.preferred === designs[style].bucket ? `${check} Selected` : 'Choose this direction', `id="choose-direction" data-style="${style}" aria-pressed="${store.preferred === designs[style].bucket}"`, 'choose') : `<span class="review-status">${store.preferred ? `${designs[styleForBucket(store.preferred)].name} selected` : 'Three cinematic directions'}</span>`}</header>`;
  }
  function productNav(style, page, mini) {
    return `<header class="product-nav"><a href="#${style}" class="wordmark" ${mini ? 'tabindex="-1"' : ''}>${logo}</a><nav aria-label="Product">${[['compare','Compare'],['notebook','Notebook'],['scores','Scores']].map(([key,label])=>`<a href="#${style}${key === 'compare' ? '' : '/'+key}" ${page === key ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav><span class="session">Anonymous by design <span aria-hidden="true">↗</span></span></header>`;
  }
  function prompt(ex, mini) {
    return `<section class="prompt"><div class="prompt-top"><span>The question</span>${mini ? '<span>Code review</span>' : `<label><span class="sr-only">Sample comparison</span><select id="sample-select">${examples.map(e=>`<option value="${e.id}" ${e.id === sampleId ? 'selected' : ''}>${e.category}</option>`).join('')}</select></label>`}</div><p>${esc(ex.question)}</p>${ex.snippet ? `<details><summary>View the original code</summary><pre><code>${esc(ex.snippet)}</code></pre></details>` : ''}</section>`;
  }
  function intro(style, ex, mini) {
    const d = designs[style];
    return `<div class="intro"><div class="intro-type"><div class="edition"><span>${style === 'folio' ? 'The comparison edition' : style === 'frequency' ? 'Independent thinking, together.' : 'A space for considered choices.'}</span><span>${d.number} / ${d.name}</span></div><h1>${d.title}</h1></div>${prompt(ex,mini)}</div>`;
  }
  function toolbar(style, ex, mini) {
    const labels = style === 'aperture' ? ['Full picture','Spotlight'] : style === 'frequency' ? ['All passages','Isolate a passage'] : ['The full spread','A closer reading'];
    return `<div class="reading-toolbar"><div class="reading-mode" aria-label="Reading mode">${button('mode',labels[0],`${mini ? '' : 'id="mode-full"'} data-focus="false" aria-pressed="${!focus || mini}"`)}${button('mode',labels[1],`${mini ? '' : 'id="mode-focus"'} data-focus="true" aria-pressed="${focus && !mini}"`)}</div>${focus && !mini ? `<div class="passage-rail" aria-label="Passage to compare">${ex.answers.A.paragraphs.map((p,i)=>button('passage',`${i+1}`,`id="passage-${i}" data-index="${i}" aria-label="Compare passage ${i+1}" aria-pressed="${passage===i}"`)).join('')}</div>` : `<span class="reading-note">${mark} Keep the line that makes the difference.</span>`}<span class="blind-note">${!mini && saved(style) ? 'A & B · models revealed after your vote' : 'A & B · identities hidden until your vote'}</span></div>`;
  }
  function answer(style, ex, side, s, mini) {
    const complete = !!s.vote;
    return `<article class="answer answer-${side} ${side === mobileSide ? 'mobile-active' : ''}"><header class="answer-top"><span class="answer-letter" aria-hidden="true">${side}</span><div><h2>${complete ? ex.answers[side].model : `Answer ${side}`}</h2><span>${complete ? 'Fictional sample model' : 'An independent perspective'}</span></div><span class="identity-status">${complete ? (s.vote === side ? `${check} Your choice` : s.vote === 'tie' ? 'Tie' : 'Revealed') : 'Anonymous'}</span></header><div class="answer-body">${ex.answers[side].paragraphs.map((p,i) => {
      if (focus && !mini && passage !== i) return '';
      const selected = s.marks[side] === i;
      return `<section class="passage ${selected ? 'marked' : ''}"><div class="passage-top"><span class="passage-index">${String(i+1).padStart(2,'0')}</span><h3>${esc(p.title)}</h3>${complete ? (selected ? `<span class="kept-label">${check} Kept</span>` : '') : button('mark',`${selected ? check : mark}<span>${selected ? 'Kept' : style === 'folio' ? 'Clip' : 'Keep'}</span>`, `${mini ? '' : `id="mark-${side}-${i}"`} data-side="${side}" data-index="${i}" aria-label="${selected ? 'Remove' : 'Keep'} passage ${i+1} from answer ${side}" aria-pressed="${selected}"`, 'mark-button')}</div><p>${esc(p.text)}</p>${p.code ? `<pre><code>${esc(p.code)}</code></pre>` : ''}</section>`;
    }).join('')}</div><footer class="answer-bottom"><span>${complete ? 'Decision saved in your notebook.' : `${ex.answers[side].paragraphs.length} ${ex.answers[side].paragraphs.length === 1 ? 'passage' : 'passages'} · Read at your own pace.`}</span><span aria-hidden="true">${style === 'folio' ? 'm.' : '↗'}</span></footer></article>`;
  }
  function evidence(ex, s) {
    const marked = ['A','B'].filter(side=>Number.isInteger(s.marks[side]));
    return `<div class="evidence"><header>${mark}<h3>Your evidence</h3><span>${marked.length ? `${marked.length} kept` : 'Optional'}</span></header>${marked.length ? marked.map(side => {
      const p = ex.answers[side].paragraphs[s.marks[side]];
      return `<blockquote><span>Answer ${side} · passage ${s.marks[side]+1}</span><p>${esc(p.text)}</p>${p.code ? `<pre><code>${esc(p.code)}</code></pre>` : ''}</blockquote>`;
    }).join('') : `<p class="empty-evidence">${s.vote ? 'No passage kept with this decision.' : 'Some words change your mind.<br>Keep them with your decision.'}</p>`}</div>`;
  }
  function decision(style, ex, s, mini) {
    return `<section class="decision ${s.vote ? 'complete' : ''}" aria-label="Your decision"><div class="decision-lead"><span class="decision-symbol" aria-hidden="true">${style === 'folio' ? '§' : mark}</span><p>${style === 'aperture' ? 'A preference.<br><em>With a point of view.</em>' : style === 'frequency' ? 'KEEP THE SIGNAL.' : 'Keep the why.'}</p><span>Your reasoning belongs with the result.</span></div>${evidence(ex,s)}<div class="decision-action">${s.vote ? `<div class="receipt" tabindex="-1"><span class="receipt-kicker">${check} Decision saved</span><h2>${s.vote === 'tie' ? 'Equally convincing.' : `You chose<br><em>${ex.answers[s.vote].model}.</em>`}</h2><p>${s.reason ? esc(s.reason)+'. ' : ''}The models are revealed. Your decision is in the notebook.</p><a href="#${style}/notebook" class="primary">Open notebook ${arrow}</a></div>` : `<fieldset><legend>What mattered? <span>Optional</span></legend><div class="reasons">${reasons.map((r,i)=>button('reason',r,`${mini ? '' : `id="reason-${i}"`} data-reason="${r}" aria-pressed="${s.reason === r}"`)).join('')}</div></fieldset><h3>Which answer would you use?</h3><div class="votes">${button('vote','Answer A', 'data-vote="A"')}${button('vote','It’s a tie', 'data-vote="tie"')}${button('vote','Answer B', 'data-vote="B"')}</div><span class="vote-note">Your vote reveals the two sample models.</span>`}</div></section>`;
  }
  function compare(style, mini) {
    const ex = mini ? examples[0] : current(), s = mini ? {marks:{},reason:null} : state(style);
    return `${intro(style,ex,mini)}${toolbar(style,ex,mini)}<div class="mobile-tabs" aria-label="Visible answer">${['A','B'].map(side=>button('side',`Answer ${side}`,`${mini ? '' : `id="mobile-${side}"`} data-side="${side}" aria-pressed="${mobileSide===side}"`)).join('')}</div><div class="answers">${['A','B'].map(side=>answer(style,ex,side,s,mini)).join('')}<span class="versus" aria-hidden="true">&</span></div>${decision(style,ex,s,mini)}`;
  }
  function notebook(style) {
    const decisions = rows(style);
    return `<div class="view-heading"><span>Your personal collection</span><h1>The thinking<br><em>behind the choice.</em></h1><p>${decisions.length} ${decisions.length===1?'decision':'decisions'} kept in this direction.</p></div>${decisions.length ? `<div class="notebook-grid">${decisions.map(row=> {const ex=examples.find(e=>e.id===row.sampleId);return `<article class="notebook-entry"><header><span>${ex.category}</span><span>${row.vote==='tie'?'Tie':ex.answers[row.vote].model+' preferred'}</span></header><h2>${ex.title}</h2><p>${esc(ex.question)}</p>${evidence(ex,row)}<footer><span>${row.reason || 'No reason added'}</span>${button('revisit',`Revisit ${arrow}`,`data-sample="${ex.id}"`)}</footer></article>`;}).join('')}</div>` : `<div class="empty-state"><h2>Start with a point of view.</h2><p>A vote keeps the answer and any evidence you choose.</p><a class="primary" href="#${style}">Make your first comparison ${arrow}</a></div>`}`;
  }
  function scores(style) {
    const decisions = rows(style);
    return `<div class="view-heading"><span>Your preferences, counted</span><h1>A small,<br><em>honest scorecard.</em></h1><p>${decisions.length} sample ${decisions.length===1?'decision':'decisions'}. Fictional models. Your judgments.</p></div><div class="score-table"><table><caption>Results in ${designs[style].name}</caption><thead><tr><th scope="col">Model</th><th scope="col">Wins</th><th scope="col">Ties</th><th scope="col">Losses</th></tr></thead><tbody>${Object.entries(scoreDecisions(decisions)).map(([model,total])=>`<tr><th scope="row">${model}</th><td>${total.wins}</td><td>${total.ties}</td><td>${total.losses}</td></tr>`).join('')}</tbody></table><p>Every decision counts once. This is a personal record, not a public ranking.</p></div>`;
  }
  function product(style, page='compare', mini=false) {
    return `<div class="product ${style} ${mini ? 'mini-product' : ''}" data-ui ${mini?'aria-hidden="true" inert':''}>${productNav(style,page,mini)}<div class="product-content">${page==='notebook'?notebook(style):page==='scores'?scores(style):compare(style,mini)}<footer class="product-footer"><span>Static examples · fictional models · saved in this browser</span>${!mini&&page==='compare'?button('reset','Reset this example') : ''}</footer></div></div>`;
  }
  function gallery() {
    return `<main id="main" tabindex="-1" class="gallery"><div class="gallery-intro"><span>Margin / three new perspectives</span><h1>See the<br><em>difference.</em></h1><div><p>Good judgment deserves<br>a memorable setting.</p><span>Same answers. Three very different experiences.</span></div></div>${Object.entries(designs).map(([key,d])=>`<section class="chapter ${key}"><div class="chapter-copy"><span class="chapter-number">${d.number} / ${d.short}</span><h2>${d.name}<span aria-hidden="true">.</span></h2><p>${d.description}</p><a href="#${key}" class="chapter-open">Enter ${d.name} ${arrow}</a><div class="chapter-detail"><h3>The moment to try</h3><p>${d.move}</p><span>${d.tradeoff}</span></div>${button('choose', store.preferred===d.bucket?`${check} Your chosen direction`:'Choose '+d.name,`id="choose-${key}" data-style="${key}" aria-pressed="${store.preferred===d.bucket}"`,'chapter-choice')}</div><div class="chapter-preview"><div class="preview-window">${product(key,'compare',true)}</div><a class="preview-link" href="#${key}" aria-label="Explore ${d.name} demo"><span>Explore the full demo ${arrow}</span></a></div></section>`).join('')}<footer class="gallery-footer"><div><h2>Which feels like <em>Margin?</em></h2><p>Try a passage, cast a vote, and see what stays with you.</p></div><a href="../directions/">Compare with the earlier round ${arrow}</a></footer></main>`;
  }
  function render({ preserve=false, enter=false }={}) {
    const id=preserve?document.activeElement?.id:null;
    const {style,page}=parseRoute(location.hash);
    document.body.dataset.design=style||'gallery';
    document.title=style?`${designs[style].name} · Margin`:'Margin · See the difference';
    app.innerHTML=reviewNav(style)+(warning?`<p class="storage-warning" role="alert">${warning}</p>`:'')+(style?`<main id="main" tabindex="-1" class="${enter?'enter':''}">${product(style,page)}</main><aside class="design-note"><strong>${designs[style].name}</strong><span>${designs[style].move}</span><a href="#">All three directions ${arrow}</a></aside>`:gallery());
    if(id) document.getElementById(id)?.focus({preventScroll:true});
  }
  app.addEventListener('change',event=> {
    if(event.target.id!=='sample-select')return;
    sampleId=event.target.value; passage=Math.min(1,current().answers.A.paragraphs.length-1);mobileSide='A';render({preserve:true});announce('Loaded '+current().title);
  });
  app.addEventListener('click',event=>{
    const b=event.target.closest('button[data-action]');if(!b)return;
    const {style}=parseRoute(location.hash), action=b.dataset.action;
    if(action==='choose') {
      const selected=b.dataset.style;store.preferred=designs[selected].bucket;persist();render({preserve:true});announce(designs[selected].name+' selected. You can change this choice.');return;
    }
    if(!style)return;
    if(action==='mode'){focus=b.dataset.focus==='true';render({preserve:true});announce(focus?'Showing passage '+(passage+1)+' from both answers.':'Showing full answers.');return;}
    if(action==='passage'){passage=Number(b.dataset.index);render({preserve:true});announce('Showing passage '+(passage+1));return;}
    if(action==='side'){mobileSide=b.dataset.side;render({preserve:true});announce('Showing answer '+mobileSide);return;}
    if(action==='revisit'){sampleId=b.dataset.sample;passage=Math.min(1,current().answers.A.paragraphs.length-1);focus=false;location.hash=style;return;}
    if(action==='reset') {
      store.decisions[designs[style].bucket]=rows(style).filter(row=>row.sampleId!==sampleId);drafts.delete(`${style}/${sampleId}`);persist();render();document.querySelector('#main').focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});announce('This sample has been reset in '+designs[style].name);return;
    }
    if(saved(style))return;
    const s=state(style);
    if(action==='mark') {const side=b.dataset.side, index=Number(b.dataset.index);if(s.marks[side]===index)delete s.marks[side];else s.marks[side]=index;render({preserve:true});announce(Number.isInteger(s.marks[side])?'Passage kept with your decision.':'Passage removed.');}
    if(action==='reason'){s.reason=s.reason===b.dataset.reason?null:b.dataset.reason;render({preserve:true});}
    if(action==='vote') {
      store=recordVote(store,designs[style].bucket,{sampleId,vote:b.dataset.vote,marks:{...s.marks},reason:s.reason});persist();render();
      const receipt=document.querySelector('.receipt');receipt.classList.add('reveal');receipt.focus({preventScroll:true});receipt.scrollIntoView({behavior:'instant',block:'center'});
      announce(`Decision saved. Answer A is ${current().answers.A.model}. Answer B is ${current().answers.B.model}.`);
    }
  });
  window.addEventListener('hashchange',()=>{render({enter:true});window.scrollTo({top:0,behavior:'instant'});document.querySelector('#main').focus({preventScroll:true});});
  document.querySelector('.skip').addEventListener('click',event=>{event.preventDefault();document.querySelector('#main').focus();document.querySelector('#main').scrollIntoView();});
  render({enter:true});
}
