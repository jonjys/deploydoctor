import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
type Json = Record<string, unknown>;
const server = JSON.parse(read("server.json")) as Json;
const plugin = JSON.parse(read("plugins/deploydoctor/plugin.json")) as Json;
const mcpJson = JSON.parse(read("plugins/deploydoctor/mcp.json")) as { mcpServers: Record<string, { type: string; url: string }> };
// A vendored copy of the registry's schema; the $id inside says which version it is.
const schema = JSON.parse(read("tests/fixtures/mcp-server.schema.json")) as Json;

/** Keywords of JSON Schema draft-07 this validator understands. Anything else in the schema fails the test instead of passing silently. */
const KEYWORDS = new Set(["$schema", "$id", "$ref", "$comment", "title", "description", "default", "example", "examples", "definitions",
  "type", "properties", "required", "additionalProperties", "items", "pattern", "enum", "const", "minLength", "maxLength", "format",
  "allOf", "anyOf", "oneOf", "not"]);

function resolve(ref: string, root: Json): Json {
  assert.match(ref, /^#\//, ref);
  return ref.slice(2).split("/").reduce<unknown>((node, key) => (node as Json)[key], root) as Json;
}

function isUri(value: string) {
  try { new URL(value); return true; } catch { return false; }
}

/** Every way `value` breaks `schema`, as readable paths; an empty list means it validates. */
function check(schema: Json, value: unknown, path: string, root: Json): string[] {
  const errors: string[] = [];
  for (const keyword of Object.keys(schema)) if (!KEYWORDS.has(keyword)) throw new Error(`unsupported schema keyword ${keyword} at ${path}`);
  if (typeof schema.$ref === "string") errors.push(...check(resolve(schema.$ref, root), value, path, root));
  for (const sub of (schema.allOf as Json[] | undefined) ?? []) errors.push(...check(sub, value, path, root));
  if (Array.isArray(schema.anyOf) && !(schema.anyOf as Json[]).some((sub) => check(sub, value, path, root).length === 0)) errors.push(`${path}: matches none of anyOf`);
  if (Array.isArray(schema.oneOf) && (schema.oneOf as Json[]).filter((sub) => check(sub, value, path, root).length === 0).length !== 1) errors.push(`${path}: must match exactly one of oneOf`);
  if (schema.not && check(schema.not as Json, value, path, root).length === 0) errors.push(`${path}: matches a forbidden schema`);
  if (schema.type) {
    const types = ([] as string[]).concat(schema.type as string | string[]);
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value;
    if (!types.includes(actual) && !(actual === "integer" && types.includes("number"))) errors.push(`${path}: expected ${types.join("|")}, got ${actual}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) errors.push(`${path}: not one of ${JSON.stringify(schema.enum)}`);
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${path}: ${value.length} characters, at most ${schema.maxLength}`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
    if (schema.format === "uri" && !isUri(value)) errors.push(`${path}: not a URI`);
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, index) => errors.push(...check(schema.items as Json, item, `${path}[${index}]`, root)));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Json;
    for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in object)) errors.push(`${path}: missing ${key}`);
    const properties = (schema.properties as Record<string, Json> | undefined) ?? {};
    for (const [key, item] of Object.entries(object)) {
      if (key in properties) errors.push(...check(properties[key], item, `${path}.${key}`, root));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected ${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errors.push(...check(schema.additionalProperties as Json, item, `${path}.${key}`, root));
    }
  }
  return errors;
}

const validate = (value: unknown) => check(schema, value, "server", schema);

test("server.json validates against the registry schema it names", () => {
  assert.equal(schema.$id, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  assert.equal(server.$schema, schema.$id);
  assert.deepEqual(validate(server), []);
});

test("the validator itself catches the mistakes the registry would reject", () => {
  const withoutVersion: Json = { ...server };
  delete withoutVersion.version;
  assert.deepEqual(validate(withoutVersion), ["server: missing version"]);
  assert.match(validate({ ...server, description: "x".repeat(101) }).join("\n"), /server\.description: 101 characters, at most 100/);
  assert.match(validate({ ...server, name: "deploydoctor" }).join("\n"), /server\.name: does not match/);
  assert.match(validate({ ...server, remotes: [{ type: "websocket", url: "wss://x.example/mcp" }] }).join("\n"), /remotes\[0\]: matches none of anyOf/);
  assert.match(validate({ ...server, remotes: [{ type: "streamable-http" }] }).join("\n"), /remotes\[0\]: matches none of anyOf/);
  assert.match(validate({ ...server, repository: { url: "not a url", source: "github" } }).join("\n"), /repository\.url: not a URI/);
  assert.match(validate({ ...server, websiteUrl: 12 }).join("\n"), /websiteUrl: expected string, got integer/);
  // The deprecated transport still validates, so the check is on the shape, not on a hard-coded type.
  assert.deepEqual(validate({ ...server, remotes: [{ type: "sse", url: "https://deploydoctor.nyttolabs.com/api/mcp" }] }), []);
});

test("server.json lists the live remote server under the GitHub namespace, in step with the plugin files", () => {
  assert.equal(server.name, "io.github.jonjys/deploydoctor");
  assert.equal(server.title, "DeployDoctor");
  // GitHub login publishes io.github.<owner>/*, so the owner is the repository's.
  const repository = server.repository as { url: string; source: string; id: string };
  const owner = /^https:\/\/github\.com\/([^/]+)\/[^/]+$/.exec(repository.url)?.[1];
  assert.equal(`io.github.${owner}/deploydoctor`, server.name);
  assert.deepEqual(repository, { url: plugin.repository, source: "github", id: "1389188872" });
  assert.deepEqual(server.remotes, [{ type: "streamable-http", url: "https://deploydoctor.nyttolabs.com/api/mcp" }]);
  assert.deepEqual(mcpJson.mcpServers.deploydoctor, { type: "streamable-http", url: "https://deploydoctor.nyttolabs.com/api/mcp" });
  assert.equal(server.websiteUrl, plugin.homepage);
  // One version for the plugin and the listing, so a bump in one is a bump in the other.
  assert.equal(server.version, plugin.version);
  assert.match(String(server.version), /^\d+\.\d+\.\d+$/);
  // The description is the plugin's, cut to the registry's 100 characters at a clause boundary.
  const description = server.description as string;
  assert.ok(description.length <= 100 && description.endsWith("."), description);
  assert.ok((plugin.description as string).startsWith(description.slice(0, -1)), description);
  // Nothing is on npm, so there is no package to list; the remote is the whole offer.
  assert.equal("packages" in server, false);
  assert.doesNotMatch(JSON.stringify(server), /[–—“”]/);
});

test("the plugin README tells the owner how to publish the listing and where else to submit it", () => {
  const readme = read("plugins/deploydoctor/README.md");
  const section = readme.slice(readme.indexOf("## Listing DeployDoctor in MCP directories"));
  assert.ok(section.length > 200, "section exists");
  assert.match(section, /mcp-publisher login github/);
  assert.match(section, /mcp-publisher publish/);
  assert.match(section, /server\.json/);
  assert.match(section, /registry\.modelcontextprotocol\.io/);
  for (const directory of ["Smithery", "mcp.so", "Cursor", "Claude connectors"]) assert.match(section, new RegExp(directory), directory);
  // README copy: no dashes and no quotation marks.
  assert.doesNotMatch(section, /[–—"“”]/);
});
