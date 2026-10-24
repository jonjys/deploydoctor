#!/usr/bin/env node
// DeployDoctor CLI. Plain Node, no dependencies: it resolves the GitHub repository from the argument or the
// folder's git origin, POSTs it to /api/reports and prints one table row per check. Nothing is cloned,
// installed or executed on this machine; the server reads the repository through the GitHub API.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { version: VERSION } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const DEFAULT_API = "https://deploydoctor.nyttolabs.com";
const CATEGORIES = ["next", "vercel", "env", "supabase", "prisma"];
const USAGE = `Usage: npx deploydoctor [owner/repo | https://github.com/owner/repo] [--checks next,vercel,env,supabase,prisma] [--json] [--api <url>]
Without a repository it reads the GitHub origin of the current folder.
Exit codes: 0 no red check, 1 a red check, 2 the scan did not run (usage, network or API error).
Set DEPLOYDOCTOR_TOKEN to an API token from My scans to scan without the free daily limit.`;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = (text) => paint(1, text);
const STATUS = { red: { word: "Fail", code: 31 }, yellow: { word: "Review", code: 33 }, green: { word: "Pass", code: 32 } };
const label = (status) => STATUS[status]?.word ?? String(status);

const fail = (message, code = 2) => { console.error(message); process.exit(code); };

function parseArgs(argv) {
  const options = { repo: null, checks: null, json: false, api: DEFAULT_API };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith("--") && arg.includes("=") ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => { if (inline !== undefined) return inline; if (i + 1 >= argv.length) fail(`${flag} needs a value.\n${USAGE}`); return argv[++i]; };
    if (flag === "--help" || flag === "-h") { console.log(USAGE); process.exit(0); }
    else if (flag === "--version" || flag === "-v") { console.log(VERSION); process.exit(0); }
    else if (flag === "--json") options.json = true;
    else if (flag === "--checks") options.checks = value().split(",").map((item) => item.trim()).filter(Boolean);
    else if (flag === "--api") options.api = value().replace(/\/+$/, "");
    else if (flag.startsWith("-")) fail(`Unknown option ${flag}.\n${USAGE}`);
    else if (options.repo) fail(`Only one repository at a time.\n${USAGE}`);
    else options.repo = flag;
  }
  return options;
}

