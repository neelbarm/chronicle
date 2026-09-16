import type { AuthorStat, Commit, Era, FileStat, Report } from '../types';
import { authorColor, languageOf } from '../util/lang';
import { CoChangeCounter } from './coupling';
import { equalSegments, segmentEras, type WeekSignal } from './eras';
import { buildTree, collapseChains, layoutLevels, type LeafInput } from './treemap';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Calendar fields of the author's *local* clock, straight from the ISO text. */
export function localParts(iso: string): { y: number; m: number; d: number; hour: number } {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const hour = Number(iso.slice(11, 13));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    const dt = new Date(iso);
    return {
      y: dt.getUTCFullYear(),
      m: dt.getUTCMonth() + 1,
      d: dt.getUTCDate(),
      hour: dt.getUTCHours(),
    };
  }
  return { y, m, d, hour: Number.isFinite(hour) ? hour : 0 };
}

/** Monday 00:00 UTC of the week containing a local calendar date. */
export function weekStartOf(y: number, m: number, d: number): number {
  const t = Date.UTC(y, m - 1, d);
  const dow = new Date(t).getUTCDay(); // 0=Sun
  const back = (dow + 6) % 7; // Monday-based
  return t - back * DAY;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '(root)' : path.slice(0, i);
}

function topDirOf(path: string): string {
  const i = path.indexOf('/');
  return i < 0 ? '(root)' : path.slice(0, i);
}

function bump<K>(map: Map<K, number>, key: K, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function topN<K>(map: Map<K, number>, n: number): Array<[K, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
}

/** Minimum number of contributors covering half of all the lines changed. */
export function busFactor(shares: readonly number[]): number {
  const total = shares.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const sorted = [...shares].sort((a, b) => b - a);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i]!;
    if (acc >= total / 2) return i + 1;
  }
  return sorted.length;
}

interface FileAcc {
  commits: number;
  added: number;
  removed: number;
  firstTs: number;
  lastTs: number;
  authors: Map<string, number>;
}

interface AuthorAcc {
  commits: number;
  added: number;
  removed: number;
  firstTs: number;
  lastTs: number;
  email: string;
}

interface WeekAcc {
  commits: number;
  added: number;
  removed: number;
  authors: Map<string, number>;
  dirs: Map<string, number>;
  files: Map<string, number>;
  langs: Map<string, number>;
  firstTs: number;
  lastTs: number;
}

const MAX_WEEK_FILES = 3000;
/** Beyond this many commits a history is always long enough for weekly eras. */
const SHORT_HISTORY_LIMIT = 2000;

interface ShortCommit {
  ts: number;
  author: string;
  added: number;
  removed: number;
  dirs: string[];
  files: string[];
  langs: Array<[string, number]>;
}

export interface AggregateOptions {
  couplingCap: number;
  repoName: string;
  repoPath: string;
  filters: Report['meta']['filters'];
}

/**
 * Single-pass, constant-memory-per-commit aggregation. Everything the report
 * needs is derived from counters updated as commits stream past; the raw log is
 * never retained.
 */
export class Aggregator {
  private readonly files = new Map<string, FileAcc>();
  private readonly authors = new Map<string, AuthorAcc>();
  private readonly weeks = new Map<number, WeekAcc>();
  private readonly days = new Set<number>();
  private readonly heat: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  private readonly dirAuthors = new Map<string, Map<string, number>>();
  private readonly coupling: CoChangeCounter;
  private commits = 0;
  private merges = 0;
  private added = 0;
  private removed = 0;
  private firstTs = Number.POSITIVE_INFINITY;
  private lastTs = 0;
  /**
   * Per-commit digests, retained only while the history is small. Weekly
   * buckets cannot split a project whose entire life fits inside one week, so
   * short histories get segmented at commit granularity instead.
   */
  private shortCommits: ShortCommit[] | null = [];

  constructor(private readonly opts: AggregateOptions) {
    this.coupling = new CoChangeCounter({ capPerCommit: opts.couplingCap });
  }

