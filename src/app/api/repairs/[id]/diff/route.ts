import { customerSession } from "@/lib/access";
import { db, query } from "@/lib/db";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const customer = await customerSession();
  if (!customer) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^cs_[a-zA-Z0-9_]{10,200}$/.test(id)) return new Response("Not found", { status: 404 });
  const rows = await db<Array<{ patch_text: string | null }>>(query("repair_orders", {
    id: `eq.${id}`, stripe_customer_id: `eq.${customer.customerId}`, status: "eq.completed", select: "patch_text", limit: "1",
  }));
  if (!rows[0]?.patch_text) return new Response("Patch not ready", { status: 404 });
  return new Response(rows[0].patch_text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="deploydoctor.patch"', "Cache-Control": "private, no-store" } });
}
