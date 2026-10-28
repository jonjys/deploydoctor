import ts from "typescript";
import { exits, isFunctionNode, isStripeVerifierCall, lineOf, literalText, unwrap, type FunctionNode, type SourceGraph } from "@/lib/source-graph";
import { balanced, splitSql, splitTopLevel, type ConstraintIndex, type Uniqueness } from "@/lib/schema-constraints";

/**
 * Duplicate-delivery review for a verified Stripe webhook handler. It follows the handler and the local or
 * imported helpers it calls, in order, and links each database write to its table and key in the Prisma schema
 * or Supabase migrations of the same snapshot. It never executes code and never claims a confirmed vulnerability:
 * the outcome is either "no review needed from what is visible", or a review item that says what could not be
 * established. Event IDs that are only logged or handed to code that cannot be read are not treated as protection.
 */
export type Taint = "event" | "event-data" | "payload" | "event-id" | "object-id" | "value";
type Column = { column: string; taint?: Taint };
type Site = { file: string; line: number };
type Write = { kind: "write"; verb: "create" | "insert" | "upsert" | "update"; target?: string; data: Column[]; keys: Column[]; conflict?: "nothing" | "update";
  conflictColumns?: string[]; inherentUnique?: string; relative?: boolean; throwsOnConflict: boolean; conditional: boolean; throwsOnNoMatch: boolean; checked: boolean; swallowed: boolean; tx?: number; at: Site; order: number; via?: string };
type Read = { kind: "read"; target?: string; keys: Column[]; guards: boolean; locked: boolean; tx?: number; at: Site; order: number; via?: string };
type Opaque = { kind: "opaque"; name: string; reason: string; taints: Taint[]; tx?: number; at: Site; order: number };
type Log = { kind: "log"; taints: Taint[]; at: Site; order: number };
export type Effect = Write | Read | Opaque | Log;
export type IdempotencyRisk = { ruleId: "stripe-event-replay" | "stripe-idempotency-race" | "stripe-idempotency-unestablished"; file: string; line: number; problem: string; fix: string };

/** Stripe object identifiers: an object's own id and the IDs it points to (payment_intent, metadata.orderId, ...). */
const OBJECT_ID = /^(?:id|\w+_id|\w+Id|payment_intent|subscription|invoice|customer|charge|setup_intent|client_reference_id)$/;
const isId = (taint?: Taint) => taint === "event-id" || taint === "object-id";
const LOG_ROOTS = new Set(["console", "logger", "log", "Sentry", "captureException", "captureMessage"]);
const RESPONSE_ROOTS = new Set(["res", "response", "reply", "Response", "NextResponse"]);
const PURE_ROOTS = new Set(["JSON", "Math", "Object", "Array", "Number", "String", "Boolean", "Date", "Promise", "Buffer", "parseInt", "parseFloat", "encodeURIComponent", "decodeURIComponent", "structuredClone", "BigInt"]);
const CALLBACK_METHODS = new Set(["map", "forEach", "filter", "flatMap", "reduce", "some", "every", "find", "then", "catch", "finally"]);
const PURE_METHODS = new Set(["includes", "indexOf", "startsWith", "endsWith", "join", "slice", "concat", "split", "replace", "match", "test", "toFixed", "padStart", "at", "keys", "values", "entries", "localeCompare"]);
const STRIPE_READS = new Set(["retrieve", "list", "search", "listLineItems", "retrieveUpcoming", "constructEvent", "constructEventAsync"]);
/** Stripe API calls that set state (a second call leaves the same state) rather than create a new charge, refund or transfer. */
const STRIPE_SETS = new Set(["update", "del", "cancel", "expire", "close", "markUncollectible", "voidInvoice", "detach"]);
const READS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "findOne", "exists", "findById"]);
const WRITES: Record<string, Write["verb"]> = { create: "create", createMany: "create", createManyAndReturn: "create", insert: "insert", insertOne: "insert", insertMany: "insert",
  upsert: "upsert", save: "upsert", update: "update", updateMany: "update", updateOne: "update", findOneAndUpdate: "update", findByIdAndUpdate: "update" };
const RAW_SQL_METHODS = new Set(["query", "execute", "$executeRawUnsafe", "$queryRawUnsafe", "unsafe", "none", "one", "oneOrNone", "many", "manyOrNone", "any"]);
const SQL_TAG = /(?:^|\.)(?:sql|\$queryRaw|\$executeRaw)$/;

function childTaint(base: Taint | undefined, name: string | undefined): Taint | undefined {
  if (!base || !name) return undefined;
  if (base === "event") return name === "id" ? "event-id" : name === "data" ? "event-data" : undefined;
  if (base === "event-data") return name === "object" ? "payload" : "value";
  if (base === "payload" || base === "value" || base === "object-id") return OBJECT_ID.test(name) ? "object-id" : "value";
  return undefined;
}

export function taintOf(node: ts.Node, env: Map<string, Taint>): Taint | undefined {
  const n = unwrap(node);
  if (ts.isIdentifier(n)) return env.get(n.text);
  if (ts.isPropertyAccessExpression(n)) return childTaint(taintOf(n.expression, env), n.name.text);
  if (ts.isElementAccessExpression(n)) return childTaint(taintOf(n.expression, env), literalText(n.argumentExpression));
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["toString", "toLowerCase", "toUpperCase", "trim"].includes(n.expression.name.text)) return taintOf(n.expression.expression, env);
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ["String", "Number"].includes(n.expression.text) && n.arguments[0]) return taintOf(n.arguments[0], env);
  // stripe.checkout.sessions.retrieve(session.id) returns the same Stripe object.
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "retrieve" && n.arguments[0] && isId(taintOf(n.arguments[0], env))) return "payload";
  if (ts.isTemplateExpression(n)) return n.templateSpans.map(span => taintOf(span.expression, env)).find(Boolean);
  if (ts.isBinaryExpression(n) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(n.operatorToken.kind)) return taintOf(n.left, env) ?? taintOf(n.right, env);
  if (ts.isConditionalExpression(n)) return taintOf(n.whenTrue, env) ?? taintOf(n.whenFalse, env);
  if (ts.isObjectLiteralExpression(n)) return n.properties.some(p => (ts.isPropertyAssignment(p) && taintOf(p.initializer, env)) || (ts.isShorthandPropertyAssignment(p) && env.get(p.name.text))) ? "value" : undefined;
  return undefined;
}

