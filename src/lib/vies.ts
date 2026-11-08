/**
 * One anonymous lookup in the European Commission's VIES service for the VAT number a site prints about
 * itself. No requester number is sent, so no consultation number is issued (that is what Vatidence sells).
 * Called at most once per site check, and only when a number was found: the capacity is the Commission's.
 */
export type ViesVerdict = { valid: boolean; name: string | null } | null;

const ENDPOINT = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";

export async function viesCheck(number: { countryCode: string; vatNumber: string }, fetcher: typeof fetch = fetch): Promise<ViesVerdict> {
  try {
    const response = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ countryCode: number.countryCode, vatNumber: number.vatNumber }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { valid?: unknown; name?: unknown; errorWrappers?: unknown; actionSucceed?: unknown };
    // A member state that is down answers with errorWrappers or actionSucceed:false: unknown, never "not valid".
    if (body.errorWrappers || body.actionSucceed === false || typeof body.valid !== "boolean") return null;
    const name = typeof body.name === "string" && body.name.trim() && body.name.trim() !== "---" ? body.name.trim() : null;
    return { valid: body.valid, name };
  } catch {
    return null;
  }
}
