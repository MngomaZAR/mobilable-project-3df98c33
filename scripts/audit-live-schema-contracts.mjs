#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { loadLocalEnv } from './lib/load-env-file.mjs';

loadLocalEnv();

const root = process.cwd();
const apiProvider = (process.env.EXPO_PUBLIC_BACKEND_PROVIDER || 'api') === 'api';
const scanRoots = apiProvider ? ['src'] : ['src', 'supabase/functions'];
const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx']);
const ignoredColumns = new Set(['*', 'count']);
const knownNestedObjectKeys = new Set([
  'null',
  'providerId',
  'requestedLat',
  'requestedLng',
  'accuracy',
  'fanout_count',
  'intensity_level',
  'offer_count',
  'offer_id',
]);

const normalizeColumn = (value) =>
  value
    .trim()
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/::[a-zA-Z0-9_ .]+$/g, '')
    .trim();

const walk = async (dir) => {
  const absolute = path.join(root, dir);
  const out = [];
  const entries = await fs.readdir(absolute, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(absolute, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path.relative(root, full))));
    else if (sourceExts.has(path.extname(entry.name))) out.push(full);
  }
  return out;
};

const lineNumberForIndex = (content, index) => content.slice(0, index).split(/\r?\n/).length;

const splitTopLevel = (value) => {
  const parts = [];
  let current = '';
  let depth = 0;
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
};

const collectSelectColumns = (selectBody) => {
  const cols = new Set();
  for (const rawPart of splitTopLevel(selectBody)) {
    let part = normalizeColumn(rawPart);
    if (!part || part.includes('(') || part.includes(')')) continue;
    if (part.includes(':')) part = part.split(':').pop();
    if (part.includes('.')) part = part.split('.').pop();
    if (ignoredColumns.has(part)) continue;
    cols.add(part);
  }
  return cols;
};

const extractObjectKeys = (objectBody) => {
  const keys = new Set();
  const withoutComments = objectBody
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  let inString = null;
  let token = '';
  let expectingKey = true;

  for (let i = 0; i < withoutComments.length; i += 1) {
    const char = withoutComments[i];
    const prev = withoutComments[i - 1];

    if (inString) {
      if (char === inString && prev !== '\\') inString = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = char;
      token = '';
      continue;
    }

    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      token = '';
      expectingKey = false;
      continue;
    }

    if (char === '}' || char === ']' || char === ')') {
      depth = Math.max(0, depth - 1);
      token = '';
      expectingKey = false;
      continue;
    }

    if (depth === 0 && char === ',') {
      token = '';
      expectingKey = true;
      continue;
    }

    if (depth === 0 && expectingKey && /[a-zA-Z0-9_]/.test(char)) {
      token += char;
      continue;
    }

    if (depth === 0 && expectingKey && char === ':' && token) {
      keys.add(token);
      token = '';
      expectingKey = false;
      continue;
    }

    if (!/\s/.test(char)) token = '';
  }
  return keys;
};

