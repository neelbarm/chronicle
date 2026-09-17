import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { basename, resolve } from 'node:path';
import type { Commit, ParseOptions } from '../types';
import { LOG_FORMAT, LogParser } from './parse';

export class GitError extends Error {}

/** Runs git and buffers stdout. Used for small, bounded outputs only. */
export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.setEncoding('utf8');
    p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d: string) => (out += d));
    p.stderr.on('data', (d: string) => (err += d));
    p.on('error', (e) => rej(new GitError(`failed to run git: ${e.message}`)));
    p.on('close', (code) => {
      if (code === 0) res(out);
      else rej(new GitError(`git ${args.slice(0, 2).join(' ')} exited ${code}: ${err.trim() || 'no stderr'}`));
    });
  });
}

export async function resolveRepo(input: string): Promise<{ root: string; name: string }> {
  const dir = resolve(input);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new GitError(`${dir} is not a directory`);
  }
  const root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
  if (!root) throw new GitError(`${dir} is not inside a git repository`);
  let name = basename(root);
  try {
    const url = (await git(root, ['config', '--get', 'remote.origin.url'])).trim();
    if (url) {
      const m = /([^/:]+?)(?:\.git)?$/.exec(url.replace(/\/+$/, ''));
      if (m && m[1]) name = m[1];
    }
  } catch {
    /* no remote configured: the directory name is fine */
  }
  return { root, name };
}

export interface LogOptions extends ParseOptions {
  since?: string;
  until?: string;
  maxCommits?: number;
}

/**
 * Streams `git log --numstat` and yields commits as they are parsed. Back
 * pressure is handled by pausing stdout while the consumer works, so a 100k
 * commit repository never materialises in memory.
 */
export async function* streamCommits(root: string, opts: LogOptions): AsyncGenerator<Commit> {
  const args = [
    '--no-pager',
    'log',
    '--no-color',
    '--numstat',
    '--find-renames',
    '--no-textconv',
    `--format=${LOG_FORMAT}`,
  ];
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.until) args.push(`--until=${opts.until}`);
  if (opts.maxCommits && opts.maxCommits > 0) args.push(`--max-count=${opts.maxCommits}`);

  const child = spawn('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const parser = new LogParser(opts);
  const decoder = new StringDecoder('utf8');
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => {
    if (stderr.length < 4000) stderr += d;
  });

  const queue: Commit[] = [];
  let done = false;
  let failure: Error | null = null;
  let wake: (() => void) | null = null;
  const signal = () => {
    const w = wake;
    wake = null;
    if (w) w();
  };

  child.stdout.on('data', (buf: Buffer) => {
    try {
      const commits = parser.push(decoder.write(buf));
      if (commits.length) {
        queue.push(...commits);
        if (queue.length > 512) child.stdout.pause();
        signal();
      }
    } catch (e) {
      failure = e as Error;
      child.kill();
      signal();
    }
  });
  child.on('error', (e) => {
    failure = new GitError(`failed to run git log: ${e.message}`);
    done = true;
    signal();
  });
  child.on('close', (code) => {
    try {
      queue.push(...parser.flush());
    } catch (e) {
      failure = e as Error;
    }
    if (code !== 0 && code !== null && !failure) {
      failure = new GitError(`git log exited ${code}: ${stderr.trim() || 'no stderr'}`);
    }
    done = true;
    signal();
  });

  while (true) {
    if (queue.length === 0) {
      if (failure) throw failure;
      if (done) return;
      await new Promise<void>((r) => (wake = r));
      continue;
    }
    const batch = queue.splice(0, queue.length);
    if (child.stdout.isPaused()) child.stdout.resume();
    for (const c of batch) yield c;
  }
}

/**
 * Line counts for every text file in the commit `rev` points at.
 *
 * `git grep -I -c ''` matches every line of every file and reports `rev:path:count`
 * — one git process instead of tens of thousands of file reads, and it already
 * knows which blobs are binary. Reading the commit rather than the working tree
 * keeps the report consistent with the history it describes, whatever is
 * currently uncommitted on disk.
 *
 * `-z` is what makes the paths usable: without it git C-quotes any path with a
 * quote, a control character or a non-ASCII byte in it, and those names would
 * then never match the raw ones `git ls-tree -z` reports. With it each record is
 * `rev:path\0count\n`, so the path survives byte for byte.
 */
export async function currentLineCounts(root: string, rev = 'HEAD'): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await new Promise<void>((res, rej) => {
    const p = spawn('git', ['--no-pager', 'grep', '-I', '-c', '-z', '--no-color', '-e', '', rev, '--', '.'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const decoder = new StringDecoder('utf8');
    let buf = '';
    const drain = (final: boolean) => {
      for (;;) {
        const nul = buf.indexOf('\0');
        if (nul < 0) break;
        // The count runs from the NUL to the newline that ends the record. A
        // path may itself contain newlines, which is why the NUL leads.
        const nl = buf.indexOf('\n', nul);
        if (nl < 0 && !final) break;
        const end = nl < 0 ? buf.length : nl;
        let path = buf.slice(0, nul);
        const n = Number(buf.slice(nul + 1, end).trim());
        buf = buf.slice(end + 1);
        if (path.startsWith(rev + ':')) path = path.slice(rev.length + 1);
        if (path && Number.isFinite(n)) counts.set(path, n);
        if (nl < 0) break;
      }
    };
    p.stdout.on('data', (chunk: Buffer) => {
      buf += decoder.write(chunk);
      drain(false);
    });
    p.on('error', () => rej(new GitError('git grep failed')));
    p.on('close', () => {
      buf += decoder.end();
      drain(true);
      res();
    });
  });
  return counts;
}

/** Files in the commit `rev` points at (git grep skips empty files, ls-tree does not). */
export async function listFiles(root: string, rev = 'HEAD'): Promise<string[]> {
  const out = await git(root, ['--no-pager', 'ls-tree', '-r', '--name-only', '-z', rev]);
  return out.split('\0').filter(Boolean);
}
