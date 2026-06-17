#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const runtimeTargets = [
  'App.tsx',
  'app.config.js',
  'eas.json',
  'src',
  'supabase/config.toml',
  '.github/workflows/ios-testflight-no-eas.yml',
  '.github/workflows/eas-deploy-web.yml',
];

const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.yml', '.yaml', '.toml']);
const localEndpointPattern =
  /\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2|192\.168\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/[^\s'"`]*)?/gi;

const walkFiles = async (target) => {
  const absolute = path.join(root, target);
  const entries = [];
  const stat = await fs.stat(absolute).catch(() => null);
  if (!stat) return entries;
  if (stat.isFile()) return sourceExts.has(path.extname(absolute)) ? [absolute] : [];
  if (!stat.isDirectory()) return entries;

  for (const entry of await fs.readdir(absolute, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build', '.git'].includes(entry.name)) continue;
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) entries.push(...(await walkFiles(path.relative(root, child))));
    else if (sourceExts.has(path.extname(entry.name))) entries.push(child);
  }
  return entries;
};

const lineNumberForIndex = (content, index) => content.slice(0, index).split(/\r?\n/).length;

const files = [];
for (const target of runtimeTargets) files.push(...(await walkFiles(target)));

const findings = [];
for (const file of files) {
  const content = await fs.readFile(file, 'utf8');
  for (const match of content.matchAll(localEndpointPattern)) {
    findings.push({
      file: path.relative(root, file),
      line: lineNumberForIndex(content, match.index ?? 0),
      endpoint: match[0],
    });
  }
}

const result = {
  summary: {
    filesScanned: files.length,
    failed: findings.length,
  },
  findings,
};

console.log(JSON.stringify(result, null, 2));

if (findings.length > 0) {
  console.error('Release runtime audit failed: local endpoints are not allowed in app/runtime deployment paths.');
  process.exit(1);
}
