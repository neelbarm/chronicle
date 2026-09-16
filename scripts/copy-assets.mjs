#!/usr/bin/env node
// Copies the browser-side assets (plain JS + CSS, intentionally un-compiled) into dist/
// so the compiled CLI can inline them into the generated report.
import { mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'src', 'client');
const out = join(root, 'dist', 'client');

mkdirSync(out, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  copyFileSync(join(src, f), join(out, f));
  n++;
}
console.log(`copy-assets: ${n} client asset(s) -> dist/client`);
