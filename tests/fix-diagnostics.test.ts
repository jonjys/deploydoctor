import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { fixAppIdentity, fixConfigChecks } from "../src/lib/fix-pr/diagnostics";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const good = { appId: "5657324", slug: "deploydoctor-fix", privateKey: pem, clientId: "Iv23liexample123", clientSecret: "c".repeat(40), webhookSecret: "w".repeat(32) };

test("each Fix PR requirement is checked and named, without showing any value", () => {
  assert.ok(fixConfigChecks(good).every(c => c.ok));
  const bad = fixConfigChecks({ ...good, webhookSecret: "short", privateKey: "MIIEowIBAAKCAQEA" });
  assert.deepEqual(bad.filter(c => !c.ok).map(c => c.label), ["GITHUB_FIX_APP_PRIVATE_KEY is a PEM key", "GITHUB_FIX_WEBHOOK_SECRET is at least 16 characters"]);
  const shown = JSON.stringify(bad);
  for (const secret of ["short", "MIIEowIBAAKCAQEA", good.clientSecret]) assert.ok(!shown.includes(secret));
  assert.equal(fixConfigChecks(null).filter(c => c.ok).length, 0);
});

test("GitHub is asked whether the key belongs to this app", async () => {
  const answer = (body: object, status = 200) => async () => new Response(JSON.stringify(body), { status });
  assert.deepEqual(await fixAppIdentity(good, answer({ id: 5657324, slug: "deploydoctor-fix" }) as typeof fetch), { ok: true, detail: "GitHub confirms the key belongs to deploydoctor-fix." });
  assert.equal((await fixAppIdentity(good, answer({}, 401) as typeof fetch)).ok, false);
  assert.match((await fixAppIdentity(good, answer({ id: 5657324, slug: "other" }) as typeof fetch)).detail, /slug is "other"/);
  assert.match((await fixAppIdentity({ ...good, privateKey: "nope" })).detail, /Skipped/);
});
