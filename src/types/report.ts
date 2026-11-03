import type { HostingAudit } from "@/lib/hosting-config";
import type { Stack } from "@/lib/stack";
import type { Improvement } from "@/lib/improvements";
import type { PullRequestImpact } from "@/lib/pr-impact";

export type CheckStatus = "red" | "yellow" | "green";
export type CheckId = "next-entry" | "imports" | "server-libs" | "env" | "supabase" | "prisma" | "build-config" | "secrets" | "dependencies" | "production-safety";
export type Category = "next" | "vercel" | "env" | "supabase" | "prisma";
export type Finding = { file: string; line: number; problem: string; fix: string; command?: string; ruleId?: string; repairable?: boolean; status?: "red" | "yellow" };

export type CheckResult = {
  id: CheckId;
  category?: Category;
  title: string;
  status: CheckStatus;
  explanation: string;
  fix: string;
  evidence: string[];
  findings?: Finding[];
  evaluatedRules?: string[];
  coverageOnly?: boolean;
  /** A complete file to commit, e.g. .env.example with the missing variables. Absent on older reports. */
  suggestedFile?: { path: string; content: string; command?: string };
};

export type ReportResults = {
  repository: {
    owner: string;
    name: string;
    defaultBranch: string;
    /** The branch, tag or commit that was scanned when it was not the default branch (CI scans a PR head). Absent on older reports. */
    ref?: string;
    /** Immutable Git commit used for this scan. Older reports must be rescanned before buying a patch. */
    commitSha?: string;
  };
  checkedAt: string;
  scan: {
    filesInTree: number;
    sourceFilesRead: number;
    sourceFilesFound: number;
    partial: boolean;
    reasons?: string[];
  };
  /** Absent on reports saved before category filtering existed: every check counts as scanned. */
  scope?: { scanned: Category[]; ignored: Category[] };
  stack?: Stack;
  hosting?: HostingAudit;
  /** Where the Next.js app was found. "nested" means a subfolder (monorepo), which is not supported yet. Absent on older reports. */
  nextApp?: "root" | "nested" | "none";
  summary: Record<CheckStatus, number>;
  overall: CheckStatus;
  checks: CheckResult[];
  /** Things the scan can see are missing that are not errors. Absent on reports saved before improvements existed. */
  improvements?: Improvement[];
  /** Optional PR comparison; legacy and ordinary repository reports are unchanged. */
  pullRequest?: PullRequestImpact;
};

export type StoredReport = {
  id: string;
  repo_url: string;
  results: ReportResults;
  created_at: string;
  is_private?: boolean;
};
