#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { buildReport } from './index';
import type { CliOptions } from './types';
import { DEFAULT_EXCLUDES } from './util/glob';

const VERSION = '0.1.0';

const HELP = `chronicle ${VERSION} — turn a git repository into an interactive HTML story.

Usage
  chronicle [repo-path] [options]

Options
  -o, --out <file>        Output HTML file (default: chronicle.html)
      --since <date>      Only commits after this date (any git date: "2024-01-01", "6 months ago")
      --until <date>      Only commits before this date
      --max-commits <n>   Stop after n commits (newest first)
      --exclude <glob>    Extra path to ignore; repeatable
      --no-default-excludes
                          Drop the built-in ignore list (lockfiles, vendor, minified, node_modules…)
      --coupling-cap <n>  Ignore commits touching more than n files when computing
                          co-change pairs (default: 40)
      --title <name>      Override the project name in the report
      --narrate           Use Claude for the era narratives (needs ANTHROPIC_API_KEY;
                          silently falls back to the built-in narrator)
      --open              Open the report when it is written
  -q, --quiet             Only print the output path
  -h, --help              Show this help
  -v, --version           Print the version

Examples
  chronicle . -o report.html
  chronicle ~/src/linux --since "1 year ago" --max-commits 20000
  chronicle . --exclude "docs/**" --exclude "*.svg" --narrate
`;

export function parseArgs(argv: string[]): CliOptions | { help: true } | { version: true } {
  const out: CliOptions = {
    repo: '.',
    out: 'chronicle.html',
    exclude: [...DEFAULT_EXCLUDES],
    couplingCap: 40,
    narrate: false,
    open: false,
    quiet: false,
  };
  const extra: string[] = [];
  let useDefaults = true;
  let sawRepo = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '-h': case '--help': return { help: true };
      case '-v': case '--version': return { version: true };
      case '-o': case '--out': out.out = next(); break;
      case '--since': out.since = next(); break;
      case '--until': out.until = next(); break;
      case '--max-commits': {
        const n = Number(next());
        if (!Number.isFinite(n) || n <= 0) throw new Error('--max-commits needs a positive number');
        out.maxCommits = Math.floor(n);
        break;
      }
      case '--exclude': extra.push(next()); break;
      case '--no-default-excludes': useDefaults = false; break;
      case '--coupling-cap': {
        const n = Number(next());
        if (!Number.isFinite(n) || n < 2) throw new Error('--coupling-cap needs a number >= 2');
        out.couplingCap = Math.floor(n);
        break;
      }
      case '--title': out.title = next(); break;
      case '--narrate': out.narrate = true; break;
      case '--open': out.open = true; break;
      case '-q': case '--quiet': out.quiet = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`unknown option: ${a}`);
        if (sawRepo) throw new Error(`unexpected argument: ${a}`);
        out.repo = a;
        sawRepo = true;
    }
  }
  out.exclude = useDefaults ? [...DEFAULT_EXCLUDES, ...extra] : extra;
  return out;
}

async function main(): Promise<void> {
  let opts: CliOptions | { help: true } | { version: true };
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`chronicle: ${(e as Error).message}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  if ('help' in opts) { process.stdout.write(HELP); return; }
  if ('version' in opts) { process.stdout.write(`${VERSION}\n`); return; }

  const log = opts.quiet ? () => {} : (m: string) => process.stderr.write(`chronicle: ${m}\n`);
  try {
    const { report, html } = await buildReport(opts, log);
    const outPath = resolve(opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html, 'utf8');
    const kb = Math.round(Buffer.byteLength(html) / 1024);
    log(
      `wrote ${outPath} (${kb} KB) — ${report.hero.commits} commits, ` +
        `${report.eras.length} era(s), ${report.hero.authors} author(s), ${report.meta.tookMs} ms`,
    );
    if (opts.quiet) process.stdout.write(`${outPath}\n`);
    if (opts.open) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      spawn(cmd, [outPath], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    process.stderr.write(`chronicle: ${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}

void main();
