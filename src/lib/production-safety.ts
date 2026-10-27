import ts from "typescript";
import { stripeReplayRisks } from "@/lib/stripe-replay";
import type { RepositorySnapshot } from "@/lib/analyzer";
import type { CheckResult, Finding } from "@/types/report";

import { PRODUCTION_RULES } from "@/lib/production-rules";
export { PRODUCTION_RULES } from "@/lib/production-rules";
type Rule = typeof PRODUCTION_RULES[number];
const SOURCE = /\.[cm]?[jt]sx?$/;
const EXCLUDED = /(?:^|\/)(?:tests?|__tests__|__mocks__|fixtures|spec|examples?|scripts|cli|action)\/|\.(?:test|spec|stories)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;
const ROUTE = /^(?:src\/)?app\/(?:.*\/)?route\.[cm]?[jt]s$/;
const PAGES_API = /^(?:src\/)?pages\/api\/.*\.[cm]?[jt]s$/;
const unwrap = (n: ts.Node): ts.Node => ts.isAwaitExpression(n) || ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) ? unwrap(n.expression) : n;
const prop = (n: ts.Node) => ts.isPropertyAccessExpression(n) ? n.name.text : "";
const literal = (n: ts.Node | undefined) => n && ts.isStringLiteralLike(n) ? n.text : undefined;
const name = (n: ts.Node) => ts.isIdentifier(n) || ts.isStringLiteralLike(n) ? n.text : "";
const exported = (n: ts.Node) => ts.canHaveModifiers(n) && ts.getModifiers(n)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);

