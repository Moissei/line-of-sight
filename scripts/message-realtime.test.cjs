const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Run against real helper code without loading native modules or real credentials.
function loadHelper(path, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const box = { exports: {} };
  new Function('require', 'module', 'exports', output)(
    (id) => dependencies[id] ?? require(id), box, box.exports,
  );
  return box.exports;
}
const { watchMessageChanges } = loadHelper('src/lib/message-realtime.ts');
const { mergeMessages } = loadHelper('src/lib/messages.ts');
const pause = () => new Promise((resolve) => setTimeout(resolve, 300));
function fixture(reload) {
  let receive, status;
  const sent = [];
  let removed = 0;
  const channel = {
    on(type, filter, handler) {
      assert.equal(type, 'broadcast');
      assert.equal(filter.event, 'messages_changed');
      receive = handler; return this;
    },
    subscribe(handler) { status = handler; return this; },
    async send(event) { sent.push(event); throw new Error('simulated transport failure'); },
  };
  const client = {
    auth: { async getSession() { return { data: { session: {} }, error: null }; } },
    realtime: { async setAuth() {} },
    channel(topic, options) {
      assert.equal(topic, 'connection:test');
      assert.equal(options.config.private, true);
      return channel;
    },
    async removeChannel(value) { assert.equal(value, channel); removed++; },
  };
  const watcher = watchMessageChanges(client, 'test', reload);
  return { watcher, ready: () => new Promise((resolve) => setImmediate(resolve)), receive: () => receive({ body: 'untrusted' }),
    status: (value) => status(value), sent, removed: () => removed };
}

test('private subscribe, duplicate hints, and reconnect refresh RPC data only', async () => {
  let calls = 0;
  let rows = [];
  const f = fixture(async () => {
    calls++;
    rows = mergeMessages(rows, [{ message_id: 'one', body: 'RPC data',
      sender_is_me: false, created_at: '2026-09-10T00:00:00Z' }]);
  });
  await f.ready();
  f.status('SUBSCRIBED'); f.receive(); f.receive();
  await pause();
  assert.equal(calls, 1);
  f.status('CHANNEL_ERROR'); f.status('SUBSCRIBED');
  await pause();
  assert.equal(calls, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body, 'RPC data');
  f.watcher.dispose();
});

test('failed broadcast does not reject successful durable send', async () => {
  let durableWrites = 0;
  const { sendMessage } = loadHelper('src/lib/messages.ts', {
    './supabase': { supabase: { async rpc(name) {
      assert.equal(name, 'send_message'); durableWrites++;
      return { data: 'confirmed', error: null };
    } } },
  });
  const f = fixture(async () => {});
  await f.ready();
  f.status('SUBSCRIBED');
  await sendMessage('test', 'Hello');
  await assert.doesNotReject(f.watcher.notify());
  assert.equal(durableWrites, 1);
  assert.deepEqual(f.sent, [{ type: 'broadcast', event: 'messages_changed', payload: {} }]);
  f.watcher.dispose();
});

test('denied subscription never broadcasts; cleanup cancels scheduled reload', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; });
  await f.ready();
  f.status('CHANNEL_ERROR');
  await f.watcher.notify();
  assert.equal(f.sent.length, 0);
  f.status('SUBSCRIBED');
  f.watcher.dispose(); f.watcher.dispose(); f.receive();
  await pause();
  assert.equal(calls, 0);
  assert.equal(f.removed(), 1);
});

test('cleanup aborts in-flight refresh and suppresses queued events', async () => {
  let signal;
  let finish;
  const f = fixture(async (value) => {
    signal = value;
    await new Promise((resolve) => { finish = resolve; });
  });
  await f.ready();
  f.status('SUBSCRIBED');
  await pause();
  f.receive();
  f.watcher.dispose();
  assert.equal(signal.aborted, true);
  finish();
});

test('events during reload queue one follow-up without overlapping calls', async () => {
  let calls = 0;
  let finish;
  const f = fixture(async () => {
    calls++;
    if (calls === 1) await new Promise((resolve) => { finish = resolve; });
  });
  await f.ready();
  f.status('SUBSCRIBED');
  await pause();
  f.receive(); f.receive();
  assert.equal(calls, 1);
  finish();
  await pause();
  assert.equal(calls, 2);
  f.watcher.dispose();
});

test('leaving before auth completes cannot create a late subscription', async () => {
  let channels = 0;
  let finish;
  const watcher = watchMessageChanges({
    auth: { getSession: () => new Promise((resolve) => { finish = resolve; }) },
    realtime: { async setAuth() {} },
    channel() { channels++; },
  }, 'test', async () => {});
  watcher.dispose();
  finish({ data: { session: {} }, error: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(channels, 0);
});

test('repeated focus cycles remove every subscription', async () => {
  for (let i = 0; i < 4; i++) {
    const f = fixture(async () => {});
    await f.ready();
    f.status('SUBSCRIBED');
    f.watcher.dispose();
    assert.equal(f.removed(), 1);
    await f.watcher.notify();
    assert.equal(f.sent.length, 0);
  }
});

test('manual newest refresh and earlier pagination preserve RPC cursors and dedupe', async () => {
  const calls = [];
  const newer = { message_id: 'b', body: 'new', sender_is_me: true, created_at: '2026-09-10T12:00:00Z' };
  const older = { ...newer, message_id: 'a', body: 'old' };
  const { loadMessages, getOlderMessageCursor } = loadHelper('src/lib/messages.ts', {
    './supabase': { supabase: { rpc(name, args) {
      assert.equal(name, 'list_messages');
      calls.push(args);
      return { async abortSignal() {
        return { data: args.before_message_id ? [older] : [newer], error: null };
      } };
    } } },
  });
  const signal = new AbortController().signal;
  const first = await loadMessages('test', null, signal);
  const cursor = getOlderMessageCursor(first.messages);
  const earlier = await loadMessages('test', cursor, signal);
  const refreshed = await loadMessages('test', null, signal);
  assert.equal(calls[1].before_message_id, 'b');
  assert.equal(calls[1].before_created_at, newer.created_at);
  assert.equal(calls[2].before_message_id, null);
  assert.deepEqual(mergeMessages(first.messages, earlier.messages, refreshed.messages).map((m) => m.message_id), ['a', 'b']);
  assert.equal(earlier.hasEarlier, false);
});
