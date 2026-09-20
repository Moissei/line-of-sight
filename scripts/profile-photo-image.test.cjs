const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function fixture() {
  let cursor = 0, props = { uri: 'old', expiresAt: 1000 }, now = 0;
  const states = [], effects = [], layouts = [], failures = [], timers = [];
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = {
    react: {
      useRef(initial) { const i = cursor++; return states[i] ??= { current: initial }; },
      useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
      useLayoutEffect(fn) { layouts.push(fn); },
      useEffect(fn) { effects.push(fn); },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Image: 'Image', StyleSheet: { create: x => x, absoluteFill: {} } },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/components/profile-photo-image.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'exports', 'Date', 'setTimeout', 'clearTimeout', code)(name => dependencies[name], exports, { now: () => now }, (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, () => {});
  function render(next) { if (next) props = next; cursor = 0; const tree = exports.ProfilePhotoImage({ ...props, onFailure: uri => failures.push(uri) }); layouts.splice(0).forEach(fn => fn()); effects.at(-1)?.(); return tree.props.children; }
  return { render, failures, effects, timers, time(value) { now = value; timers.splice(0).forEach(timer => timer.fn()); } };
}
const opacity = image => image.props.style[1].opacity;
test('replacement promotes only on native load and preserves its native key', () => {
  const f = fixture(); let images = f.render(); images[0].props.onLoad(); images = f.render(); const oldKey = images[0].key;
  images = f.render({ uri: 'new', expiresAt: 2000 });
  assert.equal(images[0].key, oldKey); assert.equal(opacity(images[0]), 1); assert.equal(opacity(images[1]), 0);
  const pendingKey = images[1].key; const oldError = images[0].props.onError;
  images[1].props.onLoad(); images = f.render(); assert.equal(images.length, 1); assert.equal(images[0].key, pendingKey); assert.equal(opacity(images[0]), 1);
  oldError(); assert.equal(f.render()[0].key, pendingKey); assert.deepEqual(f.failures, []);
  assert.equal(images[0].props.fadeDuration, 0);
});
test('superseded URL/version callbacks cannot promote or remove current target', () => {
  const f = fixture(); const old = f.render()[0]; f.render({ uri: 'old', expiresAt: 2000 }); old.props.onLoad(); old.props.onError();
  assert.equal(opacity(f.render()[0]), 0); assert.deepEqual(f.failures, []);
  const current = f.render()[0]; current.props.onError(); assert.deepEqual(f.failures, ['old']);
});
test('expiry hides retained image while replacement is pending; expired load cannot promote', () => {
  const f = fixture(); f.render()[0].props.onLoad(); const images = f.render({ uri: 'new', expiresAt: 2000 });
  f.time(1000); assert.equal(f.render().length, 1); assert.equal(opacity(f.render()[0]), 0);
  f.time(2000); images[1].props.onLoad(); assert.deepEqual(f.render(), []);
});
test('unmount prevents image event publication across account-generation reset', () => {
  const f = fixture(); const image = f.render()[0]; const cleanup = f.effects[0](); cleanup();
  image.props.onLoad(); image.props.onError(); assert.deepEqual(f.failures, []); assert.equal(opacity(f.render()[0]), 0);
});
