#!/usr/bin/env node
/**
 * Repository analysis utility.
 *
 * Generates a consolidated report covering:
 * 1. Recursive file listings for key source directories.
 * 2. ESLint-powered unused export detection.
 * 3. Duplicate function/constant name checks.
 * 4. React useEffect dependency array validation.
 * 5. Supabase real-time subscription coverage.
 */

const fs = require('fs/promises');
const path = require('path');
const { ESLint } = require('eslint');
const ts = require('typescript');

const ROOT_DIR = process.cwd();
const TARGET_DIRECTORIES = [
  'src/components',
  'src/screens',
  'src/hooks',
  'src/context',
  'src/utils',
  'src/integrations',
];
const ANALYZED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const SUPABASE_COMPONENT_DIRS = new Set(['src/components', 'src/screens']);

async function main() {
  try {
    const { directoryReports, fileRecords } = await gatherDirectoryInfo();
    const analyzableRecords = fileRecords.filter(({ absolute }) =>
      ANALYZED_EXTENSIONS.has(path.extname(absolute).toLowerCase())
    );

    const fileLoader = createSourceFileLoader();

    const lintReport = await detectUnusedExports(analyzableRecords.map((record) => record.absolute));
    const duplicateSymbols = await findDuplicateNames(analyzableRecords, fileLoader.getSourceFile);
    const missingEffectDeps = await findMissingEffectDependencies(analyzableRecords, fileLoader.getSourceFile);
    const supabaseReport = await evaluateSupabaseSubscriptions(analyzableRecords, fileLoader.readText);

    const report = {
      generatedAt: new Date().toISOString(),
      directories: directoryReports,
      duplicateSymbols,
      missingUseEffectDependencies: missingEffectDeps,
      supabaseSubscriptions: supabaseReport,
      unusedExportFindings: lintReport.issues,
    };

    if (lintReport.error) {
      report.unusedExportError = lintReport.error;
    }

    printReport(report);
  } catch (error) {
    console.error('Repository analysis failed:', error);
    process.exitCode = 1;
  }
}

async function gatherDirectoryInfo() {
  const directoryReports = [];
  const fileRecords = [];

  for (const directory of TARGET_DIRECTORIES) {
    const absoluteDir = path.join(ROOT_DIR, directory);
    const exists = await pathExists(absoluteDir);

    if (!exists) {
      directoryReports.push({
        directory,
        exists: false,
        files: [],
        fileCount: 0,
      });
      continue;
    }

    const absoluteFiles = await listFilesRecursively(absoluteDir);
    absoluteFiles.sort();
    const relativeFiles = absoluteFiles.map((filePath) => toPosixPath(path.relative(ROOT_DIR, filePath)));

    directoryReports.push({
      directory,
      exists: true,
      files: relativeFiles,
      fileCount: relativeFiles.length,
    });

    for (let i = 0; i < absoluteFiles.length; i += 1) {
      fileRecords.push({
        absolute: absoluteFiles[i],
        relative: relativeFiles[i],
        baseDirectory: directory,
      });
    }
  }

  return { directoryReports, fileRecords };
}

async function detectUnusedExports(absoluteFiles) {
  if (!absoluteFiles.length) {
    return { issues: [], note: 'No analyzable files found.' };
  }

  try {
    const eslint = new ESLint({
      useEslintrc: false,
      errorOnUnmatchedPattern: false,
      baseConfig: {
        parser: '@typescript-eslint/parser',
        parserOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
          ecmaFeatures: { jsx: true },
        },
        env: { es2021: true, browser: true, node: true },
        plugins: ['import'],
        settings: {
          'import/resolver': {
            node: {
              extensions: ['.js', '.jsx', '.ts', '.tsx'],
            },
          },
        },
        rules: {
          'import/no-unused-modules': ['error', { unusedExports: true }],
        },
      },
    });

    const lintResults = await eslint.lintFiles(absoluteFiles);
    const issues = [];

    lintResults.forEach((result) => {
      result.messages
        .filter((message) => message.ruleId === 'import/no-unused-modules')
        .forEach((message) => {
          issues.push({
            file: toPosixPath(path.relative(ROOT_DIR, result.filePath)),
            line: message.line,
            column: message.column,
            message: message.message,
          });
        });
    });

    return { issues };
  } catch (error) {
    return { issues: [], error: error.message };
  }
}

