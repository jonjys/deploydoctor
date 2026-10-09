import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { CopyTextButton } from "@/components/copy-text-button";
import { SITE_URL } from "@/lib/site";
import { plans } from "@/lib/plans";

export const metadata: Metadata = {
  title: "DeployDoctor in CI: fail a pull request before Vercel builds it",
  description: "A GitHub Action that scans every pull request for the mistakes that break a Vercel deploy. Case-sensitive imports, missing env variables, undeclared packages, Prisma and Edge runtime mistakes, annotated on the changed files.",
  alternates: { canonical: "/ci" },
  openGraph: { type: "article", siteName: "DeployDoctor", url: "/ci", title: "DeployDoctor in CI: fail a pull request before Vercel builds it",
    description: "Scan every pull request before Vercel builds it. Findings annotated on the changed files, a report link in the job summary." },
};

const WORKFLOW = `name: DeployDoctor
on:
  pull_request:
jobs:
  deploydoctor:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # lets GitHub prove which public repo is asking; no account, no secret
    steps:
      - uses: jonjys/deploydoctor-action@v1`;

const PAID_WORKFLOW = `      - uses: jonjys/deploydoctor-action@v1
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
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free on public repositories, 3 scans a day per repository. Unlimited and private repositories with any DeployDoctor pass." } };
  return (
    <main className="site-shell">
      <SiteNav current="ci" />
      <article className="guide ci-page">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
        <p className="section-kicker">GITHUB ACTION · API</p>
        <h1>Fail the pull request before Vercel builds it.</h1>
        <p className="guide-lead">
          The same nine checks as the website, on every pull request. Findings land as annotations on the changed files, the job summary
          links the full report, and the check goes red on a definite problem. Static analysis through the GitHub API: nothing is cloned,
          installed or executed, so it finishes in seconds and needs no build.
        </p>

        <section>
          <h2>1. Add the workflow. Free on public repositories.</h2>
          <p>
            Save this as <code>.github/workflows/deploydoctor.yml</code>. No account, no token, no secret: the <code>id-token: write</code> permission lets
            GitHub sign a short-lived proof of which repository is asking, and DeployDoctor only scans that repository. Each public repository gets
            3 free scans a day; when they are used, the job warns and passes instead of blocking the pull request.
          </p>
          <pre><code>{WORKFLOW}</code></pre>
          <p className="ci-copy"><CopyTextButton text={WORKFLOW} label="Copy workflow" copiedLabel="Copied" /></p>
          <p>Also listed on the <a href="https://github.com/marketplace/actions/deploydoctor">GitHub Marketplace</a>.</p>
        </section>

        <section>
          <h2>2. Private repository or more than 3 pull requests a day</h2>
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
            <li>Fails the job when a check is red: an import that only resolves on macOS, a package that is used but not declared, a <code>process.env</code> read that no <code>.env.example</code> documents, a Node-only module on the Edge runtime, Prisma without <code>prisma generate</code>, a live secret in source.</li>
            <li>Annotates each finding on the file and line in the pull request, with the fix.</li>
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
            time budget, and marks a scan partial when it hits one. A green check means the nine static checks passed, not that the deploy will succeed.
          </p>
        </section>

        <aside className="guide-cta">
          <div>
            <h2>Try it on a public repository first</h2>
            <p>Three free scans a day on the website and in the Action, no account. A pass removes the limit and adds private repositories.</p>
          </div>
          <Link className="cta-button" href="/">Scan a repository →</Link>
        </aside>
        <p className="guide-updated">Updated 2026-10-09 · <a href="https://github.com/marketplace/actions/deploydoctor">GitHub Marketplace</a> · <a href="https://github.com/jonjys/deploydoctor-action">Action source</a></p>
      </article>
    </main>
  );
}
