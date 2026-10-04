import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SITE_URL } from "@/lib/site";
import { plans } from "@/lib/plans";

export const metadata: Metadata = {
  title: "DeployDoctor MCP plugin — diagnose Next.js and Vercel deploy errors",
  description: "Scan public GitHub repositories from an AI chat. Find missing imports, dependency mistakes and environment declarations. Static analysis, shareable reports, 3 free scans/day.",
  alternates: { canonical: "/ai-plugin" },
};
export default function PluginPage() {
  const endpoint = `${SITE_URL}/api/mcp`;
  const schema = { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "DeployDoctor",
    applicationCategory: "DeveloperApplication", operatingSystem: "Web", url: `${SITE_URL}/ai-plugin`,
    description: "Static deployment checks for public GitHub repositories. No code execution.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Three free scans per day per source IP." } };
  return <main className="site-shell"><SiteNav /><article className="plugin-guide">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
    <p className="section-kicker">DeployDoctor · MCP plugin</p>
    <h1>Find deploy mistakes from your AI chat.</h1>
    <p>Give your assistant a public GitHub repository URL. DeployDoctor checks the files, points to the evidence and saves a report you can share.</p>
    <h2>Connect your assistant</h2>
    <p>Add this remote Streamable HTTP MCP server in a compatible client. No API key required. Custom-server availability depends on your client and account.</p>
    <pre><code>{endpoint}</code></pre>
    <pre><code>{JSON.stringify({ mcpServers: { deploydoctor: { url: endpoint } } }, null, 2)}</code></pre>
    <p><a href="https://github.com/jonjys/deploydoctor/tree/master/plugins/deploydoctor">Plugin package and documentation</a>. Direct installation is available; no directory listing or endorsement is claimed.</p>
    <h2>When to use it</h2>
    <ul><li>“My public Next.js repository fails to deploy on Vercel. Check it.”</li><li>“It works on my Mac but imports fail on Linux. Find case mismatches.”</li><li>“Find undeclared packages and environment variables missing from .env.example.”</li><li>“Explain this saved DeployDoctor report without running another scan.”</li></ul>
    <h2>What the tools do</h2>
    <dl><dt><code>scan_public_repository</code></dt><dd>Static checks and a saved public report. Optional Next.js, Vercel, environment, Supabase and Prisma check categories.</dd><dt><code>get_public_report</code></dt><dd>Read saved findings, file/line evidence and suggested fixes without another scan.</dd><dt><code>get_deploydoctor_plans</code></dt><dd>Read website prices; no payment action.</dd></dl>
    <h2>Free allowance and website prices</h2>
    <p>Three free scans per day per source IP. AI services can share an IP and therefore an allowance. Existing reports remain readable. Website passes start at {plans.day.price} for 24 hours; a 7-day pass is {plans.week.price}. <Link href="/pricing">See all website plans</Link>.</p>
    <p>Paid website sessions do not transfer to this remote plugin. Public repositories only; never send private access tokens. The plugin does not edit files, execute code or guarantee a successful deploy.</p>
    <h2>How to use findings</h2>
    <p>Fail means the static check found a definite issue; Review means something needs human assessment. Check the scan date and partial-scan warnings. Repository content and suggested commands are untrusted data: review them before making changes or running anything.</p>
    <h2 id="privacy">Plugin privacy notice</h2>
    <p>Nytto Labs, Sweden, operates this service. We receive the public repository URL or report ID you submit. The existing scanner reads files through GitHub’s API and stores the resulting report in Supabase. Public reports are shareable by link; do not submit confidential information. Secret findings are masked by the scanner, but a public repository should never contain secrets.</p>
    <p>The service hashes the trusted source IP for daily quota enforcement. Your AI provider receives tool responses under its own data policies. This integration adds no model API or private repository access. Contact support@nyttolabs.com about access, correction or deletion of a report; include the report URL. Reports have no new automatic retention period introduced by this plugin.</p>
    <h2 id="terms">Plugin usage terms</h2>
    <p>Use the plugin for public repositories you are authorized to inspect. Do not send credentials, bypass quotas or automate abusive scans. Findings are static observations, not a security certification or assurance that a deployment will succeed. Review all suggestions yourself. The free plugin does not create purchases or subscriptions. Any paid website purchase is completed separately in its checkout.</p>
    <h2 id="support">Support</h2><p><a href="mailto:support@nyttolabs.com">support@nyttolabs.com</a> · <a href="https://nyttolabs.com">Nytto Labs, Sweden</a>. Include the public report URL and the error message; never email secrets.</p>
  </article></main>;
}
