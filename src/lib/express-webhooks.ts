import ts from "typescript";
import { exits, isFunctionNode, isStripeVerifierCall, lineOf, literalText, unwrap, type FunctionNode, type SourceGraph } from "@/lib/source-graph";

/**
 * Express middleware order in front of Stripe webhook routes. For every app (`express()`) and router
 * (`express.Router()`), registrations are read in source order. Routers mounted from other files are followed
 * through their imports. The first body parser that applies to Stripe's `application/json` request decides what
 * `constructEvent` receives. Only static paths and plain registrations count as certain; anything else is a review
 * item, and nothing is ever moved or patched automatically.
 */
export type ExpressRisk = { file: string; line: number; status: "red" | "yellow"; problem: string; fix: string };
export type ExpressWebhook = { file: string; fn: FunctionNode };

type ParserKind = "json" | "raw" | "text" | "urlencoded";
type PathSpec = { kind: "all" } | { kind: "literal"; value: string } | { kind: "unknown"; text: string };
type Parser = { kind: "parser"; parser: ParserKind; applies: "yes" | "no" | "unknown"; preserved?: string; verify: boolean; label: string };
type Item = (Parser | { kind: "unclear"; reason: string } | { kind: "exempt"; label: string } | { kind: "wrapper"; fn: FunctionNode; sf: ts.SourceFile; parser: Parser & { file: string; line: number }; label: string })
  & { file: string; line: number };
type Placed = { item: Item; path: PathSpec; exact: boolean; direct: boolean };
type Container = { file: string; sf: ts.SourceFile; name: string; kind: "app" | "router"; block: ts.Node; decl: ts.VariableDeclaration };
type Webhook = { fn: FunctionNode; file: string; sf: ts.SourceFile; verifier: ts.CallExpression; label: string };

const METHODS = new Set(["use", "get", "post", "put", "patch", "delete", "all", "options", "head"]);
const STRIPE_TYPES = new Set(["application/json", "json", "*/*", "application/*", "*/json"]);
const DEFAULT_TYPE: Record<ParserKind, string> = { json: "application/json", raw: "application/octet-stream", text: "text/plain", urlencoded: "application/x-www-form-urlencoded" };
const RAW_FIX = "Give the webhook route its own raw parser, for example app.post(path, express.raw({ type: 'application/json' }), handler), registered before app.use(express.json()); or skip the JSON parser for the webhook path; or keep the original bytes with express.json({ verify: (req, res, buf) => { req.rawBody = buf } }) and pass req.rawBody to constructEvent. Moving app.use(express.json()) changes which other routes receive parsed bodies, so check those routes first; DeployDoctor does not move middleware for you. Then send a signed test event (stripe trigger) and confirm verification succeeds.";

const pathJoin = (prefix: PathSpec, path: PathSpec): PathSpec => {
  if (prefix.kind === "unknown") return prefix;
  if (path.kind === "unknown") return path;
  const a = prefix.kind === "literal" ? prefix.value : "";
  const b = path.kind === "literal" ? path.value : "";
  const joined = `/${[a, b].join("/").split("/").filter(Boolean).join("/")}`;
  return joined === "/" && prefix.kind === "all" && path.kind === "all" ? { kind: "all" } : { kind: "literal", value: joined };
};

class ExpressAnalysis {
  readonly risks: ExpressRisk[] = [];
  readonly webhooks: ExpressWebhook[] = [];
  evaluated = false;
  private readonly containers: Container[] = [];
  private readonly mounted = new Set<Container>();
  private readonly seenRoutes = new Set<ts.Node>();

  constructor(private readonly graph: SourceGraph, files: string[]) {
    for (const file of files) {
      const sf = graph.parse(file);
      if (sf) this.containers.push(...this.findContainers(file, sf));
    }
  }

  private readonly nameCache = new WeakMap<ts.SourceFile, ReturnType<ExpressAnalysis["readNames"]>>();
  private names(sf: ts.SourceFile) {
    if (!this.nameCache.has(sf)) this.nameCache.set(sf, this.readNames(sf));
    return this.nameCache.get(sf)!;
  }

