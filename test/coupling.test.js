'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CoChangeCounter } = require('../dist/analyze/coupling');
const { busFactor, weekStartOf, localParts } = require('../dist/analyze/aggregate');

test('counts each unordered pair once per commit', () => {
  const c = new CoChangeCounter();
  c.add(['a.ts', 'b.ts', 'c.ts']);
  assert.equal(c.size, 3);
  assert.equal(c.get('a.ts', 'b.ts'), 1);
  assert.equal(c.get('b.ts', 'a.ts'), 1, 'order does not matter');
  c.add(['b.ts', 'a.ts']);
  assert.equal(c.get('a.ts', 'b.ts'), 2);
  assert.equal(c.get('a.ts', 'c.ts'), 1);
});

test('ignores single-file commits and duplicate paths', () => {
  const c = new CoChangeCounter();
  c.add(['solo.ts']);
  c.add([]);
  c.add(['dup.ts', 'dup.ts']);
  assert.equal(c.size, 0);
  assert.equal(c.consideredCommits, 0);
});

test('skips commits above the per-commit cap', () => {
  const c = new CoChangeCounter({ capPerCommit: 4 });
  c.add(['a', 'b', 'c', 'd']);
  assert.equal(c.consideredCommits, 1);
  assert.equal(c.size, 6);
  c.add(['a', 'b', 'c', 'd', 'e']);
  assert.equal(c.skippedCommits, 1);
  assert.equal(c.size, 6, 'the oversized commit contributed nothing');
});

test('ranks pairs by strength and respects minCount', () => {
  const c = new CoChangeCounter();
  for (let i = 0; i < 8; i++) c.add(['core.ts', 'core.test.ts']);
  for (let i = 0; i < 3; i++) c.add(['core.ts', 'util.ts']);
  c.add(['README.md', 'LICENSE']);

  const commits = new Map([
    ['core.ts', 40],
    ['core.test.ts', 8],
    ['util.ts', 30],
    ['README.md', 1],
    ['LICENSE', 1],
  ]);
  const top = c.top(10, commits);
  assert.equal(top[0].a, 'core.test.ts');
  assert.equal(top[0].b, 'core.ts');
  assert.equal(top[0].count, 8);
  assert.equal(top[0].strength, 1, '8 of core.test.ts\'s 8 commits are shared');
  assert.ok(top.every((p) => p.count >= 2), 'pairs seen once are dropped by default');
  assert.ok(!top.some((p) => p.a === 'LICENSE' || p.b === 'LICENSE'));
  for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].strength >= top[i].strength);
});

test('strength never exceeds 1 even with missing commit counts', () => {
  const c = new CoChangeCounter();
  for (let i = 0; i < 5; i++) c.add(['x', 'y']);
  const top = c.top(5, new Map());
  assert.equal(top[0].strength, 1);
});

test('pruning keeps the map bounded and preserves strong pairs', () => {
  const c = new CoChangeCounter({ capPerCommit: 40, maxPairs: 500 });
  for (let i = 0; i < 40; i++) c.add(['hot-a.ts', 'hot-b.ts']);
  for (let i = 0; i < 400; i++) c.add([`noise-${i}.ts`, `noise-${i}-b.ts`]);
  assert.ok(c.size <= 500 * 1.1, `map stayed bounded (${c.size})`);
  assert.equal(c.get('hot-a.ts', 'hot-b.ts'), 40, 'frequent pairs survive pruning');
});

test('bus factor is the smallest group covering half the lines', () => {
  assert.equal(busFactor([50, 30, 20]), 1);
  assert.equal(busFactor([40, 30, 30]), 2);
  assert.equal(busFactor([10, 10, 10, 10, 10, 10]), 3);
  assert.equal(busFactor([]), 0);
  assert.equal(busFactor([0, 0]), 0);
  assert.equal(busFactor([7]), 1);
});

test('week bucketing snaps to Monday and reads the author local clock', () => {
  // 2024-06-05 is a Wednesday; its week starts Monday 2024-06-03.
  assert.equal(weekStartOf(2024, 6, 5), Date.UTC(2024, 5, 3));
  assert.equal(weekStartOf(2024, 6, 3), Date.UTC(2024, 5, 3));
  // Sunday belongs to the week that started six days earlier.
  assert.equal(weekStartOf(2024, 6, 9), Date.UTC(2024, 5, 3));
  const p = localParts('2024-06-03T23:15:00-04:00');
  assert.deepEqual(p, { y: 2024, m: 6, d: 3, hour: 23 });
});
