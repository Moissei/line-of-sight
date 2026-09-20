/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Synthetic byte signatures and mocked codecs test routing/failure isolation only.
// Actual EXIF removal, orientation and transparency require native/browser verification.
const root = path.resolve(__dirname, '..');
function load(file, dependencies, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', ...Object.keys(globals), code)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports, ...Object.values(globals));
  return exports;
}

function fixture(options = {}) {
  const events = [];
  const mime = options.mime ?? 'image/jpeg';
  const jpeg = ['image/jpeg', 'image/heic', 'image/heif'].includes(mime);
  const bytes = options.bytes ?? Uint8Array.from(jpeg ? [255, 216, 255, 42] : [137, 80, 78, 71, 13, 10, 26, 10, 42]).buffer;
  const original = Uint8Array.from([1, 2, 3, 4]).buffer;
  const web = options.platform === 'web';
  const outputUri = options.sameUri ? 'selected' : web ? 'blob:output' : 'sanitized';
  function fail(phase) { if (options.fail === phase) throw new Error('sensitive local path and metadata'); }
  class File {
    constructor(uri) { this.uri = uri; }
    get size() { return this.uri === 'selected' ? 4 : options.size ?? bytes.byteLength; }
    get exists() { return true; }
    async arrayBuffer() {
      assert.notEqual(this.uri, 'selected', 'Original bytes must never be read for upload');
      events.push('read'); fail('read'); return bytes;
    }
    delete() { assert.notEqual(this.uri, 'selected'); events.push('delete'); fail('delete'); }
  }
  const image = {
    uri: 'blob:render',
    release() { events.push('image release'); },
    async saveAsync(config) { events.push(['encode', config]); fail('encode'); return { uri: outputUri }; },
  };
  const context = {
    rotate(angle) { assert.equal(angle, 0); events.push('redraw'); },
    async renderAsync() { events.push('render'); fail('render'); return image; },
    release() { events.push('context release'); },
  };
  const helper = load('src/lib/profile-photo.ts', {
    'react-native': { Platform: { OS: options.platform ?? 'android' } },
    'expo-file-system': { File },
    'expo-image-manipulator': {
      ImageManipulator: { manipulate(uri) { assert.equal(uri, web ? 'blob:input' : 'selected'); fail('decode'); return context; } },
      SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
    },
  }, {
    URL: { createObjectURL() { return 'blob:input'; }, revokeObjectURL(uri) { events.push(['revoke', uri]); } },
    fetch: async (uri) => {
      assert.equal(uri, 'blob:output'); events.push('fetch'); fail('read');
      return { ok: true, blob: async () => ({ size: options.size ?? bytes.byteLength, arrayBuffer: async () => bytes }) };
    },
  });
  const photo = { uri: 'selected', mimeType: mime, file: { size: 4, type: mime, arrayBuffer() { throw new Error('Original web bytes accessed'); } } };
  return { helper, photo, events, bytes, original };
}

for (const platform of ['android', 'ios', 'web']) {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
    test(`${platform}: ${mime} is freshly encoded, output-only and cleaned`, async () => {
      const f = fixture({ platform, mime });
      const result = await f.helper.readProfilePhoto(f.photo);
      assert.equal(result.body, f.bytes);
      assert.notDeepEqual(result.body, f.original);
      const jpeg = ['image/jpeg', 'image/heic', 'image/heif'].includes(mime);
      assert.equal(result.contentType, jpeg ? 'image/jpeg' : 'image/png');
      assert.deepEqual(f.events.find(Array.isArray), ['encode', { format: jpeg ? 'jpeg' : 'png', compress: 0.9 }]);
      assert.ok(f.events.indexOf('redraw') < f.events.indexOf('render'));
      assert.ok(f.events.includes('image release'));
      assert.ok(f.events.includes('context release'));
      if (platform === 'web') {
        assert.deepEqual(f.events.filter(e => Array.isArray(e) && e[0] === 'revoke').map(e => e[1]).sort(), ['blob:input', 'blob:output', 'blob:render']);
      } else assert.equal(f.events.filter(e => e === 'delete').length, 1);
    });
  }
}

