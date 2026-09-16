#!/usr/bin/env node
/**
 * `npm run demo` — builds the two example reports shipped in examples/.
 * Every repository is read strictly read-only (chronicle only ever runs
 * `git log`, `git ls-files`, `git grep` and `git rev-parse`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'cli.js');
const outDir = join(root, 'examples');
mkdirSync(outDir, { recursive: true });

const targets = [
  { repo: join(homedir(), 'projects', 'mixpilot'), out: join(outDir, 'mixpilot.html') },
  { repo: root, out: join(outDir, 'chronicle.html') },
];

let failed = 0;
for (const t of targets) {
  if (!existsSync(join(t.repo, '.git'))) {
    console.error(`demo: skipping ${t.repo} (not a git repository on this machine)`);
    continue;
  }
  const args = [cli, t.repo, '-o', t.out];
  if (process.argv.includes('--narrate')) args.push('--narrate');
  const res = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (res.status !== 0) {
    failed++;
    continue;
  }
  const kb = Math.round(statSync(t.out).size / 1024);
  console.log(`demo: ${resolve(t.out)} (${kb} KB)`);
}

if (failed) {
  console.error(`demo: ${failed} report(s) failed`);
  process.exit(1);
}
console.log('demo: open examples/*.html in any browser — they are fully self-contained.');
