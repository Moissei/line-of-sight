const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/components/discovery-brand.tsx', 'utf8');
test('ornament masks and static line remain in both states; only signal and pupils are active-only', () => {
  assert.match(source, /\{\[\{ x: 580/);
  assert.doesNotMatch(source, /active && \[\{ x: 580/);
  assert.match(source, /width: width \* 0.36, height: 1/);
  assert.match(source, /active && <Animated.View style=\{\[styles.signal/);
  assert.match(source, /active && \[\{ x: 347/);
  assert.match(source, /toValue: 0.85, duration: 200/);
  const dots = source.match(/\{\[([\d., ]+)\]\.map\(x =>/)[1].split(',').map(Number);
  assert.equal(dots.filter(x => x < 0.5).length, 3);
  assert.equal(dots.filter(x => x > 0.5).length, 3);
  assert.doesNotMatch(source, /scale:/);
});
test('existing loop, reduced-motion gate and focus cleanup stay intact', () => {
  assert.match(source, /traveling = Animated.loop\(Animated.sequence/);
  assert.match(source, /if \(disposed \|\| reduced\) return/);
  assert.match(source, /reduceMotionChanged/);
  assert.match(source, /listener.remove\(\); fading\?\.stop\(\); traveling\?\.stop\(\)/);
  assert.match(source, /duration: 1400/);
});
