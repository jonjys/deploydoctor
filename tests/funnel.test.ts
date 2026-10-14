import assert from "node:assert/strict";
import test from "node:test";
import { githubFailure, maybePrivateRepo } from "../src/lib/github-status";
import { repoUrlFromParam } from "../src/lib/repo-input";
import { confirmFallbackEvent, scanRepoFromContext } from "../src/lib/checkout-guard";
import { messages, t } from "../src/lib/i18n";

test("a buyer's token that cannot read the repo says so instead of blaming visibility or the rate limit", () => {
  for (const status of [401, 403, 404]) {
    const failure = githubFailure(status, { userToken: true });
    assert.equal(failure.key, "gh.tokenNoAccess", String(status));
    assert.equal(failure.status, 403);
  }
  assert.equal(githubFailure(403, { userToken: true, rateLimited: true }).key, "gh.rateLimit");
  assert.equal(githubFailure(429, { userToken: true }).key, "gh.rateLimit");
  // Without a user token nothing changes.
  assert.deepEqual([404, 403, 429, 500].map((status) => githubFailure(status).key), ["gh.notFound", "gh.rateLimit", "gh.rateLimit", "gh.unexpected"]);
  assert.equal(githubFailure(404).status, 404);
});

test("a repo GitHub would not show may be private, unless a token was already sent", () => {
  assert.equal(maybePrivateRepo("gh.notFound"), true);
  assert.equal(maybePrivateRepo("gh.privateOnly"), true);
  assert.equal(maybePrivateRepo("gh.privateOnly", "github_pat_x"), true);
  assert.equal(maybePrivateRepo("gh.notFound", "github_pat_x"), false);
  assert.equal(maybePrivateRepo("gh.tokenNoAccess", "github_pat_x"), false);
  assert.equal(maybePrivateRepo("gh.rateLimit"), false);
  assert.equal(maybePrivateRepo(undefined), false);
});

test("the repo field and ?repo= accept what people paste and give one canonical URL", () => {
  const canonical = "https://github.com/vercel/commerce";
  for (const input of [
    "vercel/commerce", " vercel/commerce ", "github.com/vercel/commerce", "www.github.com/vercel/commerce",
    "https://github.com/vercel/commerce", "https://www.github.com/vercel/commerce/", "http://github.com/vercel/commerce",
    "https://github.com/vercel/commerce.git", "https://github.com/vercel/commerce/tree/main", "https://github.com/vercel/commerce/tree/feat/x/y",
    "https://github.com/vercel/commerce/blob/main/app/page.tsx", "https://github.com/vercel/commerce?tab=readme-ov-file", "HTTPS://GITHUB.COM/vercel/commerce",
  ]) assert.equal(repoUrlFromParam(input), canonical, input);
  assert.equal(repoUrlFromParam("acme/site.github.io"), "https://github.com/acme/site.github.io");
  for (const input of [
    "", null, undefined, "vercel", "github.com/vercel", "https://github.com/vercel", "https://gitlab.com/vercel/commerce",
    "https://github.com/vercel/commerce/pulls", "vercel/commerce/extra", "javascript:alert(1)", "owner/repo name",
  ]) assert.equal(repoUrlFromParam(input), "", String(input));
});

test("only a scan repo URL in the checkout context leads back to a scan", () => {
  assert.equal(scanRepoFromContext("https://github.com/vercel/commerce"), "vercel/commerce");
  for (const context of [undefined, null, "", "healthcare-app/web", "https://github.com/vercel/commerce/tree/main", "https://evil.example/https://github.com/a/b", "https://github.com/a/b?x=1"]) {
    assert.equal(scanRepoFromContext(context), undefined, String(context));
  }
});

test("the confirm fallback event never outranks or dedupes the real webhook event", () => {
  const event = confirmFallbackEvent({ id: "cs_test_abc123456789", created: 1_760_000_000 });
  assert.equal(event.id, "confirm_cs_test_abc123456789");
  assert.ok(!event.id.startsWith("evt_"));
  assert.equal(event.type, "checkout.session.completed");
  // apply_billing_event only overwrites when the newer event is at least as new; real events come after the session exists.
  assert.equal(event.created, 1_760_000_000);
  assert.equal((event.data.object as { id: string }).id, "cs_test_abc123456789");
});

test("new funnel copy exists in both languages, prices match, and has no dashes or quotation marks", () => {
  const keys = ["gh.maybePrivate", "gh.tokenNoAccess", "paywall.privateTitle", "form.private.needsPass", "form.private.tokenLink",
    "form.private.note", "confirm.scanNow", "account.passActive", "account.historyNote", "pricing.badge.week", "pricing.badge.public"] as const;
  for (const key of keys) {
    for (const lang of ["en", "sv"] as const) {
      assert.ok(messages[lang][key], `${lang} ${key}`);
      assert.doesNotMatch(messages[lang][key], /[–—"“”„]/, `${lang} ${key}`);
    }
  }
  assert.match(t("en", "gh.maybePrivate"), /\$2/);
  assert.match(t("sv", "gh.maybePrivate"), /19 kr/);
  assert.match(t("sv", "paywall.privateTitle"), /19 kr/);
  assert.equal(t("en", "confirm.scanNow", { repo: "a/b" }), "Scan a/b now");
  assert.doesNotMatch(`${messages.en["pricing.badge.week"]} ${messages.sv["pricing.badge.week"]}`, /POPULAR|POPULÄR/);
});
