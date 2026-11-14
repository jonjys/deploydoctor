import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { pageMetadata, pages } from "@/lib/seo";
export const metadata = pageMetadata(pages.platforms);
export default function PlatformsPage() {
  const targets = [
    { name: "Cloudflare Workers and Pages", config: "wrangler.toml, wrangler.json, wrangler.jsonc", checks: "Configuration syntax, recorded compatibility dates, Worker entrypoint paths, source-backed Node compatibility risks, duplicate bindings, mixed Pages/Workers configuration and assets paths.", limit: "Generated entrypoints need build verification. Assets-only Workers do not require main. Node compatibility defaults depend on the recorded date. Dashboard bindings, secrets and deployed behavior are not verified." },
    { name: "Netlify", config: "netlify.toml", checks: "Build base paths, literal package-manager scripts including contexts and nested packages, functions inside publish directories, forced SPA rewrite ordering, self-redirect risks and invalid edge-function path declarations.", limit: "Dashboard overrides, plugins, generated redirects and edge functions are not executed. Hosting environment values and the final publish output remain unverified." },
    { name: "Vercel", config: "vercel.json and supported framework configuration", checks: "Existing build, import, environment, dependency, Next.js, Vite, SvelteKit, Astro, function and cron checks remain available.", limit: "A static result is not a production build, runtime test or confirmation that payment fulfillment works." },
    { name: "Fly.io", config: "fly.toml", checks: "TOML syntax, explicit internal-port bounds, references to declared process groups, invalid volume mount destinations and explicit Dockerfile paths.", limit: "The application listening interface/port, volumes, CLI overrides, generated files, images and live health checks are not verified." },
    { name: "Render", config: "render.yaml / render.yml", checks: "Safe YAML parsing, root directories, Dockerfile paths, healthcheck path syntax, explicit package scripts, development server commands, static file/directory conflicts and missing cron schedules. Supports services inside project environments.", limit: "Only selected Blueprint fields are checked, not the complete provider schema. Other repositories or unscanned branches are excluded from source-path checks. Dashboard state, generated output and live behavior remain unverified." },
    { name: "Railway and Docker", config: "Legacy railway.json / railway.toml, Dockerfile", checks: "Legacy Railway config syntax and Dockerfile path risks; explicit environment-file copies into Docker image layers and sensitive ARG/ENV declaration review.", limit: "Railway TypeScript IaC is recognized but not evaluated. Service root settings, current configuration eligibility, container builds, image vulnerabilities and persistent volumes are not verified." },
  ];
  return <main className="site-shell"><SiteNav /><article className="guide">
    <p className="section-kicker">COVERAGE, WITH EVIDENCE</p><h1>Your code. Your deployment platform.</h1>
    <p className="guide-lead">Paste a public or authorized private GitHub repository. DeployDoctor identifies committed configuration and runs the supported static checks. Every finding needs evidence; unknown behavior stays unknown.</p>
    <Link className="cta-button" href="/">Scan your repository →</Link>
    {targets.map(target => <section key={target.name}><h2>{target.name}</h2><p><strong>Configuration:</strong> <code>{target.config}</code></p><p>{target.checks}</p><p><strong>Not verified:</strong> {target.limit}</p></section>)}
    <section><h2>Language support means different checks</h2><ul>
      <li><strong>JavaScript and TypeScript:</strong> syntax-tree import analysis and supported build, dependency, environment, payment and production-safety patterns. It does not run the compiler or tests.</li>
      <li><strong>Rust:</strong> Cargo edition/minimum-version consistency, pinned toolchain, explicit target paths and locked-build configuration. No compilation or crate audit.</li>
      <li><strong>Python and Go:</strong> recognized manifests, limited literal environment-reference checks and known secret patterns. Python exact-version pin conflicts with simple requires-python constraints; Go toolchain/minimum conflicts and local replacement paths. No interpreter, compiler, full PEP 440 resolver or dependency audit.</li>
      <li><strong>Other detected languages:</strong> file inventory and applicable known secret/configuration checks. Detection is not a claim of full language analysis.</li>
    </ul></section>
    <section><h2>One scanner, the same limits</h2><p>These checks feed the existing report, Launch Readiness, PR comparisons, API, CLI and GitHub Action. One free repository scan per day per IP on the website; existing passes and private-repository permissions still apply. No additional AI calls are used for platform checks.</p><p>The legacy API category <code>vercel</code> means Build &amp; deployment. Its name is retained for compatibility; it does not restrict the analysis to Vercel.</p><p>Repository code is never installed, imported or executed. Partial scans remain labeled, and no result guarantees a successful deployment.</p></section>
    <p><Link href="/ci">Use in a pull request →</Link>{" · "}<Link href="/diagnose">Already have a failed build log? →</Link></p>
  </article></main>;
}
