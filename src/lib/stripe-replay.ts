import ts from "typescript";

const unwrap = (node: ts.Node): ts.Node => ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) ? unwrap(node.expression) : node;
function owner(node: ts.Node): ts.Node | undefined {
  let current = node.parent;
  while (current && !ts.isFunctionLike(current)) current = current.parent;
  return current;
}
function contains(node: ts.Node, predicate: (node: ts.Node) => boolean): boolean {
  if (predicate(node)) return true;
  return ts.forEachChild(node, child => contains(child, predicate) || undefined) === true;
}

export type ReplayRisk = { ruleId: "stripe-event-replay" | "stripe-memory-deduplication"; node: ts.Node; problem: string; fix: string };

/** Narrow review heuristics, never a proof that fulfillment is or is not idempotent. Reuses the parsed source tree. */
export function stripeReplayRisks(sf: ts.SourceFile, nodes: ts.Node[], verifiers: ts.CallExpression[]): ReplayRisk[] {
  const risks: ReplayRisk[] = [];
  const declarations = nodes.filter(ts.isVariableDeclaration);
  for (const verifier of verifiers) {
    const scope = owner(verifier);
    if (!scope) continue;
    const declaration = declarations.find(d => d.initializer && unwrap(d.initializer) === verifier && ts.isIdentifier(d.name));
    // Assignments are intentionally excluded: reassignment and try/catch data flow need a real type/control-flow analysis.
    if (!declaration || !ts.isIdentifier(declaration.name)) continue;
    const event = declaration.name.text;
    const local = nodes.filter(node => owner(node) === scope);
    if (local.some(node => node !== declaration && (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name) && node.name.text === event)) continue;
    if (local.some(node => ts.isBinaryExpression(node) && node.left.getText(sf) === event && node.operatorToken.kind === ts.SyntaxKind.EqualsToken)) continue;
    const eventProperty = (node: ts.Node, property: string) => (ts.isPropertyAccessExpression(node) && node.name.text === property && ts.isIdentifier(node.expression) && node.expression.text === event)
      || (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === property && ts.isIdentifier(node.expression) && node.expression.text === event);
    const ids = new Set(declarations.filter(d => owner(d) === scope && d.initializer && eventProperty(unwrap(d.initializer), "id") && ts.isIdentifier(d.name)).map(d => d.name.getText(sf)));
    const isEventId = (node: ts.Node) => eventProperty(unwrap(node), "id") || (ts.isIdentifier(unwrap(node)) && ids.has(unwrap(node).getText(sf)));
    const calls = local.filter(ts.isCallExpression);
    // An ID handed to another operation may be claimed durably outside this file.
    const externalIdHandoff = calls.some(call => call.arguments.some(arg => contains(arg, isEventId))
      && !(ts.isPropertyAccessExpression(call.expression) && ["has", "get", "add", "set"].includes(call.expression.name.text)));
    let memory = false;
    for (const call of calls) {
      if (externalIdHandoff) break;
      if (!ts.isPropertyAccessExpression(call.expression) || !["has", "get"].includes(call.expression.name.text) || !call.arguments[0] || !isEventId(call.arguments[0]) || !ts.isIdentifier(call.expression.expression)) continue;
      const cache = call.expression.expression.text;
      const matches = declarations.filter(d => ts.isIdentifier(d.name) && d.name.text === cache);
      if (matches.length !== 1) continue;
      const store = matches[0];
      if (owner(store) && owner(store) !== scope) continue;
      const init = store.initializer && unwrap(store.initializer);
      if (!init || !ts.isNewExpression(init) || !ts.isIdentifier(init.expression) || !["Set", "Map"].includes(init.expression.text)) continue;
      const constructor = init.expression.text;
      if (call.expression.name.text === "get" && constructor !== "Map") continue;
      if (nodes.some(n => (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isClassDeclaration(n) || ts.isImportSpecifier(n)) && n.name?.getText(sf) === constructor)) continue;
      const writes = calls.some(n => ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText(sf) === cache && ["add", "set"].includes(n.expression.name.text) && n.arguments[0] && isEventId(n.arguments[0]));
      if (!writes) continue;
      memory = true;
      risks.push({ ruleId: "stripe-memory-deduplication", node: call,
        problem: "Stripe event IDs are checked and stored in a process-memory Set or Map. This state is not shared across instances or preserved across restarts.",
        fix: "Review whether a durable guard also exists. Use an atomic database claim/unique constraint or an idempotent fulfillment transaction keyed by event ID or business object. Test duplicate and concurrent deliveries; process memory alone is insufficient on serverless deployments." });
    }
    if (memory || !local.some(n => eventProperty(n, "type"))) continue;
    // Even an ID passed to an opaque helper may implement a durable claim elsewhere. Do not call it missing.
    if (local.some(n => eventProperty(n, "id"))) continue;
    const payload = (node: ts.Node): boolean => ts.isPropertyAccessExpression(node) && node.name.text === "object" && eventProperty(node.expression, "data");
    const aliases = new Set(declarations.filter(d => owner(d) === scope && d.initializer && payload(unwrap(d.initializer)) && ts.isIdentifier(d.name)).map(d => d.name.getText(sf)));
    if (local.some(n => ts.isPropertyAccessExpression(n) && n.name.text === "id" && (payload(n.expression) || aliases.has(n.expression.getText(sf))))) continue;
    const delegated = calls.some(call => call !== verifier && call.arguments.some(arg => ts.isIdentifier(unwrap(arg)) && unwrap(arg).getText(sf) === event));
    if (delegated) continue;
    const mutation = calls.find(call => call.pos > verifier.pos && ts.isPropertyAccessExpression(call.expression) && ["create", "insert"].includes(call.expression.name.text)
      && call.arguments.some(arg => contains(arg, n => payload(n) || (ts.isIdentifier(n) && aliases.has(n.text)))));
    if (mutation) risks.push({ ruleId: "stripe-event-replay", node: mutation,
      problem: "A verified Stripe event leads to a create/insert using its payload, without a visible event-ID or object-ID handoff in this handler. Duplicate-delivery protection needs review.",
      fix: "Inspect database constraints and imported helpers before changing code. Ensure fulfillment uses a durable atomic claim or idempotent transaction keyed by event.id, or the business object ID plus event.type where appropriate. Logging an ID is not protection. Replay the same event, including concurrent deliveries, and verify the business action happens once; retries after failures must remain possible." });
  }
  return risks;
}
