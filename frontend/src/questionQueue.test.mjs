import test from 'node:test';
import assert from 'node:assert/strict';
import { QuestionQueue, restoreQueue, splitQuestions } from './questionQueue.ts';
import { latestComparison } from './api.ts';

const models = ['gpt-4o-mini', 'gpt-6-luna'];
const result = (status = 'pending', id = crypto.randomUUID()) => ({ id, status });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('late pending snapshots cannot replace completed answers, votes, or notes', () => {
  const ready = { ...result('ready'), vote: { choice: 'A' }, annotations: { note: 'Keep this' } };
  assert.equal(latestComparison(ready, { id: ready.id, status: 'pending' }), ready);
  const failed = { ...ready, status: 'failed' };
  assert.equal(latestComparison(failed, { id: ready.id, status: 'pending' }), failed);
  const next = result();
  assert.equal(latestComparison(ready, next), next);
  assert.equal(latestComparison(null, next), next);
});

test('five questions run in order, one pair at a time, without waiting for votes', async () => {
  const calls = [];
  const queue = new QuestionQueue(async (path, options) => {
    calls.push({ path, body: options && JSON.parse(options.body) });
    return options ? result() : result('ready', path.split('/').at(-1));
  });
  queue.start(['one', 'two', 'three', 'four', 'five'], models);
  for (let i = 0; i < 5; i++) {
    await queue.step();
    assert.equal(calls.filter(call => call.body).length, i + 1);
    assert.equal(queue.state.items[i].status, 'pending');
    await queue.step();
    assert.equal(queue.state.items[i].status, 'ready');
  }
  await queue.step();
  assert.equal(calls.length, 10);
  assert.deepEqual(calls.filter(call => call.body).map(call => call.body.prompt), ['one', 'two', 'three', 'four', 'five']);
  assert.equal(new Set(calls.filter(call => call.body).map(call => call.body.request_id)).size, 5);
});

test('overlapping ticks and pause during creation cannot start another pair', async () => {
  const pending = deferred(); let posts = 0;
  const queue = new QuestionQueue(async (path, options) => options ? (++posts, pending.promise) : result('ready'));
  queue.start(['first', 'second'], models);
  const first = queue.step();
  await queue.step(); queue.pause();
  assert.equal(posts, 1);
  pending.resolve(result()); await first;
  await queue.step(); await queue.step();
  assert.equal(queue.state.items[0].status, 'ready');
  assert.equal(queue.state.items[1].status, 'queued');
  assert.equal(posts, 1);
  queue.resume(); await queue.step(); assert.equal(posts, 2);
});

test('one finished answer still leaves the pair pending; next waits for both', async () => {
  let polls = 0, posts = 0;
  const queue = new QuestionQueue(async (_, options) => options ? (++posts, result()) : result(++polls === 3 ? 'ready' : 'pending'));
  queue.start(['first', 'second'], models);
  for (let i = 0; i < 4; i++) await queue.step();
  assert.equal(posts, 1);
  await queue.step(); assert.equal(posts, 2);
});

test('unknown POST outcome pauses and reconnects using the same request ID', async () => {
  const ids = [];
  const queue = new QuestionQueue(async (_, options) => {
    ids.push(JSON.parse(options.body).request_id);
    if (ids.length === 1) throw new Error('Disconnected');
    return result();
  });
  queue.start(['first', 'second'], models); await queue.step(); await queue.step();
  assert.equal(ids.length, 1); assert.equal(queue.state.paused, true);
  assert.equal(queue.clear(), false);
  const restored = new QuestionQueue(queueRequest, restoreQueue(JSON.stringify(queue.state)));
  async function queueRequest(_, options) { ids.push(JSON.parse(options.body).request_id); return result(); }
  await restored.step(); assert.equal(ids.length, 1);
  restored.resume(); await restored.step(); assert.equal(ids[0], ids[1]);
});

