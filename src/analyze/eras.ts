/**
 * Era detection: split a project's timeline into 3-8 phases by looking for
 * change points in a combined signal.
 *
 * Two things mark a new chapter in a codebase:
 *   1. the pace changes (a sprint starts, the project goes quiet);
 *   2. the *place* changes (work moves from `parser/` to `web/`).
 *
 * We score every week boundary on both — normalised velocity delta, and the
 * Jaccard distance between the directory sets touched on either side — then
 * greedily accept the strongest boundaries subject to a minimum era width.
 */

export interface WeekSignal {
  /** Monday of the week, epoch ms. */
  weekStart: number;
  commits: number;
  /** Directories touched during the week. */
  dirs: Set<string>;
}

export interface SegmentOptions {
  minEras?: number;
  maxEras?: number;
  /** Half-width, in weeks, of the comparison windows. */
  window?: number;
  /** Weight of the directory-shift term (velocity gets the remainder). */
  jaccardWeight?: number;
}

export interface Boundary {
  index: number;
  score: number;
  jaccard: number;
  velocity: number;
}

function jaccardDistance(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  if (a.size === 0 || b.size === 0) return 1;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) if (large.has(v)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : 1 - inter / union;
}

function unionOf(weeks: WeekSignal[], from: number, to: number): Set<string> {
  const s = new Set<string>();
  for (let i = Math.max(0, from); i < Math.min(weeks.length, to); i++) {
    for (const d of weeks[i]!.dirs) s.add(d);
  }
  return s;
}

function mean(weeks: WeekSignal[], from: number, to: number): number {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, from); i < Math.min(weeks.length, to); i++) {
    sum += weeks[i]!.commits;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/** Per-week change-point scores. Exposed for tests and for the timeline UI. */
export function boundaryScores(weeks: WeekSignal[], opts: SegmentOptions = {}): Boundary[] {
  const n = weeks.length;
  const w = Math.max(2, Math.min(opts.window ?? Math.round(n * 0.08), 10));
  const jw = opts.jaccardWeight ?? 0.6;
  const vw = 1 - jw;
  const out: Boundary[] = [];
  for (let i = 1; i < n; i++) {
    const jac = jaccardDistance(unionOf(weeks, i - w, i), unionOf(weeks, i, i + w));
    const vl = mean(weeks, i - w, i);
    const vr = mean(weeks, i, i + w);
    const vel = Math.abs(vl - vr) / (vl + vr + 1);
    let score = jw * jac + vw * vel;

    // A stretch of silence is the most legible chapter break there is.
    let gap = 0;
    for (let k = i - 1; k >= 0 && weeks[k]!.commits === 0; k--) gap++;
    if (gap >= 3 && weeks[i]!.commits > 0) score += Math.min(0.35, 0.08 * gap);

    out.push({ index: i, score, jaccard: jac, velocity: vel });
  }
  return out;
}

/**
 * Returns the week indices at which a new era begins (never includes 0).
 */
export function segmentEras(weeks: WeekSignal[], opts: SegmentOptions = {}): number[] {
  const n = weeks.length;
  const minEras = Math.max(1, opts.minEras ?? 3);
  const maxEras = Math.max(minEras, opts.maxEras ?? 8);
  if (n < 3) return [];

  const minGap = Math.max(1, Math.floor(n / (maxEras + 1)));
  const scores = boundaryScores(weeks, opts).filter((b) => b.index >= minGap && n - b.index >= minGap);
  if (scores.length === 0) return [];

  const vals = scores.map((s) => s.score);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - avg) ** 2, 0) / vals.length);
  const threshold = avg + 0.45 * sd;

  const ranked = [...scores].sort((a, b) => b.score - a.score);
  const chosen: number[] = [];
  const fits = (i: number) => chosen.every((c) => Math.abs(c - i) >= minGap);

  for (const cand of ranked) {
    if (chosen.length >= maxEras - 1) break;
    // A perfectly flat signal has nothing to say: stop once the minimum is met.
    if (chosen.length >= minEras - 1 && (cand.score <= 1e-6 || cand.score < threshold)) break;
    if (!fits(cand.index)) continue;
    chosen.push(cand.index);
  }
  // Guarantee the minimum era count when the history is long enough to carry it.
  if (chosen.length < minEras - 1 && n >= minEras * minGap) {
    for (const cand of ranked) {
      if (chosen.length >= minEras - 1) break;
      if (fits(cand.index)) chosen.push(cand.index);
    }
  }
  return chosen.sort((a, b) => a - b);
}

/**
 * Fallback for histories too short for week-level statistics: cut the commit
 * list into equal slices.
 */
export function equalSegments(count: number, parts: number): number[] {
  const p = Math.max(1, Math.min(parts, count));
  const out: number[] = [];
  for (let i = 1; i < p; i++) out.push(Math.round((i * count) / p));
  return [...new Set(out)].filter((i) => i > 0 && i < count);
}
