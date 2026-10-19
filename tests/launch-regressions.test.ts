import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { moduleImports } from "../src/lib/dependencies";
import { diagnosisRules, detectionRules, mailRules, AI_MAX_OUTPUT_TOKENS, AI_SITE_DIAGNOSES_PER_DAY, PAID_DIAGNOSES_PER_DAY } from "../src/lib/budget-policy";

function check(files: Record<string, string>, id = "imports") {
  const contents = { "package.json": JSON.stringify({ dependencies: { next: "16.4.2" } }), ...files };
  const snapshot: RepositorySnapshot = { owner: "example", name: "app", defaultBranch: "main", partial: false,
    entries: Object.keys(contents).map(path => ({ path, type: "blob" })), contents: new Map(Object.entries(contents)), sourceFilesFound: 1, sourceFilesRead: 1 };
  return analyzeSnapshot(snapshot).checks.find(check => check.id === id)!;
}
test("commented imports, quoted code, templates, regex and JSX prose never create missing import failures", () => {
  const samples = ['// import Ghost from "./missing";', '/* import Ghost from "./missing"; */',
    'const example = `import Ghost from "./missing"`;', 'const example = \'import Ghost from "./missing"\';',
    'const example = /import Ghost from "missing"/;', 'const el = <p>import Ghost from "./missing"</p>;'];
  for (const source of samples) assert.equal(check({ "app/page.tsx": `${source}\nexport default function Page(){return null}` }).status, "green", source);
});
test("baseUrl and path aliases resolve from the same directory; real casing errors remain red", () => {
  const files = { "tsconfig.json": '{"compilerOptions":{"baseUrl":"./src","paths":{"@/*":["*"]}}}',
    "app/page.tsx": 'import Button from "@/components/Button"; export default function Page(){return <Button/>}', "src/components/Button.tsx": "export default 1" };
  assert.equal(check(files).status, "green");
  assert.equal(check({ ...files, "app/page.tsx": files["app/page.tsx"].replace("components/Button", "components/button") }).status, "red");
});
test("generated files, ignored paths and declaration files are not falsely certain failures", () => {
  assert.equal(check({ "app/page.tsx": 'import x from "./generated/client"; export default function Page(){return x}' }).status, "yellow");
  assert.equal(check({ "app/page.tsx": 'import x from "./build/client"; export default function Page(){return x}', ".gitignore": "app/build/" }).status, "yellow");
  assert.equal(check({ "app/page.tsx": "export default function Page(){return null}", "types.d.ts": 'import "./generated/types"' }).status, "green");
  assert.equal(check({ "app/page.tsx": 'import x from "./actually-missing"; export default function Page(){return x}' }).status, "red");
});
test("undocumented environment variables need verification in hosting, while browser secrets remain red", () => {
  assert.equal(check({ "app/page.tsx": 'export default function Page(){return process.env.API_URL}' }, "env").status, "yellow");
  assert.equal(check({ "app/page.tsx": 'export default function Page(){return process.env.NEXT_PUBLIC_SECRET_KEY}' }, "env").status, "red");
});
test("all import consumers distinguish runtime code from type-only code and string samples", () => {
  assert.deepEqual(moduleImports('const s = "require(\'fake\')"; import type {A} from "types"; export {type B} from "types2"; require("real")').map(item => item.specifier), ["real"]);
});
test("paid AI usage, site usage, detection and email all have finite budgets", () => {
  assert.equal(diagnosisRules("customer", true)[1].limit, PAID_DIAGNOSES_PER_DAY);
  assert.equal(diagnosisRules("customer", true)[0].limit, AI_SITE_DIAGNOSES_PER_DAY);
  assert.equal(diagnosisRules("visitor", false)[1].limit, 1);
  assert.ok(AI_MAX_OUTPUT_TOKENS <= 2000);
  for (const rules of [diagnosisRules("a", true), detectionRules("a"), mailRules("a@example.com")]) {
    assert.ok(rules.every(rule => rule.limit > 0 && rule.seconds > 0 && Number.isFinite(rule.limit)));
  }
});
