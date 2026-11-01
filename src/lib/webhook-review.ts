import { z } from "zod";
import { checkProductionSafety } from "@/lib/production-safety";
import { findSecrets, maskSecrets } from "@/lib/secrets";
import type { RepositorySnapshot } from "@/lib/analyzer";

export const WEBHOOK_INPUT_LIMIT = 90_000;
export const webhookInput = z.object({
  framework: z.enum(["next-app", "next-pages", "express"]),
  source: z.string().min(20).max(40_000),
  schema: z.string().max(30_000).default(""),
  schemaType: z.enum(["sql", "prisma"]).default("sql"),
}).strict();
export type WebhookInput = z.infer<typeof webhookInput>;
export const REVIEW_LIMITATIONS = [
  "Only the pasted handler and optional schema were inspected. Imported helpers and middleware are not included.",
  "No webhook, build, database, payment or repository code was executed. No live database constraint was verified.",
  "Review findings indicate source patterns, not confirmed vulnerabilities. No findings does not establish safe fulfillment.",
  "Downloaded tests require your own adapter and an isolated test database before they can exercise your application.",
];
export function reviewWebhook(input: WebhookInput) {
  if (findSecrets(input.source + "\n" + input.schema).length) throw new Error("Remove credentials before submitting code.");
  const file = input.framework === "next-app" ? "app/api/webhook/route.ts" : input.framework === "next-pages" ? "pages/api/webhook.ts" : "src/server.ts";
  const contents = new Map<string,string>([[file,input.source],["package.json",JSON.stringify({dependencies:input.framework === "express" ? {express:"5",stripe:"22"} : {next:"16",stripe:"22"}})]]);
  if (input.schema.trim()) contents.set(input.schemaType === "sql" ? "supabase/migrations/00000000000000_pasted_schema.sql" : "prisma/schema.prisma",input.schema);
  const snapshot: RepositorySnapshot = {owner:"pasted",name:"webhook",defaultBranch:"not-a-repository",contents,entries:[...contents.keys()].map(path=>({path,type:"blob"})),sourceFilesRead:1,sourceFilesFound:1,partial:true};
  const analysis = checkProductionSafety(snapshot);
  const relevant = (id: string) => /^(?:stripe-|checkout-)/.test(id);
  const findings = (analysis.findings ?? []).filter(f=>relevant(f.ruleId ?? "")).map(f=>({...f, problem:maskSecrets(f.problem),fix:maskSecrets(f.fix),excerpt:maskSecrets((contents.get(f.file)??"").split("\n")[f.line-1]??"").slice(0,350)}));
  const evaluatedRules = (analysis.evaluatedRules??[]).filter(relevant);
  return {kind:"pasted-webhook" as const,file,findings,evaluatedRules,status:findings.length ? "review" as const : "inconclusive" as const,
    summary:findings.length ? `${findings.length} source patterns to review. Your checkout was not executed.` : "No matching local risk found. This limited review cannot establish whether your webhook is safe.",
    limitations:REVIEW_LIMITATIONS,codeStored:false as const,aiUsed:false as const};
}
export type WebhookReview = ReturnType<typeof reviewWebhook>;
