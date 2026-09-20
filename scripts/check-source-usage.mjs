// Production modules must be reachable from the browser entry, not just from tests.
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'web/src');
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const modules = readdirSync(sourceRoot, { recursive: true })
  .filter(name => /\.[cm]?[jt]sx?$/.test(name) && !/\.(test|spec)\.|\.d\.[cm]?ts$/.test(name))
  .map(name => path.join(sourceRoot, name));
const edges = new Map();
for (const file of modules) {
  const node = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const dependencies = [];
  function visit(child) {
    const specifier = (ts.isImportDeclaration(child) || ts.isExportDeclaration(child)) ? child.moduleSpecifier
      : ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword ? child.arguments[0] : undefined;
    if (specifier && ts.isStringLiteral(specifier)) {
      const dependency = ts.resolveModuleName(specifier.text, file, parsed.options, ts.sys).resolvedModule;
      if (dependency) dependencies.push(dependency.resolvedFileName);
    }
    ts.forEachChild(child, visit);
  }
  visit(node);
  edges.set(file, dependencies);
}
const reachable = new Set();
function walk(file) {
  if (reachable.has(file)) return;
  reachable.add(file);
  for (const dependency of edges.get(file) ?? []) walk(dependency);
}
walk(path.join(sourceRoot, 'main.tsx'));
const unused = modules.filter(file => !reachable.has(file));
if (unused.length) {
  console.error('Production modules unreachable from web/src/main.tsx:\n' + unused.map(file => path.relative(root, file)).join('\n'));
  process.exitCode = 1;
} else console.log(`PASS source reachability: ${modules.length} production modules`);
