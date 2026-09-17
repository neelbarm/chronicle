'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { squarify, buildTree, collapseChains, layoutLevels } = require('../dist/analyze/treemap');

const RECT = { x: 0, y: 0, w: 1, h: 1 };
const EPS = 1e-9;

function overlaps(a, b) {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

function checkTiling(values, rect) {
  const rects = squarify(values, rect);
  assert.equal(rects.length, values.length);
  const total = values.reduce((a, b) => a + b, 0);
  let area = 0;
  for (const r of rects) {
    assert.ok(r.w >= -EPS && r.h >= -EPS, 'no negative dimensions');
    assert.ok(r.x >= rect.x - 1e-6 && r.y >= rect.y - 1e-6, 'inside the parent rect');
    assert.ok(r.x + r.w <= rect.x + rect.w + 1e-6, 'does not overflow horizontally');
    assert.ok(r.y + r.h <= rect.y + rect.h + 1e-6, 'does not overflow vertically');
    area += r.w * r.h;
  }
  assert.ok(Math.abs(area - rect.w * rect.h) < 1e-6, `areas sum to the parent area (got ${area})`);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      assert.ok(!overlaps(rects[i], rects[j]), `rects ${i} and ${j} overlap`);
    }
  }
  // Area must be proportional to value.
  for (let i = 0; i < values.length; i++) {
    const expected = (values[i] / total) * rect.w * rect.h;
    assert.ok(Math.abs(rects[i].w * rects[i].h - expected) < 1e-6, `rect ${i} area is proportional`);
  }
  return rects;
}

test('tiles the rect exactly for a variety of inputs', () => {
  checkTiling([6, 6, 4, 3, 2, 2, 1], RECT);
  checkTiling([100, 1, 1, 1, 1], RECT);
  checkTiling([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], { x: 10, y: 5, w: 400, h: 220 });
  checkTiling([5], RECT);
  const many = Array.from({ length: 140 }, (_, i) => 140 - i);
  checkTiling(many, { x: 0, y: 0, w: 900, h: 500 });
});

test('aspect ratios stay reasonable (that is the point of squarifying)', () => {
  const rects = squarify([9, 8, 7, 6, 5, 4, 3, 2, 1], { x: 0, y: 0, w: 600, h: 400 });
  const ratios = rects.map((r) => Math.max(r.w / r.h, r.h / r.w));
  const worst = Math.max(...ratios);
  assert.ok(worst < 8, `worst aspect ratio ${worst.toFixed(2)} should stay modest`);
});

test('degenerate inputs do not produce NaN', () => {
  for (const r of squarify([0, 0, 0], RECT)) {
    assert.ok(Number.isFinite(r.x) && Number.isFinite(r.w));
  }
  assert.deepEqual(squarify([], RECT), []);
  for (const r of squarify([1, 2], { x: 0, y: 0, w: 0, h: 10 })) {
    assert.ok(Number.isFinite(r.w) && r.w === 0);
  }
});

const LEAVES = [
  { path: 'src/a.ts', loc: 100, churn: 10, added: 120, removed: 20, topAuthor: 'Ada', language: 'TypeScript' },
  { path: 'src/deep/b.ts', loc: 50, churn: 4, added: 60, removed: 10, topAuthor: 'Grace', language: 'TypeScript' },
  { path: 'src/deep/c.ts', loc: 25, churn: 2, added: 30, removed: 5, topAuthor: 'Ada', language: 'TypeScript' },
  { path: 'README.md', loc: 25, churn: 6, added: 40, removed: 15, topAuthor: 'Ada', language: 'Docs' },
];

test('buildTree rolls loc and churn up the directories', () => {
  const root = buildTree(LEAVES, 'demo');
  assert.equal(root.loc, 200);
  assert.equal(root.churn, 22);
  const src = root.children.find((c) => c.path === 'src');
  assert.equal(src.loc, 175);
  assert.equal(src.churn, 16);
  const deep = src.children.find((c) => c.path === 'src/deep');
  assert.equal(deep.loc, 75);
  assert.equal(deep.children.length, 2);
});

test('collapseChains folds single-child directory chains', () => {
  const tree = collapseChains(
    buildTree([{ path: 'a/b/c/only.ts', loc: 10, churn: 1, added: 1, removed: 0, topAuthor: 'x', language: 'TypeScript' }], 'demo'),
  );
  const names = [];
  (function walk(n) {
    names.push(n.name);
    (n.children || []).forEach(walk);
  })(tree);
  assert.ok(names.some((n) => n.includes('/')), `expected a collapsed crumb, got ${names.join(', ')}`);
});

test('layoutLevels emits a unit-square layout per directory', () => {
  const { layouts, maxChurn } = layoutLevels(buildTree(LEAVES, 'demo'));
  assert.ok(layouts[''], 'root level exists');
  assert.ok(layouts['src'], 'nested level exists');
  // maxChurn is churn-per-file, so the hottest single file (src/a.ts, 10 commits) sets it.
  assert.equal(maxChurn, 10);
  for (const [path, rects] of Object.entries(layouts)) {
    let area = 0;
    rects.forEach((r) => (area += r.w * r.h));
    assert.ok(Math.abs(area - 1) < 1e-6, `level ${path || '/'} tiles the unit square`);
    rects.forEach((r) => {
      assert.ok(r.x >= -EPS && r.y >= -EPS && r.x + r.w <= 1 + EPS && r.y + r.h <= 1 + EPS);
      assert.ok(typeof r.isDir === 'boolean');
      assert.ok(Number.isFinite(r.heat) && r.heat >= 0);
      if (!r.isDir) assert.ok(typeof r.topAuthor === 'string');
    });
  }
});

test('layoutLevels merges the tail when a directory has too many children', () => {
  const wide = Array.from({ length: 30 }, (_, i) => ({
    path: `src/f${i}.ts`, loc: 30 - i, churn: 1, added: 1, removed: 0, topAuthor: 'Ada', language: 'TypeScript',
  }));
  const { layouts } = layoutLevels(buildTree(wide, 'demo'), { maxChildren: 10 });
  const level = layouts['src'];
  assert.equal(level.length, 11);
  assert.ok(level[level.length - 1].name.startsWith('+20 smaller'));
});

test('a collapsed root still publishes its level at the empty path', () => {
  // Every tracked file under one directory: collapseChains hands layoutLevels a
  // root whose path is `src`, but the report always opens at ''.
  const nested = [
    { path: 'src/only.ts', loc: 12, churn: 3, added: 12, removed: 0, topAuthor: 'Ada', language: 'TypeScript' },
    { path: 'src/other.ts', loc: 4, churn: 1, added: 4, removed: 0, topAuthor: 'Ada', language: 'TypeScript' },
  ];
  const root = collapseChains(buildTree(nested, 'demo'));
  assert.equal(root.path, 'src', 'the root collapsed onto src');
  const { layouts } = layoutLevels(root);
  assert.ok(layouts[''], 'the top level is reachable at the empty path');
  assert.deepEqual(
    layouts[''].map((r) => r.name),
    ['only.ts', 'other.ts'],
  );
});
