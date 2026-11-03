import { createHash } from "node:crypto";
import ts from "typescript";
import { HOST_CONFIG_FILE } from "@/lib/hosting-targets";
import { SourceGraph, lineOf, literalText } from "@/lib/source-graph";
import type { RepositorySnapshot } from "@/lib/analyzer";
import type { ReportResults } from "@/types/report";

export type DeploymentItem = { kind: "environment" | "migration" | "hosting" | "build" | "endpoint"; key: string; file: string; line: number; digest: string | null };
export type DeploymentInventory = { version: 1; complete: boolean; items: DeploymentItem[]; limitations: string[] };
export type DeployTask = { id: string; kind: DeploymentItem["kind"]; change: "added" | "changed" | "removed"; confidence: "observed-change" | "needs-review"; file: string; line: number; side: "base" | "head"; title: string; action: string; verification: string };
export type DeployHandoff = { version: 1; baseCommitSha: string; headCommitSha: string; complete: boolean; tasks: DeployTask[]; limitations: string[]; manualChecks: string[] };
const EXCLUDED = /(?:^|\/)(?:tests?|__tests__|__mocks__|fixtures|__fixtures__|examples?|node_modules|vendor|scripts|cli|action)\/|\.(?:test|spec|stories)\.[cm]?[jt]sx?$/i;
const SOURCE = /\.[cm]?[jt]sx?$/;
const MIGRATION = /(?:^|\/)(?:supabase|prisma)\/migrations\/.*\.(?:sql|prisma)$|(?:^|\/)drizzle\/[^/]+\.sql$/i;
const ENDPOINT = /^(?:src\/)?(?:app\/(?:.*\/)?route\.[cm]?[jt]s|pages\/api\/.*\.[cm]?[jt]s)$/;
const BUILTIN = /^(?:NODE_ENV|CI|PORT|HOST|HOSTNAME|NO_COLOR|FORCE_COLOR|NEXT_RUNTIME|VERCEL(?:_[A-Z0-9_]+)?|NETLIFY|CONTEXT|DEPLOY_URL|DEPLOY_PRIME_URL|CF_PAGES(?:_[A-Z0-9_]+)?|FLY_[A-Z0-9_]+|RENDER(?:_[A-Z0-9_]+)?)$/;
const hash = (source: string) => createHash("sha256").update(source).digest("hex");

