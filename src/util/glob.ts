/**
 * Tiny glob engine. Supports `*`, `**`, `?`, `{a,b}` and character classes,
 * matched against POSIX-style repo-relative paths.
 *
 * A pattern with no `/` also matches any basename (so `*.min.js` works without
 * the caller writing `**\/*.min.js`).
 */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  let i = 0;
  const p = pattern;
  while (i < p.length) {
    const c = p[i]!;
    if (c === '*') {
      if (p[i + 1] === '*') {
        // `**/` swallows any number of directories (including none).
        if (p[i + 2] === '/') {
          re += '(?:.*\\/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '{') {
      const end = p.indexOf('}', i);
      if (end < 0) {
        re += '\\{';
        i += 1;
      } else {
        const alts = p.slice(i + 1, end).split(',');
        re += '(?:' + alts.map((a) => globToRegExp(a).source.replace(/^\^|\$$/g, '')).join('|') + ')';
        i = end + 1;
      }
    } else if (c === '[') {
      const end = p.indexOf(']', i + 1);
      if (end < 0) {
        re += '\\[';
        i += 1;
      } else {
        re += p.slice(i, end + 1);
        i = end + 1;
      }
    } else {
      re += c.replace(/[.+^$(){}|\\\/]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp('^' + re + '$');
}

export function makeMatcher(patterns: string[]): (path: string) => boolean {
  if (patterns.length === 0) return () => false;
  const exact: RegExp[] = [];
  const basename: RegExp[] = [];
  for (const pat of patterns) {
    const trimmed = pat.trim();
    if (!trimmed) continue;
    const re = globToRegExp(trimmed);
    if (trimmed.includes('/')) exact.push(re);
    else {
      exact.push(globToRegExp('**/' + trimmed));
      basename.push(re);
    }
    // A bare directory name should also cover everything beneath it.
    if (!trimmed.includes('*') && !trimmed.includes('.')) {
      exact.push(globToRegExp('**/' + trimmed + '/**'));
    }
  }
  return (path: string) => {
    for (const re of exact) if (re.test(path)) return true;
    if (basename.length) {
      const base = path.slice(path.lastIndexOf('/') + 1);
      for (const re of basename) if (re.test(base)) return true;
    }
    return false;
  };
}

export const DEFAULT_EXCLUDES: string[] = [
  'node_modules/**',
  '**/node_modules/**',
  'vendor/**',
  '**/vendor/**',
  'third_party/**',
  '**/third_party/**',
  'dist/**',
  '**/dist/**',
  'build/**',
  '**/build/**',
  'out/**',
  '.next/**',
  'target/**',
  'Pods/**',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
  'composer.lock',
  'Gemfile.lock',
  'go.sum',
  '*.lock',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.snap',
  '*.pb.go',
  '*_pb2.py',
  '**/__snapshots__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/site-packages/**',
  '**/coverage/**',
  '**/.yarn/**',
];
