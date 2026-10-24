import { WatchForm } from "@/components/watch-form";
import { watchEnabled } from "@/lib/watch";

/** The Watch this repo box, only on public reports and only once email sending is configured. */
export function WatchBox({ reportId, repo, isPrivate, summary }: { reportId: string; repo: string; isPrivate?: boolean; summary?: string }) {
  if (isPrivate || !watchEnabled()) return null;
  if (summary) return <details className="report-secondary"><summary>{summary}</summary><WatchForm reportId={reportId} repo={repo} /></details>;
  return <WatchForm reportId={reportId} repo={repo} />;
}
