import test from 'node:test';
import assert from 'node:assert/strict';
import { designs, styleForBucket, parseRoute, STORAGE_KEY } from './app.js';
import { validateStore, recordVote, scoreDecisions, STORAGE_KEY as earlierKey } from '../directions/app.js';

test('new directions use isolated, reversible storage buckets', () => {
  assert.notEqual(STORAGE_KEY, earlierKey);
  assert.equal(new Set(Object.values(designs).map(d=>d.bucket)).size, 3);
  for (const [style, design] of Object.entries(designs)) assert.equal(styleForBucket(design.bucket), style);
  assert.equal(styleForBucket('untrusted'), null);
});
test('only supported routes open a design and view', () => {
  assert.deepEqual(parseRoute('#aperture/notebook'), {style:'aperture',page:'notebook'});
  assert.deepEqual(parseRoute('#frequency/scores'), {style:'frequency',page:'scores'});
  assert.deepEqual(parseRoute('#folio/unknown'), {style:'folio',page:'compare'});
  assert.deepEqual(parseRoute('#__proto__/scores'), {style:null,page:'scores'});
});
test('new directions preserve evidence and vote independently through reload', () => {
  let store = validateStore(null);
  for (const design of Object.values(designs)) {
    store = recordVote(store,design.bucket,{sampleId:'python',vote:'A',marks:{A:1},reason:'Correctness'});
    store = recordVote(store,design.bucket,{sampleId:'python',vote:'B',marks:{},reason:null});
  }
  store.preferred=designs.aperture.bucket;
  const restored=validateStore(JSON.parse(JSON.stringify(store)));
  assert.equal(styleForBucket(restored.preferred),'aperture');
  for (const design of Object.values(designs)) {
    const rows=restored.decisions[design.bucket];
    assert.equal(rows.length,1); assert.equal(rows[0].vote,'A'); assert.equal(rows[0].marks.A,1);
    assert.deepEqual(scoreDecisions(rows).Cedar,{wins:1,ties:0,losses:0});
  }
});
