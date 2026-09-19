const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('src/lib/nearby-discovery.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleExports = {};
new Function('exports', 'require', compiled)(moduleExports, () => {
  throw new Error('Parser must not load a network client');
});
const { parseNearbyProfiles } = moduleExports;
const row = { user_id: 'b', first_name: 'Sam', age: null, gender: null, bio: null, intents: [] };

test('six safe fields, nullable profile values and intentions are accepted', () => {
  assert.deepEqual(parseNearbyProfiles([row]), [row]);
  const populated = { ...row, age: 28, gender: 'Woman', bio: 'Hello', intents: ['Dating', 'Friendship'] };
  assert.deepEqual(parseNearbyProfiles([populated]), [populated]);
  assert.deepEqual(parseNearbyProfiles([]), []);
});
test('malformed required fields remain rejected', () => {
  for (const input of [null, {}, [null], [1]]) assert.throws(() => parseNearbyProfiles(input));
  for (const key of Object.keys(row)) {
    const missing = { ...row }; delete missing[key];
    assert.throws(() => parseNearbyProfiles([missing]), key);
  }
  for (const [key, value] of [['user_id', 1], ['first_name', null], ['age', 1.5],
    ['age', NaN], ['gender', 1], ['bio', {}], ['intents', null], ['intents', [1]]]) {
    assert.throws(() => parseNearbyProfiles([{ ...row, [key]: value }]), key);
  }
});
test('legacy distance and unexpected coordinates never propagate', () => {
  const input = { ...row, distance_meters: 7, latitude: 12, longitude: 34,
    coordinates: [34, 12], position: { lat: 12, lng: 34 }, measured_meters: 7.1 };
  assert.deepEqual(parseNearbyProfiles([input]), [row]);
  assert.deepEqual(parseNearbyProfiles([{ ...input, distance_meters: 'legacy-extra' }]), [row]);
  const parsed = parseNearbyProfiles([input])[0];
  assert.notEqual(parsed.intents, input.intents);
});
test('parser preserves server ordering without intention filtering', () => {
  const input = [row, { ...row, user_id: 'a', intents: ['Networking'] }];
  assert.deepEqual(parseNearbyProfiles(input), input);
});
test('card has no distance rendering and retains photo/request/safety wiring', () => {
  const card = fs.readFileSync('src/components/nearby-profile-card.tsx', 'utf8');
  assert.doesNotMatch(card, /distance|meters|m away|__DEV__/i);
  assert.match(card, /<PrimaryPhoto key=\{profile.primaryPhotoUrl \?\? 'placeholder'\} uri=\{profile.primaryPhotoUrl\}/);
  assert.match(card, /cachePolicy="none"/);
  assert.match(card, /<SafetyActions target=\{\{ kind: 'user', id: profile.user_id \}\} onBlocked=\{onBlocked\}/);
  assert.match(card, /<RequestToConnect key=\{profile.user_id\} targetUserId=\{profile.user_id\} revision=\{profile.requestRevision \?\? 0\}/);
});
