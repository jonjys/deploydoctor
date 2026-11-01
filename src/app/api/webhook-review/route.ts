import { boundedBody } from "@/lib/bounded-body";
import { sameOrigin } from "@/lib/stripe";
import { activePlan, requestCustomer, reserveScan, finishScan, hashRequestIp } from "@/lib/access";
import { scanAllowance } from "@/lib/limits";
import { acquireWork, releaseWork, workLimitResponse } from "@/lib/work-budget";
import { langFromRequest } from "@/lib/i18n";
import { reviewWebhook, webhookInput, WEBHOOK_INPUT_LIMIT } from "@/lib/webhook-review";
import { findSecrets } from "@/lib/secrets";
export const maxDuration = 30;
const headers = { "Cache-Control":"no-store", "Referrer-Policy":"no-referrer" };
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({error:"Open this review from DeployDoctor."},{status:403,headers});
  let reservation: string | null = null, lease: string | null = null;
  try {
    if (Number(request.headers.get("content-length")||0)>WEBHOOK_INPUT_LIMIT) return Response.json({error:"Code is too large. Paste one handler and optional schema."},{status:413,headers});
    const raw = await boundedBody(request,WEBHOOK_INPUT_LIMIT);
    const parsed = webhookInput.safeParse(JSON.parse(raw));
    if (!parsed.success) return Response.json({error:"Choose a supported handler and paste 20–40,000 characters of source. Optional schema: at most 30,000 characters."},{status:400,headers});
    if (findSecrets(parsed.data.source+"\n"+parsed.data.schema).length) return Response.json({error:"Remove credentials before submitting code. Nothing was analyzed."},{status:400,headers});
    const {customer,invalidToken} = await requestCustomer(request);
    if (invalidToken) return Response.json({error:"Invalid DeployDoctor token."},{status:401,headers});
    const plan = await activePlan(customer), identity = hashRequestIp(request);
    lease = await acquireWork([{key:`webhook-review:${identity}`,limit:3,seconds:60},{key:"webhook-review:site",limit:40,seconds:60}],"webhook-review:active",2,45);
    if (!plan) {
      const quota = await reserveScan(request,scanAllowance(null));
      if (!quota.allowed) return Response.json({error:"Today’s free scan is used. A pasted-code review shares the repository scan allowance. Continue with the existing $2/24h pass.",paywall:true},{status:402,headers});
      reservation=quota.id;
    }
    const result=reviewWebhook(parsed.data);
    if (reservation) { await finishScan(reservation,true);reservation=null; }
    return Response.json(result,{headers});
  } catch(error) {
    const limited=workLimitResponse(error,langFromRequest(request));if(limited)return limited;
    const status=error instanceof RangeError?413:error instanceof SyntaxError?400:503;
    return Response.json({error:status===413?"Code is too large.":status===400?"Invalid request.":"Review could not finish. Your code was not saved. Try again shortly."},{status,headers});
  } finally {
    if(reservation)await finishScan(reservation,false).catch(()=>{});
    if(lease)await releaseWork(lease);
  }
}