  private readNames(sf: ts.SourceFile) {
    const express = new Set<string>(), routers = new Set<string>(), bodyParser = new Set<string>();
    const parsers = new Map<string, ParserKind>();
    for (const statement of sf.statements) {
      const binds: Array<{ moduleName: string; local: string; imported: string }> = [];
      if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) {
        const moduleName = literalText(statement.moduleSpecifier) ?? "";
        const clause = statement.importClause;
        if (clause?.name) binds.push({ moduleName, local: clause.name.text, imported: "default" });
        const named = clause?.namedBindings;
        if (named && ts.isNamespaceImport(named)) binds.push({ moduleName, local: named.name.text, imported: "default" });
        if (named && ts.isNamedImports(named)) for (const e of named.elements) if (!e.isTypeOnly) binds.push({ moduleName, local: e.name.text, imported: e.propertyName?.text ?? e.name.text });
      }
      if (ts.isVariableStatement(statement)) for (const d of statement.declarationList.declarations) {
        const init = d.initializer && unwrap(d.initializer);
        const moduleName = init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "require" ? literalText(init.arguments[0]) : undefined;
        if (!moduleName) continue;
        if (ts.isIdentifier(d.name)) binds.push({ moduleName, local: d.name.text, imported: "default" });
        if (ts.isObjectBindingPattern(d.name)) for (const e of d.name.elements) if (ts.isIdentifier(e.name)) binds.push({ moduleName, local: e.name.text, imported: e.propertyName?.getText(sf) ?? e.name.text });
      }
      for (const { moduleName, local, imported } of binds) {
        if (moduleName === "express" && imported === "default") express.add(local);
        else if (moduleName === "express" && imported === "Router") routers.add(local);
        else if (moduleName === "body-parser" && imported === "default") bodyParser.add(local);
        else if ((moduleName === "express" || moduleName === "body-parser") && ["json", "raw", "text", "urlencoded"].includes(imported)) parsers.set(local, imported as ParserKind);
      }
    }
    return { express, routers, bodyParser, parsers };
  }

  private findContainers(file: string, sf: ts.SourceFile): Container[] {
    const { express, routers } = this.names(sf);
    if (!express.size && !routers.size) return [];
    const found: Container[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const init = unwrap(node.initializer);
        if (ts.isCallExpression(init)) {
          const callee = unwrap(init.expression);
          const kind = ts.isIdentifier(callee) && express.has(callee.text) ? "app"
            : (ts.isIdentifier(callee) && routers.has(callee.text)) || (ts.isPropertyAccessExpression(callee) && callee.name.text === "Router" && ts.isIdentifier(callee.expression) && express.has(callee.expression.text)) ? "router" : undefined;
          let block: ts.Node = node.parent;
          while (block && !ts.isBlock(block) && !ts.isSourceFile(block)) block = block.parent;
          if (kind) found.push({ file, sf, name: node.name.text, kind, block, decl: node });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    // Two containers with one name in a file cannot be told apart by name alone.
    return found.filter(c => found.filter(o => o.name === c.name).length === 1);
  }

  private parserCall(node: ts.Node, sf: ts.SourceFile): { kind: ParserKind; call: ts.CallExpression } | undefined {
    const n = unwrap(node);
    if (!ts.isCallExpression(n)) return undefined;
    const { express, bodyParser, parsers } = this.names(sf);
    const callee = unwrap(n.expression);
    if (ts.isIdentifier(callee) && parsers.has(callee.text)) return { kind: parsers.get(callee.text)!, call: n };
    if (ts.isIdentifier(callee) && bodyParser.has(callee.text)) return { kind: "json", call: n }; // legacy bodyParser() includes json
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && (express.has(callee.expression.text) || bodyParser.has(callee.expression.text))
      && ["json", "raw", "text", "urlencoded"].includes(callee.name.text)) return { kind: callee.name.text as ParserKind, call: n };
    return undefined;
  }

  private parser(kind: ParserKind, call: ts.CallExpression, file: string, sf: ts.SourceFile): Parser & { file: string; line: number } {
    const label = `${call.expression.getText(sf)}()`;
    const base = { kind: "parser" as const, parser: kind, verify: false, label, file, line: lineOf(sf, call) };
    const options = call.arguments[0] && unwrap(call.arguments[0]);
    if (options && !ts.isObjectLiteralExpression(options)) return { ...base, applies: "unknown" };
    let types: string[] | undefined = [DEFAULT_TYPE[kind]];
    let preserved: string | undefined, verify = false;
    if (options && ts.isObjectLiteralExpression(options)) for (const property of options.properties) {
      const name = property.name?.getText(sf);
      if (name === "type" && ts.isPropertyAssignment(property)) {
        const value = unwrap(property.initializer);
        types = literalText(value) !== undefined ? [literalText(value)!] : ts.isArrayLiteralExpression(value) && value.elements.every(e => literalText(e) !== undefined) ? value.elements.map(e => literalText(e)!) : undefined;
      }
      if (name === "verify") {
        verify = true;
        const value = ts.isPropertyAssignment(property) ? unwrap(property.initializer) : ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
        const fn = value && isFunctionNode(value) ? value : value && ts.isIdentifier(value) ? this.graph.localFunction(sf, value.text) : ts.isMethodDeclaration(property) ? property : undefined;
        if (fn) preserved = this.preservedProperty(fn);
      }
    }
    const applies = !types ? "unknown" : types.some(t => STRIPE_TYPES.has(t.toLowerCase()) || t.toLowerCase().startsWith("application/json")) ? "yes" : "no";
    return { ...base, applies, preserved, verify };
  }

  /** `verify: (req, res, buf) => { req.rawBody = buf }` keeps the original bytes on req.rawBody. */
  private preservedProperty(fn: FunctionNode): string | undefined {
    const [req, , buf] = fn.parameters.map(p => (ts.isIdentifier(p.name) ? p.name.text : undefined));
    if (!req || !buf) return undefined;
    let found: string | undefined;
    const visit = (n: ts.Node) => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && ts.isIdentifier(n.left.expression) && n.left.expression.text === req) {
        let usesBuf = false;
        const scan = (m: ts.Node) => { if (ts.isIdentifier(m) && m.text === buf) usesBuf = true; ts.forEachChild(m, scan); };
        scan(n.right);
        if (usesBuf) found = n.left.name.text;
      }
      ts.forEachChild(n, visit);
    };
    if (fn.body) visit(fn.body);
    return found;
  }

  private stringConst(sf: ts.SourceFile, name: string): string | undefined {
    let value: string | undefined, count = 0;
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) { count++; value = literalText(n.initializer && unwrap(n.initializer)); }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return count === 1 ? value : undefined;
  }

  private path(node: ts.Expression, sf: ts.SourceFile): PathSpec | undefined {
    const n = unwrap(node);
    const text = literalText(n) ?? (ts.isIdentifier(n) ? this.stringConst(sf, n.text) : undefined);
    if (text !== undefined) return text === "*" || text === "/*" || text === "(.*)" || text === "/" ? { kind: "all" } : { kind: "literal", value: text };
    if (ts.isRegularExpressionLiteral(n) || ts.isArrayLiteralExpression(n) || ts.isTemplateExpression(n)) return { kind: "unknown", text: n.getText(sf).slice(0, 60) };
    return undefined; // not a path: a handler
  }

  /** app.use(PREFIX, parser): a first argument that is neither a known function nor a router may be a path. */
  private unresolvedPath(arg: ts.Expression, container: Container): PathSpec | undefined {
    const n = unwrap(arg);
    if (isFunctionNode(n) || ts.isCallExpression(n) || ts.isArrayLiteralExpression(n)) return undefined;
    if (!(ts.isIdentifier(n) || ts.isPropertyAccessExpression(n) || ts.isBinaryExpression(n) || ts.isTemplateExpression(n))) return undefined;
    if (ts.isIdentifier(n)) {
      if (this.containers.some(c => c.file === container.file && c.name === n.text) || this.graph.localFunction(container.sf, n.text)) return undefined;
      if (this.item(n, container.file, container.sf)) return undefined;
      const resolved = this.graph.resolveCallee(container.file, container.sf, n);
      if (resolved.kind === "function") return undefined;
    }
    return { kind: "unknown", text: n.getText(container.sf).slice(0, 60) };
  }

  private registrations(container: Container) {
    const regs: Array<{ method: string; path: PathSpec; handlers: ts.Expression[]; call: ts.CallExpression; direct: boolean }> = [];
    const { sf } = container;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && METHODS.has(node.expression.name.text)) {
        const method = node.expression.name.text;
        let receiver = unwrap(node.expression.expression);
        let routePath: PathSpec | undefined;
        // app.route("/x").post(h) and app.route("/x").get(a).post(b)
        while (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression) && METHODS.has(receiver.expression.name.text) && receiver.expression.name.text !== "use") receiver = unwrap(receiver.expression.expression);
        if (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression) && receiver.expression.name.text === "route" && receiver.arguments[0]) {
          routePath = this.path(receiver.arguments[0], sf) ?? { kind: "unknown", text: receiver.arguments[0].getText(sf) };
          receiver = unwrap(receiver.expression.expression);
        }
        if (ts.isIdentifier(receiver) && receiver.text === container.name && node.pos > container.decl.pos) {
          let args = [...node.arguments];
          let path: PathSpec = routePath ?? { kind: "all" };
          if (!routePath && args[0]) {
            const first = this.path(args[0], sf) ?? (method === "use" && args.length > 1 ? this.unresolvedPath(args[0], container) : undefined);
            if (first) { path = first; args = args.slice(1); }
            else if (method !== "use") { path = { kind: "unknown", text: args[0].getText(sf).slice(0, 60) }; args = args.slice(1); }
          }
          const handlers = args.flatMap(a => { const v = unwrap(a); return ts.isArrayLiteralExpression(v) ? [...v.elements] : [a]; });
          let statement: ts.Node = node;
          while (statement.parent && !ts.isExpressionStatement(statement) && !ts.isBlock(statement.parent) && !ts.isSourceFile(statement.parent)) statement = statement.parent;
          regs.push({ method, path, handlers, call: node, direct: statement.parent === container.block });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    // configure(app) / registerMiddleware(app): middleware may be registered where this scan cannot see the order.
    const handoffs = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.pos > container.decl.pos && node.arguments.some(a => ts.isIdentifier(unwrap(a)) && (unwrap(a) as ts.Identifier).text === container.name)) {
        const callee = node.expression.getText(sf);
        if (!/(?:^|\.)(?:createServer|listen|serverless|handle|use|get|post|put|patch|delete|all|route)$/.test(callee)) regs.push({ method: "handoff", path: { kind: "all" }, handlers: [], call: node, direct: true });
      }
      ts.forEachChild(node, handoffs);
    };
    handoffs(sf);
    return regs.sort((a, b) => a.call.pos - b.call.pos);
  }

  /** A handler that contains the Stripe signature check, in this file or an imported one. */
  private webhook(handler: ts.Expression, file: string, sf: ts.SourceFile): Webhook | undefined {
    const n = unwrap(handler);
    let target: { fn: FunctionNode; file: string; sf: ts.SourceFile } | undefined;
    if (isFunctionNode(n)) target = { fn: n, file, sf };
    else if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) {
      const resolved = this.graph.resolveCallee(file, sf, n as ts.Expression);
      if (resolved.kind === "function") target = resolved;
    }
    if (!target?.fn.body) return undefined;
    let verifier: ts.CallExpression | undefined;
    const visit = (m: ts.Node) => { if (!verifier && isStripeVerifierCall(m)) verifier = m as ts.CallExpression; else if (!(isFunctionNode(m) && m !== target!.fn)) ts.forEachChild(m, visit); };
    visit(target.fn.body);
    return verifier ? { ...target, verifier, label: n.getText(sf).slice(0, 40) } : undefined;
  }

  /** What a middleware argument does to the request body, or undefined when it does not touch it. */
  private item(handler: ts.Expression, file: string, sf: ts.SourceFile, depth = 0): Item | { mount: Container } | undefined {
    const n = unwrap(handler);
    const line = lineOf(sf, n);
    const direct = this.parserCall(n, sf);
    if (direct) return this.parser(direct.kind, direct.call, file, sf);
    if (ts.isIdentifier(n)) {
      const local = this.containers.find(c => c.file === file && c.name === n.text);
      if (local) return { mount: local };
      let init: ts.Expression | undefined, count = 0;
      const visit = (m: ts.Node) => { if (ts.isVariableDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === n.text) { count++; init = m.initializer; } ts.forEachChild(m, visit); };
      visit(sf);
      if (count === 1 && init && depth < 2) { const inner = this.item(init, file, sf, depth + 1); if (inner) return inner; }
      const bound = this.graph.binding(sf, n.text);
      if (bound) {
        const ref = this.graph.resolve(file, bound.moduleName);
        if (ref.kind === "file") {
          const targetSf = this.graph.parse(ref.file);
          const exported = targetSf && this.graph.exportedLocalName(targetSf, bound.imported === "*" ? "default" : bound.imported);
          const remote = exported?.name && this.containers.find(c => c.file === ref.file && c.name === exported.name);
          if (remote) return { mount: remote };
        }
        if (ref.kind === "unread") return { kind: "unclear", reason: `${n.text} comes from ${ref.file}, which was not read in this scan`, file, line };
      }
    }
    const fn = isFunctionNode(n) ? n : ts.isIdentifier(n) ? this.graph.localFunction(sf, n.text) : undefined;
    if (fn?.body) {
      let inner: { kind: ParserKind; call: ts.CallExpression } | undefined;
      const visit = (m: ts.Node) => { inner ??= this.parserCall(m, sf); if (!inner) ts.forEachChild(m, visit); };
      visit(fn.body);
      if (inner) return { kind: "wrapper", fn, sf, parser: this.parser(inner.kind, inner.call, file, sf), label: `the middleware at ${file}:${line}`, file, line };
      return undefined;
    }
    if (ts.isCallExpression(n)) {
      let wrapped = false;
      const visit = (m: ts.Node) => { if (this.parserCall(m, sf)) wrapped = true; else ts.forEachChild(m, visit); };
      n.arguments.forEach(visit);
      if (wrapped) return { kind: "unclear", reason: `a body parser is wrapped in ${n.expression.getText(sf).slice(0, 40)}(), whose path handling cannot be read statically`, file, line };
    }
    return undefined;
  }

  /** Whether a wrapper like `(req, res, next) => req.originalUrl === "/webhook" ? next() : express.json()(req, res, next)` skips `path`. */
  private wrapperSkips(fn: FunctionNode, sf: ts.SourceFile, path: string): boolean | undefined {
    const [req, , next] = fn.parameters.map(p => (ts.isIdentifier(p.name) ? p.name.text : undefined));
    if (!req || !next || !fn.body) return undefined;
    const evaluate = (n: ts.Node): boolean | undefined => {
      n = unwrap(n);
      if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) { const v = evaluate(n.operand); return v === undefined ? undefined : !v; }
      if (ts.isBinaryExpression(n)) {
        const op = n.operatorToken.kind;
        if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
          const l = evaluate(n.left), r = evaluate(n.right);
          if (l === undefined || r === undefined) return undefined;
          return op === ts.SyntaxKind.AmpersandAmpersandToken ? l && r : l || r;
        }
        const url = [n.left, n.right].find(s => /^(?:originalUrl|url|path|baseUrl)$/.test(ts.isPropertyAccessExpression(unwrap(s)) ? (unwrap(s) as ts.PropertyAccessExpression).name.text : "") && (unwrap(s) as ts.PropertyAccessExpression).expression.getText(sf) === req);
        const value = literalText(unwrap(n.left === url ? n.right : n.left));
        if (!url || value === undefined) return undefined;
        const equal = value.toLowerCase() === path.toLowerCase();
        if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken) return equal;
        if (op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) return !equal;
        return undefined;
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["startsWith", "includes", "endsWith"].includes(n.expression.name.text)) {
        const subject = unwrap(n.expression.expression);
        const value = literalText(n.arguments[0]);
        if (!ts.isPropertyAccessExpression(subject) || subject.expression.getText(sf) !== req || !/^(?:originalUrl|url|path|baseUrl)$/.test(subject.name.text) || value === undefined) return undefined;
        const p = path.toLowerCase(), v = value.toLowerCase();
        return n.expression.name.text === "startsWith" ? p.startsWith(v) : n.expression.name.text === "endsWith" ? p.endsWith(v) : p.includes(v);
      }
      return undefined;
    };
    const parses = (n: ts.Node | undefined): boolean => {
      if (!n) return false;
      let found = false;
      const visit = (m: ts.Node) => { if (this.parserCall(m, sf)) found = true; else ts.forEachChild(m, visit); };
      visit(n);
      return found;
    };
    const callsNext = (n: ts.Node | undefined): boolean => {
      if (!n) return false;
      let found = false;
      const visit = (m: ts.Node) => { if (ts.isCallExpression(m) && ts.isIdentifier(unwrap(m.expression)) && (unwrap(m.expression) as ts.Identifier).text === next) found = true; else ts.forEachChild(m, visit); };
      visit(n);
      return found;
    };
    const conditions: Array<ts.IfStatement | ts.ConditionalExpression> = [];
    const collect = (n: ts.Node) => { if (isFunctionNode(n)) return; if (ts.isIfStatement(n) || ts.isConditionalExpression(n)) conditions.push(n); ts.forEachChild(n, collect); };
    collect(fn.body);
    for (const n of conditions) {
      const condition = ts.isIfStatement(n) ? n.expression : n.condition;
      const yes = ts.isIfStatement(n) ? n.thenStatement : n.whenTrue, no = ts.isIfStatement(n) ? n.elseStatement : n.whenFalse;
      const match = evaluate(condition);
      if (parses(yes) || parses(no)) {
        if (match === undefined) return undefined;
        const taken = match ? yes : no;
        if (!taken) return undefined;
        return parses(taken) ? false : callsNext(taken) ? true : undefined;
      }
      // if (req.originalUrl === "/webhook") return next(); ...parser
      if (ts.isIfStatement(n) && !n.elseStatement && callsNext(yes) && exits(yes)) {
        if (match === undefined) return undefined;
        if (match) return true;
        continue;
      }
      if (match === undefined && (exits(yes) || (no && exits(no)))) return undefined;
    }
    return false;
  }

  private applies(placed: Placed, webhookPath: PathSpec): "yes" | "no" | "unknown" {
    if (placed.path.kind === "all") return "yes";
    if (placed.path.kind === "unknown" || webhookPath.kind === "unknown") return "unknown";
    if (webhookPath.kind === "all") return "unknown";
    const p = placed.path.value.replace(/\/+$/, "").toLowerCase() || "/", w = webhookPath.value.replace(/\/+$/, "").toLowerCase() || "/";
    if (/[:*?()]/.test(p)) return "unknown";
    if (placed.exact) return p === w ? "yes" : "no";
    return p === "/" || w === p || w.startsWith(`${p}/`) ? "yes" : "no";
  }

  run() {
    for (const root of this.containers.filter(c => c.kind === "app")) this.walk(root, { kind: "all" }, [], true);
    for (const router of this.containers) if (router.kind === "router" && !this.mounted.has(router)) this.walk(router, { kind: "all" }, [], false);
  }

  private walk(container: Container, prefix: PathSpec, inherited: Placed[], rooted: boolean, depth = 0) {
    if (depth > 5) return;
    const placed: Placed[] = [];
    for (const reg of this.registrations(container)) {
      if (reg.method === "handoff") {
        placed.push({ item: { kind: "unclear", reason: `${container.name} is passed to ${reg.call.expression.getText(container.sf).slice(0, 40)}(), which may register middleware`, file: container.file, line: lineOf(container.sf, reg.call) }, path: { kind: "all" }, exact: false, direct: true });
        continue;
      }
      const path = pathJoin(prefix, reg.path);
      const exact = reg.method !== "use";
      for (let index = 0; index < reg.handlers.length; index++) {
        const handler = reg.handlers[index];
        const hook = ["post", "all", "put", "use"].includes(reg.method) ? this.webhook(handler, container.file, container.sf) : undefined;
        if (hook) {
          // Route-level middleware before the handler is already in `placed`, with this route's exact path.
          this.evaluate(container, reg.call, hook, path, [...inherited, ...placed], rooted);
          break;
        }
        const item = this.item(handler, container.file, container.sf);
        if (item && "mount" in item) {
          this.mounted.add(item.mount);
          this.walk(item.mount, path, [...inherited, ...placed], rooted, depth + 1);
          continue;
        }
        if (item) placed.push({ item, path, exact, direct: reg.direct });
      }
    }
  }

  private evaluate(container: Container, route: ts.CallExpression, hook: Webhook, path: PathSpec, chain: Placed[], rooted: boolean) {
    this.evaluated = true;
    if (!this.webhooks.some(w => w.fn === hook.fn)) this.webhooks.push({ file: hook.file, fn: hook.fn });
    if (this.seenRoutes.has(route)) return;
    const site = { file: container.file, line: lineOf(container.sf, route) };
    const where = `${site.file}:${site.line}`;
    const routeText = path.kind === "literal" ? path.value : path.kind === "all" ? "(all paths)" : path.text;
    const payload = this.payload(hook);
    let state: { kind: "parsed"; parser: Parser & { file: string; line: number } } | { kind: "raw" } | { kind: "unclear"; reason: string; at: string } | { kind: "none"; mismatch?: Parser & { file: string; line: number } } = { kind: "none" };
    for (const placed of chain) {
      const at = `${placed.item.file}:${placed.item.line}`;
      const applies = this.applies(placed, path);
      if (applies === "no") continue;
      if (placed.item.kind === "exempt") continue;
      if (placed.item.kind === "unclear") { if (applies === "yes" || applies === "unknown") { state = { kind: "unclear", reason: placed.item.reason, at }; break; } continue; }
      if (!placed.direct) {
        const parser = placed.item.kind === "wrapper" ? placed.item.parser : placed.item;
        if (parser.applies !== "no") { state = { kind: "unclear", reason: `${parser.label} is registered inside a condition, loop or callback`, at }; break; }
        continue;
      }
      if (applies === "unknown") {
        const parser = placed.item.kind === "wrapper" ? placed.item.parser : placed.item;
        if (parser.applies !== "no") { state = { kind: "unclear", reason: `the path of ${parser.label} could not be matched with the webhook path ${routeText}`, at }; break; }
        continue;
      }
      let parser: Parser & { file: string; line: number };
      if (placed.item.kind === "wrapper") {
        const skips = path.kind === "literal" ? this.wrapperSkips(placed.item.fn, placed.item.sf, path.value) : undefined;
        if (skips === true) continue;
        if (skips === undefined) { state = { kind: "unclear", reason: `${placed.item.label} decides at runtime whether ${placed.item.parser.label} runs`, at }; break; }
        parser = placed.item.parser;
      } else parser = placed.item;
      if (parser.applies === "unknown") { state = { kind: "unclear", reason: `the options of ${parser.label} could not be read statically`, at }; break; }
      if (parser.applies === "no") { if (parser.parser === "raw" || parser.parser === "text") state = { kind: "none", mismatch: parser }; continue; }
      state = parser.parser === "json" || parser.parser === "urlencoded" ? { kind: "parsed", parser } : { kind: "raw" };
      break;
    }
    const add = (status: "red" | "yellow", problem: string, fix = RAW_FIX) => { this.seenRoutes.add(route); this.risks.push({ ...site, status, problem, fix }); };
    const routeName = `the Stripe webhook route ${routeText} (${where})`;
    if (state.kind === "parsed") {
      const p = state.parser;
      const at = `${p.file}:${p.line}`;
      if (payload.kind === "property" && payload.name === p.preserved) return;
      const keep = p.preserved ? ` Pass req.${p.preserved}, which the verify callback of ${p.label} at ${at} keeps, to constructEvent instead.` : "";
      if (payload.kind === "body") {
        const certain = rooted && !p.verify;
        add(certain || (rooted && p.preserved) ? "red" : "yellow", `${p.label} at ${at} parses Stripe's JSON body before ${routeName}, so constructEvent receives a parsed object instead of the raw request bytes and signature verification fails.${keep}${rooted ? "" : " The router's mount point is not visible, so the full middleware order is not established."}`);
      } else if (payload.kind === "reserialized") add("yellow", `${p.label} at ${at} parses the body before ${routeName}, and the handler re-serializes req.body for constructEvent. Re-serialized JSON rarely matches the signed bytes.${keep}`);
      else if (payload.kind === "property") add("yellow", `${p.label} at ${at} parses the body before ${routeName}, and no visible middleware sets req.${payload.name}, which constructEvent receives.${keep}`);
      else add("yellow", `${p.label} at ${at} reads the request stream before ${routeName}; the handler builds the payload for constructEvent another way, which may then receive an empty body. Review how the raw bytes reach constructEvent.${keep}`);
      return;
    }
    if (state.kind === "unclear") {
      add("yellow", `Could not establish whether a JSON body parser runs before ${routeName}: ${state.reason} (${state.at}). Stripe signature verification needs the raw request bytes; review this middleware chain.`);
      return;
    }
    if (state.kind === "none" && payload.kind === "body" && state.mismatch) {
      const m = state.mismatch;
      add("yellow", `${m.label} at ${m.file}:${m.line} only parses ${DEFAULT_TYPE[m.parser]} by default, but Stripe sends application/json, so req.body is not the raw payload for ${routeName}.`, `Set the type explicitly, for example express.raw({ type: 'application/json' }), on the webhook route. Then send a signed test event (stripe trigger) and confirm verification succeeds.`);
    }
  }

  private payload(hook: Webhook): { kind: "body" | "reserialized" | "other" } | { kind: "property"; name: string } {
    const param = hook.fn.parameters[0]?.name;
    const req = param && ts.isIdentifier(param) ? param.text : undefined;
    const destructuredBody = param && ts.isObjectBindingPattern(param) ? param.elements.find(e => (e.propertyName?.getText() ?? e.name.getText()) === "body")?.name.getText() : undefined;
    let arg = hook.verifier.arguments[0] && unwrap(hook.verifier.arguments[0]);
    if (arg && ts.isIdentifier(arg)) {
      const name = arg.text;
      let init: ts.Expression | undefined;
      const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) init = n.initializer; ts.forEachChild(n, visit); };
      if (hook.fn.body) visit(hook.fn.body);
      if (init) arg = unwrap(init);
    }
    const classify = (n: ts.Node | undefined): { kind: "body" | "reserialized" | "other" } | { kind: "property"; name: string } => {
      if (!n) return { kind: "other" };
      n = unwrap(n);
      if (ts.isIdentifier(n) && n.text === destructuredBody) return { kind: "body" };
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === req) return n.name.text === "body" ? { kind: "body" } : { kind: "property", name: n.name.text };
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "toString") return classify(n.expression.expression);
      if (ts.isCallExpression(n) && n.expression.getText() === "Buffer.from") return classify(n.arguments[0]);
      if (ts.isCallExpression(n) && n.expression.getText() === "JSON.stringify") return classify(n.arguments[0]).kind === "body" ? { kind: "reserialized" } : { kind: "other" };
      return { kind: "other" };
    };
    return classify(arg);
  }
}

/** Express apps and routers in the snapshot, with their Stripe webhook handlers and body-parser findings. */
export function expressStripeWebhooks(graph: SourceGraph, files: string[]) {
  const analysis = new ExpressAnalysis(graph, files);
  analysis.run();
  return { risks: analysis.risks, webhooks: analysis.webhooks, evaluated: analysis.evaluated };
}