/** Every taint inside an argument (object properties, arrays, nested calls), without entering function bodies. */
function deepTaints(node: ts.Node, env: Map<string, Taint>): Taint[] {
  const found = new Set<Taint>();
  const visit = (n: ts.Node) => {
    if (isFunctionNode(n)) return;
    if (ts.isShorthandPropertyAssignment(n)) { const taint = env.get(n.name.text); if (taint) found.add(taint); return; }
    if (ts.isExpression(n)) {
      const taint = taintOf(n, env);
      if (taint && !ts.isObjectLiteralExpression(unwrap(n))) { found.add(taint); return; }
      // event.type or session.amount_total is a property of a tracked value, not the value itself.
      if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) || ts.isIdentifier(n)) return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return [...found];
}

function columns(object: ts.Node | undefined, env: Map<string, Taint>): Column[] {
  const value = object && unwrap(object);
  if (!value) return [];
  if (ts.isArrayLiteralExpression(value)) return columns(value.elements[0], env);
  if (!ts.isObjectLiteralExpression(value)) return [];
  const out: Column[] = [];
  for (const property of value.properties) {
    if (ts.isShorthandPropertyAssignment(property)) out.push({ column: property.name.text.toLowerCase(), taint: env.get(property.name.text) });
    else if (ts.isPropertyAssignment(property)) {
      const name = (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : property.name.getText()).toLowerCase();
      const inner = unwrap(property.initializer);
      // Prisma compound unique input: where: { eventId_kind: { eventId, kind } }
      if (name.includes("_") && ts.isObjectLiteralExpression(inner) && inner.properties.every(p => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p))) {
        const nested = columns(inner, env);
        if (nested.length > 1 && nested.every(c => name.split("_").includes(c.column))) { out.push(...nested); continue; }
      }
      // Operator objects ({ not: "paid" }, { in: [...] }) are predicates, not keys.
      if (ts.isObjectLiteralExpression(inner)) { out.push({ column: name, taint: undefined }); continue; }
      out.push({ column: name, taint: taintOf(inner, env) });
    }
  }
  return out;
}

const objectProperty = (object: ts.Node | undefined, name: string) => {
  const value = object && unwrap(object);
  if (!value || !ts.isObjectLiteralExpression(value)) return undefined;
  const property = value.properties.find(p => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === name);
  return property && ts.isPropertyAssignment(property) ? property.initializer : undefined;
};

/** { credits: { increment: 1 } }, { $inc: ... }: an update that adds to the current value instead of setting it. */
function relative(object: ts.Node | undefined): boolean {
  const value = object && unwrap(object);
  if (!value || !ts.isObjectLiteralExpression(value)) return false;
  return value.properties.some(p => {
    const name = p.name?.getText().replace(/['"]/g, "") ?? "";
    if (["$inc", "$push", "$addToSet", "increment", "decrement", "multiply", "divide", "push"].includes(name)) return true;
    return ts.isPropertyAssignment(p) && relative(p.initializer);
  });
}

/** Root of a call chain: `a` in a.b().c.d(). */
function chainRoot(expression: ts.Expression): ts.Expression {
  let current = unwrap(expression) as ts.Expression;
  for (;;) {
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) current = unwrap(current.expression) as ts.Expression;
    else if (ts.isCallExpression(current)) current = unwrap(current.expression) as ts.Expression;
    else return current;
  }
}
/** The calls of a fluent chain, innermost first: supabase.from("t").insert(x).select() → from, insert, select. */
function chainCalls(call: ts.CallExpression) {
  const calls: Array<{ name: string; call: ts.CallExpression }> = [];
  let current: ts.Expression = call;
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    calls.unshift({ name: current.expression.name.text, call: current });
    current = unwrap(current.expression.expression) as ts.Expression;
  }
  return calls;
}

type Callback = { fn: FunctionNode; file: string; sf: ts.SourceFile; env: Map<string, Taint> };
type Frame = { file: string; sf: ts.SourceFile; env: Map<string, Taint>; vars: Map<string, Effect[]>; fns: Map<string, Callback>; tx?: number; noExitCatch: boolean; depth: number; active: (node: ts.Node) => boolean };

class Walker {
  readonly effects: Effect[] = [];
  private order = 0;
  private tx = 0;
  private readonly visiting = new Set<FunctionNode>();
  private readonly stripeNames: Set<string>;
  constructor(private readonly graph: SourceGraph, private readonly constraints: ConstraintIndex, stripeNames: Set<string>) { this.stripeNames = new Set(stripeNames); }

  private site(frame: Frame, node: ts.Node): Site { return { file: frame.file, line: lineOf(frame.sf, node) }; }
  private push<T extends Effect>(effect: Omit<T, "order">): T { const full = { ...effect, order: ++this.order } as T; this.effects.push(full); return full; }

  run(file: string, sf: ts.SourceFile, fn: FunctionNode, env: Map<string, Taint>, after: number) {
    this.visiting.add(fn);
    const frame: Frame = { file, sf, env, vars: new Map(), fns: new Map(), noExitCatch: false, depth: 0, active: node => node.pos >= after };
    if (fn.body) this.visit(fn.body, frame);
  }

  private inline(fn: FunctionNode, frame: Frame) {
    for (const parameter of fn.parameters) this.bind(parameter.name, undefined, frame.env);
    if (fn.body) this.visit(fn.body, frame);
  }

  private bind(name: ts.BindingName, taint: Taint | undefined, env: Map<string, Taint>) {
    if (ts.isIdentifier(name)) { if (taint) env.set(name.text, taint); else env.delete(name.text); return; }
    if (ts.isObjectBindingPattern(name)) for (const element of name.elements) {
      const key = element.propertyName ? element.propertyName.getText() : ts.isIdentifier(element.name) ? element.name.text : undefined;
      this.bind(element.name, childTaint(taint, key), env);
    }
  }

