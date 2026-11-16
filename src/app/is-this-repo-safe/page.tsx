import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { RepoSafetyForm } from "./repo-safety-form";

export const metadata: Metadata = {
  title: "Is this GitHub repo safe? Check before you download or run it | DeployDoctor",
  description: "Paste a GitHub link. DeployDoctor reads the code for the tricks malware repos use: install scripts that download and run code, hidden or encoded commands, password and wallet stealing, Discord and Telegram webhooks, committed .exe files and README lures. Free, nothing is run.",
  alternates: { canonical: "/is-this-repo-safe" },
  openGraph: { title: "Is this GitHub repo safe?", description: "Check a repo for malware tricks before you download or run it. Free, nothing is run.", url: "/is-this-repo-safe", type: "website" },
};

export default async function RepoSafetyPage({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const { repo } = await searchParams;
  const initial = typeof repo === "string" ? repo.slice(0, 300) : "";
  return <main className="site-shell"><SiteNav /><article className="guide leak-page">
    <p className="section-kicker">BEFORE YOU DOWNLOAD</p>
    <h1>Is this GitHub repo safe?</h1>
    <p className="guide-lead">Free AI tools, game mods, crypto bots and &quot;cracked&quot; apps on GitHub are one of the most common ways people get their passwords, API keys and wallets stolen. Paste the link before you download or run anything.</p>
    <RepoSafetyForm initial={initial} />
    <h2>What it looks for</h2>
    <ul>
      <li><strong>Install scripts</strong> that download and run code the moment you run <code>npm install</code> or <code>pip install</code>.</li>
      <li><strong>Hidden code</strong>: base64 or hex that is decoded and executed, encoded PowerShell, and code pushed off-screen with hundreds of spaces.</li>
      <li><strong>Stealing</strong>: reading saved browser passwords, cookies, Discord tokens, crypto wallets or SSH keys, and sending them to Discord or Telegram webhooks, paste sites or bare IP addresses.</li>
      <li><strong>Download lures</strong>: READMEs that tell you to turn off your antivirus, password-protected archives and committed <code>.exe</code> files.</li>
      <li><strong>The account</strong>: brand-new owners and stars that arrived suspiciously fast.</li>
    </ul>
    <h2>What it cannot do</h2>
    <p>It reads the repository&apos;s files; it does not run them, and it cannot see inside compiled programs or archives. A clean result means none of these known tricks were found, and it cannot prove a program is safe. Only download from people and projects you have reason to trust.</p>
  </article></main>;
}