  add(c: Commit): void {
    this.commits++;
    if (c.isMerge) this.merges++;
    if (c.ts > 0) {
      if (c.ts < this.firstTs) this.firstTs = c.ts;
      if (c.ts > this.lastTs) this.lastTs = c.ts;
    }
    if (this.shortCommits) {
      if (this.shortCommits.length >= SHORT_HISTORY_LIMIT) this.shortCommits = null;
      else {
        const langs = new Map<string, number>();
        for (const f of c.files) if (!f.binary) bump(langs, languageOf(f.path), f.added - f.removed);
        this.shortCommits.push({
          ts: c.ts,
          author: c.author,
          added: c.files.reduce((a, f) => a + f.added, 0),
          removed: c.files.reduce((a, f) => a + f.removed, 0),
          dirs: c.files.map((f) => dirOf(f.path)),
          files: c.files.map((f) => f.path),
          langs: [...langs.entries()],
        });
      }
    }

    const { y, m, d, hour } = localParts(c.date);
    const dayKey = Date.UTC(y, m - 1, d);
    this.days.add(dayKey);
    const dow = (new Date(dayKey).getUTCDay() + 6) % 7; // 0 = Monday
    this.heat[dow]![hour % 24]! += 1;

    const author = this.authors.get(c.author) ?? {
      commits: 0,
      added: 0,
      removed: 0,
      firstTs: c.ts,
      lastTs: c.ts,
      email: c.email,
    };
    author.commits++;
    author.firstTs = Math.min(author.firstTs, c.ts);
    author.lastTs = Math.max(author.lastTs, c.ts);
    this.authors.set(c.author, author);

    const ws = weekStartOf(y, m, d);
    let week = this.weeks.get(ws);
    if (!week) {
      week = {
        commits: 0,
        added: 0,
        removed: 0,
        authors: new Map(),
        dirs: new Map(),
        files: new Map(),
        langs: new Map(),
        firstTs: c.ts,
        lastTs: c.ts,
      };
      this.weeks.set(ws, week);
    }
    week.commits++;
    week.firstTs = Math.min(week.firstTs, c.ts);
    week.lastTs = Math.max(week.lastTs, c.ts);
    bump(week.authors, c.author);

    const paths: string[] = [];
    for (const f of c.files) {
      const lines = f.added + f.removed;
      this.added += f.added;
      this.removed += f.removed;
      author.added += f.added;
      author.removed += f.removed;
      week.added += f.added;
      week.removed += f.removed;

      let acc = this.files.get(f.path);
      if (!acc) {
        acc = { commits: 0, added: 0, removed: 0, firstTs: c.ts, lastTs: c.ts, authors: new Map() };
        this.files.set(f.path, acc);
      }
      acc.commits++;
      acc.added += f.added;
      acc.removed += f.removed;
      acc.firstTs = Math.min(acc.firstTs, c.ts);
      acc.lastTs = Math.max(acc.lastTs, c.ts);
      bump(acc.authors, c.author, lines || 1);

      const dir = dirOf(f.path);
      bump(week.dirs, dir);
      if (week.files.size < MAX_WEEK_FILES || week.files.has(f.path)) bump(week.files, f.path);
      if (!f.binary) bump(week.langs, languageOf(f.path), f.added - f.removed);

      const top = topDirOf(f.path);
      let da = this.dirAuthors.get(top);
      if (!da) {
        da = new Map();
        this.dirAuthors.set(top, da);
      }
      bump(da, c.author, lines);

      if (!f.binary) paths.push(f.path);
    }
    this.coupling.add(paths);
  }

  private authorStats(): AuthorStat[] {
    const list = [...this.authors.entries()]
      .map(([name, a]) => ({
        name,
        commits: a.commits,
        added: a.added,
        removed: a.removed,
        firstTs: a.firstTs,
        lastTs: a.lastTs,
        color: '',
      }))
      .sort((a, b) => b.commits - a.commits || b.added - a.added || a.name.localeCompare(b.name));
    list.forEach((a, i) => (a.color = authorColor(i)));
    return list;
  }