/** Save names, paths and one-way change fingerprints only. Never save commands or configuration/secret values. */
export function deploymentInventory(snapshot: RepositorySnapshot): DeploymentInventory {
  const out: DeploymentInventory = { version: 1, complete: !snapshot.partial, items: [], limitations: [] }, graph = new SourceGraph(snapshot);
  const seen = new Set<string>();
  const add = (item: DeploymentItem) => { const key = `${item.kind}:${item.key}`; if (seen.has(key)) return; if (out.items.length < 300) { seen.add(key); out.items.push(item); } else { out.complete = false; if (!out.limitations.includes("Deployment inventory item limit reached.")) out.limitations.push("Deployment inventory item limit reached."); } };
  for (const entry of snapshot.entries) {
    const file = entry.path; if (entry.type !== "blob" || EXCLUDED.test(file)) continue;
    const source = snapshot.contents.get(file);
    if (MIGRATION.test(file) || ENDPOINT.test(file)) add({kind:MIGRATION.test(file)?"migration":"endpoint",key:file,file,line:1,digest:source === undefined ? null : hash(source)});
    if (HOST_CONFIG_FILE.test(file) || file === "vercel.json") {
      if (source === undefined) { out.complete = false; out.limitations.push("A deployment configuration was not read."); }
      else add({kind:"hosting",key:file,file,line:1,digest:hash(source)});
    }
    if (source === undefined) continue;
    if (/(?:^|\/)package\.json$/.test(file)) {
      try {
        const json = ts.parseJsonText(file, source), parsed: unknown = JSON.parse(source);
        const scripts = (parsed as { scripts?: Record<string,unknown> })?.scripts;
        for (const key of ["build","start","prebuild","postbuild","postinstall"]) if (scripts && typeof scripts[key] === "string") {
          let line = 1;
          const statement = json.statements[0];
          const root = statement && ts.isExpressionStatement(statement) ? statement.expression : undefined;
          const scriptsProperty = root && ts.isObjectLiteralExpression(root) ? root.properties.find(p => ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name) && p.name.text === "scripts") : undefined;
          if (scriptsProperty && ts.isPropertyAssignment(scriptsProperty) && ts.isObjectLiteralExpression(scriptsProperty.initializer)) {
            const property = scriptsProperty.initializer.properties.find(p => ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name) && p.name.text === key);
            if (property) line = lineOf(json,property);
          }
          add({kind:"build",key:`${file}:${key}`,file,line,digest:hash(scripts[key] as string)});
        }
      } catch { out.complete = false; out.limitations.push("A package manifest could not be inventoried."); }
    }
    if (!SOURCE.test(file) || /\.d\.[cm]?ts$/.test(file)) continue;
    const sf = graph.parse(file); if (!sf) { out.complete = false; out.limitations.push("Some source could not be parsed for environment references."); continue; }
    let shadowedProcess = false;
    const bindings = (node: ts.Node) => { if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) || ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)) && node.name && ts.isIdentifier(node.name) && node.name.text === "process") shadowedProcess = true; ts.forEachChild(node,bindings); }; bindings(sf);
    if (shadowedProcess) { out.complete = false; out.limitations.push("Environment references in files with a local process binding require review."); }
    const environment = (node: ts.Node) => !shadowedProcess && ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "process" && node.name.text === "env"
      || ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === "env";
    const record = (name: string | undefined, node: ts.Node) => { if (name && /^[A-Z][A-Z0-9_]{0,99}$/.test(name) && !BUILTIN.test(name)) add({kind:"environment",key:name,file,line:lineOf(sf,node),digest:null}); };
    const walk = (node: ts.Node) => {
      if (ts.isTypeNode(node)) return;
      if (ts.isPropertyAccessExpression(node) && environment(node.expression)) record(node.name.text,node);
      if (ts.isElementAccessExpression(node) && environment(node.expression)) record(literalText(node.argumentExpression),node);
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && environment(node.initializer)) for (const element of node.name.elements) {
        if (element.dotDotDotToken) continue;
        const key = element.propertyName ?? element.name;
        if (ts.isIdentifier(key) || ts.isStringLiteral(key)) record(key.text,element);
      }
      ts.forEachChild(node,walk);
    }; walk(sf);
  }
  out.limitations = [...new Set(out.limitations)]; return out;
}

const COPY = {
  environment: { title:"Review new production environment reference", action:"Decide whether this variable is required or optional, document it and configure it securely in the target environment if needed. Never paste its value into the report or a PR.", verification:"Verify the affected flow with the intended production configuration; source analysis cannot read hosting values." },
  migration: { title:"Plan the database migration", action:"Review the migration, backup/recovery plan and deployment order with the application change. Do not run an unreviewed migration automatically.", verification:"Test on a safe staging database and check compatibility with both the previous and new application version." },
  hosting: { title:"Review deployment configuration change", action:"Review the pinned configuration diff for bindings, cron jobs, routes, build contexts and provider settings that need an external change.", verification:"Validate using the target provider and test the affected routing/runtime behavior. Dashboard settings were not inspected." },
  build: { title:"Verify the production command change", action:"Review the pinned package script diff and reproduce the intended clean production build/start process.", verification:"Run the production build in the target environment, with its actual Node/package-manager version and required variables." },
  endpoint: { title:"Verify the endpoint contract", action:"Review callers, authentication and any webhook/callback registrations affected by this source change.", verification:"Exercise the actual request and expected response in staging. A source route file does not establish the deployed URL or successful handling." },
};