  private visit(node: ts.Node, frame: Frame): void {
    if (isFunctionNode(node)) return;
    if (ts.isVariableDeclaration(node)) {
      const before = this.effects.length;
      if (node.initializer) this.visit(node.initializer, frame);
      const produced = this.effects.slice(before);
      const init = node.initializer && unwrap(node.initializer);
      const taint = init && isStripeVerifierCall(init) ? "event" : node.initializer ? taintOf(node.initializer, frame.env) : undefined;
      this.bind(node.name, taint, frame.env);
      // const stripe = new Stripe(key) / stripeClient() / require("stripe")(key)
      const maker = init && (ts.isNewExpression(init) || ts.isCallExpression(init)) ? unwrap(init.expression) : undefined;
      if (maker && ts.isIdentifier(node.name) && ((ts.isIdentifier(maker) && this.stripeNames.has(maker.text)) || (ts.isCallExpression(maker) && literalText(maker.arguments[0]) === "stripe"))) this.stripeNames.add(node.name.text);
      const names: string[] = [];
      const collect = (name: ts.BindingName) => { if (ts.isIdentifier(name)) names.push(name.text); else for (const e of name.elements) if (!ts.isOmittedExpression(e)) collect(e.name); };
      collect(node.name);
      for (const name of names) frame.vars.set(name, produced);
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      const before = this.effects.length;
      this.visit(node.right, frame);
      frame.vars.set(node.left.text, this.effects.slice(before));
      // A later untainted assignment does not erase an earlier tainted one: another branch may have run.
      const taint = isStripeVerifierCall(unwrap(node.right)) ? "event" : taintOf(node.right, frame.env);
      if (taint) frame.env.set(node.left.text, taint);
      return;
    }
    if (ts.isIfStatement(node)) {
      const before = this.effects.length;
      this.visit(node.expression, frame);
      const guarded = [...this.effects.slice(before)];
      const refer = (n: ts.Node) => { if (ts.isIdentifier(n) && frame.vars.has(n.text)) guarded.push(...frame.vars.get(n.text)!); ts.forEachChild(n, refer); };
      refer(node.expression);
      const thenStart = this.effects.length;
      this.visit(node.thenStatement, frame);
      const writesInThen = this.effects.slice(thenStart).some(e => e.kind === "write");
      if (exits(node.thenStatement) || writesInThen) for (const effect of guarded) {
        if (effect.kind === "read") effect.guards = true;
        if (effect.kind === "write" && exits(node.thenStatement)) effect.checked = true;
      }
      if (node.elseStatement) this.visit(node.elseStatement, frame);
      return;
    }
    if (ts.isTryStatement(node)) {
      const catchExits = Boolean(node.catchClause && exits(node.catchClause.block));
      this.visit(node.tryBlock, { ...frame, noExitCatch: frame.noExitCatch || (Boolean(node.catchClause) && !catchExits) });
      if (node.catchClause) this.visit(node.catchClause.block, frame);
      if (node.finallyBlock) this.visit(node.finallyBlock, frame);
      return;
    }
    if (ts.isTaggedTemplateExpression(node) && SQL_TAG.test(node.tag.getText(frame.sf)) && frame.active(node)) {
      const spans = ts.isTemplateExpression(node.template) ? node.template.templateSpans.map(s => s.expression) : [];
      const text = ts.isTemplateExpression(node.template)
        ? node.template.head.text + node.template.templateSpans.map((s, i) => `__dd${i}__` + s.literal.text).join("")
        : node.template.text;
      this.sql(text, expr => { const m = /__dd(\d+)__/.exec(expr); return m ? taintOf(spans[Number(m[1])], frame.env) : undefined; }, this.site(frame, node), frame, undefined, true);
      return;
    }
    if (ts.isCallExpression(node)) { this.call(node, frame); return; }
    ts.forEachChild(node, child => this.visit(child, frame));
  }

  private visitArgs(call: ts.CallExpression, frame: Frame) {
    for (const arg of call.arguments) {
      const value = unwrap(arg);
      if (isFunctionNode(value)) this.inline(value, frame); else this.visit(arg, frame);
    }
  }