async function findDuplicateNames(records, getSourceFile) {
  const symbolMap = new Map();

  for (const record of records) {
    const sourceFile = await getSourceFile(record.absolute);
    const symbols = extractTopLevelSymbols(sourceFile);

    symbols.forEach((symbol) => {
      if (!symbolMap.has(symbol.name)) {
        symbolMap.set(symbol.name, []);
      }

      symbolMap.get(symbol.name).push({
        file: record.relative,
        kind: symbol.kind,
        exported: symbol.exported,
        line: symbol.line,
        column: symbol.column,
      });
    });
  }

  const duplicates = [];
  symbolMap.forEach((occurrences, name) => {
    const uniqueFiles = new Set(occurrences.map((item) => item.file));
    if (uniqueFiles.size > 1) {
      duplicates.push({ name, occurrences });
    }
  });

  return duplicates.sort((a, b) => a.name.localeCompare(b.name));
}

async function findMissingEffectDependencies(records, getSourceFile) {
  const issues = [];

  for (const record of records) {
    const sourceFile = await getSourceFile(record.absolute);
    const fileIssues = [];

    const visit = (node) => {
      if (ts.isCallExpression(node) && isUseEffectCall(node.expression)) {
        const hasDependencyArray = node.arguments.length >= 2 && ts.isArrayLiteralExpression(node.arguments[1]);

        if (!hasDependencyArray) {
          const location = getNodeLocation(sourceFile, node.expression);
          fileIssues.push({
            component: findNearestComponentName(node),
            line: location.line,
            column: location.column,
          });
        }
      }

      node.forEachChild(visit);
    };

    visit(sourceFile);

    if (fileIssues.length) {
      issues.push({
        file: record.relative,
        hooks: fileIssues,
      });
    }
  }

  return issues;
}

async function evaluateSupabaseSubscriptions(records, readText) {
  const filesOfInterest = records.filter((record) => SUPABASE_COMPONENT_DIRS.has(record.baseDirectory));
  const withSubscriptions = [];
  const withoutSubscriptions = [];

  for (const record of filesOfInterest) {
    const fileContents = await readText(record.absolute);
    const hasSubscription = /supabase\s*\.\s*from\s*\([^)]*\)\s*\.on/gi.test(fileContents);

    if (hasSubscription) {
      withSubscriptions.push(record.relative);
    } else {
      withoutSubscriptions.push(record.relative);
    }
  }

  return {
    filesChecked: filesOfInterest.length,
    withSubscriptions: withSubscriptions.sort(),
    withoutSubscriptions: withoutSubscriptions.sort(),
  };
}

function createSourceFileLoader() {
  const textCache = new Map();
  const sourceFileCache = new Map();

  const readText = async (filePath) => {
    if (!textCache.has(filePath)) {
      const text = await fs.readFile(filePath, 'utf8');
      textCache.set(filePath, text);
    }

    return textCache.get(filePath);
  };

  const getSourceFile = async (filePath) => {
    if (!sourceFileCache.has(filePath)) {
      const text = await readText(filePath);
      const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, getScriptKind(filePath));
      sourceFileCache.set(filePath, sourceFile);
    }

    return sourceFileCache.get(filePath);
  };

  return { readText, getSourceFile };
}

async function listFilesRecursively(startDir) {
  const discovered = [];
  const entries = await fs.readdir(startDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(startDir, entry.name);

    if (entry.isDirectory()) {
      const nestedFiles = await listFilesRecursively(entryPath);
      discovered.push(...nestedFiles);
    } else if (entry.isFile()) {
      discovered.push(entryPath);
    }
  }

  return discovered;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function extractTopLevelSymbols(sourceFile) {
  const symbols = [];

  const recordSymbol = (name, kind, exported, node) => {
    const location = getNodeLocation(sourceFile, node);
    symbols.push({ name, kind, exported, line: location.line, column: location.column });
  };

  sourceFile.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      recordSymbol(node.name.text, 'function', hasExportModifier(node), node.name);
      return;
    }

    if (ts.isVariableStatement(node)) {
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) === ts.NodeFlags.Const;
      if (!isConst) {
        return;
      }

      const exported = hasExportModifier(node);
      node.declarationList.declarations.forEach((declaration) => {
        if (ts.isIdentifier(declaration.name)) {
          recordSymbol(declaration.name.text, 'const', exported, declaration.name);
        }
      });
    }
  });

  return symbols;
}