export function createDeployHandoff(base: ReportResults, head: ReportResults, renames: Record<string,string> = {}, renameComplete = true): DeployHandoff | undefined {
  const before = base.deploymentInventory, after = head.deploymentInventory;
  const baseCommitSha = base.repository.commitSha, headCommitSha = head.repository.commitSha;
  if (`${base.repository.owner}/${base.repository.name}`.toLowerCase() !== `${head.repository.owner}/${head.repository.name}`.toLowerCase()) return undefined;
  if (!before || !after || before.version !== 1 || after.version !== 1 || !/^[a-f0-9]{40}$/i.test(baseCommitSha??"") || !/^[a-f0-9]{40}$/i.test(headCommitSha??"")) return undefined;
  const complete = before.complete && after.complete && !base.scan.partial && !head.scan.partial && renameComplete;
  const result: DeployHandoff = {version:1,baseCommitSha:baseCommitSha!,headCommitSha:headCommitSha!,complete,tasks:[],limitations:[
    "A deployment checklist derived from two committed snapshots. Every task still requires manual verification; nothing was deployed or automatically completed.",
    "Environment references include optional/dev-only uses. Absence of a reference is not proof a variable is unnecessary. Dynamic references and languages other than JavaScript/TypeScript are not inventoried here.",
    "Command/configuration fingerprints detect text changes, including comments or whitespace. They do not establish changed runtime semantics. Files outside the inspected paths are not covered.",
    ...before.limitations,...after.limitations,
  ],manualChecks:["Run the real production build and smoke-test affected flows in staging.","Verify the deployed commit, production configuration and post-deploy health. Test a real checkout separately if payments changed."]};
  if (!complete) result.limitations.push("Incomplete coverage: unmatched items are review candidates, not proven additions or removals.");
  const key = (item:DeploymentItem, old=false) => item.kind === "environment" ? `${item.kind}:${item.key}` : `${item.kind}:${old ? renames[item.file] ?? item.file : item.file}:${item.kind === "build" ? item.key.slice(item.file.length+1) : ""}`;
  const remaining = new Map(before.items.map(item=>[key(item,true),item]));
  const add = (item:DeploymentItem,change:DeployTask["change"],side:"base"|"head") => {
    const copy=COPY[item.kind];
    result.tasks.push({id:hash(`${item.kind}:${item.key}:${change}`).slice(0,16),kind:item.kind,change,confidence:complete?"observed-change":"needs-review",file:item.file,line:item.line,side,
      title:item.kind === "environment" ? `${copy.title}: ${item.key}` : copy.title,action:change === "removed" ? "This tracked source/configuration item is no longer present in the compared inventory. Review the pinned diff and any external dependencies before removing or changing production resources." : copy.action,verification:copy.verification});
  };
  for (const item of after.items) {
    const old = remaining.get(key(item)); remaining.delete(key(item));
    if (!old) add(item,"added","head");
    else if (item.digest && old.digest && item.digest!==old.digest) add(item,"changed","head");
  }
  for (const item of remaining.values()) if (item.kind !== "environment") add(item,"removed","base");
  const priority = {environment:0,migration:1,hosting:2,build:3,endpoint:4};
  result.tasks.sort((a,b)=>priority[a.kind]-priority[b.kind]||a.file.localeCompare(b.file)||a.line-b.line);
  if(result.tasks.length>40){result.tasks=result.tasks.slice(0,40);result.complete=false;result.limitations.push("Only the first 40 deployment tasks are shown.");}
  result.limitations=[...new Set(result.limitations)];return result;
}

export function handoffMarkdown(handoff: DeployHandoff, reportUrl: string): string {
  return ["# DeployDoctor — Deploy Handoff",`Report: ${reportUrl}`,`Base: ${handoff.baseCommitSha}`,`Head: ${handoff.headCommitSha}`,"Manual checklist. No task is automatically complete.",...handoff.tasks.map(task=>`\n- [ ] ${task.title} (${task.change}; ${task.confidence})\n  Source: ${task.file}:${task.line} at ${task.side === "base" ? handoff.baseCommitSha : handoff.headCommitSha}\n  Action: ${task.action}\n  Verify: ${task.verification}`),"\n## Manual release checks",...handoff.manualChecks.map(check=>`- [ ] ${check}`),"\n## Limits",...handoff.limitations.map(note=>`- ${note}`)].join("\n");
}
