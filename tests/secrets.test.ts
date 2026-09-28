import assert from "node:assert/strict";
import test from "node:test";
import { findSecrets, maskSecrets } from "../src/lib/secrets";

// Pieces are joined at runtime so no complete key-shaped string is committed.
const body = "Qm7Rk2Vt9Lp4Xw8Zn3Jc6Hb1Fg5Ds0Ay";

test("every supported key format is found and masked to prefix plus last four", () => {
  const samples: Array<[string, string]> = [
    ["sk_" + "live_" + body, "sk_live_…" + body.slice(-4)],
    ["rk_" + "live_" + body, "rk_live_…" + body.slice(-4)],
    ["whsec_" + body + "Pq", "whsec_…" + "0AyPq".slice(-4)],
    ["AKIA" + "Q4ZT7NR2WX5KLM3B", "AKIA…LM3B"],
    ["ghp_" + body + "a1B2", "ghp_…a1B2"],
    ["github_pat_" + body.slice(0, 22) + "_" + (body + body).slice(0, 59), "github_pat_…" + (body + body).slice(55, 59)],
    ["sb_secret_" + body, "sb_secret_…" + body.slice(-4)],
  ];
  for (const [secret, masked] of samples) {
    const found = findSecrets(`const value = "${secret}";`);
    assert.equal(found.length, 1, secret.slice(0, 12));
    assert.equal(found[0].masked, masked);
    assert.equal(maskSecrets(`x=${secret}`), `x=${masked}`);
  }
});

test("look-alikes are not secrets", () => {
  for (const text of ["sk_" + "live_", "sk_" + "live_12345", "AKIA" + "IOSFODNN7EXAMPLE", "whsec_" + "x".repeat(40),
    "sb_secret_" + "your-secret-key-goes-here", "-----BEGIN PRIVATE " + "KEY-----\n...\n-----END PRIVATE KEY-----"]) {
    assert.deepEqual(findSecrets(text), [], text);
  }
});
