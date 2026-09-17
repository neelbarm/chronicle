import type { Commit, FileChange, ParseOptions } from '../types';
import { makeMatcher } from '../util/glob';

/** Record separator emitted by our --format string. */
export const REC = '\x1e';
/** Field separator inside the header line. */
export const FIELD = '\x1f';

/**
 * The exact --format git is asked for. Kept next to the parser so the two can
 * never drift apart.
 */
export const LOG_FORMAT = `${REC}%H${FIELD}%an${FIELD}%ae${FIELD}%aI${FIELD}%P${FIELD}%s`;

/**
 * Decodes a git "C-quoted" path (git quotes paths containing control chars,
 * quotes, backslashes or non-ASCII bytes when core.quotePath is on).
 */
export function unquotePath(raw: string): string {
  if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') return raw;
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') {
      // Re-encode as UTF-8 so octal escapes and literal text mix correctly.
      for (const b of Buffer.from(ch, 'utf8')) bytes.push(b);
      continue;
    }
    const next = body[++i];
    if (next === undefined) break;
    switch (next) {
      case 'n': bytes.push(10); break;
      case 't': bytes.push(9); break;
      case 'r': bytes.push(13); break;
      case 'b': bytes.push(8); break;
      case 'f': bytes.push(12); break;
      case 'v': bytes.push(11); break;
      case 'a': bytes.push(7); break;
      case '"': bytes.push(34); break;
      case '\\': bytes.push(92); break;
      default: {
        if (next >= '0' && next <= '7') {
          let oct = next;
          while (oct.length < 3 && body[i + 1] !== undefined && body[i + 1]! >= '0' && body[i + 1]! <= '7') {
            oct += body[++i]!;
          }
          bytes.push(parseInt(oct, 8) & 0xff);
        } else {
          for (const b of Buffer.from(next, 'utf8')) bytes.push(b);
        }
      }
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

export interface ParsedPath {
  path: string;
  from?: string;
}

/**
 * Index of the closing quote of a C-quoted token starting at position 0, or -1
 * when the field does not open with one.
 */
function quotedTokenEnd(s: string): number {
  if (s[0] !== '"') return -1;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '"') return i;
  }
  return -1;
}

/**
 * Splits the path column of a --numstat line, resolving git's two rename
 * spellings:
 *   `old.ts => new.ts`
 *   `src/{old => new}/file.ts`   (shared prefix/suffix factored out)
 *
 * When either side needs quoting git always uses the first spelling and quotes
 * each side on its own — `"öld.ts" => "nëw.ts"` — so the arrow has to be found
 * before anything is decoded. Unquoting the whole field first would strip the
 * outer pair of quotes and leave the inner ones stranded in the path.
 */
export function parsePathField(field: string): ParsedPath {
  const trimmed = field.trim();
  const q = quotedTokenEnd(trimmed);
  if (q > 0 && trimmed.startsWith(' => ', q + 1)) {
    return {
      path: normalizeSlashes(unquotePath(trimmed.slice(q + 5).trim())),
      from: normalizeSlashes(unquotePath(trimmed.slice(0, q + 1))),
    };
  }
  const raw = unquotePath(trimmed);
  const open = raw.indexOf('{');
  const arrowInBrace = open >= 0 ? raw.indexOf(' => ', open) : -1;
  const close = arrowInBrace >= 0 ? raw.indexOf('}', arrowInBrace) : -1;
  if (open >= 0 && arrowInBrace > open && close > arrowInBrace) {
    const prefix = raw.slice(0, open);
    const suffix = raw.slice(close + 1);
    const oldPart = raw.slice(open + 1, arrowInBrace);
    const newPart = raw.slice(arrowInBrace + 4, close);
    return {
      path: normalizeSlashes(prefix + newPart + suffix),
      from: normalizeSlashes(prefix + oldPart + suffix),
    };
  }
  const arrow = raw.indexOf(' => ');
  if (arrow > 0) {
    return {
      path: normalizeSlashes(unquotePath(raw.slice(arrow + 4).trim())),
      from: normalizeSlashes(unquotePath(raw.slice(0, arrow).trim())),
    };
  }
  return { path: normalizeSlashes(raw) };
}