// owner/repo, a github.com URL with or without a scheme, or a git remote in https, ssh or scp form.
function githubRepo(text) {
  const trimmed = text.trim();
  // GitHub owners are letters, digits and hyphens; repository names also allow dots and underscores.
  const short = /^([A-Za-z0-9-]+)\/([\w.-]+?)(?:\.git)?$/.exec(trimmed);
  const remote = /^(?:(?:https?|ssh|git):\/\/(?:[\w.-]+@)?|[\w.-]+@|www\.)?github\.com[/:]([A-Za-z0-9-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(trimmed);
  const match = short ?? remote;
  if (!match || match[2].startsWith(".")) return null;
  return `https://github.com/${match[1]}/${match[2]}`;
}

function originRepo() {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
    return githubRepo(url);
  } catch {
    return null;
  }
}

function resolveRepo(argument) {
  if (argument) {
    const repo = githubRepo(argument);
    if (!repo) fail(`DeployDoctor scans public GitHub repositories: pass owner/repo or a github.com URL, not ${argument}.`);
    return repo;
  }
  const repo = originRepo();
  if (!repo) fail("No repository given and no GitHub origin in this folder. Try: npx deploydoctor owner/repo");
  return repo;
}

function table(checks) {
  const rows = checks.map((check) => {
    const finding = (check.findings ?? [])[0];
    const where = finding?.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : "";
    return [label(check.status), check.title, where, check.status];
  });
  const head = ["Status", "Check", "Where"];
  const widths = head.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells, decorate) => cells.map((cell, column) => {
    const padded = column === cells.length - 1 ? cell : cell.padEnd(widths[column]);
    return decorate ? decorate(padded, column) : padded;
  }).join("  ").trimEnd();
  const out = [line(head, (cell) => bold(cell))];
  for (const [word, title, where, status] of rows) out.push(line([word, title, where], (cell, column) => (column === 0 && STATUS[status] ? paint(STATUS[status].code, cell) : cell)));
  return out.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.checks) {
    const unknown = options.checks.filter((check) => !CATEGORIES.includes(check));
    if (unknown.length || !options.checks.length) fail(`--checks takes a comma-separated list of ${CATEGORIES.join(", ")}.`);
  }
  const repoUrl = resolveRepo(options.repo);
  const token = (process.env.DEPLOYDOCTOR_TOKEN ?? "").trim();
  const headers = { "content-type": "application/json", accept: "application/json", "user-agent": `deploydoctor-cli/${VERSION}` };
  if (token) headers.authorization = `Bearer ${token}`;
  const body = { repoUrl, ...(options.checks ? { checks: options.checks } : {}) };

  let response;
  let text;
  try {
    response = await fetch(`${options.api}/api/reports`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    text = await response.text();
  } catch (error) {
    fail(`DeployDoctor did not answer at ${options.api}: ${error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail(`DeployDoctor returned ${response.status} with an unexpected answer. Try again in a minute.`);
  }
  // The body is written once and the exit code is left to Node: process.exit right after a write drops whatever did not fit
  // the pipe buffer (64 KB on Linux), which would cut a large --json report in half.
  if (options.json) console.log(text);

  const pricing = typeof data.pricingUrl === "string" ? data.pricingUrl : `${options.api}/pricing`;
  if (!response.ok) {
    if (options.json) { process.exitCode = 2; return; }
    const message = typeof data.error === "string" ? data.error : `DeployDoctor returned ${response.status}.`;
    if (response.status === 429 && data.paywall === true) {
      fail(`${message}\nFree scans: 1 a day per IP, no account. Unlimited scans: ${pricing}, then create an API token under My scans and set DEPLOYDOCTOR_TOKEN.`);
    }
    // privateRepo marks the private repository offer whatever the status; a plain 402 is a token whose pass has lapsed.
    if (data.privateRepo === true) fail(`${message}\nPrivate repositories need a pass: ${pricing}`);
    if (response.status === 402) fail(`${message}\nNo active pass for DEPLOYDOCTOR_TOKEN. Get one: ${pricing}, then the token works again, or create a new one under My scans in the browser you paid in.`);
    if (response.status === 401) fail(`${message}\nDEPLOYDOCTOR_TOKEN is not valid. Create a new token under My scans.`);
    fail(`DeployDoctor returned ${response.status}: ${message}`);
  }

  const checks = Array.isArray(data.checks) ? data.checks : [];
  const red = checks.some((check) => check.status === "red") || (data.summary?.red ?? 0) > 0;
  if (!options.json) {
    const repo = repoUrl.replace("https://github.com/", "");
    const at = data.ref ? ` @ ${data.ref}${data.commitSha ? ` ${String(data.commitSha).slice(0, 8)}` : ""}` : "";
    console.log(bold(`DeployDoctor: ${repo}${at}`));
    console.log("");
    console.log(table(checks));
    console.log("");
    const summary = data.summary ?? {};
    const verdict = STATUS[data.overall] ? paint(STATUS[data.overall].code, label(data.overall)) : "";
    console.log(`${verdict ? `${verdict}: ` : ""}${summary.red ?? 0} failed, ${summary.yellow ?? 0} to review, ${summary.green ?? 0} passed.`);
    if (data.partial) console.log("Partial scan: the file or time budget was hit, the report says where.");
    console.log(`Report: ${data.url ?? `${options.api}${data.href ?? ""}`}`);
    if (!token) console.log("Free scans: 1 a day per IP. Nothing was cloned or executed on this machine.");
  }
  process.exitCode = red ? 1 : 0;
}

main().catch((error) => fail(`DeployDoctor CLI failed: ${error instanceof Error ? error.message : String(error)}`));
