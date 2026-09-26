import type { Stack } from "@/lib/stack";

export type CheckStatus = "red" | "yellow" | "green";
export type CheckId = "next-entry" | "imports" | "server-libs" | "env" | "supabase" | "prisma";
export type Category = "next" | "vercel" | "env" | "supabase" | "prisma";
export type Finding = { file: string; line: number; problem: string; fix: string; command?: string };

export type CheckResult = {
  id: CheckId;
  category?: Category;
  title: string;
  status: CheckStatus;
  explanation: string;
  fix: string;
  evidence: string[];
  findings?: Finding[];
};

export type ReportResults = {
  repository: {
    owner: string;
    name: string;
    defaultBranch: string;
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
  summary: Record<CheckStatus, number>;
  overall: CheckStatus;
  checks: CheckResult[];
};

export type StoredReport = {
  id: string;
  repo_url: string;
  results: ReportResults;
  created_at: string;
  is_private?: boolean;
};
