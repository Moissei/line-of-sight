const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(tab) {
  let cursor = 0, effect, cleanup, tree;
  const state = [], pending = [], responses = [], navigation = [];
  const timers = new Map(); let timerId = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return state[i] ??= { current: initial }; }, useCallback: fn => fn,
  };
  const native = { StyleSheet: { create: x => x } };
  for (const name of ['Pressable', 'RefreshControl', 'ScrollView', 'Text', 'View']) native[name] = name;
  const load = signal => new Promise((resolve, reject) => pending.push({ resolve, reject, signal }));
  const dependencies = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'expo-router': { useFocusEffect: fn => { effect = fn; }, useRouter: () => ({ push: route => navigation.push(route) }) },
    'expo-status-bar': {}, 'expo-symbols': {}, 'react-native-safe-area-context': {},
    '@/lib/connections': { loadConnections: load },
    '@/lib/incoming-requests': { loadIncomingRequests: load, respondToRequest: (...args) => new Promise(resolve => responses.push({ args, resolve })) },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(`src/app/(tabs)/${tab}.tsx`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'exports', 'setTimeout', 'clearTimeout', code)(name => dependencies[name], exports, fn => { timers.set(++timerId, fn); return timerId; }, id => timers.delete(id));
  function render() { cursor = 0; tree = exports.default(); return tree; }
  function nodes(n = tree) { return !n || typeof n !== 'object' ? [] : [n, ...[n.props?.children].flat(Infinity).filter(child => child !== undefined).flatMap(child => nodes(child))]; }
  render();
  return { state, pending, responses, navigation, render, nodes, focus() { render(); cleanup = effect(); for (const [id, fn] of timers) { timers.delete(id); fn(); } }, blur() { cleanup(); } };
}
const row = id => ({ connection_id: id, request_id: id, first_name: 'Test', age: null, gender: null, bio: null, intents: [] });
for (const tab of ['connections', 'requests']) {
  test(`${tab}: retained rows survive refocus and failure; successful refresh is authoritative`, async () => {
    const f = fixture(tab); f.focus(); await settle(); f.pending.shift().resolve([row('one')]); await settle();
    f.blur(); f.focus(); await settle(); assert.equal(f.state[0][0].first_name, 'Test');
    f.pending.shift().reject(Error('private')); await settle(); assert.equal(f.state[0].length, 1);
    f.blur(); f.focus(); await settle(); f.pending.shift().resolve([]); await settle(); assert.deepEqual(f.state[0], []); f.blur();
  });
  test(`${tab}: aborted older focus cannot overwrite authoritative newer result`, async () => {
    const f = fixture(tab); f.focus(); await settle(); const old = f.pending.shift(); f.blur(); assert.equal(old.signal.aborted, true);
    f.focus(); await settle(); f.pending.shift().resolve([row('new')]); await settle(); old.resolve([row('old')]); await settle();
    assert.equal(f.state[0][0].request_id, 'new'); f.blur();
  });
}
test('Connections pull-to-refresh retains rows and requests fresh data', async () => {
  const f = fixture('connections'); f.focus(); await settle(); f.pending.shift().resolve([row('one')]); await settle(); f.render();
  const scroll = f.nodes().find(n => n.type === 'ScrollView'); scroll.props.refreshControl.props.onRefresh();
  assert.equal(f.state[0].length, 1); f.pending.shift().resolve([]); await settle(); assert.deepEqual(f.state[0], []); f.blur();
});
for (const response of ['accepted', 'declined']) test(`Requests ${response} removes row only after confirmation and locks duplicate actions`, async () => {
  const f = fixture('requests'); f.focus(); await settle(); f.pending.shift().resolve([row('one')]); await settle(); f.render();
  const buttons = f.nodes().filter(n => n.type === 'Pressable'); const press = buttons[response === 'accepted' ? 0 : 1].props.onPress;
  press(); press(); assert.equal(f.responses.length, 1); assert.equal(f.state[0].length, 1);
  assert.deepEqual(f.responses[0].args, ['one', response]); f.responses[0].resolve(); await settle(); assert.deepEqual(f.state[0], []); f.blur();
});

