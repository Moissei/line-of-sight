const fs = require('node:fs');
const ts = require('typescript');
const test = require('node:test');
const assert = require('node:assert/strict');
const jsx = (type, props) => ({ type, props });
function load(file, height = 900) {
 const exports = {};
 const deps = { 'react/jsx-runtime': { jsx, jsxs: jsx }, react: { useState: x => [x, () => {}] },
 'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: x => x }, useWindowDimensions: () => ({ height }) },
 './safety-actions': { SafetyActions: 'Safety' }, './request-to-connect': { RequestToConnect: 'Request' } };
 const code = ts.transpileModule(fs.readFileSync(file, 'utf8') + '\nexport { styles };', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
 new Function('require', 'exports', '__DEV__', code)(id => deps[id] ?? {}, exports, false);
 return exports;
}
function nodes(n) { return !n || typeof n !== 'object' ? [] : [n, ...[n.props?.children].flat(Infinity).flatMap(nodes)]; }
for (const gender of ['Female', 'Male', 'Nonbinary', null]) test('nearby compact presentation: ' + gender, () => {
 const m = load('src/components/nearby-profile-card.tsx');
 const profile = { user_id: 'test', first_name: 'Sofia', age: 29, gender, bio: 'A long bio', intents: ['Dating', 'Friendship'] };
 const tree = m.NearbyProfileCard({ profile, onBlocked() {} }); const all = nodes(tree);
 assert.equal(m.styles.card.borderWidth, undefined); assert.equal(m.styles.card.padding, undefined);
 assert.ok(all.some(n => n.props.numberOfLines === 2 && n.props.ellipsizeMode === 'tail'));
 const identity = all.find(n => n.props.style === m.styles.name);
 const symbol = nodes(identity).find(n => Array.isArray(n.props.style));
 if (gender) assert.equal(symbol.props.children[1], gender === 'Female' ? '\u2640\uFE0E' : gender === 'Male' ? '\u2642\uFE0E' : gender);
 else assert.equal(symbol, undefined);
 assert.equal(m.styles.female.color, '#B86F7C'); assert.equal(m.styles.male.color, '#647FA3');
 assert.equal(m.styles.chip.backgroundColor, '#EEF1E9'); assert.equal(m.styles.chip.paddingHorizontal, 12); assert.equal(m.styles.chip.paddingVertical, 6); assert.equal(m.styles.chip.borderRadius, 16);
 assert.equal(m.styles.actions.flexWrap, 'wrap');
 assert.equal(all.some(n => n.type === 'Safety'), false);
 assert.equal(m.NearbySafetyOptions({ userId: 'test', onBlocked() {} }).props.quiet, true);
 assert.equal(all.find(n => n.type === 'Request').props.targetUserId, 'test');
 const photo = all.find(n => typeof n.type === 'function');
 assert.equal(photo.type(photo.props).props.style[1].height, 189);
 const empty = m.NearbyProfileCard({ profile: { ...profile, bio: '' }, onBlocked() {} });
 assert.equal(nodes(empty).some(n => n.props.style === m.styles.bio), false);
});
test('Connect is outlined with comfortable touch target and safety retains its existing modal', () => {
 const request = load('src/components/request-to-connect.tsx');
 assert.equal(request.styles.button.backgroundColor, 'transparent'); assert.equal(request.styles.button.borderColor, '#3F6B50');
 assert.ok(request.styles.button.minHeight >= 44); assert.equal(request.styles.label.color, '#3F6B50');
 const source = fs.readFileSync('src/components/request-to-connect.tsx', 'utf8');
 assert.match(source, /await sendConnectionRequest\(targetUserId\)/); assert.match(source, /: 'Connect'/);
 const safety = fs.readFileSync('src/components/safety-actions.tsx', 'utf8');
 assert.match(safety, /setMode\('more'\)/); assert.match(safety, /quiet \? 'Safety options' : 'More'/);
});

test('quiet safety action keeps its touch target and only tightens the result introduction gap', () => {
 const safety = load('src/components/safety-actions.tsx').styles;
 assert.ok(safety.quiet.minHeight >= 44);
 assert.equal(safety.quiet.borderWidth, undefined);
 assert.equal(safety.quiet.backgroundColor, undefined);
 assert.equal(safety.quietLabel.color, '#656D66');
 assert.equal(safety.quietLabel.fontWeight, '500');
 const discovery = load('src/app/(tabs)/discovery.tsx').styles;
 assert.equal(discovery.nearbySection.gap, 10);
 assert.equal(discovery.nearbyFound.marginBottom, -6);
});

test('populated Connect and Stop share visible button geometry and responsive equal slots', () => {
 const request = load('src/components/request-to-connect.tsx').styles;
 const screen = load('src/app/(tabs)/discovery.tsx').styles;
 const stop = { ...screen.button, ...screen.stopButton, ...screen.pairedAction };
 for (const key of ['minHeight', 'borderWidth', 'borderRadius', 'backgroundColor']) assert.equal(stop[key], request.button[key]);
 assert.equal(stop.paddingHorizontal, request.button.padding); assert.equal(stop.paddingVertical, request.button.padding);
 const label = { ...screen.buttonLabel, ...screen.stopLabel, ...screen.pairedLabel };
 for (const key of ['fontSize', 'lineHeight', 'fontWeight', 'fontFamily']) assert.equal(label[key], request.label[key]);
 assert.equal(stop.borderColor, '#A65F5F'); assert.equal(request.button.borderColor, '#3F6B50');
 const card = load('src/components/nearby-profile-card.tsx').styles;
 assert.equal(card.actions.gap, 12); assert.equal(card.actions.flexWrap, 'wrap'); assert.equal(card.actionSlot.flexGrow, 1);
});