  private streak(): { days: number; startTs: number; endTs: number } {
    const days = [...this.days].sort((a, b) => a - b);
    let best = { days: 0, startTs: 0, endTs: 0 };
    let runStart = 0;
    let run = 0;
    for (let i = 0; i < days.length; i++) {
      if (i > 0 && days[i]! - days[i - 1]! === DAY) run++;
      else {
        run = 1;
        runStart = days[i]!;
      }
      if (run > best.days) best = { days: run, startTs: runStart, endTs: days[i]! };
    }
    return best;
  }

  /** Dense weekly signal (gaps filled with zero-commit weeks). */
  private weekSeries(): Array<{ ws: number; acc: WeekAcc | undefined }> {
    const keys = [...this.weeks.keys()].sort((a, b) => a - b);
    if (keys.length === 0) return [];
    const out: Array<{ ws: number; acc: WeekAcc | undefined }> = [];
    const last = keys[keys.length - 1]!;
    // Guard rail: a repo spanning 40 years would otherwise create 2000+ slots.
    const step = WEEK;
    for (let t = keys[0]!; t <= last; t += step) out.push({ ws: t, acc: this.weeks.get(t) });
    return out;
  }

  /**
   * Eras for histories shorter than six weeks: cut the commit list itself into
   * equal slices so even a weekend project reads as a beginning, a middle and
   * an end. Returns null when the per-commit digests were dropped.
   */
  private commitLevelEras(): Era[] | null {
    const list = this.shortCommits;
    if (!list || list.length < 2) return null;
    // git log is newest-first; the story runs the other way.
    const commits = [...list].sort((a, b) => a.ts - b.ts);
    const parts = Math.min(3, commits.length);
    const cuts = equalSegments(commits.length, parts);
    const ranges: Array<[number, number]> = [];
    let start = 0;
    for (const c of cuts) {
      ranges.push([start, c]);
      start = c;
    }
    ranges.push([start, commits.length]);

    const eras: Era[] = [];
    let idx = 0;
    for (const [a, b] of ranges) {
      if (b <= a) continue;
      const authors = new Map<string, number>();
      const dirs = new Map<string, number>();
      const files = new Map<string, number>();
      const langs = new Map<string, number>();
      let added = 0;
      let removed = 0;
      for (let i = a; i < b; i++) {
        const c = commits[i]!;
        added += c.added;
        removed += c.removed;
        bump(authors, c.author);
        for (const d of new Set(c.dirs)) bump(dirs, d);
        for (const f of new Set(c.files)) bump(files, f);
        for (const [k, v] of c.langs) bump(langs, k, v);
      }
      const startTs = commits[a]!.ts;
      const endTs = commits[b - 1]!.ts;
      const weeks = Math.max(1, (endTs - startTs) / WEEK);
      eras.push({
        index: idx++,
        startTs,
        endTs,
        commits: b - a,
        added,
        removed,
        authors: topN(authors, 6).map(([name, c]) => ({ name, commits: c })),
        dirs: topN(dirs, 6).map(([name, c]) => ({ name, commits: c })),
        files: topN(files, 6).map(([path, c]) => ({ path, commits: c })),
        languages: topN(langs, 5).map(([name, lines]) => ({ name, lines })),
        label: '',
        narrative: '',
        peakWeekCommits: b - a,
        commitsPerWeek: Math.round(((b - a) / weeks) * 10) / 10,
      });
    }
    return eras.length ? eras : null;
  }

