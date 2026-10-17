import { WatchForm } from "@/components/watch-form";
import { watchEnabled } from "@/lib/watch";

/** The Watch this repo box, only on public reports and only once email sending is configured. */
export function WatchBox({ reportId, repo, isPrivate }: { reportId: string; repo: string; isPrivate?: boolean }) {
  if (isPrivate || !watchEnabled()) return null;
  return <WatchForm reportId={reportId} repo={repo} />;
}
