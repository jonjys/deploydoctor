import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { ErrorExplainer } from "@/components/error-explainer";

export const metadata: Metadata = {
  title: "Explain a build or deploy error, free | DeployDoctor",
  description: "Paste a Vercel, Next.js or Node build error. Get the most likely cause and a fix hint. Free, runs in your browser, no sign-up.",
  alternates: { canonical: "/explain-error" },
};

export default function ExplainErrorPage() {
  return (
    <main className="site-shell">
      <SiteNav current="diagnose" />
      <header className="pricing-header">
        <p className="section-kicker">FREE ERROR EXPLAINER</p>
        <h1>Paste your error.<br />Get the likely cause.</h1>
        <p>Covers common Vercel, Next.js and Node errors: missing modules, missing environment variables, out of memory, TypeScript, 404 after deploy, CORS, Node version mismatch and more. No sign-up.</p>
      </header>

      <ErrorExplainer />

      <section className="pass-strip" aria-labelledby="explain-cta">
        <div>
          <h2 id="explain-cta">Want the full scan of your repo?</h2>
          <p>The explainer looks at one error. A scan checks imports, build config, dependencies, environment variables and secrets across the whole repository.</p>
        </div>
        <div className="pass-actions">
          <Link className="primary-button" href="/checkout?plan=day">Day pass $2</Link>
          <Link href="/pricing">See pricing</Link>
        </div>
      </section>
    </main>
  );
}
