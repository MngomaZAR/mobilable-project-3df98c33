import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const typesFile = path.join(root, 'src', 'navigation', 'types.ts');
const navigatorFile = path.join(root, 'src', 'navigation', 'MainNavigator.tsx');

const dashboardFiles = {
  client: path.join(root, 'src', 'screens', 'HomeScreen.tsx'),
  photographer: path.join(root, 'src', 'screens', 'PhotographerDashboardScreen.tsx'),
  model: path.join(root, 'src', 'screens', 'ModelPremiumDashboard.tsx'),
  admin: path.join(root, 'src', 'screens', 'AdminDashboardScreen.tsx'),
};

const results = [];
const warnings = [];
const push = (name, ok, details = '') => results.push({ name, ok, details });
const warn = (name, details) => warnings.push({ name, details });

const extractTypeKeys = (content, typeName) => {
  const block = content.match(new RegExp(`export type ${typeName} = \\{([\\s\\S]*?)\\n\\};`));
  if (!block) return [];
  const keys = [];
  for (const m of block[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*:/gm)) {
    keys.push(m[1]);
  }
  return keys;
};

const collectNavigateTargets = (content) => {
  const direct = new Set();
  const rootTabs = new Set();

  for (const m of content.matchAll(/navigate\(\s*['"]([^'"]+)['"]/g)) {
    direct.add(m[1]);
  }

  for (const m of content.matchAll(/navigate\(\s*['"]Root['"]\s*,\s*\{[\s\S]*?screen:\s*['"]([^'"]+)['"]/g)) {
    rootTabs.add(m[1]);
  }

  return { direct: [...direct], rootTabs: [...rootTabs] };
};

const run = async () => {
  const [typesContent, navigatorContent] = await Promise.all([
    fs.readFile(typesFile, 'utf8'),
    fs.readFile(navigatorFile, 'utf8'),
  ]);

  const rootRoutes = new Set(extractTypeKeys(typesContent, 'RootStackParamList'));
  const tabRoutes = new Set(extractTypeKeys(typesContent, 'TabParamList'));

  push('Route contracts loaded', rootRoutes.size > 0 && tabRoutes.size > 0, `root=${rootRoutes.size} tab=${tabRoutes.size}`);

  const mappingChecks = [
    /role\s*===\s*'photographer'[\s\S]*\?\s*PhotographerDashboardScreen/m,
    /role\s*===\s*'model'[\s\S]*\?\s*ModelPremiumDashboard/m,
    /role\s*===\s*'admin'[\s\S]*\?\s*AdminDashboardScreen/m,
    /:\s*HomeScreen/m,
  ];
  const mappingOk = mappingChecks.every((rx) => rx.test(navigatorContent));
  push('Role to dashboard mapping', mappingOk, mappingOk ? 'client/photographer/model/admin mapped' : 'missing role mapping in MainNavigator');

  for (const [role, file] of Object.entries(dashboardFiles)) {
    const rel = path.relative(root, file);
    let content = '';
    try {
      content = await fs.readFile(file, 'utf8');
      push(`Dashboard file exists: ${role}`, true, rel);
    } catch {
      push(`Dashboard file exists: ${role}`, false, rel);
      continue;
    }

    const { direct, rootTabs } = collectNavigateTargets(content);
    push(`Dashboard navigation calls: ${role}`, direct.length > 0, `navigate_calls=${direct.length}`);

    const unknownRootRoutes = direct.filter(
      (route) => route !== 'Root' && !rootRoutes.has(route) && !tabRoutes.has(route)
    );
    push(
      `Dashboard stack routes valid: ${role}`,
      unknownRootRoutes.length === 0,
      unknownRootRoutes.length ? `unknown=${unknownRootRoutes.join(',')}` : `routes=${direct.join(',')}`
    );

    const unknownTabs = rootTabs.filter((tab) => !tabRoutes.has(tab));
    push(
      `Dashboard tab routes valid: ${role}`,
      unknownTabs.length === 0,
      unknownTabs.length ? `unknown_tabs=${unknownTabs.join(',')}` : `tabs=${rootTabs.join(',') || 'none'}`
    );

    const hasRoleDataHook = /useAppData\(/.test(content) || /useAuth\(/.test(content);
    if (!hasRoleDataHook) {
      warn(`Dashboard data hook warning: ${role}`, `${rel} has no useAppData/useAuth hook`);
    }
  }

  console.log(
    JSON.stringify(
      {
        summary: {
          total: results.length,
          failed: results.filter((r) => !r.ok).length,
          warnings: warnings.length,
        },
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