const collectApiContracts = async () => {
  const contracts = new Map();
  for (const file of await walk('src')) {
    const source = ts.createSourceFile(file, await fs.readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const variables = new Map();
    const index = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer);
      ts.forEachChild(node, index);
    };
    index(source);
    const resolve = (node, seen = new Set()) => {
      if (node && ts.isIdentifier(node) && variables.has(node.text) && !seen.has(node.text)) {
        return resolve(variables.get(node.text), new Set([...seen, node.text]));
      }
      return node;
    };
    const literal = node => {
      const value = resolve(node);
      return value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) ? value.text : null;
    };
    const tables = node => {
      if (!node || !ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return [];
      if (node.expression.name.text === 'from') {
        const name = literal(node.arguments[0]);
        if (name) return [name];
        // The mobile role switch uses the same provider contract for both tables.
        if (/talent|photographer|model|getTalentTable/i.test(node.arguments[0]?.getText(source) || '')) return ['photographers', 'models'];
        return [];
      }
      return tables(node.expression.expression);
    };
    const add = (table, column, node, usage) => {
      if (!contracts.has(table)) contracts.set(table, new Map());
      if (!column || ignoredColumns.has(column)) return;
      const cols = contracts.get(table);
      if (!cols.has(column)) cols.set(column, []);
      cols.get(column).push({ usage, file: path.relative(root, file), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    };
    const objectKeys = node => {
      node = resolve(node);
      if (!node) return [];
      if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(objectKeys);
      if (!ts.isObjectLiteralExpression(node)) return [];
      return node.properties.flatMap(prop => ts.isSpreadAssignment(prop) ? objectKeys(prop.expression) : prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? [prop.name.text] : []);
    };
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        for (const table of tables(node)) {
          add(table, null, node, method);
          if (method === 'select') for (const column of collectSelectColumns(literal(node.arguments[0]) || '')) add(table, column, node, 'select');
          if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'order', 'is', 'ilike'].includes(method)) add(table, literal(node.arguments[0]), node, method);
          if (['insert', 'update', 'upsert', 'match'].includes(method)) for (const column of objectKeys(node.arguments[0])) add(table, column, node, method);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return contracts;
};

const collectContracts = async () => {
  if (apiProvider) return collectApiContracts();
  const contracts = new Map();
  const ensure = (table) => {
    if (!contracts.has(table)) contracts.set(table, new Map());
    return contracts.get(table);
  };
  const add = (table, column, usage, file, line) => {
    if (!table || !column || ignoredColumns.has(column)) return;
    if (knownNestedObjectKeys.has(column)) return;
    const columns = ensure(table);
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column).push({ usage, file: path.relative(root, file), line });
  };

  const files = [];
  for (const scanRoot of scanRoots) files.push(...(await walk(scanRoot)));

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');

    const tableRegex = /\.from\(\s*['"]([a-zA-Z0-9_]+)['"]\s*\)/g;
    for (const tableMatch of content.matchAll(tableRegex)) {
      const table = tableMatch[1];
      ensure(table);
      const start = tableMatch.index ?? 0;
      const nextFrom = content.indexOf('.from(', start + 6);
      const chain = content.slice(start, nextFrom === -1 ? Math.min(content.length, start + 5000) : nextFrom);

      for (const selectMatch of chain.matchAll(/\.select\(\s*`([\s\S]*?)`\s*\)|\.select\(\s*['"]([^'"]*)['"]\s*\)/g)) {
        const selectBody = selectMatch[1] ?? selectMatch[2] ?? '';
        for (const column of collectSelectColumns(selectBody)) {
          add(table, column, 'select', file, lineNumberForIndex(content, start + (selectMatch.index ?? 0)));
        }
      }

      for (const filterMatch of chain.matchAll(/\.(?:eq|neq|gt|gte|lt|lte|in|contains|containedBy|order)\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) {
        add(table, filterMatch[1], 'filter/order', file, lineNumberForIndex(content, start + (filterMatch.index ?? 0)));
      }

      for (const writeMatch of chain.matchAll(/\.(?:insert|update|upsert)\(\s*(?:\[\s*)?\{([\s\S]*?)\}\s*(?:\])?/g)) {
        for (const column of extractObjectKeys(writeMatch[1])) {
          add(table, column, 'write', file, lineNumberForIndex(content, start + (writeMatch.index ?? 0)));
        }
      }
    }
  }

  return contracts;
};

const loadLiveSchema = async () => {
  if (apiProvider) {
    const url = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (!url) throw new Error('EXPO_PUBLIC_API_BASE_URL is required to audit the deployed API database.');
    const response = await fetch(`${url.replace(/\/+$/, '')}/health/contract`, { signal: AbortSignal.timeout(20000) });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(`Deployed API contract failed: HTTP ${response.status}`);
    const schema = new Map();
    for (const [table, columns] of Object.entries(body.tables || {})) {
      schema.set(table, new Set(Array.isArray(columns) ? columns : columns.columns || Object.keys(columns)));
    }
    if (!schema.size) throw new Error('Deployed API did not return its database schema.');
    return schema;
  }
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY');

  const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`OpenAPI schema fetch failed: ${response.status}`);
  const openApi = await response.json();
  const definitions = openApi.definitions || openApi.components?.schemas || {};
  const schema = new Map();
  for (const [table, definition] of Object.entries(definitions)) {
    schema.set(table, new Set(Object.keys(definition?.properties ?? {})));
  }
  return schema;
};

const contracts = await collectContracts();
if (process.argv.includes('--export-contract')) {
  const contract = Object.fromEntries([...contracts].map(([table, columns]) => [table, [...columns.keys()].sort()]));
  await fs.writeFile(path.join(root, 'backend/api/app/mobile_schema_contract.json'), `${JSON.stringify(contract, null, 2)}\n`);
  console.log(`Exported source contract for ${contracts.size} tables. Review before using it in migrations.`);
  process.exit(0);
}
const liveSchema = await loadLiveSchema();
const findings = [];

for (const [table, columns] of contracts.entries()) {
  const liveColumns = liveSchema.get(table);
  if (!liveColumns) {
    findings.push({ table, column: null, issue: 'missing_table', examples: [...columns.values()].flat().slice(0, 5) });
    continue;
  }
  for (const [column, examples] of columns.entries()) {
    if (!liveColumns.has(column)) {
      findings.push({ table, column, issue: 'missing_column', examples: examples.slice(0, 5) });
    }
  }
}

console.log(
  JSON.stringify(
    {
      summary: {
        tablesReferenced: contracts.size,
        liveTables: liveSchema.size,
        findings: findings.length,
      },
      findings,
    },
    null,
    2,
  ),
);

process.exit(findings.length ? 1 : 0);
