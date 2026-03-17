import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const srcDir = path.join(root, 'src');
const screensDir = path.join(srcDir, 'screens');
const navFile = path.join(srcDir, 'navigation', 'MainNavigator.tsx');

const exts = ['.ts', '.tsx', '.js', '.jsx', '.json'];
const nonRouteScreenComponents = new Set(['CreatePremiumBox']);

const isSourceFile = (name) => /\.(ts|tsx|js|jsx)$/.test(name);

const walk = async (dir) => {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (isSourceFile(entry.name)) out.push(full);
  }
  return out;
};

const resolveImport = async (fromFile, importPath) => {
  if (!importPath.startsWith('.')) return { checked: false, exists: true };
  const base = path.resolve(path.dirname(fromFile), importPath);
  const candidates = [base, ...exts.map((e) => `${base}${e}`), ...exts.map((e) => path.join(base, `index${e}`))];
  for (const candidate of candidates) {
    try {
      const st = await fs.stat(candidate);
      if (st.isFile()) return { checked: true, exists: true, resolved: candidate };
    } catch {
      // continue
    }
  }
  return { checked: true, exists: false, resolved: candidates };
};

const collectImports = (content) => {
  const imports = [];
  const regexes = [
    /import\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const r of regexes) {
    let m;
    while ((m = r.exec(content)) !== null) imports.push(m[1]);
  }
  return imports;
};

const collectSupabaseContracts = (content) => {
  const tables = new Set();
  const functions = new Set();
  for (const m of content.matchAll(/\.from\('([a-zA-Z0-9_]+)'\)/g)) tables.add(m[1]);
  for (const m of content.matchAll(/functions\.invoke\('([a-zA-Z0-9\-]+)'/g)) functions.add(m[1]);
  return { tables: [...tables], functions: [...functions] };
};

const run = async () => {
  const results = [];
  const warnings = [];
  const push = (name, ok, details = '') => results.push({ name, ok, details });
  const warn = (name, details) => warnings.push({ name, details });

  const files = await walk(srcDir);
  push('Source file inventory', files.length > 0, `files=${files.length}`);

  let unresolvedCount = 0;
  const allTables = new Set();
  const allFunctions = new Set();
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    const imports = collectImports(content);
    for (const imp of imports) {
      const res = await resolveImport(file, imp);
      if (res.checked && !res.exists) {
        unresolvedCount += 1;
        warn('Unresolved import', `${path.relative(root, file)} -> ${imp}`);
      }
    }
    const { tables, functions } = collectSupabaseContracts(content);
    tables.forEach((t) => allTables.add(t));
    functions.forEach((f) => allFunctions.add(f));
  }
  push('Relative import resolution', unresolvedCount === 0, `unresolved=${unresolvedCount}`);

  // Screen registration audit (navigation reachability baseline)
  const screenFiles = (await fs.readdir(screensDir))
    .filter((f) => f.endsWith('.tsx'))
    .filter((f) => !nonRouteScreenComponents.has(f.replace(/\.tsx$/, '')));
  const navContent = await fs.readFile(navFile, 'utf8');
  let unreferencedScreens = 0;
  for (const screenFile of screenFiles) {
    const base = screenFile.replace(/\.tsx$/, '');
    if (!navContent.includes(base)) {
      unreferencedScreens += 1;
      warn('Unreferenced screen in MainNavigator', base);
    }
  }
  push('Screen registration (MainNavigator)', unreferencedScreens === 0, `unreferenced=${unreferencedScreens}`);

  push('Supabase table contracts found', allTables.size > 0, `tables=${allTables.size}`);
  push('Supabase function contracts found', allFunctions.size > 0, `functions=${allFunctions.size}`);

  console.log(
    JSON.stringify(
      {
        summary: {
          total: results.length,
          failed: results.filter((r) => !r.ok).length,
          warnings: warnings.length,
        },
        tables: [...allTables].sort(),
        functions: [...allFunctions].sort(),
        warnings,
        results,
      },
      null,
      2,
    ),
  );
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
};

run();
