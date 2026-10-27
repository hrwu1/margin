import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStore, recordVote, scoreDecisions, excerpt, examples } from './app.js';

test('untrusted saved choices retain only known directions, samples and valid evidence', () => {
  const store = validateStore({ preferred: '__proto__', decisions: { lens: [
    {sampleId:'python',vote:'A',reason:'Correctness',marks:{A:2,B:99}},
    {sampleId:'missing',vote:'B'}, {sampleId:'indexes',vote:'unknown'},
    {sampleId:'message',vote:'tie',reason:'<script>',marks:{A:-1,B:'0'}}
  ]}});
  assert.equal(store.preferred,null);
  assert.deepEqual(store.decisions.lens,[
    {sampleId:'python',vote:'A',reason:'Correctness',marks:{A:2}},
    {sampleId:'message',vote:'tie',reason:null,marks:{}}
  ]);
  assert.deepEqual(validateStore(null).decisions.workbench,[]);
});

test('a revealed vote stays immutable and each direction has an independent notebook', () => {
  let store = recordVote(null,'fieldnotes',{sampleId:'python',vote:'A',marks:{A:1},reason:'Correctness'});
  const first = structuredClone(store);
  store = recordVote(store,'fieldnotes',{sampleId:'python',vote:'B',marks:{B:0}});
  assert.deepEqual(store,first);
  store = recordVote(store,'lens',{sampleId:'python',vote:'B',marks:{B:0}});
  assert.equal(store.decisions.fieldnotes[0].vote,'A');
  assert.equal(store.decisions.lens[0].vote,'B');
  assert.equal(first.decisions.lens.length,0);
});

test('scores follow model identity when A and B switch, count ties, and start at zero', () => {
  assert.deepEqual(scoreDecisions([]).Cedar,{wins:0,ties:0,losses:0});
  const scores = scoreDecisions([
    {sampleId:'python',vote:'A'},
    {sampleId:'indexes',vote:'A'},
    {sampleId:'message',vote:'tie'}
  ]);
  assert.deepEqual(scores.Cedar,{wins:1,ties:1,losses:1});
  assert.deepEqual(scores.Birch,{wins:1,ties:1,losses:1});
});

test('decision records snapshot evidence and preserve the selected direction across serialization', () => {
  const marks = {A:1};
  const store = recordVote({preferred:'workbench'},'workbench',{sampleId:'python',vote:'tie',marks});
  marks.A = 2;
  assert.equal(store.decisions.workbench[0].marks.A,1);
  assert.deepEqual(validateStore(JSON.parse(JSON.stringify(store))),store);
  assert.match(excerpt(examples[0],'A',1),/if items is None:/);
});
