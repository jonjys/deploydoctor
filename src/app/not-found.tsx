import Link from "next/link";

export default function NotFound() {
  return (
    <main className="site-shell">
      <div className="not-found-card">
        <p className="section-kicker">404 / REPORT NOT FOUND</p>
        <h1>This report is off the chart.</h1>
        <p>The link may be incomplete, or the saved report is no longer available.</p>
        <Link className="cta-button" href="/">
          Scan a repository
        </Link>
      </div>
    </main>
  );
}
