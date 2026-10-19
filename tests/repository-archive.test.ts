import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { pack } from "tar-stream";
import { readRepositoryArchive } from "../src/lib/repository-archive";

async function archive(items: Array<{ name: string; text?: string; type?: "file" | "symlink" }>) {
  const tar = pack();
  for (const item of items) tar.entry({ name: item.name, type: item.type ?? "file", linkname: item.type === "symlink" ? "../../outside" : undefined }, item.text ?? "");
  tar.finalize();
  const chunks = [];
  for await (const chunk of tar) chunks.push(chunk);
  return gzipSync(Buffer.concat(chunks));
}
function parse(data: Buffer, select = (_path: string, size: number) => size < 256000) {
  return readRepositoryArchive(Readable.toWeb(Readable.from([data])) as ReadableStream<Uint8Array>, select,
    file => file === "package.json" ? 0 : 5, AbortSignal.timeout(5000));
}

test("a repository archive preserves paths and reads selected files without extracting links", async () => {
  const read = await parse(await archive([
    { name: "owner-sha/package.json", text: '{"name":"demo"}' },
    { name: "owner-sha/src/page.tsx", text: "export default 1" },
    { name: "owner-sha/binary.png", text: "binary" },
    { name: "owner-sha/link", type: "symlink" },
  ]), file => /json|tsx/.test(file));
  assert.equal(read.contents.get("package.json"), '{"name":"demo"}');
  assert.equal(read.contents.has("binary.png"), false);
  assert.equal(read.contents.has("link"), false);
  assert.equal(read.entries.find(item => item.path === "src/page.tsx")?.type, "blob");
});
test("path traversal and mixed archive roots are rejected", async () => {
  for (const path of ["root/../outside", "root/dir/../../outside", "root/path\\outside"]) {
    await assert.rejects(parse(await archive([{ name: path, text: "no" }])), /Unsafe/);
  }
  await assert.rejects(parse(await archive([{ name: "root/a", text: "a" }, { name: "other/b", text: "b" }])), /Unsafe/);
});
test("more than 180 interesting files keeps high-priority configuration and marks the scan partial", async () => {
  const items = Array.from({ length: 181 }, (_, i) => ({ name: `root/src/file${i}.ts`, text: "export {}" }));
  items.push({ name: "root/package.json", text: "{}" });
  const read = await parse(await archive(items));
  assert.equal(read.entries.length, 182);
  assert.equal(read.contents.size, 180);
  assert.equal(read.contents.get("package.json"), "{}");
  assert.equal(read.truncated, true);
});
test("malformed gzip and cancelled downloads fail rather than producing a clean scan", async () => {
  await assert.rejects(parse(Buffer.from("not gzip")));
  const signal = AbortSignal.abort();
  await assert.rejects(readRepositoryArchive(Readable.toWeb(Readable.from([await archive([{ name: "root/a", text: "a" }])])) as ReadableStream<Uint8Array>, () => true, () => 0, signal));
});
