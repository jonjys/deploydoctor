import { RepoForm } from "@/components/repo-form";
import Link from "next/link";

const checks = [
  "Next.js entrypoint",
  "Broken imports",
  "Server dependencies",
  "Environment variables",
  "Supabase boundaries",
];

function PulseMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

export default function Home() {
  return (
    <main className="site-shell home-page">
      <nav className="topbar" aria-label="Primary navigation">
        <Link className="brand" href="/" aria-label="DeployDoctor home">
          <PulseMark />
          <span>DeployDoctor</span>
        </Link>
        <span className="nav-note">
          <span className="status-dot" /> GitHub repository preflight
        </span>
      </nav>

      <section className="hero">
        <div className="eyebrow">
          <span className="eyebrow-icon">✦</span>
          VERCEL READINESS SCANNER
        </div>
        <h1>Works locally, breaks on Vercel? Find out why in 10 seconds.</h1>
        <p className="hero-copy">
          Paste a public GitHub repository. DeployDoctor checks the code paths
          most likely to fail after your push—without cloning or building it.
        </p>

        <RepoForm />

        <div className="trust-row" aria-label="Scanner characteristics">
          <span>
            <span className="mini-check">✓</span> Public repos only
          </span>
          <span>
            <span className="mini-check">✓</span> No code execution
          </span>
          <span>
            <span className="mini-check">✓</span> Shareable report
          </span>
        </div>
      </section>

      <section className="checks-panel" aria-labelledby="checks-heading">
        <div>
          <p className="section-kicker">THE PRE-FLIGHT</p>
          <h2 id="checks-heading">Five checks. The failures that matter.</h2>
        </div>
        <ol className="check-list">
          {checks.map((check, index) => (
            <li key={check}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {check}
            </li>
          ))}
        </ol>
      </section>

      <footer className="footer">
        <span>DeployDoctor</span>
        <span>Reads metadata and source through the GitHub REST API.</span>
      </footer>
    </main>
  );
}
