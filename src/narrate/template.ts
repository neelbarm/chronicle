import type { Era, Report } from '../types';

/**
 * The template narrator. It has no model behind it — every sentence is chosen
 * from the numbers, and the phrasing rotates deterministically so a seven-era
 * report never reads like the same sentence seven times.
 */

const DAY = 86_400_000;

export function fmtDate(ts: number): string {
  if (!ts) return 'unknown';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function fmtMonth(ts: number): string {
  if (!ts) return 'unknown';
  return new Date(ts).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

export function joinList(items: string[], conj = 'and'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`;
}

export function humanSpan(ms: number): string {
  const days = Math.max(1, Math.round(ms / DAY));
  if (days < 14) return plural(days, 'day');
  if (days < 70) return plural(Math.round(days / 7), 'week');
  if (days < 730) return plural(Math.max(1, Math.round(days / 30.4)), 'month');
  const years = days / 365.25;
  return `${years.toFixed(1)} years`;
}

function pace(era: Era, prev: Era | undefined): { word: string; ratio: number } {
  if (!prev || prev.commitsPerWeek === 0) return { word: 'opening', ratio: 1 };
  const ratio = era.commitsPerWeek / prev.commitsPerWeek;
  if (ratio >= 2) return { word: 'a sharp acceleration', ratio };
  if (ratio >= 1.25) return { word: 'a step up in pace', ratio };
  if (ratio <= 0.4) return { word: 'a marked slowdown', ratio };
  if (ratio <= 0.8) return { word: 'a cooling off', ratio };
  return { word: 'a steady hand', ratio };
}

function niceDir(name: string): string {
  return name === '(root)' ? 'the repository root' : `\`${name}\``;
}

function labelFor(era: Era, prev: Era | undefined, isLast: boolean, total: number): string {
  const dir = era.dirs[0]?.name;
  const lang = era.languages[0]?.name;
  if (era.index === 0) return total === 1 ? 'The whole story' : 'Genesis';
  const p = pace(era, prev);
  if (p.ratio >= 2) return dir ? `The ${shortDir(dir)} surge` : 'Acceleration';
  if (p.ratio <= 0.4) return isLast ? 'Settling down' : 'The quiet stretch';
  if (dir && prev && prev.dirs[0]?.name !== dir) return `Into ${shortDir(dir)}`;
  if (isLast) return 'Where it stands';
  if (lang && prev && prev.languages[0]?.name !== lang) return `The ${lang} turn`;
  return `Chapter ${era.index + 1}`;
}

function shortDir(name: string): string {
  if (name === '(root)') return 'the root';
  const parts = name.split('/');
  return parts.length > 2 ? `${parts[0]}/…/${parts[parts.length - 1]}` : name;
}

const OPENERS = [
  (a: string, b: string) => `From ${a} to ${b},`,
  (a: string, b: string) => `Between ${a} and ${b},`,
  (a: string, b: string) => `Across ${a} to ${b},`,
  (a: string, b: string) => `${a} through ${b}:`,
];

/** Writes `label` and `narrative` into every era, and returns a repo summary. */
export function narrateTemplate(report: Report): Report {
  const eras = report.eras;
  eras.forEach((era, i) => {
    const prev = i > 0 ? eras[i - 1] : undefined;
    const isLast = i === eras.length - 1;
    era.label = labelFor(era, prev, isLast, eras.length);
    era.narrative = eraParagraph(era, prev, isLast, i);
  });
  report.summary = summaryParagraph(report);
  return report;
}

function eraParagraph(era: Era, prev: Era | undefined, isLast: boolean, i: number): string {
  const opener = OPENERS[i % OPENERS.length]!(fmtDate(era.startTs), fmtDate(era.endTs));
  const span = humanSpan(Math.max(DAY, era.endTs - era.startTs));
  const sentences: string[] = [];

  const authorNames = era.authors.slice(0, 3).map((a) => a.name);
  const lead = era.authors[0];
  const authorShare = lead && era.commits > 0 ? Math.round((lead.commits / era.commits) * 100) : 0;

  // A rate per week is meaningless for a chapter that lasted two afternoons.
  const showRate = era.endTs - era.startTs >= 14 * DAY;
  sentences.push(
    `${opener} ${span} of work produced ${plural(era.commits, 'commit')}` +
      (showRate ? ` (${era.commitsPerWeek.toLocaleString('en-US')} per week)` : '') +
      ` from ${plural(era.authors.length, 'contributor')}.`,
  );

  if (prev && showRate) {
    const p = pace(era, prev);
    sentences.push(
      `That is ${p.word} against the previous chapter's ${prev.commitsPerWeek} commits a week, ` +
        `peaking at ${plural(era.peakWeekCommits, 'commit')} in the busiest single week.`,
    );
  } else if (prev) {
    sentences.push(
      `${plural(era.added, 'line')} went in and ${era.removed.toLocaleString('en-US')} came out.`,
    );
  } else {
    sentences.push(
      `The busiest week of the period carried ${plural(era.peakWeekCommits, 'commit')}, ` +
        `and ${plural(era.added, 'line')} were added while ${era.removed.toLocaleString('en-US')} came out.`,
    );
  }

  if (era.dirs.length) {
    const dirs = era.dirs.slice(0, 3).map((d) => niceDir(d.name));
    const focus = era.dirs[0]!;
    const focusShare = era.commits > 0 ? Math.round((focus.commits / Math.max(1, era.commits)) * 100) : 0;
    sentences.push(
      `Attention sat on ${joinList(dirs)}` +
        (focusShare > 0 ? `, with ${niceDir(focus.name)} touched in roughly ${focusShare}% of the chapter's commits` : '') +
        '.',
    );
  }

  if (era.files.length) {
    const files = era.files.slice(0, 2).map((f) => `\`${f.path}\` (${plural(f.commits, 'edit')})`);
    sentences.push(`The centre of gravity was ${joinList(files)}.`);
  }

  if (lead && authorNames.length) {
    sentences.push(
      authorNames.length === 1
        ? `${lead.name} carried the whole chapter.`
        : `${joinList(authorNames)} did the bulk of it, ${lead.name} alone accounting for about ${authorShare}% of the commits.`,
    );
  }

  const langs = era.languages.filter((l) => l.lines > 0).slice(0, 2).map((l) => l.name);
  if (langs.length) {
    sentences.push(
      isLast
        ? `The code that survives from here is mostly ${joinList(langs)}.`
        : `Most of the new ground was broken in ${joinList(langs)}.`,
    );
  }

  return sentences.join(' ');
}

function summaryParagraph(report: Report): string {
  const h = report.hero;
  const span = humanSpan(Math.max(DAY, h.lastTs - h.firstTs));
  const cadence = h.spanDays > 0 ? (h.commits / Math.max(1, h.spanDays / 7)).toFixed(1) : String(h.commits);
  const topAuthor = report.authors[0];
  const share = topAuthor && h.commits ? Math.round((topAuthor.commits / h.commits) * 100) : 0;
  const hotspot = report.topFiles[0];
  const eraCount = report.eras.length;

  const parts = [
    `${report.meta.repoName} has been under development for ${span}, starting ${fmtMonth(h.firstTs)} ` +
      `and last touched ${fmtDate(h.lastTs)}.`,
    `${plural(h.commits, 'commit')} from ${plural(h.authors, 'author')} moved ` +
      `${plural(h.linesAdded + h.linesRemoved, 'line')} in and out of the tree, ` +
      `leaving ${plural(h.loc, 'line')} across ${plural(h.files, 'tracked file')} today.`,
    `Work landed on ${plural(h.activeDays, 'day')} at about ${cadence} commits a week, ` +
      `with a longest unbroken run of ${plural(h.longestStreak.days, 'day')}.`,
  ];
  if (topAuthor && h.authors > 1) {
    parts.push(
      `${topAuthor.name} is the most prolific contributor at ${share}% of commits, and the bus factor — ` +
        `the smallest group of people responsible for half of all the lines ever changed — is ${h.busFactor}.`,
    );
  } else if (topAuthor) {
    parts.push(`Every commit here belongs to ${topAuthor.name}, so the bus factor is ${h.busFactor}.`);
  }
  if (hotspot) {
    parts.push(
      `The single most-edited file is \`${hotspot.path}\` with ${plural(hotspot.commits, 'commit')} against it.`,
    );
  }
  parts.push(
    eraCount > 1
      ? `Chronicle reads this history as ${plural(eraCount, 'distinct era')}, detected from shifts in commit velocity and in which directories the work was happening.`
      : `The history is short enough to read as a single chapter.`,
  );
  return parts.join(' ');
}