for (const tab of ['connections', 'requests']) test(`${tab}: loaded empty state remains during background refresh without loading branch`, async () => {
  const f = fixture(tab); f.focus(); await settle(); assert.equal(f.state[1], true);
  f.pending.shift().resolve([]); await settle(); f.blur(); f.focus(); await settle();
  assert.equal(f.state[1], false); f.render();
  assert.ok(!JSON.stringify(f.render()).includes(tab === 'connections' ? 'Loading connections...' : 'Loading requests...'));
  if (tab === 'connections') {
    const scroll = f.nodes().find(n => n.type === 'ScrollView');
    assert.equal(scroll.props.refreshControl.props.refreshing, false);
    scroll.props.refreshControl.props.onRefresh(); f.render();
    assert.equal(f.nodes().find(n => n.type === 'ScrollView').props.refreshControl.props.refreshing, true);
  }
  f.blur();
});


test('Connections open rows preserve chat navigation and present bounded profile text', async () => {
  const f = fixture('connections'); f.focus(); await settle();
  f.pending.shift().resolve([
    { ...row('first'), first_name: 'A very long name '.repeat(8), age: 35, bio: 'Long bio '.repeat(40), intents: ['Dating','Friendship','Networking','Socializing'] },
    { ...row('second'), first_name: 'David' },
  ]); await settle(); f.render();
  const buttons = f.nodes().filter(n => n.type === 'Pressable');
  assert.equal(buttons.length, 2);
  for (const [index, button] of buttons.entries()) {
    assert.equal(button.props.accessibilityRole, 'button');
    assert.match(button.props.accessibilityLabel, /^Open conversation with /);
    assert.equal(button.props.accessibilityHint, 'Opens your existing chat.');
    button.props.onPress();
    assert.deepEqual(f.navigation[index], { pathname: '/connection-detail', params: { connectionId: index === 0 ? 'first' : 'second' } });
    const style = button.props.style({ pressed: false });
    assert.equal(style[0].borderWidth, undefined);
    assert.equal(button.props.style({ pressed: true }).at(-1).opacity, 0.75);
  }
  const texts = f.nodes().filter(n => n.type === 'Text');
  const names = texts.filter(n => n.props.numberOfLines === 2);
  assert.equal(names.length, 2); assert.equal(names[0].props.children[1], ', 35'); assert.equal(names[1].props.children[1], '');
  assert.equal(names[0].props.ellipsizeMode, 'tail');
  const bios = texts.filter(n => n.props.numberOfLines === 1);
  assert.equal(bios.length, 1); assert.equal(bios[0].props.ellipsizeMode, 'tail');
  for (const intent of ['Dating','Friendship','Networking','Socializing']) assert.ok(texts.some(n => n.props.children === intent));
  assert.ok(!texts.some(n => n.props.children === 'Message'));
  const source = fs.readFileSync('src/app/(tabs)/connections.tsx','utf8');
  assert.doesNotMatch(source, /envelope|mail_outline|messageAction|messageLabel|fontFamily/);
  assert.match(source, /width: 77, height: 96/);
  assert.equal(f.nodes().filter(n => n.props?.style?.width === 77 && n.props?.accessible === false).length, 2);
  f.blur();
});


test('Connections shows existing short bio below name with Profile-aligned header and quiet dividers', async () => {
  const f = fixture('connections'); f.focus(); await settle();
  f.pending.shift().resolve([{ ...row('one'), first_name: 'Ver', age: 1857, bio: '  Ss  ', intents: ['Dating','Friendship'] }, { ...row('two'), bio: '   ' }]);
  await settle(); f.render();
  const texts = f.nodes().filter(n => n.type === 'Text');
  const bio = texts.find(n => n.props.children === 'Ss');
  assert.ok(bio); assert.equal(bio.props.numberOfLines, 1); assert.equal(bio.props.ellipsizeMode, 'tail');
  assert.equal(texts.filter(n => n.props.numberOfLines === 1).length, 1);
  const identity = f.nodes().find(n => n.props?.children?.includes?.(bio));
  assert.equal(identity.props.style.alignSelf, 'center'); assert.equal(identity.props.style.minHeight, undefined);
  assert.equal(identity.props.children[0].props.children[0], 'Ver');
  const title = texts.find(n => n.props.children === 'Connections');
  assert.equal(title.props.style.fontSize, 27); assert.equal(title.props.style.fontWeight, '600'); assert.equal(title.props.style.color, '#253D2F');
  const rows = f.nodes().filter(n => n.type === 'Pressable');
  assert.equal(rows[0].props.style({ pressed: false })[1].borderBottomColor, '#D6DCD4');
  assert.equal(rows[1].props.style({ pressed: false })[1], false);
  f.blur();
});


