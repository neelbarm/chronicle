import { Aggregator } from './analyze/aggregate';
import { currentLineCounts, listFiles, resolveRepo, streamCommits } from './git/run';
import { narrateWithClaude } from './narrate/claude';
import { narrateTemplate } from './narrate/template';
import { renderReport } from './report/render';
import type { CliOptions, Report } from './types';
import { makeMatcher } from './util/glob';

export { renderReport } from './report/render';
export { Aggregator } from './analyze/aggregate';
export { LogParser, parseLog } from './git/parse';
export * from './types';

export interface BuildResult {
  report: Report;
  html: string;
}

/** Runs the whole pipeline: git -> aggregate -> narrate -> HTML. */
export async function buildReport(
  opts: CliOptions,
  log: (msg: string) => void = () => {},
): Promise<BuildResult> {
  const started = Date.now();
  const { root, name } = await resolveRepo(opts.repo);
  log(`repository: ${name} (${root})`);

  const agg = new Aggregator({
    couplingCap: opts.couplingCap,
    repoName: opts.title ?? name,
    repoPath: root,
    filters: {
      since: opts.since,
      until: opts.until,
      maxCommits: opts.maxCommits,
      exclude: opts.exclude,
    },
  });

  let n = 0;
  for await (const commit of streamCommits(root, {
    exclude: opts.exclude,
    since: opts.since,
    until: opts.until,
    maxCommits: opts.maxCommits,
  })) {
    agg.add(commit);
    if (++n % 2000 === 0) log(`  parsed ${n.toLocaleString('en-US')} commits…`);
  }
  log(`parsed ${n.toLocaleString('en-US')} commits in ${Date.now() - started} ms`);
  if (n === 0) throw new Error('no commits matched — check --since / --max-commits, or the repo is empty');

  const excluded = makeMatcher(opts.exclude);
  const counts = await currentLineCounts(root);
  const tracked = await listFiles(root);
  const loc = new Map<string, number>();
  for (const f of tracked) {
    if (excluded(f)) continue;
    const c = counts.get(f);
    // Files git grep never reported are binary (or empty); keep only text files.
    if (c === undefined) continue;
    loc.set(f, c);
  }
  log(`measured ${loc.size.toLocaleString('en-US')} tracked text files`);

  const report = narrateTemplate(agg.finish(loc));

  if (opts.narrate) {
    const claude = await narrateWithClaude(report, log);
    if (claude) {
      claude.eras.forEach((e, i) => {
        const era = report.eras[i];
        if (!era) return;
        era.label = e.label;
        era.narrative = e.narrative;
      });
      report.meta.narrator = 'claude';
    }
  }

  const cs = agg.couplingStats;
  log(
    `coupling: ${cs.pairs.toLocaleString('en-US')} pairs from ${cs.considered.toLocaleString('en-US')} commits` +
      (cs.skipped ? ` (${cs.skipped} oversized commits skipped)` : ''),
  );
  report.meta.tookMs = Date.now() - started;
  const options = opts.title ? { title: opts.title } : {};
  return { report, html: renderReport(report, options) };
}
