import { hashRequestIp } from "@/lib/access";
import { db } from "@/lib/db";
import { getReport } from "@/lib/reports";
import { sameOrigin } from "@/lib/stripe";
import { langFromRequest, t } from "@/lib/i18n";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Did DeployDoctor solve it? One answer per visitor per report or diagnosis; answering again replaces the answer.
 * A report answer needs a report the visitor can open, so the counter cannot be filled with made-up ids.
 */
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 500) return Response.json({ error: t(lang, "err.tooLarge") }, { status: 413 });
    const body = JSON.parse(raw) as { kind?: unknown; target?: unknown; solved?: unknown };
    if ((body.kind !== "report" && body.kind !== "diagnosis") || typeof body.target !== "string" || !UUID.test(body.target)
      || typeof body.solved !== "boolean") {
      return Response.json({ error: t(lang, "solved.invalid") }, { status: 400 });
    }
    if (body.kind === "report" && !(await getReport(body.target))) return Response.json({ error: t(lang, "solved.invalid") }, { status: 404 });
    const now = new Date().toISOString();
    await db("fix_feedback?on_conflict=kind,target,voter_hash", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ kind: body.kind, target: body.target.toLowerCase(), solved: body.solved,
        voter_hash: hashRequestIp(request), updated_at: now }),
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: t(lang, "err.invalidJson") }, { status: 400 });
    console.error("Feedback failed:", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: t(lang, "solved.failed") }, { status: 502 });
  }
}
