import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { marked } from 'marked';

const root = fileURLToPath(new URL('../', import.meta.url));
const documents = {
  TERMS_OF_SERVICE: 'terms', PRIVACY_POLICY: 'privacy', CREATOR_POLICY: 'creator-policy',
  MODEL_RELEASE: 'model-release', COMMUNITY_GUIDELINES: 'community', COOKIE_POLICY: 'cookie-policy',
};
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
marked.use({ renderer: { html: token => escape(token.text) } });

export function readLegalDocuments(source) {
  const ast = ts.createSourceFile('LegalContent.ts', source, ts.ScriptTarget.Latest, true);
  const statement = ast.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'LEGAL_CONTENT'));
  const object = statement?.declarationList.declarations.find(declaration => declaration.name.getText(ast) === 'LEGAL_CONTENT')?.initializer;
  if (!object || !ts.isObjectLiteralExpression(object)) throw new Error('Expected literal legal document collection');
  return Object.fromEntries(object.properties.map(property => {
    if (!ts.isPropertyAssignment(property) || !ts.isNoSubstitutionTemplateLiteral(property.initializer)) {
      throw new Error('Legal documents must use plain string templates');
    }
    return [property.name.getText(ast), property.initializer.text];
  }));
}

export function renderPolicy(markdown) {
  const title = markdown.split('\n')[0].replace(/^#\s+/, '');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} | PAPZ (Pty) Ltd</title>
<style>
*{box-sizing:border-box}body{margin:0;color:#17232a;background:#fff;font:16px/1.65 system-ui,sans-serif}
header,footer{padding:20px max(20px,calc((100% - 820px)/2));background:#f2f6f5;border-bottom:1px solid #d9e2df}
header a{font-weight:700}nav{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:10px}a{color:#00694e}
main{max-width:820px;margin:auto;padding:32px 20px 64px}h1{font-size:30px;line-height:1.2}h2{font-size:22px;line-height:1.3;margin-top:32px}
hr{border:0;border-top:1px solid #d9e2df;margin:28px 0}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px;border:1px solid #d9e2df;text-align:left}footer{font-size:14px}p,li{overflow-wrap:anywhere}
</style></head><body><header><a href="/">Papzii</a><nav aria-label="Policies"><a href="/terms/">Terms</a><a href="/privacy/">Privacy</a><a href="/creator-policy/">Creator Policy</a><a href="mailto:support@papzii.co.za">Support</a></nav></header>
<main>${marked.parse(markdown)}</main><footer>Papzii is operated by PAPZ (Pty) Ltd · Registration 2025/188861/07</footer></body></html>\n`;
}

export function buildPolicies(output = path.join(root, 'public')) {
  const content = readLegalDocuments(fs.readFileSync(path.join(root, 'src/constants/LegalContent.ts'), 'utf8'));
  for (const [key, slug] of Object.entries(documents)) {
    if (!content[key]) throw new Error(`Missing legal document: ${key}`);
    const directory = path.join(output, slug);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'index.html'), renderPolicy(content[key]));
  }
  console.log(`Generated ${Object.keys(documents).length} public policy pages from bundled legal content`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildPolicies();