function hasExportModifier(node) {
  return Boolean(
    node.modifiers?.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword
    )
  );
}

function findNearestComponentName(node) {
  let current = node;

  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text;
    }

    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer &&
      (ts.isArrowFunction(current.initializer) || ts.isFunctionExpression(current.initializer))
    ) {
      return current.name.text;
    }

    current = current.parent;
  }

  return null;
}

function isUseEffectCall(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text === 'useEffect';
  }

  return ts.isPropertyAccessExpression(expression) && expression.name.text === 'useEffect';
}

function getNodeLocation(sourceFile, node) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return { line: line + 1, column: character + 1 };
}

function getScriptKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.ts') return ts.ScriptKind.TS;
  if (ext === '.jsx') return ts.ScriptKind.JSX;

  return ts.ScriptKind.JS;
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function printReport(report) {
  console.log('=== Repository Analysis Report ===');
  console.log(`Generated at: ${report.generatedAt}`);
  console.log('');

  console.log('1) Directory Inventory');
  report.directories.forEach((dir) => {
    if (!dir.exists) {
      console.log(`- ${dir.directory}: (missing directory)`);
      return;
    }

    console.log(`- ${dir.directory}: ${dir.fileCount} file(s)`);
    dir.files.forEach((filePath) => console.log(`    • ${filePath}`));
  });

  console.log('');
  console.log('2) Unused Exports (ESLint import/no-unused-modules)');
  if (report.unusedExportError) {
    console.log(`- ESLint error: ${report.unusedExportError}`);
  } else if (!report.unusedExportFindings.length) {
    console.log('- No unused exports detected.');
  } else {
    report.unusedExportFindings.forEach((issue) => {
      console.log(`- ${issue.file}:${issue.line}:${issue.column} — ${issue.message}`);
    });
  }

  console.log('');
  console.log('3) Duplicate Function/Constant Names');
  if (!report.duplicateSymbols.length) {
    console.log('- No duplicate symbol names found.');
  } else {
    report.duplicateSymbols.forEach((item) => {
      console.log(`- ${item.name}`);
      item.occurrences.forEach((occurrence) => {
        const exportLabel = occurrence.exported ? 'exported' : 'local';
        console.log(
          `    • ${occurrence.file}:${occurrence.line}:${occurrence.column} (${occurrence.kind}, ${exportLabel})`
        );
      });
    });
  }

  console.log('');
  console.log('4) useEffect Hooks Missing Dependency Arrays');
  if (!report.missingUseEffectDependencies.length) {
    console.log('- All useEffect hooks include dependency arrays.');
  } else {
    report.missingUseEffectDependencies.forEach((fileIssue) => {
      console.log(`- ${fileIssue.file}`);
      fileIssue.hooks.forEach((hook) => {
        const componentLabel = hook.component ? ` in ${hook.component}` : '';
        console.log(`    • Line ${hook.line}, Col ${hook.column}${componentLabel}`);
      });
    });
  }

  console.log('');
  console.log('5) Supabase Real-time Subscriptions Coverage');
  console.log(`- Files checked (components/screens): ${report.supabaseSubscriptions.filesChecked}`);
  console.log(`- With subscriptions: ${report.supabaseSubscriptions.withSubscriptions.length}`);
  console.log(`- Without subscriptions: ${report.supabaseSubscriptions.withoutSubscriptions.length}`);
  if (report.supabaseSubscriptions.withoutSubscriptions.length) {
    report.supabaseSubscriptions.withoutSubscriptions.forEach((filePath) => {
      console.log(`    • ${filePath}`);
    });
  }

  console.log('');
  console.log('Raw JSON output:');
  console.log(JSON.stringify(report, null, 2));
}

main();
