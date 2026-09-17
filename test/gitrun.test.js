'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { currentLineCounts, listFiles } = require('../dist/git/run');

/** A throwaway repository containing one plain and one awkwardly named file. */
function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-test-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Ada Lovelace',
        GIT_AUTHOR_EMAIL: 'ada@example.com',
        GIT_COMMITTER_NAME: 'Ada Lovelace',
        GIT_COMMITTER_EMAIL: 'ada@example.com',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      },
    });
  git('init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'dir with space'));
  writeFileSync(join(dir, 'plain.txt'), 'a\nb\nc\n');
  writeFileSync(join(dir, 'dir with space', 'my file.txt'), 'a\nb\n');
  writeFileSync(join(dir, 'héllo wörld.md'), 'one\n');
  writeFileSync(join(dir, 'say "hi".txt'), 'x\ny\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  return { dir, git };
}

test('line counts come back under the same paths git ls-tree reports', async () => {
  const { dir } = scratchRepo();
  try {
    const tracked = await listFiles(dir);
    const counts = await currentLineCounts(dir);
    // git C-quotes non-ASCII and quoted names unless asked not to; those names
    // would then never match the raw ones and the files would silently vanish
    // from the treemap, the LOC total and the file count.
    for (const path of tracked) {
      assert.ok(counts.has(path), `no line count for ${JSON.stringify(path)}`);
    }
    assert.equal(counts.get('plain.txt'), 3);
    assert.equal(counts.get('dir with space/my file.txt'), 2);
    assert.equal(counts.get('héllo wörld.md'), 1);
    assert.equal(counts.get('say "hi".txt'), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('binary blobs are left out of the line counts', async () => {
  const { dir, git } = scratchRepo();
  try {
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 0, 3, 4]));
    git('add', '-A');
    git('commit', '-qm', 'binary');
    const counts = await currentLineCounts(dir);
    assert.equal(counts.has('blob.bin'), false);
    assert.equal(counts.get('plain.txt'), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
