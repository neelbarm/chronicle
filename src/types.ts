/** Shared types for chronicle. */

export interface FileChange {
  /** Path as it is known *today* (renames resolved forward). */
  path: string;
  /** Path recorded in this commit, before rename resolution. */
  rawPath: string;
  added: number;
  removed: number;
  binary: boolean;
  renamedFrom?: string;
}

export interface Commit {
  hash: string;
  author: string;
  email: string;
  /** ISO-8601 author date with offset, exactly as git printed it. */
  date: string;
  /** Epoch milliseconds of the author date. */
  ts: number;
  parents: string[];
  subject: string;
  isMerge: boolean;
  files: FileChange[];
}

export interface ParseOptions {
  /** Paths matching any of these globs are dropped from `files`. */
  exclude?: string[];
}

export interface CliOptions {
  repo: string;
  out: string;
  since?: string;
  until?: string;
  maxCommits?: number;
  exclude: string[];
  couplingCap: number;
  narrate: boolean;
  open: boolean;
  quiet: boolean;
  title?: string;
}

/* ---------- aggregate model handed to the renderer ---------- */

export interface AuthorStat {
  name: string;
  commits: number;
  added: number;
  removed: number;
  firstTs: number;
  lastTs: number;
  color: string;
}

export interface FileStat {
  path: string;
  commits: number;
  added: number;
  removed: number;
  firstTs: number;
  lastTs: number;
  /** Author -> lines touched, only kept for the top files. */
  topAuthor: string;
  loc: number;
  language: string;
}

export interface WeekBucket {
  /** Monday of the week, epoch ms (UTC). */
  weekStart: number;
  commits: number;
  added: number;
  removed: number;
  authors: string[];
  dirs: string[];
}

export interface Era {
  index: number;
  startTs: number;
  endTs: number;
  commits: number;
  added: number;
  removed: number;
  authors: Array<{ name: string; commits: number }>;
  dirs: Array<{ name: string; commits: number }>;
  files: Array<{ path: string; commits: number }>;
  languages: Array<{ name: string; lines: number }>;
  label: string;
  narrative: string;
  peakWeekCommits: number;
  commitsPerWeek: number;
}

export interface TreeNode {
  name: string;
  path: string;
  /** Current lines of code in this subtree. */
  loc: number;
  /** Commits touching anything in this subtree. */
  churn: number;
  /** Leaf files in this subtree (1 for a leaf). */
  fileCount: number;
  children?: TreeNode[];
  /** Leaf-only extras. */
  added?: number;
  removed?: number;
  topAuthor?: string;
  language?: string;
}

export interface TreemapRect {
  path: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  loc: number;
  churn: number;
  /** Churn per file — what the colour scale uses, so directories stay comparable to files. */
  heat: number;
  isDir: boolean;
  added?: number;
  removed?: number;
  topAuthor?: string;
  language?: string;
  childCount?: number;
}

export interface CouplingPair {
  a: string;
  b: string;
  count: number;
  /** count / min(commits(a), commits(b)) */
  strength: number;
}

export interface Report {
  meta: {
    repoName: string;
    repoPath: string;
    generatedAt: string;
    chronicleVersion: string;
    tookMs: number;
    narrator: 'template' | 'claude';
    filters: { since?: string; until?: string; maxCommits?: number; exclude: string[] };
  };
  hero: {
    commits: number;
    mergeCommits: number;
    authors: number;
    firstTs: number;
    lastTs: number;
    loc: number;
    files: number;
    activeDays: number;
    spanDays: number;
    longestStreak: { days: number; startTs: number; endTs: number };
    linesAdded: number;
    linesRemoved: number;
    busFactor: number;
  };
  rhythm: {
    /** 7 rows (Mon..Sun) x 24 cols, commit counts in local repo time. */
    heat: number[][];
    maxHeat: number;
    weeks: Array<{ t: number; commits: number; added: number; removed: number }>;
  };
  growth: {
    languages: string[];
    /** One row per week: [weekStart, loc_lang0, loc_lang1, ...] cumulative. */
    series: number[][];
  };
  hotspots: {
    /** dirPath -> child rects laid out in the unit square. */
    layouts: Record<string, TreemapRect[]>;
    maxChurn: number;
    totalLoc: number;
  };
  knowledge: {
    busFactor: number;
    authors: AuthorStat[];
    dirs: Array<{
      name: string;
      lines: number;
      shares: Array<{ author: string; lines: number }>;
      busFactor: number;
    }>;
  };
  coupling: {
    pairs: CouplingPair[];
    nodes: Array<{ id: string; label: string; dir: string; degree: number; weight: number }>;
    edges: Array<{ source: number; target: number; count: number; strength: number }>;
  };
  eras: Era[];
  authors: AuthorStat[];
  topFiles: FileStat[];
  /** Opening paragraph of the story, written from the aggregate stats. */
  summary: string;
}
