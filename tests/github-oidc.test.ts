import { test } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { GITHUB_OIDC_ISSUER, resetGitHubKeyCache, verifyGitHubOidc } from "../src/lib/github-oidc";

const AUD = "https://deploydoctor.nyttolabs.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwks = async () => ({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] });

function sign(claims: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: typeof privateKey } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createSign("RSA-SHA256").update(`${header}.${body}`).sign(opts.key ?? privateKey).toString("base64url");
  return `${header}.${body}.${sig}`;
}
const now = Math.floor(Date.now() / 1000);
const good = { iss: GITHUB_OIDC_ISSUER, aud: AUD, exp: now + 300, nbf: now - 10, repository: "acme/web", repository_visibility: "public" };

test("accepts a valid GitHub Actions OIDC token and returns its repository", async () => {
  resetGitHubKeyCache();
  const claims = await verifyGitHubOidc(sign(good), AUD, { fetchJwks: jwks });
  assert.equal(claims?.repository, "acme/web");
  assert.equal(claims?.repository_visibility, "public");
});

test("rejects tokens with a bad signature, unknown key or wrong algorithm", async () => {
  resetGitHubKeyCache();
  assert.equal(await verifyGitHubOidc(sign(good, { key: other.privateKey }), AUD, { fetchJwks: jwks }), null);
  assert.equal(await verifyGitHubOidc(sign(good, { kid: "nope" }), AUD, { fetchJwks: jwks }), null);
  assert.equal(await verifyGitHubOidc(sign(good, { alg: "none" }), AUD, { fetchJwks: jwks }), null);
  const [h, b] = sign(good).split(".");
  const tampered = Buffer.from(JSON.stringify({ ...good, repository: "victim/app" })).toString("base64url");
  assert.equal(await verifyGitHubOidc(`${h}.${tampered}.${sign(good).split(".")[2]}`, AUD, { fetchJwks: jwks }), null);
  assert.equal(await verifyGitHubOidc(`${h}.${b}`, AUD, { fetchJwks: jwks }), null);
});

test("rejects the wrong issuer, audience, an expired or not-yet-valid token", async () => {
  resetGitHubKeyCache();
  assert.equal(await verifyGitHubOidc(sign({ ...good, iss: "https://evil.example" }), AUD, { fetchJwks: jwks }), null);
  assert.equal(await verifyGitHubOidc(sign({ ...good, aud: "https://other.example" }), AUD, { fetchJwks: jwks }), null);
  assert.equal(await verifyGitHubOidc(sign({ ...good, exp: now - 120 }), AUD, { fetchJwks: jwks }), null);
  assert.equal(await verifyGitHubOidc(sign({ ...good, nbf: now + 600 }), AUD, { fetchJwks: jwks }), null);
  assert.equal(await verifyGitHubOidc(sign({ ...good, repository: "not a repo" }), AUD, { fetchJwks: jwks }), null);
  assert.equal(await verifyGitHubOidc("", AUD, { fetchJwks: jwks }), null);
  assert.equal(await verifyGitHubOidc(null, AUD, { fetchJwks: jwks }), null);
});

test("refreshes GitHub's keys once when the key id is new", async () => {
  resetGitHubKeyCache();
  let calls = 0;
  const rotating = async () => (++calls === 1 ? { keys: [] } : jwks());
  assert.equal((await verifyGitHubOidc(sign(good), AUD, { fetchJwks: rotating }))?.repository, "acme/web");
  assert.equal(calls, 2);
});
