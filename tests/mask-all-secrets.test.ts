import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { maskAllSecrets } from "../src/lib/secrets";

// Built at runtime so no secret-shaped literal sits in the repository.
const body = (length: number) => Array.from({ length }, (_, index) => "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0"[(index * 7) % 30]).join("");

test("a build log sent to the model has every key format masked, not only repository-finding formats", () => {
  const keys = [
    ["sk", "live", body(32)].join("_"),
    ["sk", "proj", body(48)].join("-"),
    ["sk-ant-api03", body(90)].join("-"),
    ["sk", "test", body(30)].join("_"),
    ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url"), body(43)].join("."),
  ];
  const log = keys.map((key, index) => `line ${index}: KEY=${key}`).join("\n");
  const masked = maskAllSecrets(log);
  for (const key of keys) assert.ok(!masked.includes(key), `unmasked: ${key.slice(0, 12)}`);
  assert.equal(masked.split("\n").length, keys.length, "the log keeps its lines");
  assert.match(masked, /line 4: KEY=eyJ…/);
});

test("the AI diagnosis masks with maskAllSecrets before calling the model", () => {
  const source = readFileSync(new URL("../src/lib/ai-diagnose.ts", import.meta.url), "utf8");
  assert.match(source, /const log = maskAllSecrets\(/);
});