for (const fail of ['decode', 'render', 'encode', 'read', 'delete']) {
  test(`${fail} failure is closed and errors do not disclose source details`, async () => {
    const f = fixture({ fail });
    await assert.rejects(f.helper.readProfilePhoto(f.photo), { message: f.helper.PHOTO_UPLOAD_ERROR });
    if (['read', 'delete'].includes(fail)) assert.ok(f.events.includes('delete'));
    if (fail !== 'decode') assert.ok(f.events.includes('context release'));
    if (['encode', 'read', 'delete'].includes(fail)) assert.ok(f.events.includes('image release'));
  });
}

test('web read failure releases every owned blob, never selected original', async () => {
  const f = fixture({ platform: 'web', fail: 'read' });
  await assert.rejects(f.helper.readProfilePhoto(f.photo));
  assert.equal(f.events.filter(e => Array.isArray(e) && e[0] === 'revoke').length, 3);
});

test('encoder returning original URI is rejected without deleting original', async () => {
  const f = fixture({ sameUri: true });
  await assert.rejects(f.helper.readProfilePhoto(f.photo));
  assert.ok(!f.events.includes('delete'));
});

test('actual output signature must match requested format', async () => {
  for (const bytes of [new ArrayBuffer(0), Uint8Array.from([1, 2, 3]).buffer, Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer]) {
    const f = fixture({ bytes });
    await assert.rejects(f.helper.readProfilePhoto(f.photo), { message: f.helper.PHOTO_TYPE_ERROR });
    assert.ok(f.events.includes('delete'));
  }
});

test('5 MiB output limit checks both file size and actual returned bytes', async () => {
  for (const options of [{ size: 5 * 1024 * 1024 + 1 }, { size: 4, bytes: new ArrayBuffer(5 * 1024 * 1024 + 1) }, { platform: 'web', size: 5 * 1024 * 1024 + 1 }]) {
    const f = fixture(options);
    await assert.rejects(f.helper.readProfilePhoto(f.photo), { message: f.helper.PHOTO_SIZE_ERROR });
    assert.ok(f.events.includes('delete') || f.events.some(e => Array.isArray(e) && e[1] === 'blob:output'));
  }
});

function uploads(f, owner = 'owner') {
  const events = [];
  const storage = {
    list: async () => ({ data: [] }),
    upload: async (...args) => { events.push(['upload', ...args]); return {}; },
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
    storage: { from: (name) => { assert.equal(name, 'profile-photos'); return storage; } },
    from: () => ({
      select: () => ({ eq: () => ({ data: [], maybeSingle: async () => ({ data: {} }) }) }),
      upsert: async (...args) => { events.push(['metadata', ...args]); return {}; },
    }),
  };
  return { events, api: load('src/lib/profile-photos.ts', { './supabase': { supabase }, './profile-photo': f.helper }) };
}

test('all three slots and replacements sanitize with canonical owner paths, upsert and metadata ordering', async () => {
  const f = fixture();
  const u = uploads(f);
  for (let round = 0; round < 2; round++) await u.api.saveSelectedPhotos('owner', { 1: f.photo, 2: f.photo, 3: f.photo });
  assert.equal(u.events.length, 12);
  for (let i = 0; i < 6; i++) {
    const position = i % 3 + 1;
    assert.deepEqual(u.events[i * 2], ['upload', `owner/${position}`, f.bytes, { contentType: 'image/jpeg', upsert: true }]);
    assert.deepEqual(u.events[i * 2 + 1], ['metadata', { user_id: 'owner', position, storage_path: `owner/${position}` }, { onConflict: 'user_id,position' }]);
  }
  assert.equal(f.events.filter(e => e === 'render').length, 6);
});

test('sanitization failure and changed owner each prevent upload and metadata writes', async () => {
  for (const [f, owner] of [[fixture({ fail: 'encode' }), 'owner'], [fixture(), 'different-owner']]) {
    const u = uploads(f, owner);
    await assert.rejects(u.api.saveSelectedPhotos('owner', { 1: f.photo }));
    assert.deepEqual(u.events, []);
  }
});

test('creation and editing retain the same shared photo upload path', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(read('src/app/intentions.tsx'), /saveProfile\(draft\)/);
  assert.match(read('src/components/profile-form.tsx'), /saveProfile\(draft, true\)/);
  assert.match(read('src/lib/profile.ts'), /saveSelectedPhotos\(data\.user\.id, draft\.photos/);
});
