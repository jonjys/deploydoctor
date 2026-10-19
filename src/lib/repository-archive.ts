import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { extract } from "tar-stream";

export const ARCHIVE_LIMITS = { compressed: 20_000_000, expanded: 100_000_000, entries: 30_000, buffered: 24_000_000 } as const;
type Entry = { path: string; type: "blob" | "tree"; size?: number };
export type ArchiveSnapshot = { entries: Entry[]; contents: Map<string, string>; truncated: boolean };

/** Parse data only: no extraction to disk, links, subprocesses or repository code execution. */
export async function readRepositoryArchive(body: ReadableStream<Uint8Array>, select: (path: string, size: number) => boolean,
  priority: (path: string) => number, signal: AbortSignal): Promise<ArchiveSnapshot> {
  const entries: Entry[] = [];
  const contents = new Map<string, string>();
  let root: string | undefined;
  let buffered = 0;
  let truncated = false;
  const limiter = (max: number) => {
    let bytes = 0;
    return new Transform({ transform(chunk, _encoding, done) {
      bytes += chunk.length;
      done(bytes > max ? new Error("Repository archive exceeds the size limit.") : null, chunk);
    } });
  };
  const tar = extract();
  tar.on("entry", (header, stream, next) => {
    stream.on("error", error => tar.destroy(error));
    const parts = header.name.replace(/\/$/, "").split("/");
    root ??= parts[0];
    if (parts[0] !== root || parts.some(part => !part || part === "." || part === "..") || /[\\\0]/.test(header.name)) {
      stream.resume(); tar.destroy(new Error("Unsafe repository archive path.")); return;
    }
    const path = parts.slice(1).join("/");
    if (!path || !["file", "directory", "symlink", "link"].includes(header.type ?? "")) { stream.resume(); stream.on("end", next); return; }
    if (entries.length >= ARCHIVE_LIMITS.entries) { tar.destroy(new Error("Repository archive has too many entries.")); stream.resume(); return; }
    const size = header.size ?? 0;
    entries.push({ path, type: header.type === "directory" ? "tree" : "blob", size });
    const chunks: Buffer[] = [];
    const wanted = header.type === "file" && select(path, size);
    if (wanted) stream.on("data", (chunk: Buffer) => chunks.push(chunk)); else stream.resume();
    stream.on("end", () => {
      if (wanted) {
        const data = Buffer.concat(chunks);
        contents.set(path, data.toString("utf8"));
        buffered += data.length;
        while (contents.size > 180 || buffered > ARCHIVE_LIMITS.buffered) {
          const worst = [...contents.keys()].sort((a, b) => priority(b) - priority(a) || b.localeCompare(a))[0];
          buffered -= Buffer.byteLength(contents.get(worst)!);
          contents.delete(worst); truncated = true;
        }
      }
      next();
    });
  });
  await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), limiter(ARCHIVE_LIMITS.compressed), createGunzip(),
    limiter(ARCHIVE_LIMITS.expanded), tar, { signal });
  return { entries, contents, truncated };
}