test('Connections preserves RPC bio through mapper to rendered row and keeps chevron decorative', async () => {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/lib/connections.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', code)(exports);
  const records = exports.parseConnections([{ ...row('bio-contract'), first_name: 'Ver', age: 1857, bio: 'Ss', gender: null, connected_at: '2026-09-01T00:00:00Z' }]);
  const f = fixture('connections'); f.focus(); await settle(); f.pending.shift().resolve(records); await settle(); f.render();
  const bio = f.nodes().find(n => n.type === 'Text' && n.props.children === 'Ss');
  assert.ok(bio); assert.equal(bio.props.numberOfLines, 1); assert.equal(bio.props.ellipsizeMode, 'tail');
  const chevron = f.nodes().find(n => n.props?.name?.android === 'chevron_right');
  assert.equal(chevron.props.size, 19); assert.equal(chevron.props.weight, 'medium'); assert.equal(chevron.props.tintColor, '#253D2F');
  assert.equal(chevron.props.accessible, false); assert.equal(chevron.props.onPress, undefined); assert.equal(chevron.props.style.alignSelf, 'center');
  assert.equal(f.nodes().filter(n => n.type === 'Pressable').length, 1);
  f.blur();
});


for (const response of ['accepted','declined']) test('Requests open list has compact independent actions: ' + response, async () => {
  const f = fixture('requests'); f.focus(); await settle();
  f.pending.shift().resolve([{ ...row('one'), first_name: 'Maya', age:31, bio:'Coffee and concerts', gender:'Female', intents:['Dating','Friendship'] }, row('two')]);
  await settle(); f.render();
  const nodes=f.nodes(), texts=nodes.filter(n=>n.type==='Text');
  const bio=texts.find(n=>n.props.children==='Coffee and concerts'); assert.equal(bio.props.numberOfLines,2); assert.equal(bio.props.ellipsizeMode,'tail');
  assert.ok(texts.some(n=>n.props.accessibilityLabel==='Maya, 31, Female'));
  assert.equal(texts.filter(n=>n.props.children==='Female').length,0);
  assert.ok(texts.some(n=>n.props.children==='Dating')); assert.ok(texts.some(n=>n.props.children==='Friendship'));
  const buttons=nodes.filter(n=>n.type==='Pressable'); assert.equal(buttons.length,4);
  for(const b of buttons){ assert.ok(b.props.style[0].minHeight + b.props.hitSlop.top + b.props.hitSlop.bottom >=44); assert.equal(b.props.style[0].flex,undefined); assert.match(b.props.accessibilityLabel,/request from /); }
  const rows=nodes.filter(n=>Array.isArray(n.props?.style)&&n.props.style[0]?.gap===14);
  assert.equal(rows.length,2); assert.equal(rows[0].props.style[0].borderWidth,undefined); assert.equal(rows[0].props.style[0].backgroundColor,undefined); assert.equal(rows[1].props.style[1],false);
  buttons[response==='accepted'?2:3].props.onPress();
  assert.deepEqual(f.responses[0].args,['two',response]); f.responses[0].resolve(); await settle(); f.blur();
});