function normalizeSlashes(p: string): string {
  return p.replace(/\/{2,}/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

/**
 * Incremental parser for `git log --numstat` output.
 *
 * Commits arrive newest-first, which is what lets us resolve renames *forward*:
 * when we meet `a.ts => b.ts` we know every earlier mention of `a.ts` is really
 * the file we call `b.ts` today, so historical churn lands on one identity.
 *
 * Nothing but a chunk-sized buffer and the rename alias table is retained, so
 * memory stays flat across repositories of any size.
 */
export class LogParser {
  private buf = '';
  private readonly aliases = new Map<string, string>();
  private readonly excluded: (path: string) => boolean;
  /** Commits seen, including ones whose files were entirely filtered out. */
  public commitCount = 0;

  constructor(opts: ParseOptions = {}) {
    this.excluded = makeMatcher(opts.exclude ?? []);
  }

  /** Current (post-rename) name for a historical path. */
  canonical(path: string): string {
    let p = path;
    const seen: string[] = [];
    for (let i = 0; i < 64; i++) {
      const next = this.aliases.get(p);
      if (next === undefined || next === p) break;
      seen.push(p);
      p = next;
    }
    // Path compression keeps long rename chains O(1) on the next lookup.
    for (const s of seen) this.aliases.set(s, p);
    return p;
  }

  push(chunk: string): Commit[] {
    this.buf += chunk;
    if (!this.buf.includes(REC)) return [];
    const parts = this.buf.split(REC);
    this.buf = parts.pop() ?? '';
    const out: Commit[] = [];
    for (const part of parts) {
      const c = this.record(part);
      if (c) out.push(c);
    }
    return out;
  }

  flush(): Commit[] {
    const rest = this.buf;
    this.buf = '';
    const c = rest ? this.record(rest) : null;
    return c ? [c] : [];
  }

  private record(rec: string): Commit | null {
    if (!rec.trim()) return null;
    const nl = rec.indexOf('\n');
    const header = nl < 0 ? rec : rec.slice(0, nl);
    const body = nl < 0 ? '' : rec.slice(nl + 1);
    const f = header.split(FIELD);
    if (f.length < 6 || !f[0]) return null;
    const [hash, author, email, date, parents] = f as [string, string, string, string, string];
    const subject = f.slice(5).join(FIELD);
    const parentList = parents.trim() ? parents.trim().split(/\s+/) : [];

    const files: FileChange[] = [];
    if (body) {
      for (const line of body.split('\n')) {
        if (!line) continue;
        const t1 = line.indexOf('\t');
        if (t1 < 0) continue;
        const t2 = line.indexOf('\t', t1 + 1);
        if (t2 < 0) continue;
        const aStr = line.slice(0, t1);
        const rStr = line.slice(t1 + 1, t2);
        const parsed = parsePathField(line.slice(t2 + 1));
        if (parsed.from) this.aliases.set(parsed.from, this.canonical(parsed.path));
        const path = this.canonical(parsed.path);
        if (this.excluded(path)) continue;
        const binary = aStr === '-' || rStr === '-';
        const change: FileChange = {
          path,
          rawPath: parsed.path,
          added: binary ? 0 : Number(aStr) || 0,
          removed: binary ? 0 : Number(rStr) || 0,
          binary,
        };
        if (parsed.from) change.renamedFrom = parsed.from;
        files.push(change);
      }
    }

    const ts = Date.parse(date);
    this.commitCount++;
    return {
      hash,
      author: author.trim() || '(unknown)',
      email: email.trim(),
      date,
      ts: Number.isFinite(ts) ? ts : 0,
      parents: parentList,
      subject,
      isMerge: parentList.length > 1,
      files,
    };
  }
}

/** Convenience wrapper used by the tests: parse a whole log in one go. */
export function parseLog(text: string, opts: ParseOptions = {}): Commit[] {
  const p = new LogParser(opts);
  return [...p.push(text), ...p.flush()];
}