  private call(call: ts.CallExpression, frame: Frame) {
    const { sf } = frame;
    const callee = unwrap(call.expression) as ts.Expression;
    if (isStripeVerifierCall(call) || !frame.active(call)) { this.visitArgs(call, frame); return; }
    const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
    const root = chainRoot(callee);
    const rootName = ts.isIdentifier(root) ? root.text : ts.isCallExpression(root) && ts.isIdentifier(root.expression) ? root.expression.text : "";

    // Transactions: everything in the callback (or array) shares one transaction id.
    if (["$transaction", "transaction"].includes(method)) {
      const tx = ++this.tx;
      const inner = { ...frame, tx };
      for (const arg of call.arguments) {
        const value = unwrap(arg);
        if (isFunctionNode(value)) this.inline(value, inner);
        else if (ts.isArrayLiteralExpression(value)) value.elements.forEach(element => this.visit(element, inner));
      }
      return;
    }
    if (LOG_ROOTS.has(rootName)) {
      const taints = call.arguments.flatMap(arg => deepTaints(arg, frame.env));
      if (taints.length) this.push<Log>({ kind: "log", taints, at: this.site(frame, call) });
      return;
    }
    if (RESPONSE_ROOTS.has(rootName)) return;
    if (this.stripeNames.has(rootName)) {
      const taints = call.arguments.flatMap(arg => deepTaints(arg, frame.env));
      // stripe.refunds.create(params, { idempotencyKey: event.id }): Stripe itself rejects the repeat.
      const keyed = call.arguments.some(arg => { const key = objectProperty(arg, "idempotencyKey"); return Boolean(key && isId(taintOf(key, frame.env))); });
      if (!STRIPE_READS.has(method) && !STRIPE_SETS.has(method) && !keyed && taints.length) this.push<Opaque>({ kind: "opaque", name: callee.getText(sf), reason: "it creates something through the Stripe API without an idempotencyKey derived from the event or object ID", taints, tx: frame.tx, at: this.site(frame, call) });
      return;
    }
    if (ts.isPropertyAccessExpression(callee) && STRIPE_READS.has(method)) { this.visitArgs(call, frame); return; }
    if (method === "rpc" && literalText(call.arguments[0])) { this.rpc(call, frame); return; }
    // Redis SET key value NX (or SETNX): an atomic claim of a key that exists at most once.
    const nx = method === "setnx" || (method === "set" && call.arguments.slice(2).some(arg => /^nx$/i.test(literalText(unwrap(arg)) ?? "") || objectProperty(arg, "nx")?.kind === ts.SyntaxKind.TrueKeyword || objectProperty(arg, "NX")?.kind === ts.SyntaxKind.TrueKeyword));
    if (nx && call.arguments[0]) {
      this.write(frame, call, { verb: "insert", target: "Redis", data: [{ column: "key", taint: taintOf(call.arguments[0], frame.env) }], keys: [], conflict: "nothing", inherentUnique: "SET NX", throwsOnConflict: false, conditional: false, throwsOnNoMatch: false });
      return;
    }
    if (RAW_SQL_METHODS.has(method) && call.arguments[0]) {
      const first = unwrap(call.arguments[0]);
      const text = literalText(first) ?? (ts.isTemplateExpression(first) ? first.head.text + first.templateSpans.map((s, i) => `__dd${i}__` + s.literal.text).join("") : undefined);
      if (text && /\b(?:insert|update|select)\b/i.test(text)) {
        const spans = ts.isTemplateExpression(first) ? first.templateSpans.map(s => s.expression) : [];
        const params = call.arguments[1] && ts.isArrayLiteralExpression(unwrap(call.arguments[1])) ? (unwrap(call.arguments[1]) as ts.ArrayLiteralExpression).elements : undefined;
        this.sql(text, expr => {
          const marker = /__dd(\d+)__/.exec(expr);
          if (marker) return taintOf(spans[Number(marker[1])], frame.env);
          const positional = /\$(\d+)/.exec(expr);
          return positional && params?.[Number(positional[1]) - 1] ? taintOf(params[Number(positional[1]) - 1], frame.env) : undefined;
        }, this.site(frame, call), frame, undefined, true);
        return;
      }
    }
    if (this.fluent(call, frame) || this.model(call, frame)) return;
    if (PURE_ROOTS.has(rootName) && !(ts.isIdentifier(root) && frame.env.has(rootName))) { this.visitArgs(call, frame); return; }
    if (ts.isPropertyAccessExpression(callee) && CALLBACK_METHODS.has(method)) { this.visit(callee.expression, frame); this.visitArgs(call, frame); return; }
    if (ts.isPropertyAccessExpression(callee) && PURE_METHODS.has(method)) { this.visit(callee.expression, frame); this.visitArgs(call, frame); return; }
    // A function the caller passed in: handle(event, id => stripe.checkout.sessions.retrieve(id))
    const passed = ts.isIdentifier(callee) ? frame.fns.get(callee.text) : undefined;
    if (passed && frame.depth < 3 && !this.visiting.has(passed.fn)) {
      const env = new Map(passed.env);
      passed.fn.parameters.forEach((parameter, index) => this.bind(parameter.name, call.arguments[index] ? taintOf(call.arguments[index], frame.env) : undefined, env));
      this.visiting.add(passed.fn);
      if (passed.fn.body) this.visit(passed.fn.body, { ...frame, file: passed.file, sf: passed.sf, env, vars: new Map(), fns: new Map(), depth: frame.depth + 1 });
      this.visiting.delete(passed.fn);
      this.visitArgs(call, frame);
      return;
    }
    if (ts.isPropertyAccessExpression(callee) && ["has", "get", "add", "set", "delete"].includes(method) && ts.isIdentifier(callee.expression)) return; // in-memory Set/Map: its own rule

    const resolved = this.graph.resolveCallee(frame.file, sf, callee);
    // A recursive call (a retry) repeats effects that are already being followed.
    if (resolved.kind === "function" && this.visiting.has(resolved.fn)) { this.visitArgs(call, frame); return; }
    if (resolved.kind === "function" && frame.depth < 3) {
      const env = new Map<string, Taint>();
      const fns = new Map<string, Callback>();
      resolved.fn.parameters.forEach((parameter, index) => {
        const arg = call.arguments[index] && unwrap(call.arguments[index]);
        this.bind(parameter.name, arg ? taintOf(arg, frame.env) : undefined, env);
        if (arg && isFunctionNode(arg) && ts.isIdentifier(parameter.name)) fns.set(parameter.name.text, { fn: arg, file: frame.file, sf: frame.sf, env: frame.env });
      });
      this.visiting.add(resolved.fn);
      if (resolved.fn.body) this.visit(resolved.fn.body, { file: resolved.file, sf: resolved.sf, env, vars: new Map(), fns, tx: frame.tx, noExitCatch: frame.noExitCatch, depth: frame.depth + 1, active: () => true });
      this.visiting.delete(resolved.fn);
      this.visitArgs(call, frame);
      return;
    }
    const taints = call.arguments.flatMap(arg => deepTaints(arg, frame.env));
    if (taints.some(t => t !== "value")) {
      const reason = resolved.kind === "opaque" ? resolved.reason : "it is nested too deeply to follow";
      this.push<Opaque>({ kind: "opaque", name: callee.getText(sf).slice(0, 60), reason, taints, tx: frame.tx, at: this.site(frame, call) });
    }
    this.visitArgs(call, frame);
  }

  private write(frame: Frame, node: ts.Node, write: Omit<Write, "kind" | "order" | "at" | "checked" | "swallowed" | "tx">): Write {
    return this.push<Write>({ kind: "write", ...write, checked: false, swallowed: write.throwsOnConflict && frame.noExitCatch, tx: frame.tx, at: this.site(frame, node) });
  }

