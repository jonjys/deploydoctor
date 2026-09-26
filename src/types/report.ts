export type CheckStatus = "red" | "yellow" | "green";

export type CheckResult = {
  id: "next-entry" | "imports" | "server-libs" | "env" | "supabase";
  title: string;
  status: CheckStatus;
  explanation: string;
  fix: string;
  evidence: string[];
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
    sourceFilesFound: number;
    sourceFilesRead: number;
    partial: boolean;
  };
  summary: Record<CheckStatus, number>;
  overall: CheckStatus;
  checks: CheckResult[];
};

export type StoredReport = {
  id: string;
  repo_url: string;
  results: ReportResults;
  created_at: string;
};