  private buildEras(series: Array<{ ws: number; acc: WeekAcc | undefined }>): Era[] {
    const signal: WeekSignal[] = series.map((s) => ({
      weekStart: s.ws,
      commits: s.acc?.commits ?? 0,
      dirs: new Set(s.acc ? s.acc.dirs.keys() : []),
    }));

    let ranges: Array<[number, number]>;
    if (signal.length >= 6) {
      const cuts = segmentEras(signal, { minEras: 3, maxEras: 8 });
      ranges = [];
      let start = 0;
      for (const c of cuts) {
        ranges.push([start, c]);
        start = c;
      }
      ranges.push([start, signal.length]);
    } else {
      const byCommit = this.commitLevelEras();
      if (byCommit) return byCommit;
      ranges = [[0, signal.length]];
    }
    ranges = ranges.filter(([a, b]) => b > a);

    const eras: Era[] = [];
    let idx = 0;
    for (const [a, b] of ranges) {
      const authors = new Map<string, number>();
      const dirs = new Map<string, number>();
      const files = new Map<string, number>();
      const langs = new Map<string, number>();
      let commits = 0;
      let added = 0;
      let removed = 0;
      let peak = 0;
      let startTs = Number.POSITIVE_INFINITY;
      let endTs = 0;
      for (let i = a; i < b; i++) {
        const acc = series[i]!.acc;
        if (!acc) continue;
        commits += acc.commits;
        added += acc.added;
        removed += acc.removed;
        peak = Math.max(peak, acc.commits);
        startTs = Math.min(startTs, acc.firstTs);
        endTs = Math.max(endTs, acc.lastTs);
        for (const [k, v] of acc.authors) bump(authors, k, v);
        for (const [k, v] of acc.dirs) bump(dirs, k, v);
        for (const [k, v] of acc.files) bump(files, k, v);
        for (const [k, v] of acc.langs) bump(langs, k, v);
      }
      if (commits === 0) continue;
      const weeksSpan = Math.max(1, b - a);
      eras.push({
        index: idx++,
        startTs: Number.isFinite(startTs) ? startTs : series[a]!.ws,
        endTs: endTs || series[Math.min(b, series.length - 1)]!.ws,
        commits,
        added,
        removed,
        authors: topN(authors, 6).map(([name, c]) => ({ name, commits: c })),
        dirs: topN(dirs, 6).map(([name, c]) => ({ name, commits: c })),
        files: topN(files, 6).map(([path, c]) => ({ path, commits: c })),
        languages: topN(langs, 5).map(([name, lines]) => ({ name, lines })),
        label: '',
        narrative: '',
        peakWeekCommits: peak,
        commitsPerWeek: Math.round((commits / weeksSpan) * 10) / 10,
      });
    }
    if (eras.length === 0 && this.commits > 0) {
      eras.push({
        index: 0,
        startTs: this.firstTs,
        endTs: this.lastTs,
        commits: this.commits,
        added: this.added,
        removed: this.removed,
        authors: [],
        dirs: [],
        files: [],
        languages: [],
        label: '',
        narrative: '',
        peakWeekCommits: this.commits,
        commitsPerWeek: this.commits,
      });
    }
    return eras;
  }

  finish(currentLoc: Map<string, number>): Report {
    const series = this.weekSeries();
    const authors = this.authorStats();
    const authorIndex = new Map(authors.map((a) => [a.name, a] as const));

    /* ---- hotspots ---- */
    const leaves: LeafInput[] = [];
    let totalLoc = 0;
    for (const [path, loc] of currentLoc) {
      const acc = this.files.get(path);
      const top = acc ? topN(acc.authors, 1)[0] : undefined;
      totalLoc += loc;
      leaves.push({
        path,
        loc,
        churn: acc?.commits ?? 0,
        added: acc?.added ?? 0,
        removed: acc?.removed ?? 0,
        topAuthor: top ? top[0] : '',
        language: languageOf(path),
      });
    }
    const tree = collapseChains(buildTree(leaves, this.opts.repoName));
    const { layouts, maxChurn } = layoutLevels(tree);

    /* ---- growth ---- */
    const langTotals = new Map<string, number>();
    for (const s of series) {
      if (!s.acc) continue;
      for (const [k, v] of s.acc.langs) bump(langTotals, k, Math.abs(v));
    }
    const topLangs = topN(langTotals, 8).map(([k]) => k);
    const langSet = new Set(topLangs);
    const growthLangs = [...topLangs];
    if (langTotals.size > topLangs.length) growthLangs.push('Other');
    const running = new Array<number>(growthLangs.length).fill(0);
    const growthSeries: number[][] = [];
    for (const s of series) {
      if (s.acc) {
        for (const [lang, delta] of s.acc.langs) {
          const i = langSet.has(lang) ? growthLangs.indexOf(lang) : growthLangs.indexOf('Other');
          if (i >= 0) running[i] = Math.max(0, running[i]! + delta);
        }
      }
      growthSeries.push([s.ws, ...running.map((v) => Math.round(v))]);
    }

    /* ---- knowledge / bus factor ---- */
    const overallBus = busFactor(authors.map((a) => a.added + a.removed));
    const dirRows = [...this.dirAuthors.entries()]
      .map(([name, m]) => {
        const shares = topN(m, 12).map(([author, lines]) => ({ author, lines }));
        const lines = [...m.values()].reduce((a, b) => a + b, 0);
        return { name, lines, shares, busFactor: busFactor([...m.values()]) };
      })
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 14);