/** Pure source analysis. No evaluated code, network, secret values or inferred hosting configuration. */
export function checkProductionSafety(snapshot: RepositorySnapshot): CheckResult {
  const findings: Finding[] = [];
  const evaluated = new Set<Rule>();
  let parseIncomplete = false;
  let hasNext = false;
  try { const pkg = JSON.parse(snapshot.contents.get("package.json") ?? "{}"); hasNext = Boolean(pkg.dependencies?.next || pkg.devDependencies?.next); } catch { /* Unknown framework: do not infer Next-specific errors. */ }
  for (const [file, source] of snapshot.contents) {
    if (!SOURCE.test(file) || EXCLUDED.test(file)) continue;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    // Syntax errors require a real build; do not derive confident security claims from a recovered tree.
    if ((sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) { parseIncomplete = true; continue; }
    const nodes: ts.Node[] = [];
    const walk = (n: ts.Node) => { nodes.push(n); ts.forEachChild(n, walk); };
    walk(sf);
    const imports = sf.statements.filter(ts.isImportDeclaration).filter(n => !n.importClause?.isTypeOnly);
    const modules = imports.map(n => literal(n.moduleSpecifier));
    const stripeNames = new Set(imports.filter(n => literal(n.moduleSpecifier) === "stripe").flatMap(n => n.importClause?.name ? [n.importClause.name.text] : []));
    const stripeInstances = new Set(nodes.filter(ts.isVariableDeclaration).filter(n => n.initializer && ts.isNewExpression(n.initializer) && stripeNames.has(n.initializer.expression.getText(sf))).map(n => name(n.name)));
    // Common singleton/factory modules, without importing or executing their code.
    const stripeClients = new Set(imports.filter(n => /(?:^|\/)stripe(?:[-.][\w-]+)?$/.test(literal(n.moduleSpecifier) ?? "") && literal(n.moduleSpecifier) !== "stripe").flatMap(n => [
      ...(n.importClause?.name ? [n.importClause.name.text] : []),
      ...(n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings) ? n.importClause.namedBindings.elements.filter(e => !e.isTypeOnly).map(e => e.name.text) : []),
    ]));
    const route = hasNext && ROUTE.test(file), pages = hasNext && PAGES_API.test(file);
    let client = false;
    for (const statement of sf.statements) {
      if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
      if (statement.expression.text === "use client") client = true;
    }
    const calls = nodes.filter(ts.isCallExpression);
    const requests = new Set<string>();
    for (const n of nodes) if (ts.isFunctionDeclaration(n) && n.name && ["GET", "POST", "PUT", "PATCH", "DELETE", "handler"].includes(n.name.text)) {
      if (n.parameters[0] && ts.isIdentifier(n.parameters[0].name)) requests.add(n.parameters[0].name.text);
    }
    for (const n of nodes) if (ts.isVariableDeclaration(n) && ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(name(n.name)) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
      const parameter = n.initializer.parameters[0];
      if (parameter && ts.isIdentifier(parameter.name)) requests.add(parameter.name.text);
    }
    const requestJson = (node: ts.Node): boolean => {
      const n = unwrap(node);
      return ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "json" && requests.has(n.expression.expression.getText(sf));
    };
    const transformed = (node: ts.Node): boolean => {
      const n = unwrap(node);
      return requestJson(n) || (ts.isCallExpression(n) && ["JSON.parse", "JSON.stringify"].includes(n.expression.getText(sf)));
    };
    const declarations = nodes.filter(ts.isVariableDeclaration);
    const transformedNames = new Set(declarations.filter(n => n.initializer && transformed(n.initializer)).map(n => name(n.name)));
    const jsonEvents = new Set(declarations.filter(n => n.initializer && requestJson(n.initializer)).map(n => name(n.name)));
    const add = (ruleId: Rule, node: ts.Node, status: "red" | "yellow", problem: string, fix: string) => {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      if (!findings.some(f => f.file === file && f.line === line && f.ruleId === ruleId)) findings.push({ ruleId, status, file, line, problem, fix });
    };
    const verifiers = calls.filter(n => {
      if (!["constructEvent", "constructEventAsync"].includes(prop(n.expression)) || !ts.isPropertyAccessExpression(n.expression) || !ts.isPropertyAccessExpression(n.expression.expression) || n.expression.expression.name.text !== "webhooks") return false;
      const client = n.expression.expression.expression;
      return ts.isIdentifier(client) ? stripeInstances.has(client.text) || stripeClients.has(client.text)
        : ts.isCallExpression(client) && ts.isIdentifier(client.expression) && stripeClients.has(client.expression.text);
    });
    if ((route || pages) && verifiers.length) {
      evaluated.add("stripe-event-replay"); evaluated.add("stripe-memory-deduplication");
      for (const risk of stripeReplayRisks(sf, nodes, verifiers)) add(risk.ruleId, risk.node, "yellow", risk.problem, risk.fix);
    }
    if (stripeNames.size || stripeClients.size) {
      evaluated.add("stripe-raw-body"); evaluated.add("checkout-local-redirect");
      for (const call of verifiers) if (call.arguments[0] && (transformed(call.arguments[0]) || transformedNames.has(call.arguments[0].getText(sf)))) {
        add("stripe-raw-body", call, "yellow", "Stripe signature verification receives a parsed or reserialized payload.", "Pass the original unmodified request bytes/text to constructEvent before JSON parsing; test an actual signed webhook delivery.");
      }
      if (pages && verifiers.length) {
        evaluated.add("stripe-pages-body-parser");
        const disabled = nodes.some(n => ts.isPropertyAssignment(n) && name(n.name) === "bodyParser" && n.initializer.kind === ts.SyntaxKind.FalseKeyword);
        if (!disabled) add("stripe-pages-body-parser", verifiers[0], "yellow", "Pages API Stripe webhook does not visibly disable automatic body parsing.", "Export config = { api: { bodyParser: false } } for this Pages API route and read raw bytes before signature verification. App Router request.text() does not need this config.");
      }
      if ((route || pages) && /webhook/i.test(file)) {
        evaluated.add("stripe-event-verification");
        if (!verifiers.length && !calls.some(n => /verify|signature|webhook/i.test(n.expression.getText(sf)))) {
          const eventRead = nodes.find(n => ts.isPropertyAccessExpression(n) && n.name.text === "type" && jsonEvents.has(n.expression.getText(sf)));
          if (eventRead) add("stripe-event-verification", eventRead, "yellow", "Webhook event.type is read directly from request JSON without a visible local signature verifier.", "Confirm middleware authenticates this endpoint, or verify the raw payload with Stripe's webhook signing secret before using the event. Imported authorization cannot be established by this check.");
        }
      }
      for (const call of calls) {
        if (!ts.isPropertyAccessExpression(call.expression) || !call.expression.getText(sf).endsWith(".checkout.sessions.create") || !stripeInstances.has(call.expression.getText(sf).split(".")[0])) continue;
        const object = call.arguments[0];
        if (!object || !ts.isObjectLiteralExpression(object)) continue;
        for (const p of object.properties) if (ts.isPropertyAssignment(p) && ["success_url", "cancel_url"].includes(name(p.name))) {
          const value = literal(p.initializer);
          if (value && /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value)) add("checkout-local-redirect", p, "yellow", `Stripe ${name(p.name)} points directly to a loopback address.`, "Use an authorized production HTTPS origin for deployed checkout redirects. Keep local-only checkout code behind an explicit development configuration; verify redirects in Stripe test mode.");
        }
      }
    }
    if (route) {
      evaluated.add("next-runtime-value"); evaluated.add("personalized-static-cache");
      const settings = declarations.filter(n => ts.isVariableStatement(n.parent.parent) && exported(n.parent.parent));
      for (const n of settings) if (name(n.name) === "runtime") {
        const value = literal(n.initializer);
        if (value && !["nodejs", "edge"].includes(value)) add("next-runtime-value", n, value === "experimental-edge" ? "yellow" : "red", "Route exports a runtime literal other than nodejs or edge.", "Use an officially supported runtime value for your Next.js version: nodejs (default) or edge. Check imported dependencies before switching.");
      }
      const forced = settings.some(n => name(n.name) === "dynamic" && literal(n.initializer) === "force-static");
      const get = sf.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "GET")
        ?? declarations.find(n => name(n.name) === "GET" && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)));
      if (forced && get) {
        const sensitive = nodes.find(n => n.pos >= get.pos && n.end <= get.end && ts.isPropertyAccessExpression(n) && ["cookies", "headers"].includes(n.name.text) && requests.has(n.expression.getText(sf)));
        if (sensitive) add("personalized-static-cache", sensitive, "yellow", "A force-static GET handler reads request cookies or headers.", "Remove force-static from request-dependent handlers and use private, no-store responses for personalized or payment data. Verify behavior with two different sessions; a data leak is not proven by static scanning.");
      }
    }
    if (client && hasNext) {
      evaluated.add("next-client-boundary");
      // TypeScript/SWC removes unused and type-position-only imports. Their source text alone is not a build error.
      const runtimeUses = new Set<string>();
      const valueReferences = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) return;
        if (ts.isIdentifier(node)) {
          const parent = node.parent;
          const keyOnly = (ts.isPropertyAccessExpression(parent) && parent.name === node)
            || ((parent as ts.NamedDeclaration).name === node && !ts.isShorthandPropertyAssignment(parent));
          if (!keyOnly) runtimeUses.add(node.text);
        }
        ts.forEachChild(node, valueReferences);
      };
      valueReferences(sf);
      for (const n of imports) {
        const clause = n.importClause;
        const onlyTypes = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && !clause.name && clause.namedBindings.elements.every(e => e.isTypeOnly);
        const bindings = [...(clause?.name ? [clause.name.text] : []), ...(clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.filter(e => !e.isTypeOnly).map(e => e.name.text) : []), ...(clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? [clause.namedBindings.name.text] : [])];
        // With shadowed names we cannot establish which declaration a reference uses, so leave this case to the build.
        const used = bindings.some(binding => runtimeUses.has(binding) && !nodes.some(node => (ts.isVariableDeclaration(node) || ts.isBindingElement(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)) && node.name && name(node.name) === binding));
        const sideEffectMarker = !clause && literal(n.moduleSpecifier) === "server-only";
        if (!onlyTypes && (used || sideEffectMarker) && ["server-only", "next/headers"].includes(literal(n.moduleSpecifier) ?? "")) add("next-client-boundary", n, "red", "A use-client module directly imports a server-only module.", "Move the server-only operation into a Server Component or authenticated Route Handler; pass serializable data to the client component.");
      }
      for (const n of sf.statements) if (exported(n)) {
        const metadata = ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ["metadata", "generateMetadata"].includes(name(d.name)));
        const generator = ts.isFunctionDeclaration(n) && n.name?.text === "generateMetadata";
        if ((metadata || generator) && /^(?:src\/)?app\/(?:.*\/)?(?:page|layout)\.[jt]sx?$/.test(file)) add("next-client-boundary", n, "red", "A use-client module exports server-only Next.js metadata.", "Keep page/layout metadata in a Server Component and move the interactive UI into a separate use-client component.");
      }
    }
    if (modules.some(m => m === "node:https" || m === "https")) {
      evaluated.add("tls-verification-disabled");
      const agents = new Set(imports.filter(n => ["node:https", "https"].includes(literal(n.moduleSpecifier) ?? "")).flatMap(n => {
        const c = n.importClause;
        return [...(c?.name ? [c.name.text + ".Agent"] : []), ...(c?.namedBindings && ts.isNamespaceImport(c.namedBindings) ? [c.namedBindings.name.text + ".Agent"] : []), ...(c?.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements.filter(e => (e.propertyName?.text ?? e.name.text) === "Agent").map(e => e.name.text) : [])];
      }));
      for (const n of nodes) if (ts.isNewExpression(n) && agents.has(n.expression.getText(sf))) {
        const arg = n.arguments?.[0];
        if (arg && ts.isObjectLiteralExpression(arg)) for (const p of arg.properties) if (ts.isPropertyAssignment(p) && name(p.name) === "rejectUnauthorized" && p.initializer.kind === ts.SyntaxKind.FalseKeyword) add("tls-verification-disabled", p, "yellow", "A Node HTTPS Agent explicitly disables TLS certificate verification.", "Remove rejectUnauthorized:false. Configure the correct CA certificate instead; verify whether this code is reachable in production.");
      }
    }
  }
  const status = findings.some(f => f.status === "red") ? "red" : findings.length || snapshot.partial || parseIncomplete ? "yellow" : "green";
  return { id: "production-safety", category: "vercel", title: "Payment and production safety", status,
    explanation: !evaluated.size && !snapshot.partial && !parseIncomplete ? "No applicable production safety patterns were found. No payment or runtime behavior was verified." : findings.length ? `${findings.length} source-backed production risks. Review findings are not confirmed vulnerabilities.` : snapshot.partial || parseIncomplete ? "No production safety findings in the files read; coverage is incomplete." : "No matching production safety risks in the source files checked. This is not a payment or runtime verification.",
    fix: findings[0]?.fix ?? "Review runtime behavior, payment fulfillment and production configuration independently.",
    evidence: findings.slice(0, 8).map(f => `${f.file}:${f.line} → ${f.problem}`), findings,
    evaluatedRules: [...evaluated], coverageOnly: !findings.length && (snapshot.partial || parseIncomplete) };
}
