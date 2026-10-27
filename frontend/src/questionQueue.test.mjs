import test from 'node:test';
import assert from 'node:assert/strict';
import { QuestionQueue, restoreQueue, splitQuestions } from './questionQueue.ts';

const result = (status = 'pending', id = crypto.randomUUID()) => ({ id, status });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('five questions run in order, one pair at a time, without waiting for votes', async () => {
  const calls = [];
  const queue = new QuestionQueue(async (path, options) => {
    calls.push({ path, body: options && JSON.parse(options.body) });
    return options ? result() : result('ready', path.split('/').at(-1));
  });
  queue.start(['one', 'two', 'three', 'four', 'five']);
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
  queue.start(['first', 'second']);
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
  queue.start(['first', 'second']);
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
  queue.start(['first', 'second']); await queue.step(); await queue.step();
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
  queue.start(['bad', 'good']); await queue.step(); await queue.step(); await queue.step();
  assert.equal(queue.state.items[0].status, 'failed'); assert.ok(queue.state.error);
  assert.deepEqual(posts, ['bad']);
  queue.resume(); await queue.step(); assert.deepEqual(posts, ['bad', 'good']);
});

test('reload reconciles the pending pair but leaves unsent questions paused', async () => {
  const original = new QuestionQueue(async () => result());
  original.start(['first', 'second']); await original.step();
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
  queue.start(['first']); await queue.step(); await queue.step(); await queue.step();
  fail = false; queue.resume(); await queue.step();
  assert.deepEqual(methods, ['POST', 'GET', 'GET']);
});

test('list boundaries, multiline prompts, repeated prompts, and corrupt storage', () => {
  const queue = new QuestionQueue(async () => result());
  for (const prompts of [[], [' '], ['x'.repeat(12001)], Array(21).fill('x')]) assert.throws(() => queue.start(prompts));
  queue.start(['  code\n\n  example  ', 'same', 'same']);
  assert.equal(queue.state.items[0].prompt, 'code\n\n  example');
  assert.notEqual(queue.state.items[1].requestId, queue.state.items[2].requestId);
  assert.throws(() => queue.start(['replace']));
  assert.deepEqual(splitQuestions(' first\r\n\r\nsecond\n '), ['first', 'second']);
  for (const raw of ['invalid', '{}', '{"items":[{}]}', '{"items":null}']) assert.deepEqual(restoreQueue(raw).items, []);
});
