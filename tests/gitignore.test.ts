import assert from "node:assert/strict";
import test from "node:test";
import { ignoringRule } from "../src/lib/gitignore";

const ignored = (gitignore: string, path = ".env.example") => ignoringRule(gitignore, path)?.pattern ?? null;

test("gitignore patterns that catch .env.example", () => {
  assert.equal(ignored(".env*\n"), ".env*");
  assert.equal(ignored("node_modules\n.env.*\n"), ".env.*");
  assert.equal(ignored("/.env*"), "/.env*");
  assert.equal(ignored("**/.env*"), "**/.env*");
  assert.equal(ignored("*.example"), "*.example");
  assert.equal(ignored(".env?example"), ".env?example");
  assert.equal(ignored(".env[._]example"), ".env[._]example");
  // Order matters: a later .env* takes the exception back.
  assert.equal(ignored(".env*\n!.env.example\n.env*\n"), ".env*");
});

test("gitignore patterns that leave .env.example alone", () => {
  assert.equal(ignored(".env*\n!.env.example\n"), null);
  assert.equal(ignored(".env\n.env.local\n.env*.local\n"), null);
  assert.equal(ignored("# .env*\n"), null);
  assert.equal(ignored("\\#.env*\n"), null);
  assert.equal(ignored(".env*/\n"), null); // directory-only
  assert.equal(ignored("config/.env*\n"), null); // anchored elsewhere
  assert.equal(ignored(".env.[!e]*\n"), null);
  assert.equal(ignored(".env*\n!.env.example\n"), null);
});

test("files inside an ignored directory cannot be re-included", () => {
  assert.equal(ignoringRule("app/\n!app/.env.example\n", "app/.env.example")?.pattern, "app/");
  assert.equal(ignoringRule("app/*\n!app/.env.example\n", "app/.env.example"), null);
  assert.equal(ignoringRule("docs/**/*.md\n", "docs/a/b/readme.md")?.pattern, "docs/**/*.md");
  assert.equal(ignoringRule("docs/**/*.md\n", "docs/readme.md")?.pattern, "docs/**/*.md");
});
