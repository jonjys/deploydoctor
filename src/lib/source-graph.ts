import path from "node:path";
import ts from "typescript";
import type { RepositorySnapshot } from "@/lib/analyzer";
import { tsconfigAliases } from "@/lib/dependencies";

/**
 * Shared, read-only view of the snapshot's source files for cross-file production safety rules.
 * Every file is parsed at most once, imports are resolved only against files already in the snapshot,
 * and nothing is fetched, installed or executed.
 */
export const unwrap = (node: ts.Node): ts.Node =>
  ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) ? unwrap(node.expression) : node;
export const literalText = (node: ts.Node | undefined): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
export const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

export type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
export const isFunctionNode = (node: ts.Node): node is FunctionNode =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);

/** Where an import leads: a parsed file, a file this scan did not read, an npm package, or nothing in the repository. */
export type ModuleRef = { kind: "file"; file: string } | { kind: "unread"; file: string } | { kind: "external"; name: string } | { kind: "missing"; specifier: string };
/** What a name refers to: a function with its file, or why it could not be followed. */
export type Resolved = { kind: "function"; fn: FunctionNode; file: string; sf: ts.SourceFile } | { kind: "opaque"; reason: string };
export type Binding = { moduleName: string; imported: string };

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export class SourceGraph {
  private readonly parsed = new Map<string, ts.SourceFile | null>();
  private readonly files: Set<string>;
  private readonly aliasCache = new Map<string, Array<{ prefix: string; roots: string[] }>>();

  constructor(readonly snapshot: RepositorySnapshot) {
    this.files = new Set(snapshot.entries.filter(entry => entry.type === "blob").map(entry => entry.path));
  }

  /** The parsed file, or undefined when it was not read or does not parse cleanly (a recovered tree is not evidence). */
  parse(file: string): ts.SourceFile | undefined {
    if (!this.parsed.has(file)) {
      const source = this.snapshot.contents.get(file);
      let sf: ts.SourceFile | null = null;
      if (source !== undefined) {
        sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
        if ((sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) sf = null;
      }
      this.parsed.set(file, sf);
    }
    return this.parsed.get(file) ?? undefined;
  }

  /** Files in the snapshot tree that were not read: a partial scan, or a file over the size limit. */
  unread(file: string) { return this.files.has(file) && !this.snapshot.contents.has(file); }

  private aliases(from: string) {
    let dir = path.posix.dirname(from);
    for (;;) {
      const config = ["tsconfig.json", "jsconfig.json"].map(name => (dir === "." ? name : `${dir}/${name}`)).find(file => this.snapshot.contents.has(file));
      if (config || dir === ".") {
        const key = config ?? ".";
        if (!this.aliasCache.has(key)) {
          const base = config ? path.posix.dirname(config) : ".";
          const parsed = config ? tsconfigAliases(this.snapshot.contents.get(config)!) : { prefixes: [], baseUrl: undefined };
          const under = (target: string) => path.posix.normalize(path.posix.join(base, parsed.baseUrl ?? "", target)).replace(/\/$/, "");
          const list = parsed.prefixes.map(item => ({ prefix: item.prefix, roots: item.targets.map(under) }));
          if (!list.some(item => item.prefix === "@/")) list.push({ prefix: "@/", roots: [path.posix.join(base, "src"), base] });
          if (parsed.baseUrl !== undefined) list.push({ prefix: "", roots: [under("")] });
          this.aliasCache.set(key, list.sort((a, b) => b.prefix.length - a.prefix.length));
        }
        return this.aliasCache.get(key)!;
      }
      dir = path.posix.dirname(dir);
    }
  }

  private candidates(base: string): string[] {
    const clean = path.posix.normalize(base).replace(/^\.\//, "");
    const stem = clean.replace(/\.(?:[cm]?js|jsx)$/, "");
    return [clean, ...EXTENSIONS.map(ext => stem + ext), ...EXTENSIONS.map(ext => `${clean}/index${ext}`)];
  }

  resolve(from: string, specifier: string): ModuleRef {
    const bases: string[] = [];
    if (specifier.startsWith(".")) bases.push(path.posix.join(path.posix.dirname(from), specifier));
    else for (const alias of this.aliases(from)) {
      if (alias.prefix && !specifier.startsWith(alias.prefix)) continue;
      for (const root of alias.roots) bases.push(path.posix.join(root, specifier.slice(alias.prefix.length)));
    }
    for (const base of bases) for (const candidate of this.candidates(base)) {
      if (this.snapshot.contents.has(candidate)) return { kind: "file", file: candidate };
      if (this.files.has(candidate)) return { kind: "unread", file: candidate };
    }
    if (!specifier.startsWith(".") && !specifier.startsWith("@/") && !specifier.startsWith("~/")) return { kind: "external", name: specifier };
    return { kind: "missing", specifier };
  }

  /** An import or CommonJS require binding for a local name in `sf`, if there is exactly one. */
  binding(sf: ts.SourceFile, local: string): Binding | undefined {
    for (const statement of sf.statements) {
      if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) {
        const moduleName = literalText(statement.moduleSpecifier);
        const clause = statement.importClause;
        if (!moduleName || !clause) continue;
        if (clause.name?.text === local) return { moduleName, imported: "default" };
        const named = clause.namedBindings;
        if (named && ts.isNamespaceImport(named) && named.name.text === local) return { moduleName, imported: "*" };
        if (named && ts.isNamedImports(named)) for (const element of named.elements) {
          if (!element.isTypeOnly && element.name.text === local) return { moduleName, imported: element.propertyName?.text ?? element.name.text };
        }
      }
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer && unwrap(declaration.initializer);
        const moduleName = init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "require" ? literalText(init.arguments[0]) : undefined;
        if (!moduleName) continue;
        if (ts.isIdentifier(declaration.name) && declaration.name.text === local) return { moduleName, imported: "*" };
        if (ts.isObjectBindingPattern(declaration.name)) for (const element of declaration.name.elements) {
          if (ts.isIdentifier(element.name) && element.name.text === local) return { moduleName, imported: element.propertyName ? element.propertyName.getText(sf) : local };
        }
      }
    }
    return undefined;
  }

  /** The declaration of a top-level or nested function named `name` in `sf`, when the name is unambiguous. */
  localFunction(sf: ts.SourceFile, name: string): FunctionNode | undefined {
    const found: FunctionNode[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) found.push(node);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
        const init = unwrap(node.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) found.push(init);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return found.length === 1 ? found[0] : undefined;
  }

  /** The function a module exports under `name` ("default" included), following `export { a as b }` and CommonJS exports. */
  exportedFunction(sf: ts.SourceFile, name: string): FunctionNode | undefined {
    const local = this.exportedLocalName(sf, name);
    if (local?.fn) return local.fn;
    return local?.name ? this.localFunction(sf, local.name) : undefined;
  }

  /** The local name (or inline function) a module exports under `name`. */
  exportedLocalName(sf: ts.SourceFile, name: string): { name?: string; fn?: FunctionNode } | undefined {
    const exported = (node: ts.Node) => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = (node: ts.Node) => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
    for (const statement of sf.statements) {
      if (ts.isFunctionDeclaration(statement) && exported(statement) && statement.body) {
        if (name === "default" ? isDefault(statement) : statement.name?.text === name && !isDefault(statement)) return { fn: statement };
      }
      if (ts.isVariableStatement(statement) && exported(statement) && name !== "default") for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return { name };
      }
      if (ts.isExportAssignment(statement) && name === "default") {
        const expression = unwrap(statement.expression);
        if (isFunctionNode(expression)) return { fn: expression };
        if (ts.isIdentifier(expression)) return { name: expression.text };
      }
      if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) if (element.name.text === name) return { name: element.propertyName?.text ?? element.name.text };
      }
      // module.exports = x, module.exports = { a, b: c }, exports.a = x
      if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const left = statement.expression.left.getText(sf);
        const right = unwrap(statement.expression.right);
        if (left === "module.exports") {
          if (name === "default" && ts.isIdentifier(right)) return { name: right.text };
          if (name === "default" && isFunctionNode(right)) return { fn: right };
          if (ts.isObjectLiteralExpression(right)) for (const property of right.properties) {
            if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) return { name };
            if (ts.isPropertyAssignment(property) && property.name.getText(sf) === name) {
              const value = unwrap(property.initializer);
              if (ts.isIdentifier(value)) return { name: value.text };
              if (isFunctionNode(value)) return { fn: value };
            }
          }
        }
        if (left === `exports.${name}` || left === `module.exports.${name}`) {
          if (ts.isIdentifier(right)) return { name: right.text };
          if (isFunctionNode(right)) return { fn: right };
        }
      }
    }
    return undefined;
  }

  /** Follow a called name (`helper(...)` or `ns.helper(...)`) to its function body, or say why it cannot be followed. */
  resolveCallee(file: string, sf: ts.SourceFile, callee: ts.Expression): Resolved {
    const expression = unwrap(callee);
    let local: string | undefined;
    let member: string | undefined;
    if (ts.isIdentifier(expression)) local = expression.text;
    else if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) { local = expression.expression.text; member = expression.name.text; }
    if (!local) return { kind: "opaque", reason: "the called expression could not be resolved statically" };
    if (!member) {
      const fn = this.localFunction(sf, local);
      if (fn) return { kind: "function", fn, file, sf };
    }
    const bound = this.binding(sf, local);
    if (!bound) return { kind: "opaque", reason: member ? `${local}.${member} is not a local or imported function` : `${local} is not defined in this file` };
    const exportName = member ? (bound.imported === "*" || bound.imported === "default" ? member : undefined) : bound.imported === "*" ? "default" : bound.imported;
    if (!exportName) return { kind: "opaque", reason: `${local}.${member} could not be followed` };
    const target = this.resolve(file, bound.moduleName);
    if (target.kind === "external") return { kind: "opaque", reason: `it comes from the package ${target.name}` };
    if (target.kind === "unread") return { kind: "opaque", reason: `${target.file} was not read in this scan` };
    if (target.kind === "missing") return { kind: "opaque", reason: `${bound.moduleName} could not be resolved in the repository` };
    const targetSf = this.parse(target.file);
    if (!targetSf) return { kind: "opaque", reason: `${target.file} could not be parsed` };
    const fn = this.exportedFunction(targetSf, exportName);
    return fn ? { kind: "function", fn, file: target.file, sf: targetSf } : { kind: "opaque", reason: `${exportName} is not an exported function of ${target.file}` };
  }
}

/** True when the subtree contains a return or throw that leaves the enclosing function (nested functions excluded). */
export function exits(node: ts.Node): boolean {
  if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return true;
  if (isFunctionNode(node)) return false;
  return ts.forEachChild(node, child => exits(child) || undefined) === true;
}

/** A Stripe signature check: `<client>.webhooks.constructEvent(...)` or `constructEventAsync(...)`. */
export function isStripeVerifierCall(node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && ["constructEvent", "constructEventAsync"].includes(node.expression.name.text)
    && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "webhooks";
}
