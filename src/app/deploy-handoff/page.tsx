import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { pageMetadata, pages } from "@/lib/seo";
export const metadata = pageMetadata(pages.handoff);
export default function HandoffPage(){
 return <main className="site-shell"><SiteNav /><article className="guide">
  <p className="section-kicker">DEPLOY HANDOFF</p><h1>Your PR merged. Did the production setup move with it?</h1>
  <p className="guide-lead">A code review can miss the work outside the code. DeployDoctor compares the PR merge base and head, then turns supported deployment changes into a checklist you can hand to your teammate or coding assistant.</p>
  <Link href="/#scan-repository" className="cta-button">Paste your GitHub PR link →</Link>
  <h2>What the checklist covers</h2><ul>
   <li><strong>New environment references:</strong> review whether each name is required or optional and configure the target environment securely.</li>
   <li><strong>Migration files:</strong> review deployment order, staging and recovery before changing a database.</li>
   <li><strong>Hosting configuration:</strong> inspect changed committed settings for Vercel, Cloudflare, Netlify, Fly.io, Render and other supported configurations.</li>
   <li><strong>Production commands:</strong> verify changed package build/start hooks with the actual deployment environment.</li>
   <li><strong>Endpoint source changes:</strong> test callers, callbacks and webhooks affected by supported Next.js route-file changes.</li>
  </ul>
  <h2>Evidence you can follow</h2><p>Every task links to its file at the compared commit. Copy the complete Markdown checklist into a release issue, PR conversation or your coding assistant. Configuration values and raw build commands are not included in this inventory.</p>
  <h2>How to use it</h2><ol><li>Paste a same-repository GitHub pull request URL into the existing scanner.</li><li>Run the PR comparison with the default build and environment categories. Existing scan allowances and private-repository permissions apply.</li><li>Open Deploy Handoff in the saved report, copy the checklist, and verify each step in your real deployment environment.</li></ol>
  <h2>A manual handoff, with explicit limits</h2><p>Tasks are not automatically complete. New references can be optional or development-only. A text change is not proof of changed runtime behavior. Partial scans remain review candidates; dynamic references, unsupported paths and live provider settings are outside coverage. Builds, migrations, checkout and live health checks are never run by this feature.</p>
  <p>Existing reports need a new PR scan to obtain the inventory. Fork PR comparison remains unsupported. Reports and copied checklist text can contain repository paths and variable names; share private checklists only with authorized people.</p>
  <p><Link href="/ci">Use the existing PR workflow →</Link>{" · "}<Link href="/platforms">Exact scanning coverage →</Link>{" · "}<Link href="/pricing">Existing passes and private scanning →</Link></p>
 </article></main>;
}
