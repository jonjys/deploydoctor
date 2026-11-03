import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { CopyTextButton } from "@/components/copy-text-button";
import { SITE_URL } from "@/lib/site";
import { plans } from "@/lib/plans";

export const metadata: Metadata = {
  title: "DeployDoctor in CI: fail a pull request before Vercel builds it",
  description: "A GitHub Action that scans a pull request for the mistakes that break a Vercel deploy: case-sensitive imports, missing env variables, undeclared packages, Prisma and Edge runtime mistakes, annotated on the changed files. One free scan a day per public repository to try it, a pass scans every push.",
  alternates: { canonical: "/ci" },
  openGraph: { type: "article", siteName: "DeployDoctor", url: "/ci", title: "DeployDoctor in CI: fail a pull request before Vercel builds it",
    description: "Scan a pull request before Vercel builds it. One free scan a day per public repository to try it, a pass scans every push. Findings annotated on the changed files, a report link in the job summary." },
};

const WORKFLOW = `name: DeployDoctor
on:
  pull_request:
concurrency:
  group: deploydoctor-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
jobs:
  deploydoctor:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write # maintains one PR conversation comment
      id-token: write # lets GitHub prove which public repo is asking; no account, no secret
    steps:
      - uses: jonjys/deploydoctor-action@ef4c69e41868bf712b6dab3ccc1ea123eb4037c0`;

const PAID_WORKFLOW = `      - uses: jonjys/deploydoctor-action@ef4c69e41868bf712b6dab3ccc1ea123eb4037c0
        with:
          token: \${{ secrets.DEPLOYDOCTOR_TOKEN }}
          # Private repository? Let the scan read it:
          github-token: \${{ github.token }}`;

const CURL = `curl -s -X POST ${SITE_URL}/api/reports \\
  -H "Authorization: Bearer $DEPLOYDOCTOR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"repoUrl":"https://github.com/vercel/commerce","ref":"main"}'`;

