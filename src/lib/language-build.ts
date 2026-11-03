import path from "node:path";
import type { RepositorySnapshot } from "@/lib/analyzer";
import type { Finding } from "@/types/report";

const version = (value: string) => /^\d+\.\d+(?:\.\d+)?$/.test(value) ? [...value.split(".").map(Number), 0].slice(0, 3) : undefined;
const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
/** A deliberately small, fully understood subset; unsupported PEP 440 syntax is never guessed. */
export function exactPythonPinAllowed(pin: string, constraint: string): boolean | undefined {
  if (!/^\d+\.\d+\.\d+$/.test(pin)) return undefined;
  const parts = constraint.split(",").map(part => /^(>=|<=|==|!=|>|<)\s*(\d+\.\d+(?:\.\d+)?)$/.exec(part.trim()));
  if (!parts.length || parts.some(part => !part)) return undefined;
  return parts.every(part => {
    const result = compare(version(pin)!, version(part![2])!);
    return ({ ">=": result >= 0, "<=": result <= 0, "==": result === 0, "!=": result !== 0, ">": result > 0, "<": result < 0 } as Record<string, boolean>)[part![1]];
  });
}

export function languageBuildFindings(snapshot: RepositorySnapshot, pythonProject?: Record<string, unknown>): { findings: Finding[]; evaluatedRules: string[]; limitations: string[] } {
  const findings: Finding[] = [], evaluatedRules: string[] = [];
  const pin = snapshot.contents.get(".python-version")?.trim(), constraint = pythonProject?.["requires-python"];
  if (pin && typeof constraint === "string") {
    const compatible = exactPythonPinAllowed(pin, constraint);
    if (compatible !== undefined) evaluatedRules.push("python-pinned-version");
    if (compatible === false) findings.push({ruleId:"python-pinned-version",file:".python-version",line:1,status:"yellow",problem:`The exact Python pin ${pin} does not satisfy project.requires-python.`,fix:"Align .python-version with requires-python and independently verify which Python runtime the hosting provider selects. A developer pin does not prove the production runtime."});
  }
  const source = snapshot.contents.get("go.mod");
  if (source !== undefined) {
    const lines = source.split("\n").map(line => line.replace(/\/\/.*$/, "").trim());
    const minimum = lines.map(line => /^go\s+(\d+\.\d+(?:\.\d+)?)$/.exec(line)?.[1]).find(Boolean);
    const toolchainLine = lines.findIndex(line => /^toolchain\s+go\d+\.\d+(?:\.\d+)?$/.test(line));
    if (minimum && toolchainLine >= 0) {
      evaluatedRules.push("go-toolchain-minimum");
      const suggested = lines[toolchainLine].replace(/^toolchain\s+go/, "");
      if (compare(version(suggested)!, version(minimum)!) < 0) findings.push({ruleId:"go-toolchain-minimum",file:"go.mod",line:toolchainLine+1,status:"red",problem:"The explicit Go toolchain directive is older than the module's minimum Go directive.",fix:"Align the toolchain and go directives using go mod edit and validate the module with the intended production toolchain. This does not compare against an unknown installed Go version."});
    }
    evaluatedRules.push("go-local-replacement");
    let replacements = false;
    for (const [index, line] of lines.entries()) {
      if (/^replace\s*\($/.test(line)) { replacements = true; continue; }
      if (replacements && line === ")") { replacements = false; continue; }
      if (!replacements && !line.startsWith("replace ")) continue;
      const match = /=>\s*(\.\.?\/[^\s"'`]+)\s*$/.exec(line);
      if (!match) continue;
      const directory = path.posix.normalize(match[1]);
      const outside = directory === ".." || directory.startsWith("../");
      const missing = !snapshot.partial && directory !== "." && !snapshot.entries.some(entry => entry.path.startsWith(directory.replace(/\/$/, "") + "/"));
      if (outside || missing) findings.push({ruleId:"go-local-replacement",file:"go.mod",line:index+1,status:"yellow",problem:outside ? "A Go replacement depends on a sibling directory outside this repository snapshot." : "A literal local Go replacement directory is absent from this commit.",fix:"Make the replacement module available in the deployment build context, or replace it with a versioned module. Verify workspace and CI setup; the scanner never downloads dependencies."});
    }
  }
  return {findings: findings.slice(0, 100), evaluatedRules, limitations: findings.length > 100 ? ["Language configuration finding limit reached."] : []};
}