test('Requests outlined action pair aligns with identity and wraps within remaining width', async () => {
  const f = fixture('requests'); f.focus(); await settle(); f.pending.shift().resolve([row('one')]); await settle(); f.render();
  const nodes = f.nodes();
  const actions = nodes.find(n => n.props?.style?.marginLeft === 104);
  assert.ok(actions); assert.equal(actions.props.style.flexWrap, 'wrap');
  const portrait = nodes.find(n => n.props?.style?.width === 90);
  const header = nodes.find(n => n.props?.style?.flexDirection === 'row' && n.props.style.gap === 14);
  assert.equal(actions.props.style.marginLeft, portrait.props.style.width + header.props.style.gap);
  const buttons = nodes.filter(n => n.type === 'Pressable');
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    const style = Object.assign({}, ...button.props.style.filter(Boolean));
    assert.equal(style.backgroundColor, 'transparent'); assert.equal(style.borderWidth, 1);
    assert.equal(style.borderRadius, 12); assert.equal(style.minHeight, 36); assert.equal(style.minWidth, 90);
    assert.equal(style.maxWidth, '100%'); assert.equal(style.flex, undefined);
  }
  assert.equal(buttons[0].props.style[0].borderColor, '#3F6B50');
  assert.equal(buttons[1].props.style[1].borderColor, '#A65F5F');
  assert.equal(buttons[0].props.children.props.style[0].color, '#3F6B50');
  assert.equal(buttons[1].props.children.props.style[1].color, '#A65F5F');
  const acceptText=Object.assign({},...buttons[0].props.children.props.style.filter(Boolean));
  const declineText=Object.assign({},...buttons[1].props.children.props.style.filter(Boolean));
  for (const key of ['fontFamily','fontSize','fontWeight']) assert.equal(acceptText[key],declineText[key]);
  f.blur();
});
for (const gender of ['Female','Male','Nonbinary',null]) test('Requests identity gender and Profile chip parity: ' + gender, async () => {
  const f=fixture('requests'); f.focus(); await settle(); f.pending.shift().resolve([{...row('one'),first_name:'Maya',age:31,gender,bio:'Bio',intents:['Dating']}]); await settle(); f.render();
  const texts=f.nodes().filter(n=>n.type==='Text');
  const identity=texts.find(n=>n.props.accessibilityLabel?.startsWith('Maya, 31'));
  assert.equal(identity.props.accessibilityLabel, 'Maya, 31' + (gender ? ', '+gender : ''));
  const genders=texts.filter(n=>Array.isArray(n.props.style) && n.props.style[0]?.fontSize===18 && n.props.style[0]?.fontWeight==='400');
  assert.equal(genders.length,gender ? 1 : 0);
  if(gender) {
    assert.equal(genders[0].props.children[1],gender==='Female'?'\u2640\uFE0E':gender==='Male'?'\u2642\uFE0E':gender);
    const style=Object.assign({},...genders[0].props.style.filter(Boolean));
    assert.equal(style.color,gender==='Female'?'#B86F7C':gender==='Male'?'#647FA3':'#656D66');
    assert.equal(style.fontSize,gender==='Female'||gender==='Male'?20:18);
  }
  const actions=f.nodes().find(n=>n.props?.style?.marginLeft===104);
  assert.equal(actions.props.style.marginTop,-14);
  assert.equal(actions.props.style.paddingVertical,4);
  const profile=fs.readFileSync('src/app/(tabs)/profile.tsx','utf8');
  const chip=texts.find(n=>n.props.children==='Dating');
  const expected=new Function('return ({'+profile.match(/chip: [{]([^}]+)[}]/)[1]+'})')();
  assert.deepEqual(chip.props.style,expected);
  const block=f.nodes().find(n=>n.props?.style?.flex===1 && n.props.style.gap===4);
  assert.equal(block.props.children[1].props.children,'Bio');
  f.blur();
});


test('Requests shows only real data with mutually exclusive empty and populated presentations', async () => {
  const f=fixture('requests'); f.focus(); await settle(); f.pending.shift().resolve([]); await settle(); f.render();
  assert.ok(f.nodes().some(n=>n.type==='Text' && n.props.children==='No requests yet'));
  assert.equal(f.nodes().filter(n=>n.type==='Pressable').length,0);
  f.blur(); f.focus(); await settle(); f.pending.shift().resolve([row('real')]); await settle(); f.render();
  assert.ok(!f.nodes().some(n=>n.type==='Text' && n.props.children==='No requests yet'));
  assert.equal(f.nodes().filter(n=>n.type==='Pressable').length,2);
  f.blur();
});