test('failed pair pauses, retains the result, and continues without retrying it', async () => {
  const posts = [];
  const queue = new QuestionQueue(async (_, options) => {
    if (options) { posts.push(JSON.parse(options.body).prompt); return result(); }
    return result('failed');
  });
  queue.start(['bad', 'good'], models); await queue.step(); await queue.step(); await queue.step();
  assert.equal(queue.state.items[0].status, 'failed'); assert.ok(queue.state.error);
  assert.deepEqual(posts, ['bad']);
  queue.resume(); await queue.step(); assert.deepEqual(posts, ['bad', 'good']);
});

test('reload reconciles the pending pair but leaves unsent questions paused', async () => {
  const original = new QuestionQueue(async () => result());
  original.start(['first', 'second'], models); await original.step();
  const paths = [];
  const restored = new QuestionQueue(async (path, options) => { assert.equal(options, undefined); paths.push(path); return result('ready'); }, restoreQueue(JSON.stringify(original.state)));
  await restored.step(); await restored.step();
  assert.equal(paths.length, 1); assert.equal(restored.state.items[1].status, 'queued');
  assert.equal(restored.state.paused, true);
  assert.equal(restored.clear(), true);
});

test('polling failure resumes by GET, never by a new paid POST', async () => {
  let fail = true; const methods = [];
  const queue = new QuestionQueue(async (_, options) => {
    methods.push(options?.method || 'GET');
    if (!options && fail) throw new Error('Offline');
    return result(options ? 'pending' : 'ready');
  });
  queue.start(['first'], models); await queue.step(); await queue.step(); await queue.step();
  fail = false; queue.resume(); await queue.step();
  assert.deepEqual(methods, ['POST', 'GET', 'GET']);
});

test('list boundaries, multiline prompts, repeated prompts, and corrupt storage', () => {
  const queue = new QuestionQueue(async () => result());
  for (const prompts of [[], [' '], ['x'.repeat(12001)], Array(21).fill('x')]) assert.throws(() => queue.start(prompts, models));
  queue.start(['  code\n\n  example  ', 'same', 'same'], models);
  assert.equal(queue.state.items[0].prompt, 'code\n\n  example');
  assert.notEqual(queue.state.items[1].requestId, queue.state.items[2].requestId);
  assert.throws(() => queue.start(['replace'], models));
  assert.deepEqual(splitQuestions(' first\r\n\r\nsecond\n '), ['first', 'second']);
  for (const raw of ['invalid', '{}', '{"items":[{}]}', '{"items":null}']) assert.deepEqual(restoreQueue(raw).items, []);
});


test('selected models are frozen for every question and survive reload and retry', async () => {
  const selected = [...models];
  const bodies = [];
  const queue = new QuestionQueue(async (_, options) => {
    bodies.push(JSON.parse(options.body));
    throw new Error('Unknown outcome');
  });
  queue.start(['one', 'two'], selected);
  selected[0] = 'changed-after-start';
  await queue.step();
  const restored = new QuestionQueue(async (_, options) => {
    bodies.push(JSON.parse(options.body));
    return result('ready');
  }, restoreQueue(JSON.stringify(queue.state)));
  restored.resume(); await restored.step(); await restored.step();
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every(body => JSON.stringify(body.models) === JSON.stringify(models)));
  assert.equal(bodies[0].request_id, bodies[1].request_id);
  assert.notEqual(bodies[1].request_id, bodies[2].request_id);
});

test('invalid stored pairs are rejected and pre-selector queues keep their original requests', async () => {
  const queue = new QuestionQueue(async () => result());
  for (const pair of [[], ['one'], ['one', 'one'], ['one', 42]]) {
    assert.throws(() => queue.start(['question'], pair), /two distinct models/);
  }
  queue.start(['old question'], models);
  const old = structuredClone(queue.state);
  delete old.items[0].models;
  const restored = new QuestionQueue(async (_, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.request_id, old.items[0].requestId);
    assert.equal('models' in body, false); // The backend retains the original fixed-pair contract.
    return result('ready');
  }, restoreQueue(JSON.stringify(old)));
  assert.equal(restored.state.items.length, 1);
  restored.resume(); await restored.step();
  for (const pair of [[], ['one'], ['one', 'one'], ['one', 42]]) {
    old.items[0].models = pair;
    assert.deepEqual(restoreQueue(JSON.stringify(old)).items, []);
  }
});