    /* ---- coupling ---- */
    const fileCommits = new Map<string, number>();
    for (const [p, acc] of this.files) fileCommits.set(p, acc.commits);
    let pairs = this.coupling.top(30, fileCommits);
    // A young repository has no pair that changed together twice yet; showing the
    // single-commit pairs beats showing an empty section.
    if (pairs.length === 0) pairs = this.coupling.top(30, fileCommits, 1);
    const nodeIndex = new Map<string, number>();
    const nodes: Report['coupling']['nodes'] = [];
    const ensureNode = (path: string): number => {
      const hit = nodeIndex.get(path);
      if (hit !== undefined) return hit;
      const id = nodes.length;
      nodeIndex.set(path, id);
      nodes.push({
        id: path,
        label: path.slice(path.lastIndexOf('/') + 1),
        dir: topDirOf(path),
        degree: 0,
        weight: fileCommits.get(path) ?? 1,
      });
      return id;
    };
    const edges = pairs.map((p) => {
      const s = ensureNode(p.a);
      const t = ensureNode(p.b);
      nodes[s]!.degree++;
      nodes[t]!.degree++;
      return { source: s, target: t, count: p.count, strength: p.strength };
    });

    /* ---- top files ---- */
    const topFiles: FileStat[] = [...this.files.entries()]
      .sort((a, b) => b[1].commits - a[1].commits || b[1].added - a[1].added)
      .slice(0, 40)
      .map(([path, acc]) => {
        const top = topN(acc.authors, 1)[0];
        return {
          path,
          commits: acc.commits,
          added: acc.added,
          removed: acc.removed,
          firstTs: acc.firstTs,
          lastTs: acc.lastTs,
          topAuthor: top ? top[0] : '',
          loc: currentLoc.get(path) ?? 0,
          language: languageOf(path),
        };
      });

    const eras = this.buildEras(series);
    const spanDays = this.lastTs > 0 ? Math.max(1, Math.round((this.lastTs - this.firstTs) / DAY)) : 0;

    void authorIndex;
    return {
      meta: {
        repoName: this.opts.repoName,
        repoPath: this.opts.repoPath,
        generatedAt: new Date().toISOString(),
        chronicleVersion: '0.1.0',
        tookMs: 0,
        narrator: 'template',
        filters: this.opts.filters,
      },
      hero: {
        commits: this.commits,
        mergeCommits: this.merges,
        authors: authors.length,
        firstTs: Number.isFinite(this.firstTs) ? this.firstTs : 0,
        lastTs: this.lastTs,
        loc: totalLoc,
        files: leaves.length,
        activeDays: this.days.size,
        spanDays,
        longestStreak: this.streak(),
        linesAdded: this.added,
        linesRemoved: this.removed,
        busFactor: overallBus,
      },
      rhythm: {
        heat: this.heat,
        maxHeat: Math.max(1, ...this.heat.flat()),
        weeks: series.map((s) => ({
          t: s.ws,
          commits: s.acc?.commits ?? 0,
          added: s.acc?.added ?? 0,
          removed: s.acc?.removed ?? 0,
        })),
      },
      growth: { languages: growthLangs, series: growthSeries },
      hotspots: { layouts, maxChurn: Math.max(1, maxChurn), totalLoc },
      knowledge: { busFactor: overallBus, authors: authors.slice(0, 24), dirs: dirRows },
      coupling: { pairs, nodes, edges },
      eras,
      authors,
      topFiles,
      summary: '',
    };
  }

  get couplingStats(): { skipped: number; considered: number; pairs: number } {
    return {
      skipped: this.coupling.skippedCommits,
      considered: this.coupling.consideredCommits,
      pairs: this.coupling.size,
    };
  }
}
