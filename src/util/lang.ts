/** Extension -> language mapping, plus a stable colour per language. */

const EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', pyi: 'Python',
  rb: 'Ruby', erb: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  java: 'Java', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala', groovy: 'Groovy',
  c: 'C', h: 'C', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++',
  m: 'Objective-C', mm: 'Objective-C',
  swift: 'Swift',
  php: 'PHP',
  cs: 'C#', fs: 'F#', vb: 'Visual Basic',
  ex: 'Elixir', exs: 'Elixir', erl: 'Erlang',
  hs: 'Haskell', ml: 'OCaml', clj: 'Clojure', cljs: 'Clojure',
  dart: 'Dart', lua: 'Lua', r: 'R', jl: 'Julia', zig: 'Zig', nim: 'Nim',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell', ps1: 'PowerShell',
  sql: 'SQL', graphql: 'GraphQL', gql: 'GraphQL', proto: 'Protobuf',
  html: 'HTML', htm: 'HTML', vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
  css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS', styl: 'CSS',
  json: 'Config', jsonc: 'Config', yaml: 'Config', yml: 'Config', toml: 'Config',
  ini: 'Config', cfg: 'Config', conf: 'Config', env: 'Config', properties: 'Config',
  xml: 'Markup', plist: 'Markup', svg: 'Markup',
  md: 'Docs', mdx: 'Docs', rst: 'Docs', txt: 'Docs', adoc: 'Docs',
  tf: 'Terraform', hcl: 'Terraform',
  dockerfile: 'Docker',
  gradle: 'Build', bazel: 'Build', bzl: 'Build', cmake: 'Build', mk: 'Build',
  ipynb: 'Notebook',
  csv: 'Data', tsv: 'Data', parquet: 'Data',
};

const FILENAME: Record<string, string> = {
  dockerfile: 'Docker',
  makefile: 'Build',
  rakefile: 'Ruby',
  gemfile: 'Ruby',
  procfile: 'Config',
  'cmakelists.txt': 'Build',
};

export function languageOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (FILENAME[base]) return FILENAME[base]!;
  if (base.startsWith('.') && !base.slice(1).includes('.')) return 'Config';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'Other';
  const ext = base.slice(dot + 1);
  return EXT[ext] ?? 'Other';
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#4f8cff',
  JavaScript: '#f0c14b',
  Python: '#3fb27f',
  Go: '#4fd1e0',
  Rust: '#f2803c',
  Java: '#e3703a',
  Kotlin: '#9b6bff',
  Swift: '#ff6b5e',
  'C++': '#7b8cff',
  C: '#8d99b4',
  'C#': '#6fbf73',
  Ruby: '#e14f5e',
  PHP: '#7a7fd1',
  HTML: '#ff7a59',
  CSS: '#4fb4ff',
  Vue: '#41b883',
  Svelte: '#ff5a3c',
  Shell: '#9ad14b',
  SQL: '#d68fff',
  Config: '#6b7690',
  Docs: '#b7c0d4',
  Markup: '#8fa2c8',
  Docker: '#3d8fe0',
  Terraform: '#a56bff',
  Build: '#c0a06a',
  Data: '#59c2a6',
  Notebook: '#f08c3a',
  Other: '#5a6478',
};

export function languageColor(name: string): string {
  if (LANG_COLORS[name]) return LANG_COLORS[name]!;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360} 62% 58%)`;
}

/**
 * Perceptually spread author colours: golden-angle hues with alternating
 * lightness so adjacent legend entries stay distinguishable.
 */
export function authorColor(index: number): string {
  const hue = (200 + index * 137.508) % 360;
  const sat = 62 + ((index * 13) % 18);
  const light = index % 3 === 0 ? 64 : index % 3 === 1 ? 56 : 71;
  return `hsl(${hue.toFixed(1)} ${sat}% ${light}%)`;
}
