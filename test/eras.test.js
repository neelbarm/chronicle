'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { segmentEras, boundaryScores, equalSegments } = require('../dist/analyze/eras');

const WEEK = 7 * 86400000;

/** Builds a weekly signal from a velocity array and a per-week directory set. */
function signal(velocities, dirsFor) {
  return velocities.map((v, i) => ({
    weekStart: Date.UTC(2024, 0, 1) + i * WEEK,
    commits: v,
    dirs: new Set(dirsFor ? dirsFor(i) : ['src']),
  }));
}

test('finds the change point in a synthetic velocity step', () => {
  // 20 quiet weeks, then 20 busy ones.
  const weeks = signal([...Array(20).fill(2), ...Array(20).fill(30)]);
  const scores = boundaryScores(weeks);
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  assert.ok(Math.abs(best.index - 20) <= 2, `expected a boundary near week 20, got ${best.index}`);
});

test('finds the change point when only the directories shift', () => {
  const weeks = signal(Array(40).fill(6), (i) => (i < 20 ? ['parser', 'lexer'] : ['web', 'api']));
  const scores = boundaryScores(weeks);
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  assert.ok(Math.abs(best.index - 20) <= 2, `expected a boundary near week 20, got ${best.index}`);
  assert.ok(best.jaccard > 0.9, 'disjoint directory sets should score close to 1');
});

test('segments a three-phase history into three eras', () => {
  const weeks = signal(
    [...Array(18).fill(3), ...Array(18).fill(25), ...Array(18).fill(4)],
    (i) => (i < 18 ? ['core'] : i < 36 ? ['web'] : ['docs']),
  );
  const cuts = segmentEras(weeks, { minEras: 3, maxEras: 8 });
  assert.ok(cuts.length >= 2 && cuts.length <= 7, `got ${cuts.length} cuts`);
  assert.ok(cuts.some((c) => Math.abs(c - 18) <= 3), `expected a cut near 18, got ${cuts}`);
  assert.ok(cuts.some((c) => Math.abs(c - 36) <= 3), `expected a cut near 36, got ${cuts}`);
});

test('respects the era ceiling and the minimum gap', () => {
  const noisy = signal(Array.from({ length: 120 }, (_, i) => (i % 3 === 0 ? 30 : 1)),
    (i) => [`d${i % 7}`]);
  const cuts = segmentEras(noisy, { minEras: 3, maxEras: 8 });
  assert.ok(cuts.length <= 7, 'never produces more than 8 eras');
  const minGap = Math.floor(noisy.length / 9);
  for (let i = 1; i < cuts.length; i++) {
    assert.ok(cuts[i] - cuts[i - 1] >= minGap, `cuts too close: ${cuts}`);
  }
  assert.ok(cuts.every((c) => c > 0 && c < noisy.length));
});

test('a flat history still yields the minimum number of eras when long enough', () => {
  const flat = signal(Array(60).fill(5));
  const cuts = segmentEras(flat, { minEras: 3, maxEras: 8 });
  assert.equal(cuts.length, 2, 'three eras means two cuts');
  assert.deepEqual([...cuts].sort((a, b) => a - b), cuts);
});

test('very short histories produce no cuts', () => {
  assert.deepEqual(segmentEras(signal([1, 2])), []);
  assert.deepEqual(segmentEras([]), []);
});

test('a long silence is treated as a chapter break', () => {
  const weeks = signal([...Array(12).fill(8), ...Array(10).fill(0), ...Array(12).fill(8)]);
  const scores = boundaryScores(weeks);
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  assert.ok(best.index >= 20 && best.index <= 24, `expected the restart to score highest, got ${best.index}`);
});

test('equalSegments splits evenly and stays in range', () => {
  assert.deepEqual(equalSegments(9, 3), [3, 6]);
  assert.deepEqual(equalSegments(3, 3), [1, 2]);
  assert.deepEqual(equalSegments(2, 3), [1]);
  assert.deepEqual(equalSegments(1, 3), []);
});
