import assert from "node:assert/strict";
import test from "node:test";
import { blankTemplates, lockfileMentions, moduleImports, packageName, stripComments } from "../src/lib/dependencies";

test("package names come from bare specifiers only", () => {
  assert.equal(packageName("three"), "three");
  assert.equal(packageName("three/examples/jsm/controls/OrbitControls"), "three");
  assert.equal(packageName("@react-three/fiber"), "@react-three/fiber");
  assert.equal(packageName("@scope/pkg/sub/path"), "@scope/pkg");
  for (const local of ["./x", "../x", "/abs", "@/lib/x", "~/lib/x", "#internal", "node:fs", "fs", "fs/promises", "path",
    "https://esm.sh/x", "virtual:pwa", "Components/Button", "@Scope/x"]) {
    assert.equal(packageName(local), null, local);
  }
});

test("runtime imports skip types and comments but keep multi-line, side-effect, re-export and call imports", () => {
  const source = [
    'import type { A } from "types-a";',
    'import { type B, type C } from "types-b";',
    '// import gone from "gone";',
    '/* import gone2 from "gone2"; */',
    'const url = "https://example.com"; import real from "real";',
    'import {\n  x,\n  y,\n} from "multi";',
    'import "side-effect";',
    'export * from "reexport";',
    'export { z } from "reexport-named";',
    'import { type D, e } from "mixed";',
    'const lazy = await import("dynamic");',
    'const cjs = require("cjs");',
  ].join("\n");
  assert.deepEqual(moduleImports(source).map((use) => `${use.specifier}:${use.line}:${use.kind}`), [
    "real:5:static", "multi:6:static", "side-effect:10:static", "reexport:11:static", "reexport-named:12:static", "mixed:13:static",
    "dynamic:14:call", "cjs:15:call",
  ]);
  assert.equal(stripComments('a // b\nc /* d\ne */ f "g // h"').split("\n").length, 3);
  assert.match(stripComments('const s = "// not a comment";'), /"\/\/ not a comment"/);
});

test("lockfile mentions work across npm, pnpm, yarn and bun formats", () => {
  const formats: Record<string, string> = {
    npm3: '{ "packages": { "node_modules/three": { "version": "1" } } }',
    npm1: '{ "dependencies": { "three": { "version": "1" } } }',
    pnpm9: "packages:\n\n  three@0.170.0:\n    resolution: {integrity: sha512-x}\n",
    pnpm6: "packages:\n\n  /three@0.150.0:\n    resolution: {integrity: sha512-x}\n",
    pnpm5: "packages:\n\n  /three/0.140.0:\n    resolution: {integrity: sha512-x}\n",
    yarn1: 'three@^0.170.0:\n  version "0.170.0"\n',
    yarnBerry: '"three@npm:^0.170.0":\n  version: 0.170.0\n',
    yarnDependency: 'other@^1.0.0:\n  dependencies:\n    three "^0.170.0"\n',
    bun: '{ "packages": { "three": ["three@0.170.0", "", {}, "sha512-x"] } }',
  };
  for (const [format, text] of Object.entries(formats)) {
    assert.equal(lockfileMentions(text, "three"), true, format);
    assert.equal(lockfileMentions(text, "thr"), false, `${format}: prefix`);
    assert.equal(lockfileMentions(text, "zod"), false, `${format}: absent`);
  }
  assert.equal(lockfileMentions('"node_modules/@react-three/fiber": {}', "@react-three/fiber"), true);
  assert.equal(lockfileMentions('"node_modules/three-stdlib": {}', "three"), false);
});

test("template strings are blanked with their line breaks kept, and code around them survives", () => {
  const source = [
    'const a = `line one',
    'import x from "inside-template"',
    'with ${`nested ${"deep"}`} and \\` escaped backtick`;',
    'import real from "after";',
    'const b = "a ` in a string"; import alsoReal from "same-line";',
    "const c = `${ { key: 1 }.key }`; import last from \"last\";",
  ].join("\n");
  const blanked = blankTemplates(source);
  assert.equal(blanked.length, source.length);
  assert.equal(blanked.split("\n").length, source.split("\n").length);
  assert.doesNotMatch(blanked, /inside-template|nested|deep|escaped/);
  assert.deepEqual(moduleImports(source).map((use) => `${use.specifier}:${use.line}`), ["after:4", "same-line:5", "last:6"]);
});