export default function CiPage() {
  const schema = { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "DeployDoctor GitHub Action",
    applicationCategory: "DeveloperApplication", operatingSystem: "GitHub Actions", url: `${SITE_URL}/ci`,
    description: "Scans a pull request for the mistakes that break a Vercel deploy, before Vercel builds it.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free on public repositories, 1 scan a day per repository. Unlimited and private repositories with any DeployDoctor pass." } };
  return (
    <main className="site-shell">
      <SiteNav current="ci" />
      <article className="guide ci-page">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
        <p className="section-kicker">GITHUB ACTION · API</p>
        <h1>See deployment risks before you merge.</h1>
        <p className="guide-lead">
          The same static analysis as the website, on a pull request before Vercel builds it. Findings land as annotations on the changed files and one updated PR comment links the full report. The job summary remains available, and the check goes red on a definite problem. Static analysis through the GitHub API: nothing is cloned,
          installed or executed, and no build step is needed.
        </p>

        <section>
          <h2>1. Add the workflow. Free on public repositories.</h2>
          <p>
            Save this as <code>.github/workflows/deploydoctor.yml</code>. No account, no token, no secret: the <code>id-token: write</code> permission lets
            GitHub sign a short-lived proof of which repository is asking, and DeployDoctor only scans that repository. Each public repository gets
            1 free scan a day; when it is used, the job warns and passes instead of blocking the pull request.
          </p>
          <pre><code>{WORKFLOW}</code></pre>
          <p className="ci-copy"><CopyTextButton text={WORKFLOW} label="Copy workflow" copiedLabel="Copied" /></p>
          <p>The workflow pins the PR Change Review release to an immutable commit. Existing workflows using an older version must update the Action reference and add <code>pull-requests: write</code> to get comments.</p>
          <p>Also listed on the <a href="https://github.com/marketplace/actions/deploydoctor">GitHub Marketplace</a>.</p>
          <p>Maintaining a template or starter? Every public report also offers a Scan with DeployDoctor button for its README. Forks keep the README text, so a fork changes the owner/repo in the link to scan its own copy before the first deploy.</p>
        </section>

        <section>
          <h2>2. Private repository or more than 1 scan a day</h2>
          <p>
            Open <Link href="/account">My scans</Link> in the browser you paid in and click Create API token. Tokens work while a pass is
            active, which is any pass: {plans.day.usd} for 24 hours, {plans.week.usd} for 7 days or {plans.public.usd} a month, and are never
            subject to the daily limit. Store it as a repository secret named <code>DEPLOYDOCTOR_TOKEN</code> under Settings, Secrets and variables, Actions.
          </p>
          <pre><code>{PAID_WORKFLOW}</code></pre>
          <p>
            For a private repository, pass <code>github-token</code> so the scan can read it. The job&apos;s own token has read access to the
            repository, is forwarded for that one scan and is never stored. Private reports open only in the browser you paid in, or through your API token.
          </p>
        </section>

        <section>
          <h2>What the check does</h2>
          <ul>
            <li>Fails the job when a check is red: an import that only resolves on macOS, a package that is used but not declared, a <code>process.env</code> read without a fallback that no <code>.env.example</code> documents, a Node-only module on the Edge runtime, Prisma without <code>prisma generate</code>, a live secret in source.</li>
            <li>Annotates each finding on the file and line in the pull request, with the fix.</li>
            <li>Maintains one PR conversation comment with up to three ranked findings, the analyzed commit, file/line links and the full report. Partial scans say so. An exhausted allowance replaces stale results with Not scanned.</li>
            <li>Writes a status table to the job summary and links the saved report.</li>
            <li>Sets outputs <code>overall</code>, <code>report-url</code>, <code>red</code> and <code>yellow</code> for later steps.</li>
          </ul>
          <p>
            Inputs: <code>fail-on</code> (<code>red</code> by default, <code>yellow</code> to also fail on items that need review, <code>never</code> to only report),
            <code>checks</code> (comma-separated <code>next</code>, <code>vercel</code>, <code>env</code>, <code>supabase</code>, <code>prisma</code>; the detected stack decides when empty),
            <code>ref</code> and <code>repository</code> to scan something other than the pull request.
          </p>
        </section>

        <section>
          <h2>What changed in this PR?</h2>
          <p>For a matching same-repository PR head, the Action compares static findings at the PR merge base and head. Newly detected findings appear first; already-present findings and observations no longer detected stay separate. Moving lines are matched, known file renames are accounted for, and incomplete coverage requires review. Both commits are pinned.</p>
          <p>The comparison uses one existing scan allowance. It does not build the merged app or certify a fix. The job still applies <code>fail-on</code> to the full head scan, including existing problems.</p>
          <p><strong>Deploy Handoff:</strong> Compare a PR to get a manual release checklist for newly referenced environment names, migration files, deployment configuration, build commands and endpoint source changes. Each task links to its pinned commit. Copy it to your release issue or coding assistant; actual production setup and runtime still need verification.</p>
          <p>Comments are supported for same-repository pull requests on the scanned head commit. Forks, Dependabot, closed PRs, other events and ref overrides are not commented. Do not use <code>pull_request_target</code> to bypass these restrictions.</p>
          <p>The built-in GitHub token stays in the runner and is used only for GitHub comments. A missing write permission produces a warning; scan results remain in the job summary. Private reports retain their existing authentication.</p>
          <p>Set <code>comment: false</code> to disable conversation comments, or <code>audit-link: false</code> to remove the discreet link to the existing optional €149 human audit. No new price or subscription is introduced.</p>
          <p>Workflow concurrency prevents competing runs. The Action rechecks the live PR head before writing, but GitHub does not provide an atomic head condition for comment updates. Each comment always identifies its exact analyzed commit.</p>
        </section>

        <section>
          <h2>The API behind it</h2>
          <p>
            The action is a thin client. Any script can do the same with the token: POST a repository URL and an optional <code>ref</code> and get the whole report as JSON,
            including every finding with file and line.
          </p>
          <pre><code>{CURL}</code></pre>
          <p>
            Responses: <code>201</code> with the report, <code>401</code> for a token that does not verify, <code>402</code> when no pass is active, <code>404</code> for a missing
            repository or ref, <code>429</code> when GitHub&apos;s own rate limit is hit. A saved report is also readable as JSON at <code>/api/reports/&lt;id&gt;</code>,
            public ones with no token at all. Token requests never count against the free daily limit, so a shared runner IP does not matter.
          </p>
        </section>

        <section>
          <h2>What it does not do</h2>
          <p>
            It does not run your build, so it cannot catch type errors or failing tests; your existing jobs do that. It reads the repository through GitHub&apos;s API with a file and
            time budget, and marks a scan partial when it hits one. A green check means the applicable static checks passed, not that the deploy will succeed.
          </p>
        </section>

        <aside className="guide-cta">
          <div>
            <h2>Try it on a public repository first</h2>
            <p>One free scan a day on the website and one a day for each public repository in the Action, no account. A {plans.day.usd} pass removes the limit for 24 hours and adds private repositories.</p>
          </div>
          <Link className="cta-button" href="/">Scan a repository →</Link>
        </aside>
        <p className="guide-updated">Updated 2026-11-03 · <a href="https://github.com/marketplace/actions/deploydoctor">GitHub Marketplace</a> · <a href="https://github.com/jonjys/deploydoctor-action">Action source</a></p>
      </article>
    </main>
  );
}
