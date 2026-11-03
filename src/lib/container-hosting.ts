import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { isNode, LineCounter, parseDocument } from "yaml";
import type { RepositorySnapshot } from "@/lib/analyzer";
import type { HostingAudit } from "@/lib/hosting-config";

type Table = Record<string, unknown>;
const table = (value: unknown): Table => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Table : {};
const items = (value: unknown): Table[] => Array.isArray(value) ? value.map(table) : [];
const text = (value: unknown) => typeof value === "string" ? value : undefined;
const literal = (value: string) => value.length > 0 && !/^[A-Za-z][\w+.-]*:/.test(value) && !/[\\$*?{}\0\r\n]/.test(value) && !path.posix.isAbsolute(value) && !value.split("/").includes("..");
const scriptName = (command: string) => /^\s*(?:npm|pnpm|yarn|bun)\s+run\s+([\w:-]+)\s*$/.exec(command)?.[1] ?? /^\s*(?:pnpm|yarn)\s+(build)\s*$/.exec(command)?.[1];

function tomlLocation(source: string, section: string, key: string, occurrence = 0): number {
  let current = "", seen = -1, headerLine = 1;
  for (const [index, line] of source.split("\n").entries()) {
    const header = /^\s*\[\[?([^\]]+)\]\]?/.exec(line);
    if (header) { current = header[1].replace(/["'\s]/g, ""); if (current === section) { seen++; headerLine = index + 1; } }
    if (current === section && seen === occurrence && new RegExp(`^\\s*["']?${key}["']?\\s*=`).test(line)) return index + 1;
  }
  return headerLine;
}

/** Data-only host adapters. Explicit CLI, provider state and generated artifacts remain outside coverage. */
export function auditContainerHosting(snapshot: RepositorySnapshot): HostingAudit {
  const paths = new Set(snapshot.entries.filter(entry => entry.type === "blob").map(entry => entry.path));
  const out: HostingAudit = { platforms: [], filesRead: [], evaluatedRules: [], findings: [], limitations: [] };
  const evaluated = new Set<string>();
  const add = (ruleId: string, file: string, line: number, problem: string, fix: string, status: "red" | "yellow" = "yellow") => {
    if (out.findings.length < 100) out.findings.push({ ruleId, file, line, problem, fix, status });
    else out.limitations.push("Container-platform finding limit reached.");
  };
  const read = (file: string) => {
    const value = snapshot.contents.get(file);
    if (value !== undefined) out.filesRead.push(file);
    else out.limitations.push(`${file} was not read.`);
    return value;
  };
  const existsDirectory = (directory: string) => path.posix.normalize(directory) === "." || [...paths].some(file => file.startsWith(path.posix.normalize(directory).replace(/\/$/, "") + "/"));
  const fly = paths.has("fly.toml") ? read("fly.toml") : undefined;
  if (fly !== undefined) {
    evaluated.add("fly-config-syntax");
    try {
      const config = parseToml(fly);
      const service = table(config.http_service), services = [service, ...items(config.services)];
      evaluated.add("fly-internal-port"); evaluated.add("fly-process-reference");
      for (const [index, current] of services.slice(0, 100).entries()) {
        const at = (key: string) => tomlLocation(fly, index === 0 ? "http_service" : "services", key, index === 0 ? 0 : index - 1);
        if (typeof current.internal_port === "number" && (!Number.isInteger(current.internal_port) || current.internal_port < 1 || current.internal_port > 65535)) add("fly-internal-port", "fly.toml", at("internal_port"), "A Fly service internal_port is outside the TCP/UDP port range.", "Set internal_port to the actual application listening port, from 1 to 65535.", "red");
        const processes = table(config.processes);
        if (Object.keys(processes).length && Array.isArray(current.processes)) for (const name of current.processes.slice(0, 100)) if (typeof name === "string" && !Object.hasOwn(processes, name)) add("fly-process-reference", "fly.toml", at("processes"), "A Fly service refers to a process group absent from the committed processes table.", "Match the service processes list to the declared process group names, then validate with fly config validate.");
      }
      if (services.length > 100) out.limitations.push("Only the first 100 Fly service declarations were inspected.");
      evaluated.add("fly-volume-destination");
      const mounts = Array.isArray(config.mounts) ? items(config.mounts) : [table(config.mounts)];
      for (const [index, mount] of mounts.slice(0, 100).entries()) if (typeof mount.destination === "string" && (!mount.destination.startsWith("/") || path.posix.normalize(mount.destination) === "/")) add("fly-volume-destination", "fly.toml", tomlLocation(fly, "mounts", "destination", index), "A Fly volume destination is relative or would replace the root filesystem.", "Use an absolute directory such as /data, not /, and verify that the application writes to that mount.", "red");
      if (mounts.length > 100) out.limitations.push("Only the first 100 Fly volume declarations were inspected.");
      evaluated.add("fly-dockerfile-path");
      const build = table(config.build), dockerfile = text(build.dockerfile);
      if (dockerfile && literal(dockerfile) && !build.image && !build.builder && !paths.has(path.posix.normalize(dockerfile))) add("fly-dockerfile-path", "fly.toml", tomlLocation(fly, "build", "dockerfile"), "The explicitly configured Fly Dockerfile was not found in the scanned commit.", "Check the Dockerfile path, casing and fly deploy working directory. CLI overrides and generated files are not visible.");
    } catch {
      add("fly-config-syntax", "fly.toml", 1, "fly.toml is not valid TOML.", "Correct TOML syntax, then run fly config validate.", "red");
    }
    out.limitations.push("Fly CLI overrides, actual listening addresses/ports, volume existence, image builds and live health checks were not verified.");
  }
  const renderFiles = ["render.yaml", "render.yml"].filter(file => paths.has(file));
  if (renderFiles.length > 1) out.limitations.push("Multiple Render Blueprint files: the provider-selected file is unknown; findings require review.");
  for (const file of renderFiles) {
    const source = read(file); if (source === undefined) continue;
    evaluated.add("render-config-syntax");
    const counter = new LineCounter();
    const doc = parseDocument(source, { lineCounter: counter, uniqueKeys: true, stringKeys: true, merge: true, logLevel: "silent" });
    if (doc.errors.length) {
      add("render-config-syntax", file, doc.errors[0].linePos?.[0].line ?? 1, "The Render Blueprint is not valid single-document YAML with unique mapping keys.", "Correct the YAML and validate the Blueprint with Render's CLI or schema.", renderFiles.length > 1 ? "yellow" : "red"); continue;
    }
    if (doc.warnings.length) { out.limitations.push(`${file} uses YAML tags or constructs that need manual review.`); continue; }
    let config: Table;
    try { config = table(doc.toJS({ maxAliasCount: 30 })); }
    catch { out.limitations.push(`${file} could not be safely expanded within the YAML alias budget.`); continue; }
    const at = (keys: Array<string | number>) => { const node = doc.getIn(keys, true); return isNode(node) && node.range ? counter.linePos(node.range[0]).line : 1; };
    const queue: Array<{ value: Table; keys: Array<string | number> }> = [{ value: config, keys: [] }, { value: table(config.ungrouped), keys: ["ungrouped"] }];
    for (const [p, project] of items(config.projects).slice(0, 32).entries()) for (const [e, environment] of items(project.environments).slice(0, 32).entries()) queue.push({ value: environment, keys: ["projects", p, "environments", e] });
    let count = 0;
    for (const scope of queue) for (const [index, service] of items(scope.value.services).entries()) {
      if (++count > 100) break;
      const keys = [...scope.keys, "services", index], line = (key: string) => at([...keys, key]);
      const status = renderFiles.length > 1 ? "yellow" : "red";
      const rootDir = text(service.rootDir) ?? ".", runtime = text(service.runtime) ?? text(service.env);
      const externalRepo = text(service.repo), branch = text(service.branch);
      const sameRepo = !externalRepo || externalRepo.replace(/\.git\/?$/, "").replace(/\/$/, "").toLowerCase() === `https://github.com/${snapshot.owner}/${snapshot.name}`.replace(/\.git\/?$/, "").replace(/\/$/, "").toLowerCase();
      const sameRef = !branch || branch === snapshot.gitRef;
      const local = sameRepo && sameRef;
      if (!local) out.limitations.push("Render service paths/scripts for a different repository or explicit unscanned branch were not verified.");
      evaluated.add("render-root-directory");
      if (local && literal(rootDir) && !snapshot.partial && !existsDirectory(rootDir)) add("render-root-directory", file, line("rootDir"), "A Render rootDir is absent from the scanned commit.", "Correct rootDir or commit the service source directory before deploying.", status);
      evaluated.add("render-dockerfile-path");
      const dockerfile = text(service.dockerfilePath);
      if (local && runtime === "docker" && dockerfile && literal(rootDir) && literal(dockerfile) && !paths.has(path.posix.join(rootDir, dockerfile))) add("render-dockerfile-path", file, line("dockerfilePath"), "A Render service's explicit Dockerfile path was not found relative to its rootDir.", "Resolve dockerfilePath relative to rootDir and check its case. Verify generated files and the selected branch before deployment.");
      evaluated.add("render-healthcheck-path");
      if (typeof service.healthCheckPath === "string" && !service.healthCheckPath.startsWith("/")) add("render-healthcheck-path", file, line("healthCheckPath"), "A Render healthCheckPath does not start with /.", "Use a path such as /health and independently test that it returns a successful response.", status);
      evaluated.add("render-missing-script"); evaluated.add("render-development-start");
      for (const key of ["buildCommand", "startCommand", "preDeployCommand"]) {
        const command = text(service[key]); if (!command) continue;
        const script = scriptName(command);
        if (local && script && literal(rootDir)) {
          const manifestPath = path.posix.join(rootDir, "package.json"), raw = snapshot.contents.get(manifestPath);
          if (raw) try { const manifest = table(JSON.parse(raw)); if (!manifest.workspaces && !Object.hasOwn(table(manifest.scripts), script)) add("render-missing-script", file, line(key), `A Render command references a missing ${script} script in ${manifestPath}.`, `Define ${script} in that package or correct the service command.`, status); } catch { /* Existing package checks own syntax. */ }
        }
        if (key === "startCommand" && /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?dev|(?:npx\s+)?next\s+dev|vite(?:\s+--host(?:\s+[\d.]+)?)?)\s*$/.test(command.trim())) add("render-development-start", file, line(key), "A Render service starts an explicit development server command.", "Use the framework's production build and production server command; verify binding to the provider's listening interface and port.");
      }
      evaluated.add("render-static-publish-file");
      const publish = text(service.staticPublishPath);
      if (local && runtime === "static" && publish && literal(rootDir) && literal(publish) && paths.has(path.posix.join(rootDir, publish))) add("render-static-publish-file", file, line("staticPublishPath"), "A Render staticPublishPath points at a committed file, not a directory.", "Set the generated output directory. The directory itself may correctly be absent until the build runs.", status);
      evaluated.add("render-cron-schedule");
      if (service.type === "cron" && !text(service.schedule)?.trim()) add("render-cron-schedule", file, at(keys), "A Render cron service has no schedule in the Blueprint.", "Specify its intended cron schedule or verify the existing service setting in Render. The scanner cannot infer a safe schedule.");
    }
    if (count > 100 || items(config.projects).length > 32 || items(config.projects).slice(0, 32).some(p => items(p.environments).length > 32)) out.limitations.push("Render service/project/environment inspection limit reached.");
    out.limitations.push("Render Blueprint validation covers selected committed fields only. Dashboard state, other repositories/branches, generated outputs, actual builds and runtime behavior were not verified.");
  }
  // No secret value is ever copied into a finding. Names identify risky image configuration, not proven leaked credentials.
  for (const file of [...paths].filter(file => /^(?:Dockerfile(?:\.[\w-]+)?|[^/]+\/Dockerfile)$/.test(file) && !/(?:^|\/)(?:tests?|fixtures|node_modules|vendor)\//.test(file)).slice(0, 32)) {
    const source = read(file); if (source === undefined) continue;
    evaluated.add("docker-sensitive-build-variable");
    for (const [index, sourceLine] of source.split("\n").entries()) {
      const declaration = /^\s*(ARG|ENV)\s+([A-Z][A-Z0-9_]*)\s*(?:=\s*([^\r\n]*))?$/.exec(sourceLine);
      if (!declaration || !/(?:^|_)(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY|SERVICE_ROLE_KEY)(?:_|$)/.test(declaration[2])) continue;
      if (declaration[1] === "ENV" && (!declaration[3]?.trim() || /^(?:["']?(?:placeholder|example|changeme)["']?|\$\{?[A-Z][A-Z0-9_]*\}?)(?:\s*#.*)?$/i.test(declaration[3].trim()))) continue;
      add("docker-sensitive-build-variable", file, index + 1, `A Docker ${declaration[1]} declares the sensitive variable name ${declaration[2]}.`, "Review whether a real credential is passed at build time. Use build secret mounts or runtime injection; image metadata and build history can retain sensitive values.");
    }
  }
  out.evaluatedRules = [...evaluated]; out.limitations = [...new Set(out.limitations)];
  return out;
}
