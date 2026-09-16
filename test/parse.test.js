'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LogParser, parseLog, parsePathField, unquotePath } = require('../dist/git/parse');

const REC = '\x1e';
const F = '\x1f';

/** Builds one `git log --numstat` record the way git prints it. */
function rec(hash, author, date, parents, subject, numstat) {
  return REC + [hash, author, author.toLowerCase().replace(/ /g, '.') + '@example.com', date, parents, subject].join(F) +
    '\n\n' + (numstat.length ? numstat.join('\n') + '\n' : '');
}

/* Newest-first, exactly as git emits it. */
const FIXTURE =
  rec('a1', 'Ada Lovelace', '2024-06-03T09:15:00+02:00', 'a0', 'Rename the parser', [
    '12\t7\tsrc/{parser => reader}.ts',
    '0\t0\tnotes.txt => docs/notes.txt',
  ]) +
  rec('a0', 'Grace Hopper', '2024-05-30T23:05:00-04:00', '9f 8e', 'Merge branch feature', []) +
  rec('9f', 'Ada Lovelace', '2024-05-29T14:00:00+02:00', '7c', 'Add assets and vendored code', [
    '-\t-\tassets/logo.png',
    '5\t1\tsrc/parser.ts',
    '9000\t0\tnode_modules/left-pad/index.js',
    '3\t3\t"src/caf\\303\\251 \\t weird.ts"',
  ]) +
  rec('7c', 'Grace Hopper', '2024-05-28T08:00:00+00:00', '', 'Empty commit', []);

test('parses every commit, including empty and merge commits', () => {
  const commits = parseLog(FIXTURE);
  assert.equal(commits.length, 4);
  assert.deepEqual(commits.map((c) => c.hash), ['a1', 'a0', '9f', '7c']);

  const merge = commits[1];
  assert.equal(merge.isMerge, true);
  assert.deepEqual(merge.parents, ['9f', '8e']);
  assert.deepEqual(merge.files, []);

  const empty = commits[3];
  assert.equal(empty.isMerge, false);
  assert.deepEqual(empty.parents, []);
  assert.deepEqual(empty.files, []);
});

test('resolves renames forward so history lands on the current path', () => {
  const commits = parseLog(FIXTURE);
  const renamed = commits[0].files[0];
  assert.equal(renamed.path, 'src/reader.ts');
  assert.equal(renamed.renamedFrom, 'src/parser.ts');
  assert.equal(renamed.added, 12);
  assert.equal(renamed.removed, 7);

  // The older commit touched src/parser.ts; it must be attributed to src/reader.ts.
  const older = commits[2].files.find((f) => f.path === 'src/reader.ts');
  assert.ok(older, 'historical path should be canonicalised to the new name');
  assert.equal(older.rawPath, 'src/parser.ts');
  assert.equal(older.added, 5);
});

test('handles the plain `old => new` rename spelling', () => {
  const commits = parseLog(FIXTURE);
  const moved = commits[0].files[1];
  assert.equal(moved.path, 'docs/notes.txt');
  assert.equal(moved.renamedFrom, 'notes.txt');
});

test('flags binary files and gives them no line counts', () => {
  const commits = parseLog(FIXTURE);
  const bin = commits[2].files.find((f) => f.path === 'assets/logo.png');
  assert.equal(bin.binary, true);
  assert.equal(bin.added, 0);
  assert.equal(bin.removed, 0);
});

test('decodes C-quoted paths with octal escapes', () => {
  assert.equal(unquotePath('"src/caf\\303\\251 \\t weird.ts"'), 'src/café \t weird.ts');
  assert.equal(unquotePath('plain/path.ts'), 'plain/path.ts');
  const commits = parseLog(FIXTURE);
  assert.ok(commits[2].files.some((f) => f.path === 'src/café \t weird.ts'));
});

test('applies exclude globs to the canonical path', () => {
  const commits = parseLog(FIXTURE, { exclude: ['node_modules/**'] });
  const all = commits.flatMap((c) => c.files.map((f) => f.path));
  assert.ok(!all.some((p) => p.startsWith('node_modules/')));
  // Without the filter it is present.
  assert.ok(parseLog(FIXTURE).some((c) => c.files.some((f) => f.path.startsWith('node_modules/'))));
});

test('path field parsing covers both brace forms and no-rename paths', () => {
  assert.deepEqual(parsePathField('src/{a => b}/file.ts'), { path: 'src/b/file.ts', from: 'src/a/file.ts' });
  assert.deepEqual(parsePathField('{ => src}/file.ts'), { path: 'src/file.ts', from: 'file.ts' });
  assert.deepEqual(parsePathField('src/plain.ts'), { path: 'src/plain.ts' });
  assert.deepEqual(parsePathField('a.txt => b.txt'), { path: 'b.txt', from: 'a.txt' });
});

test('streaming in arbitrary chunks yields identical results', () => {
  const whole = parseLog(FIXTURE);
  for (const size of [1, 7, 64, 997]) {
    const p = new LogParser();
    const out = [];
    for (let i = 0; i < FIXTURE.length; i += size) out.push(...p.push(FIXTURE.slice(i, i + size)));
    out.push(...p.flush());
    assert.deepEqual(
      out.map((c) => [c.hash, c.files.map((f) => f.path + ':' + f.added)]),
      whole.map((c) => [c.hash, c.files.map((f) => f.path + ':' + f.added)]),
      `chunk size ${size}`,
    );
  }
});

test('parses author, date and subject fields', () => {
  const [head] = parseLog(FIXTURE);
  assert.equal(head.author, 'Ada Lovelace');
  assert.equal(head.email, 'ada.lovelace@example.com');
  assert.equal(head.subject, 'Rename the parser');
  assert.equal(head.ts, Date.parse('2024-06-03T09:15:00+02:00'));
});