  /** Supabase (from("t").insert(...)) and Drizzle (insert(t).values(...)) query builders. */
  private fluent(call: ts.CallExpression, frame: Frame): boolean {
    const calls = chainCalls(call);
    const from = calls.find(c => c.name === "from" && literalText(c.call.arguments[0]));
    const env = frame.env;
    if (from) {
      const target = literalText(from.call.arguments[0])!.replace(/^.*\./, "");
      const filters: Column[] = [];
      let conditional = false;
      for (const c of calls) {
        if (c.name === "eq" && literalText(c.call.arguments[0]) && c.call.arguments[1]) {
          const taint = taintOf(c.call.arguments[1], env);
          filters.push({ column: literalText(c.call.arguments[0])!.toLowerCase(), taint });
          if (!taint) conditional = true;
        } else if (c.name === "match") filters.push(...columns(c.call.arguments[0], env));
        else if (["is", "neq", "in", "lt", "gt", "lte", "gte", "not", "filter"].includes(c.name)) conditional = true;
      }
      const op = calls.find(c => ["insert", "upsert", "update", "select", "delete"].includes(c.name));
      if (!op) return false;
      if (op.name === "select") { this.push<Read>({ kind: "read", target, keys: filters, guards: false, locked: false, tx: frame.tx, at: this.site(frame, call) }); return true; }
      if (op.name === "delete") return true;
      const data = columns(op.call.arguments[0], env);
      if (op.name === "upsert") {
        const options = op.call.arguments[1];
        const onConflict = literalText(objectProperty(options, "onConflict"));
        const ignore = objectProperty(options, "ignoreDuplicates")?.kind === ts.SyntaxKind.TrueKeyword;
        this.write(frame, call, { verb: "upsert", target, data, keys: filters, conflict: ignore ? "nothing" : "update", conflictColumns: onConflict?.split(",").map(c => c.trim().toLowerCase()), throwsOnConflict: false, conditional: false, throwsOnNoMatch: false });
      } else if (op.name === "insert") {
        // Supabase returns { error } on a unique violation instead of throwing.
        this.write(frame, call, { verb: "insert", target, data, keys: filters, throwsOnConflict: false, conditional: false, throwsOnNoMatch: false });
      } else {
        this.write(frame, call, { verb: "update", target, data, keys: filters, throwsOnConflict: false, conditional: conditional && filters.some(f => isId(f.taint)), throwsOnNoMatch: false });
      }
      return true;
    }
    const insert = calls.find(c => c.name === "insert" && c.call.arguments.length === 1 && ts.isIdentifier(unwrap(c.call.arguments[0])));
    const values = calls.find(c => c.name === "values");
    if (insert && values) {
      const target = unwrap(insert.call.arguments[0]).getText(frame.sf);
      const nothing = calls.some(c => c.name === "onConflictDoNothing"), update = calls.some(c => c.name === "onConflictDoUpdate");
      this.write(frame, call, { verb: update ? "upsert" : "insert", target, data: columns(values.call.arguments[0], env), keys: [], conflict: nothing ? "nothing" : update ? "update" : undefined, throwsOnConflict: !nothing && !update, conditional: false, throwsOnNoMatch: false });
      return true;
    }
    const drizzleWhere = (where?: ts.CallExpression) => {
      const keys: Column[] = [];
      let conditional = false;
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
          if (n.expression.text === "eq" && n.arguments.length === 2) {
            const column = n.arguments[0].getText(frame.sf).split(".").pop()!.toLowerCase();
            const taint = taintOf(n.arguments[1], env);
            keys.push({ column, taint });
            if (!taint) conditional = true;
            return;
          }
          if (!["and"].includes(n.expression.text)) conditional = true;
        }
        ts.forEachChild(n, visit);
      };
      if (where?.arguments[0]) visit(where.arguments[0]);
      return { keys, conditional };
    };
    const update = calls.find(c => c.name === "update" && c.call.arguments.length === 1 && ts.isIdentifier(unwrap(c.call.arguments[0])));
    const set = calls.find(c => c.name === "set");
    if (update && set) {
      const { keys, conditional } = drizzleWhere(calls.find(c => c.name === "where")?.call);
      const setArg = set.call.arguments[0] && unwrap(set.call.arguments[0]);
      const adds = Boolean(setArg && ts.isObjectLiteralExpression(setArg) && setArg.properties.some(p => ts.isPropertyAssignment(p) && ts.isTaggedTemplateExpression(unwrap(p.initializer)) && /[-+]/.test(unwrap(p.initializer).getText(frame.sf))));
      this.write(frame, call, { verb: "update", target: unwrap(update.call.arguments[0]).getText(frame.sf), data: columns(set.call.arguments[0], env), keys, relative: adds, throwsOnConflict: false, conditional: conditional && keys.some(k => isId(k.taint)), throwsOnNoMatch: false });
      return true;
    }
    const select = calls.find(c => c.name === "select");
    const drizzleFrom = calls.find(c => c.name === "from" && c.call.arguments.length === 1 && ts.isIdentifier(unwrap(c.call.arguments[0])));
    if (select && drizzleFrom) {
      const { keys } = drizzleWhere(calls.find(c => c.name === "where")?.call);
      this.push<Read>({ kind: "read", target: unwrap(drizzleFrom.call.arguments[0]).getText(frame.sf), keys, guards: false, locked: calls.some(c => c.name === "for"), tx: frame.tx, at: this.site(frame, call) });
      return true;
    }
    return false;
  }

  /** Prisma (prisma.model.create({ data })) and ORM/driver calls (orders.insertOne(doc), Model.findOne(filter)). */
  private model(call: ts.CallExpression, frame: Frame): boolean {
    const callee = unwrap(call.expression);
    if (!ts.isPropertyAccessExpression(callee)) return false;
    const method = callee.name.text;
    const arg = call.arguments[0] && unwrap(call.arguments[0]);
    if (!(method in WRITES) && !READS.has(method)) return false;
    if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
    const receiver = unwrap(callee.expression);
    const target = ts.isPropertyAccessExpression(receiver) ? receiver.name.text : ts.isIdentifier(receiver) ? receiver.text : undefined;
    const prismaStyle = ["data", "where", "create"].some(name => objectProperty(arg, name));
    const env = frame.env;
    if (READS.has(method)) {
      this.push<Read>({ kind: "read", target, keys: columns(prismaStyle ? objectProperty(arg, "where") : arg, env), guards: false, locked: false, tx: frame.tx, at: this.site(frame, call) });
      return true;
    }
    const verb = WRITES[method];
    if (verb === "create" || verb === "insert") {
      const skip = objectProperty(arg, "skipDuplicates")?.kind === ts.SyntaxKind.TrueKeyword;
      this.write(frame, call, { verb, target, data: columns(prismaStyle ? objectProperty(arg, "data") : arg, env), keys: [], conflict: skip ? "nothing" : undefined, throwsOnConflict: !skip, conditional: false, throwsOnNoMatch: false });
    } else if (verb === "upsert") {
      const keys = columns(prismaStyle ? objectProperty(arg, "where") : undefined, env);
      this.write(frame, call, { verb, target, data: columns(prismaStyle ? objectProperty(arg, "create") : arg, env), keys, conflict: "update", conflictColumns: keys.map(k => k.column), relative: relative(objectProperty(arg, "update")), throwsOnConflict: false, conditional: false, throwsOnNoMatch: false });
    } else {
      const where = columns(prismaStyle ? objectProperty(arg, "where") : arg, env);
      const conditional = where.some(k => isId(k.taint)) && where.some(k => !k.taint);
      const changes = prismaStyle ? objectProperty(arg, "data") : call.arguments[1];
      this.write(frame, call, { verb: "update", target, data: columns(changes, env), keys: where, relative: relative(changes), throwsOnConflict: false, conditional, throwsOnNoMatch: prismaStyle && method === "update" });
    }
    return true;
  }

  private rpc(call: ts.CallExpression, frame: Frame) {
    const name = literalText(call.arguments[0])!.toLowerCase();
    const fn = this.constraints.functions.get(name);
    const args = new Map<string, Taint | undefined>();
    const object = call.arguments[1] && unwrap(call.arguments[1]);
    if (object && ts.isObjectLiteralExpression(object)) for (const property of object.properties) {
      if (ts.isPropertyAssignment(property)) args.set(property.name.getText(frame.sf).replace(/['"]/g, "").toLowerCase(), taintOf(property.initializer, frame.env));
      if (ts.isShorthandPropertyAssignment(property)) args.set(property.name.text.toLowerCase(), frame.env.get(property.name.text));
    }
    if (!fn) {
      const taints = [...args.values()].filter((t): t is Taint => Boolean(t));
      const unread = this.constraints.unreadSchemaFiles.length ? `, and ${this.constraints.unreadSchemaFiles.length} schema or migration file${this.constraints.unreadSchemaFiles.length === 1 ? " was" : "s were"} not read in this scan` : "";
      if (taints.length) this.push<Opaque>({ kind: "opaque", name: `rpc("${name}")`, reason: `the database function ${name} is not defined in the Supabase migrations read${unread}`, taints, tx: frame.tx, at: this.site(frame, call) });
      return;
    }
    const resolve = (expr: string) => {
      for (const param of fn.params) {
        if (!new RegExp(`\\b${param}\\b`, "i").test(expr)) continue;
        const taint = args.get(param);
        const field = /->>?\s*'(\w+)'/.exec(expr)?.[1];
        if (taint === "event") return field === "id" ? "event-id" : field ? "value" : "event";
        if (taint === "payload" || taint === "value") return field && OBJECT_ID.test(field) ? "object-id" : field ? "value" : taint;
        return taint;
      }
      return undefined;
    };
    // A database function runs as one statement: its writes share a transaction.
    this.sql(fn.body, resolve, { file: fn.file, line: fn.line }, { ...frame, tx: ++this.tx }, `database function ${fn.name}`, false);
  }

  /** Inserts, updates and reads in SQL text, with plpgsql `if not found then return` / `if exists (...) then return` guards. */
  private sql(text: string, resolve: (expr: string) => Taint | undefined, at: Site, frame: Frame, via: string | undefined, throws: boolean) {
    let lastWrite: Write | undefined, lastRead: Read | undefined, rowCount = false;
    const lines = (offset: number) => text.slice(0, offset).split("\n").length - 1;
    for (const { text: raw, offset } of splitSql(text)) {
      const s = raw.replace(/\s+/g, " ").trim();
      const lower = s.toLowerCase();
      const keyword = raw.search(/\b(?:insert|update|select|perform)\b/i);
      const site = { file: at.file, line: at.line + lines(offset + (keyword >= 0 ? keyword : raw.length - raw.trimStart().length)) };
      const leaves = /\bthen\s+(?:return|raise)\b/.test(lower);
      if (/\bif\s+not\s+found\s+then\s+(?:return|raise)\b/.test(lower)) { if (lastWrite) lastWrite.checked = true; continue; }
      if (/\bif\s+found\s+then\s+(?:return|raise)\b/.test(lower)) { if (lastRead) lastRead.guards = true; continue; }
      if (rowCount && /\bif\s+\w+\s*(?:=\s*0|<\s*1)\s+then\s+(?:return|raise)\b/.test(lower)) { if (lastWrite) lastWrite.checked = true; rowCount = false; continue; }
      if (/\brow_count\b/.test(lower)) rowCount = true;
      const insert = /\binsert\s+into\s+([\w."]+)\s*\(([^)]*)\)\s*(values|select)\b/i.exec(s);
      if (insert) {
        const columns = splitTopLevel(insert[2]).map(c => c.replace(/"/g, "").toLowerCase());
        let exprs: string[] = [];
        if (insert[3].toLowerCase() === "values") exprs = splitTopLevel(balanced(s, s.indexOf("(", insert.index + insert[0].length))?.body ?? "");
        else exprs = splitTopLevel(s.slice(insert.index + insert[0].length).split(/\bfrom\b|\bon\s+conflict\b/i)[0]);
        const conflict = /\bon\s+conflict\s*(?:\(([^)]*)\))?\s*(?:on\s+constraint\s+[\w"]+\s*)?(?:where\s+.*?)?\bdo\s+(nothing|update)\b/i.exec(s);
        const data = columns.map((column, i) => ({ column, taint: exprs[i] ? resolve(exprs[i]) : undefined }));
        lastWrite = this.push<Write>({ kind: "write", verb: conflict?.[2].toLowerCase() === "update" ? "upsert" : "insert", target: insert[1].replace(/"/g, "").split(".").pop()!.toLowerCase(), data, keys: [],
          conflict: conflict ? (conflict[2].toLowerCase() as "nothing" | "update") : undefined, conflictColumns: conflict?.[1]?.split(",").map(c => c.trim().replace(/"/g, "").toLowerCase()),
          throwsOnConflict: !conflict, conditional: false, throwsOnNoMatch: false, checked: false, swallowed: throws && !conflict && frame.noExitCatch, tx: frame.tx, at: site, via });
        if (leaves) lastWrite.checked = true;
        continue;
      }
      const update = /\bupdate\s+(?:only\s+)?([\w."]+)(?:\s+(?:as\s+)?(?!set\b)\w+)?\s+set\s+(.*?)\s+where\s+(.*?)(?:\s+returning\b.*)?$/i.exec(s);
      if (update) {
        const keys: Column[] = [];
        let conditional = false;
        for (const predicate of splitTopLevel(update[3], " and ")) {
          const eq = /^(?:\w+\.)?"?(\w+)"?\s*=\s*(.+)$/.exec(predicate.trim());
          const taint = eq ? resolve(eq[2]) : undefined;
          if (eq && taint) keys.push({ column: eq[1].toLowerCase(), taint }); else conditional = true;
        }
        const assignments = splitTopLevel(update[2]).map(a => /^"?(\w+)"?\s*=\s*(.+)$/.exec(a)).filter((m): m is RegExpExecArray => Boolean(m));
        const data = assignments.map(m => ({ column: m[1].toLowerCase(), taint: resolve(m[2]) }));
        const adds = assignments.some(m => new RegExp(`^"?${m[1]}"?\\s*[-+*|]`, "i").test(m[2].trim()));
        lastWrite = this.push<Write>({ kind: "write", verb: "update", target: update[1].replace(/"/g, "").split(".").pop()!.toLowerCase(), data, keys, relative: adds, throwsOnConflict: false,
          conditional: conditional && keys.some(k => isId(k.taint)), throwsOnNoMatch: false, checked: false, swallowed: false, tx: frame.tx, at: site, via });
        continue;
      }
      const select = /\b(?:select|perform)\b.*?\bfrom\s+([\w."]+)(?:\s+(?:as\s+)?(?!where\b)\w+)?\s+where\s+(.*?)(?:\s+(?:limit|order|group|for)\b|\)|$)/i.exec(s);
      if (select) {
        const keys = splitTopLevel(select[2], " and ").map(p => /^(?:\w+\.)?"?(\w+)"?\s*=\s*(.+)$/.exec(p.trim())).filter(Boolean)
          .map(m => ({ column: m![1].toLowerCase(), taint: resolve(m![2]) }));
        lastRead = this.push<Read>({ kind: "read", target: select[1].replace(/"/g, "").split(".").pop()!.toLowerCase(), keys, guards: leaves && /\bif\s+exists\b/.test(lower), locked: /\bfor\s+update\b/.test(lower), tx: frame.tx, at: site, via });
      }
    }
  }
}

const describe = (site: Site) => `${site.file}:${site.line}`;
const FIX = "Make one durable guard stop the business action itself: insert the event ID into a table with a unique key before fulfillment and stop on a conflict, give the order or payment a unique Stripe object ID (for example the Checkout Session ID), or claim it with an atomic conditional update; a shared transaction only helps together with such a key. Do not move or patch payment code from this report alone. Replay the same signed event twice, including two deliveries at the same time, and verify the order, payment or email happens once; a failed delivery must still be retryable.";
const UNKEYED_FIX = "Inspect database constraints and imported helpers before changing code. Ensure fulfillment uses a durable atomic claim or idempotent transaction keyed by event.id, or the business object ID plus event.type where appropriate. Logging an ID is not protection. Replay the same event, including concurrent deliveries, and verify the business action happens once; retries after failures must remain possible.";

function target(write: Write | Read) { return write.via ? `${write.target ?? "a table"} (in ${write.via})` : write.target ?? "a table"; }
function uniqueText(u: Uniqueness, columns: string): string {
  if (u.state === "unknown") return `${u.reason}`;
  if (u.state === "not-unique") return `no unique constraint or primary key covering ${columns} is visible in ${u.source}`;
  return `${u.source} has a unique key on (${u.columns.join(", ")})`;
}

/** Classifies what a handler visibly does about a second delivery of the same event. */
export function idempotencyRisks(graph: SourceGraph, constraints: ConstraintIndex, file: string, sf: ts.SourceFile, scope: FunctionNode, verifier: ts.CallExpression, event: string, stripeNames: Set<string>): IdempotencyRisk[] {
  const walker = new Walker(graph, constraints, stripeNames);
  walker.run(file, sf, scope, new Map([[event, "event" as Taint]]), verifier.end);
  const effects = walker.effects;
  const route = `${file}:${lineOf(sf, verifier)}`;
  const writes = effects.filter((e): e is Write => e.kind === "write" && [...e.data, ...e.keys].some(c => c.taint));
  const ledger = writes.filter(w => w.verb !== "update" && [...w.data, ...w.keys].some(c => c.taint === "event-id"));
  const fulfill = writes.filter(w => !ledger.includes(w));
  const opaque = effects.filter((e): e is Opaque => e.kind === "opaque");
  const logs = effects.filter((e): e is Log => e.kind === "log");
  const reads = effects.filter((e): e is Read => e.kind === "read" && e.keys.some(k => isId(k.taint)));
  const outward = [...fulfill, ...opaque].sort((a, b) => a.order - b.order);
  if (!outward.length) return [];

  const provided = (w: Write) => w.conflictColumns?.length ? w.conflictColumns : [...w.data, ...w.keys].map(c => c.column);
  const required = (w: Write, taint: Taint) => [...w.data, ...w.keys].filter(c => c.taint === taint).map(c => c.column);
  const unique = (w: Write, taint: Taint): Uniqueness => w.inherentUnique ? { state: "unique", columns: ["key"], source: w.inherentUnique } : constraints.uniqueness(w.target, provided(w), required(w, taint));
  const stops = (w: Write) => (w.throwsOnConflict && !w.swallowed) || ((w.conflict === "nothing" || !w.conflict) && w.checked);
  const first = outward[0];

  const ledgers = ledger.map(l => ({ l, u: unique(l, "event-id") }));
  if (ledgers.some(({ l, u }) => u.state === "unique" && stops(l) && l.order < first.order)) return [];
  if (ledgers.some(({ l, u }) => u.state === "unique" && l.throwsOnConflict && !l.swallowed && l.tx !== undefined && outward.every(e => e.kind === "write" && e.tx === l.tx))) return [];

  const gates = writes.filter(w => w.verb === "update" && w.conditional && (w.throwsOnNoMatch || w.checked));
  const safe = (w: Write) => {
    // Setting a value twice leaves the same state; adding to it twice does not.
    if (w.verb === "update") return w.conditional || !w.relative;
    if (!required(w, "object-id").length) return false;
    if (w.conflict === "update" && w.relative) return false;
    // The database rejects or merges a second row with the same unique Stripe object ID, whether or not the error is checked.
    return unique(w, "object-id").state === "unique";
  };
  if (outward.every(e => gates.some(g => g.order < e.order) || (e.kind === "write" && safe(e)))) return [];

  const finding = (ruleId: IdempotencyRisk["ruleId"], at: Site, reason: string, fix = FIX): IdempotencyRisk[] =>
    [{ ruleId, file: at.file, line: at.line, problem: `Stripe webhook ${route}: ${reason} Duplicate-delivery protection could not be established; this is not a confirmed vulnerability.`, fix }];

  const race = reads.find(r => r.guards && !r.locked && writes.some(w => w.order > r.order));
  if (race) {
    const key = race.keys.find(k => isId(k.taint))!;
    // Prefer the write that records the same key the check read; otherwise the first write after the check.
    const later = writes.find(w => w.order > race.order && [...w.data, ...w.keys].some(c => c.taint === key.taint)) ?? writes.find(w => w.order > race.order)!;
    const laterUnique = later.verb !== "update" ? unique(later, ledger.includes(later) ? "event-id" : "object-id") : undefined;
    const note = laterUnique?.state === "unique" && fulfill.some(f => f.order < later.order)
      ? ` The unique key stops the second ${target(later)} row, but the write at ${describe(fulfill.find(f => f.order < later.order)!.at)} runs before it.`
      : laterUnique ? ` For ${target(later)}, ${uniqueText(laterUnique, required(later, ledger.includes(later) ? "event-id" : "object-id").join(", ") || "the key")}.` : "";
    return finding("stripe-idempotency-race", race.at, `${target(race)} is checked by ${key.column} at ${describe(race.at)} and ${target(later)} is written afterwards at ${describe(later.at)}. Two deliveries of the same event that arrive at the same time can both pass the check before either write lands.${note}`);
  }

  const tracked = effects.some(e => (e.kind === "write" || e.kind === "read") ? [...(e.kind === "write" ? e.data : []), ...e.keys].some(c => isId(c.taint))
    : e.kind === "opaque" || e.kind === "log" ? e.taints.some(t => t !== "value") : false);
  if (!tracked && !opaque.length) {
    return [{ ruleId: "stripe-event-replay", file: first.at.file, line: first.at.line,
      problem: "A verified Stripe event leads to a create/insert using its payload, without a visible event-ID or object-ID handoff in this handler. Duplicate-delivery protection needs review.", fix: UNKEYED_FIX }];
  }
  if (ledgers.length) {
    const { l, u } = ledgers[0];
    const where = `${target(l)} at ${describe(l.at)}`;
    if (u.state !== "unique") return finding("stripe-idempotency-unestablished", l.at, `event IDs are recorded in ${where}, but ${uniqueText(u, required(l, "event-id").join(", "))}. Recording an event is not the same as rejecting a second delivery.`);
    if (l.swallowed) return finding("stripe-idempotency-unestablished", l.at, `the event ID insert into ${where} runs in a try/catch that continues after an error, so a duplicate does not stop the handler.`);
    if (!stops(l)) return finding("stripe-idempotency-unestablished", l.at, `the event ID claim in ${where} ${l.conflict ? `uses ON CONFLICT DO ${l.conflict.toUpperCase()}` : "does not throw on a conflict"} and its result is not checked, so a second delivery is not stopped before ${describe(first.at)}.`);
    return finding("stripe-idempotency-unestablished", l.at, `event IDs are recorded in ${where} only after the write at ${describe(first.at)}, outside a shared transaction, so two deliveries can both run it before either record exists.`);
  }
  const adding = fulfill.find(w => w.relative && !safe(w));
  if (adding) return finding("stripe-idempotency-unestablished", adding.at, `the ${target(adding)} ${adding.verb} at ${describe(adding.at)} adds to the current value (for example an increment) instead of setting it, so a second delivery applies it again unless something before it stops the duplicate.`);
  const keyed = fulfill.find(w => required(w, "object-id").length && !safe(w));
  if (keyed) {
    const columns = required(keyed, "object-id").join(", ");
    return finding("stripe-idempotency-unestablished", keyed.at, `the ${target(keyed)} write at ${describe(keyed.at)} is keyed by ${columns} from the Stripe object, but ${uniqueText(unique(keyed, "object-id"), columns)}.`);
  }
  const handoff = opaque.find(o => o.taints.some(t => t !== "value"));
  if (handoff) {
    const what = handoff.taints.includes("event") ? "the event" : handoff.taints.includes("event-id") ? "event.id" : "a Stripe object ID";
    return finding("stripe-idempotency-unestablished", handoff.at, `${what} is passed to ${handoff.name} at ${describe(handoff.at)}, which could not be inspected: ${handoff.reason}. Passing an ID on does not show that a second delivery is stopped.`);
  }
  const logged = logs.find(l => l.taints.includes("event-id"));
  if (logged) return finding("stripe-idempotency-unestablished", logged.at, `event.id is only logged at ${describe(logged.at)}; logging an ID does not stop a second delivery of ${describe(first.at)}.`);
  return finding("stripe-idempotency-unestablished", first.at, `the write at ${describe(first.at)} could not be linked to a table and key that rejects a second delivery.`);
}
