import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '../types';

function asset(name: string): string {
  return readFileSync(join(__dirname, '..', 'client', name), 'utf8');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

/**
 * Embeds JSON in a <script> without letting any string close the tag early.
 * Also strips the U+2028/U+2029 line separators, which are literal newlines
 * inside JS string literals.
 */
function embedJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

const SECTIONS: Array<{ id: string; nav: string; title: string; lede: string }> = [
  { id: 'eras', nav: 'Eras', title: 'Chapters', lede: 'Every project has phases. These were found, not declared.' },
  { id: 'rhythm', nav: 'Rhythm', title: 'The rhythm of the work', lede: 'When the commits actually happened.' },
  { id: 'growth', nav: 'Growth', title: 'How it grew', lede: 'Lines of code by language, accumulated week by week.' },
  { id: 'hotspots', nav: 'Hotspots', title: 'Where the heat is', lede: 'Size is code today. Colour is how often it changed.' },
  { id: 'knowledge', nav: 'Knowledge', title: 'Who knows what', lede: 'Ownership by directory, and how thin it is spread.' },
  { id: 'coupling', nav: 'Coupling', title: 'What moves together', lede: 'Files that keep being edited in the same commit.' },
  { id: 'story', nav: 'Story', title: 'The story', lede: 'The whole history, written out.' },
];

export function renderReport(report: Report, opts: { title?: string } = {}): string {
  const title = opts.title ?? `${report.meta.repoName} — chronicle`;
  const nav = SECTIONS.map(
    (s) => `<a class="nav-link" href="#${s.id}" data-nav="${s.id}">${escapeHtml(s.nav)}</a>`,
  ).join('');

  const section = (id: string, inner: string): string => {
    const s = SECTIONS.find((x) => x.id === id)!;
    return `<section class="section" id="${id}">
  <header class="section-head reveal">
    <p class="eyebrow">${escapeHtml(s.nav)}</p>
    <h2>${escapeHtml(s.title)}</h2>
    <p class="lede">${escapeHtml(s.lede)}</p>
  </header>
  ${inner}
</section>`;
  };

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="generator" content="chronicle ${escapeHtml(report.meta.chronicleVersion)}">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230a0c12'/%3E%3Cpath d='M8 22V10h3l5 8 5-8h3v12' stroke='%234f8cff' stroke-width='2.5' fill='none' stroke-linejoin='round'/%3E%3C/svg%3E">
<style>
${asset('styles.css')}
</style>
</head>
<body>
<div class="grain" aria-hidden="true"></div>
<div class="aurora" aria-hidden="true"><span></span><span></span><span></span></div>

<nav class="topnav" id="topnav">
  <div class="topnav-inner">
    <a class="brand" href="#top"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">${escapeHtml(report.meta.repoName)}</span></a>
    <div class="nav-links">${nav}</div>
    <span class="nav-meta">chronicle</span>
  </div>
  <div class="scroll-progress"><i id="progressBar"></i></div>
</nav>

<main id="top">
  <header class="hero" id="hero">
    <div class="hero-inner">
      <p class="hero-eyebrow reveal">A git history, read end to end</p>
      <h1 class="hero-title reveal" id="heroTitle">${escapeHtml(report.meta.repoName)}</h1>
      <p class="hero-dates reveal" id="heroDates"></p>
      <div class="hero-stats" id="heroStats"></div>
      <p class="hero-summary reveal" id="heroSummary"></p>
      <a class="scroll-cue reveal" href="#eras" aria-label="Scroll to the chapters"><span></span></a>
    </div>
  </header>

${section(
  'eras',
  `<div class="era-band reveal" id="eraBand"></div>
   <div class="era-cards" id="eraCards"></div>`,
)}

${section(
  'rhythm',
  `<div class="panel reveal">
     <div class="panel-head"><h3>Weekday and hour</h3><p>Local time of each commit's author.</p></div>
     <div class="heatmap-wrap"><div id="heatmap" class="heatmap"></div></div>
   </div>
   <div class="panel reveal">
     <div class="panel-head"><h3>Commits per week</h3><p>Every week between the first and last commit.</p></div>
     <div class="chart" id="velocityChart"></div>
   </div>`,
)}

${section(
  'growth',
  `<div class="panel reveal">
     <div class="panel-head"><h3>Lines of code by language</h3><p>Accumulated from every diff, week by week.</p></div>
     <div class="chart" id="growthChart"></div>
     <div class="legend" id="growthLegend"></div>
   </div>`,
)}

${section(
  'hotspots',
  `<div class="panel reveal">
     <div class="panel-head">
       <h3>Treemap of the tree today</h3>
       <p>Click a directory to go in. <span class="crumbs" id="treemapCrumbs"></span></p>
     </div>
     <div class="treemap-wrap"><div class="treemap" id="treemap"></div></div>
     <div class="churn-scale" id="churnScale"></div>
   </div>`,
)}

${section(
  'knowledge',
  `<div class="stat-row reveal" id="busRow"></div>
   <div class="panel reveal">
     <div class="panel-head"><h3>Ownership by directory</h3><p>Share of lines changed, per top-level directory.</p></div>
     <div id="ownership" class="ownership"></div>
     <div class="legend" id="authorLegend"></div>
   </div>`,
)}

${section(
  'coupling',
  `<div class="panel reveal">
     <div class="panel-head"><h3>Co-change graph</h3><p>The 30 strongest pairs. Drag a node.</p></div>
     <div class="graph-wrap"><svg id="graph" class="graph"></svg></div>
   </div>
   <div class="panel reveal">
     <div class="panel-head"><h3>The pairs</h3><p>Strength is co-changes over the commits of the rarer file.</p></div>
     <div class="table-wrap"><table class="table" id="couplingTable"></table></div>
   </div>`,
)}

${section('story', `<div class="story" id="story"></div>`)}

  <footer class="footer">
    <p>Generated by <strong>chronicle</strong> on ${escapeHtml(new Date(report.meta.generatedAt).toUTCString())}
    from <code>${escapeHtml(report.meta.repoPath)}</code> in ${report.meta.tookMs} ms.</p>
    <p class="footer-dim">Narration: ${report.meta.narrator === 'claude' ? 'Claude' : 'built-in template engine'}.
    Excludes ${report.meta.filters.exclude.length} path pattern(s).${
      report.meta.filters.since ? ` Since ${escapeHtml(report.meta.filters.since)}.` : ''
    }${report.meta.filters.maxCommits ? ` Capped at ${report.meta.filters.maxCommits} commits.` : ''}</p>
  </footer>
</main>

<div class="tooltip" id="tooltip" role="status" aria-live="polite"></div>

<script type="application/json" id="chronicle-data">${embedJson(report)}</script>
<script>
${asset('app.js')}
</script>
</body>
</html>
`;
}
