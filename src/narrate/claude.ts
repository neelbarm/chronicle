import type { Report } from '../types';
import { fmtDate } from './template';

/**
 * Optional Claude narration.
 *
 * chronicle ships with zero runtime dependencies, so this talks to the Messages
 * API over plain `fetch` rather than pulling in the SDK. Every failure path —
 * missing key, network, rate limit, malformed JSON — returns `null`, and the
 * caller keeps the template narrative it already computed.
 */

/** Cheapest model that writes clean prose; the task is summarising numbers. */
const MODEL = 'claude-haiku-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 45_000;

const SYSTEM = [
  'You are a software archaeologist writing the story of a codebase for its own team.',
  'You are given precomputed statistics for consecutive eras of a git history.',
  'For each era, write a short label (2-4 words, no quotes) and a narrative of 3-5 sentences.',
  'Rules: use only the numbers you are given; never invent features, people, or motives you cannot',
  'see in the data; write plainly, no marketing tone, no bullet points, no headings; refer to files and',
  'directories in backticks. Vary sentence openings between eras.',
  'Respond with JSON only: {"eras":[{"label":"...","narrative":"..."}]} with exactly one entry per era, in order.',
].join(' ');

function erasPrompt(report: Report): string {
  const lines: string[] = [
    `Repository: ${report.meta.repoName}`,
    `Whole history: ${report.hero.commits} commits, ${report.hero.authors} authors, ` +
      `${fmtDate(report.hero.firstTs)} to ${fmtDate(report.hero.lastTs)}, ` +
      `${report.hero.loc} lines of code today across ${report.hero.files} files.`,
    '',
  ];
  report.eras.forEach((era, i) => {
    lines.push(
      `Era ${i + 1}: ${fmtDate(era.startTs)} to ${fmtDate(era.endTs)}`,
      `  commits: ${era.commits} (${era.commitsPerWeek}/week, busiest week ${era.peakWeekCommits})`,
      `  lines: +${era.added} / -${era.removed}`,
      `  authors: ${era.authors.map((a) => `${a.name} (${a.commits})`).join(', ') || 'none'}`,
      `  directories: ${era.dirs.map((d) => `${d.name} (${d.commits})`).join(', ') || 'none'}`,
      `  files: ${era.files.map((f) => `${f.path} (${f.commits})`).join(', ') || 'none'}`,
      `  languages by net lines: ${era.languages.map((l) => `${l.name} (${l.lines})`).join(', ') || 'none'}`,
      '',
    );
  });
  return lines.join('\n');
}

/** Pulls the first balanced JSON object out of a model response. */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface NarrateResult {
  eras: Array<{ label: string; narrative: string }>;
}

/**
 * Returns Claude-written era narratives, or `null` if narration is unavailable
 * for any reason. Never throws.
 */
export async function narrateWithClaude(
  report: Report,
  log: (msg: string) => void = () => {},
): Promise<NarrateResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    log('--narrate: ANTHROPIC_API_KEY is not set, keeping the template narrative');
    return null;
  }
  if (report.eras.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: 'user', content: erasPrompt(report) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log(`--narrate: Claude returned HTTP ${res.status}, keeping the template narrative`);
      return null;
    }
    const body = (await res.json()) as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string }>;
    };
    if (body.stop_reason === 'refusal') {
      log('--narrate: the request was declined, keeping the template narrative');
      return null;
    }
    const text = (body.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('\n');
    const parsed = extractJson(text) as { eras?: Array<{ label?: unknown; narrative?: unknown }> } | null;
    const eras = parsed?.eras;
    if (!Array.isArray(eras) || eras.length !== report.eras.length) {
      log('--narrate: unexpected response shape, keeping the template narrative');
      return null;
    }
    const cleaned = eras.map((e, i) => ({
      label: typeof e.label === 'string' && e.label.trim() ? e.label.trim().slice(0, 48) : report.eras[i]!.label,
      narrative:
        typeof e.narrative === 'string' && e.narrative.trim().length > 40
          ? e.narrative.trim()
          : report.eras[i]!.narrative,
    }));
    log(`--narrate: Claude (${MODEL}) wrote ${cleaned.length} era narratives`);
    return { eras: cleaned };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`--narrate: ${msg}; keeping the template narrative`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
