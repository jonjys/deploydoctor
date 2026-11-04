import type { RepositorySnapshot } from "@/lib/analyzer";
import type { Stack } from "@/lib/stack";
import type { ReportResults } from "@/types/report";
import { improvementCopy } from "@/lib/improvements";

/**
 * The launch plan: from "it builds" to "people can pay for it". Everything comes from the scan that already ran:
 * the stack, the findings, the improvements, the environment variable names in the code and a few facts read from
 * package.json and the file tree. No AI call, no values: only names and paths.
 */
export type LaunchFacts = {
  version: 1;
  payments: "stripe" | "lemonsqueezy" | "paddle" | null;
  auth: string | null;
  email: string | null;
  errorMonitoring: boolean;
  analytics: boolean;
  privacyPage: boolean;
  termsPage: boolean;
  /** URL paths of webhook routes, e.g. /api/stripe/webhook. */
  webhooks: string[];
};

const AUTH: Array<[RegExp, string]> = [[/^next-auth$|^@auth\//, "Auth.js (NextAuth)"], [/^@clerk\//, "Clerk"], [/^better-auth$/, "Better Auth"], [/^@kinde-oss\//, "Kinde"], [/^lucia$/, "Lucia"], [/^firebase$|^firebase-admin$/, "Firebase Auth"], [/^@auth0\//, "Auth0"]];
const EMAIL: Array<[RegExp, string]> = [[/^resend$/, "Resend"], [/^@sendgrid\//, "SendGrid"], [/^postmark$/, "Postmark"], [/^nodemailer$/, "Nodemailer"], [/^@react-email\//, "React Email"]];
const ROUTE_FILE = /^(?:src\/)?(?:app\/(.*\/)?route\.[cm]?[jt]s|pages\/(api\/.*)\.[cm]?[jt]s)$/;

/** URL path of an App Router route.ts or a Pages API file; route groups and the src folder do not appear in URLs. */
export function routePath(file: string): string | null {
  const match = ROUTE_FILE.exec(file);
  if (!match) return null;
  const raw = match[1] !== undefined ? match[1] : match[2] ?? "";
  const segments = raw.split("/").filter(segment => segment && !/^\(.*\)$/.test(segment) && !segment.startsWith("@")).map(segment => segment.replace(/\/index$/, ""));
  const path = `/${segments.join("/")}`.replace(/\/index$/, "").replace(/\/$/, "");
  return path || "/";
}

export function launchFacts(snapshot: RepositorySnapshot, stack: Stack): LaunchFacts | undefined {
  if (!stack.hasPackageJson) return undefined;
  let deps: string[] = [];
  try {
    const pkg = JSON.parse(snapshot.contents.get("package.json") ?? "{}") as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  } catch { return undefined; }
  const files = snapshot.entries.filter(entry => entry.type === "blob").map(entry => entry.path);
  const page = (pattern: RegExp) => files.some(file => /^(?:src\/)?(?:app|pages)\//.test(file) && pattern.test(file)) || files.some(file => /^public\/.*\.html?$/.test(file) && pattern.test(file));
  const sources = [...snapshot.contents.entries()].filter(([file]) => /\.[cm]?[jt]sx?$/.test(file)).map(([, source]) => source);
  const supabaseAuth = stack.hasSupabase && sources.some(source => /\.auth\.(?:signIn|signUp|getUser|exchangeCodeForSession)/.test(source));
  return {
    version: 1,
    payments: deps.includes("stripe") || deps.includes("@stripe/stripe-js") ? "stripe" : deps.some(d => d.startsWith("@lemonsqueezy/")) ? "lemonsqueezy" : deps.some(d => d.startsWith("@paddle/")) ? "paddle" : null,
    auth: AUTH.find(([pattern]) => deps.some(d => pattern.test(d)))?.[1] ?? (supabaseAuth ? "Supabase Auth" : null),
    email: EMAIL.find(([pattern]) => deps.some(d => pattern.test(d)))?.[1] ?? null,
    errorMonitoring: deps.some(d => /^@sentry\/|^@highlight-run\/|^@bugsnag\/|^@logtail\/|^@axiomhq\/|^@datadog\//.test(d)),
    analytics: deps.some(d => /^@vercel\/analytics$|^posthog-|^@posthog\/|^plausible|^@plausible|^@umami|^mixpanel|^@amplitude\/|^@segment\//.test(d)) || sources.some(source => /plausible\.io\/js|googletagmanager\.com|\/_vercel\/insights/.test(source)),
    privacyPage: page(/(?:^|\/)(?:privacy|privacy-policy|integritet\w*|datenschutz)(?:\/|\.)/i),
    termsPage: page(/(?:^|\/)(?:terms|tos|terms-of-service|villkor|anvandarvillkor|agb)(?:\/|\.)/i),
    webhooks: [...new Set(files.filter(file => /webhook/i.test(file)).map(routePath).filter((path): path is string => Boolean(path)))].slice(0, 5),
  };
}

export type PlanStep = { title: string; detail: string; code?: string; done?: boolean };
export type PlanSection = { id: string; title: string; why: string; steps: PlanStep[] };
export type LaunchPlan = { repo: string; sections: PlanSection[]; prompt: string; markdown: string; stepCount: number };

const groupOf = (name: string) => /STRIPE|LEMON|PADDLE/.test(name) ? "Payments" : /SUPABASE|DATABASE|POSTGRES|PRISMA|DIRECT_URL|MONGO|REDIS|UPSTASH|TURSO|NEON/.test(name) ? "Database" : /AUTH|CLERK|GITHUB_ID|GITHUB_SECRET|GOOGLE_CLIENT|KINDE|BETTER_AUTH|SESSION/.test(name) ? "Sign-in" : /RESEND|SENDGRID|POSTMARK|SMTP|MAIL/.test(name) ? "Email" : /OPENAI|ANTHROPIC|GEMINI|GROQ|REPLICATE|MISTRAL|AI_/.test(name) ? "AI APIs" : "Other";

/** The full plan for one report. Callers decide how much of it a visitor without a pass sees. */
export function buildLaunchPlan(results: ReportResults, repo: string): LaunchPlan {
  const facts = results.launchFacts;
  const sections: PlanSection[] = [];
  const broken = results.checks.filter(check => check.status !== "green");
  sections.push({ id: "deploy", title: "Make the deploy pass", why: "Nothing else matters until Vercel builds it.",
    steps: broken.length ? broken.slice(0, 6).map(check => ({ title: check.title, detail: check.fix })) : [{ title: "No deploy blockers found", detail: "The checks that apply to this stack passed. Run a production build once with `npm run build` before you launch.", done: true }] });

  const env = (results.deploymentInventory?.items ?? []).filter(item => item.kind === "environment").map(item => item.key);
  if (env.length) {
    const groups = new Map<string, string[]>();
    for (const name of [...new Set(env)].sort()) groups.set(groupOf(name), [...(groups.get(groupOf(name)) ?? []), name]);
    sections.push({ id: "env", title: `Set ${new Set(env).size} environment variables in Vercel`, why: "Your code reads these. If one is missing in production, that feature breaks only after you launch.",
      steps: [...groups.entries()].map(([group, names]): PlanStep => ({ title: `${group}: ${names.length}`, detail: `In Vercel, open Settings, then Environment Variables, and add these for Production (and Preview if you test there). ${names.some(n => n.startsWith("NEXT_PUBLIC_")) ? "NEXT_PUBLIC_ names are visible to everyone in the browser: never put a secret in one." : "Use live values, not the ones from your laptop."}`, code: names.join("\n") }))
        .concat([{ title: "Redeploy after adding them", detail: "Vercel only reads new variables on the next deployment. Open Deployments, pick the latest one and choose Redeploy." }]) });
  }

  if (facts?.payments === "stripe") {
    const hook = facts.webhooks[0];
    sections.push({ id: "payments", title: "Take real payments with Stripe", why: "Test-mode payments never reach your bank. Switching to live is the step most first launches get wrong.",
      steps: [
        { title: "Activate your Stripe account", detail: "Stripe asks for business and bank details before it pays out. Do this first: review can take a day." },
        { title: "Swap to live keys", detail: "Replace STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (or your names for them) in Vercel with the live keys from the Stripe dashboard. Keep test keys for Preview." },
        { title: "Create the live webhook", detail: hook ? `In Stripe, live mode, Developers, Webhooks, add an endpoint at https://YOUR-DOMAIN${hook}. Subscribe to the events your code handles (usually checkout.session.completed). Put its signing secret in STRIPE_WEBHOOK_SECRET in Vercel.` : "Add a webhook endpoint in Stripe live mode for the route that fulfils orders, and put its signing secret in STRIPE_WEBHOOK_SECRET in Vercel." },
        { title: "Buy your own product once", detail: "Pay with a real card in production, check that the order or access appears, then refund yourself from the Stripe dashboard. Send the same webhook twice from Stripe and check nothing is delivered twice." },
      ] });
  } else if (facts?.payments) {
    sections.push({ id: "payments", title: `Take real payments with ${facts.payments === "lemonsqueezy" ? "Lemon Squeezy" : "Paddle"}`, why: "Live mode needs its own keys and webhook.",
      steps: [{ title: "Switch to live keys and webhook", detail: "Add the live API key and webhook secret in Vercel, point the live webhook at your production URL, and make one real purchase and refund." }] });
  } else {
    sections.push({ id: "payments", title: "Decide how people pay", why: "No payment provider is installed yet. The fastest path for a solo founder is Stripe Checkout or a payment link.",
      steps: [{ title: "Start with a Stripe Payment Link", detail: "Create a product and a Payment Link in Stripe, put the link on your site, and handle access by hand for the first customers. Build checkout in code when people actually pay." }] });
  }

  if (results.stack?.hasSupabase || results.stack?.hasPrisma || results.stack?.hasDrizzle) {
    const steps: PlanStep[] = [];
    if (results.stack.hasSupabase) steps.push(
      { title: "Row Level Security on every table", detail: "In Supabase, Table Editor: every table with user data needs RLS enabled and a policy. Without it, anyone with your public anon key can read the whole table." },
      { title: "Keep the service role key on the server", detail: "SUPABASE_SERVICE_ROLE_KEY must never start with NEXT_PUBLIC_ and never be imported in a 'use client' file." },
      { title: "Set the production URL for sign-in links", detail: "Authentication, URL Configuration: set Site URL to your domain and add it to Redirect URLs, or email links still point to localhost." });
    if (results.stack.hasPrisma || results.stack.hasDrizzle) steps.push({ title: "Run migrations against production on purpose", detail: "Apply schema changes with your migrate command in a controlled step, not automatically on every build, and keep a backup first." });
    steps.push({ title: "Turn on backups", detail: "Check that your database plan includes daily backups (Supabase Pro has point-in-time recovery). Restore one once so you know how." });
    sections.push({ id: "data", title: "Protect your data", why: "Leaked tables from missing RLS are the most common way vibe-coded apps end up in the news.", steps });
  }

  if (facts?.auth) sections.push({ id: "auth", title: `Make sign-in work in production (${facts.auth})`, why: "Sign-in that works on localhost often fails on the real domain because of callback URLs.",
    steps: [
      { title: "Add the production callback URLs", detail: `In the ${facts.auth} dashboard and in every OAuth provider (Google, GitHub), add https://YOUR-DOMAIN as an allowed origin and its callback URL. Keep localhost only for development.` },
      { title: "Set a strong production secret", detail: "The session secret (for example AUTH_SECRET or NEXTAUTH_SECRET) must be a long random value that only exists in Vercel." },
      { title: "Sign up as a new user on the live site", detail: "Use a fresh email in a private window and go through sign-up, sign-in, sign-out and password reset." },
    ] });

  const legal: PlanStep[] = [];
  if (!facts?.privacyPage) legal.push({ title: "Add a privacy policy page", detail: "Stripe, Google sign-in, app stores and EU visitors expect one. List what you collect, which services process it (hosting, database, payments, analytics) and how to get data deleted." });
  if (!facts?.termsPage) legal.push({ title: "Add terms of service", detail: "Say what people pay for, the refund policy and how to contact you. Stripe shows your refund policy to customers." });
  legal.push({ title: "Show a contact address", detail: "A support email on the site and in Stripe's public business details. Customers who cannot reach you open disputes instead." });
  sections.push({ id: "legal", title: "Legal and trust", why: "Missing pages cost sales and can get a payment account paused.", steps: legal });

  const watch: PlanStep[] = [];
  if (!facts?.errorMonitoring) watch.push({ title: "Add error monitoring", detail: "Install Sentry (npx @sentry/wizard@latest -i nextjs) or turn on Vercel's logs and alerts, so you hear about a crash before a customer tells you." });
  if (!facts?.analytics) watch.push({ title: "Add analytics", detail: "Turn on Vercel Web Analytics (one click in the dashboard plus @vercel/analytics) or Plausible, so you know whether launch traffic arrives and where it drops." });
  watch.push({ title: "Watch the deploy", detail: "Add the free DeployDoctor GitHub Action or Watch this repo, so a change that breaks the build is caught before it reaches customers." });
  sections.push({ id: "monitor", title: "Know when it breaks", why: "On launch day you are the only support team.", steps: watch });

  const polish = (results.improvements ?? []).filter(item => !["ci-check", "readme-badge"].includes(item.id)).map(item => { const copy = improvementCopy(item, "en"); return { title: copy.title, detail: `${copy.why} ${copy.how}` }; });
  if (polish.length) sections.push({ id: "polish", title: "Polish before you share it", why: "First impressions come from the link preview, the 404 page and how errors look.", steps: polish });

  sections.push({ id: "launch", title: "Launch day", why: "Where and how to post so people actually try it.",
    steps: [
      { title: "Post where your users already are", detail: "One focused post per day: X (build in public, show a 30-second screen recording), Reddit (r/SideProject, r/indiehackers and the subreddit of your users' problem), Indie Hackers and Product Hunt. Lead with the problem, not the tech." },
      { title: "Hacker News needs an older account", detail: "Show HN is restricted for new accounts. Comment for a few weeks first, then post as 'Show HN: <name> – <what it does>' with a first comment explaining why you built it." },
      { title: "Talk to the first ten users", detail: "Reply to every sign-up personally and ask what they expected. One conversation now is worth more than the next feature." },
    ] });

  const stepCount = sections.reduce((sum, section) => sum + section.steps.filter(step => !step.done).length, 0);
  return { repo, sections, stepCount, prompt: aiPrompt(results, repo, facts), markdown: markdown(repo, sections) };
}

/** One prompt for Cursor, Claude Code, Lovable or v0 that does the code-side work and leaves values and dashboards to you. */
function aiPrompt(results: ReportResults, repo: string, facts: LaunchFacts | undefined): string {
  const tasks: string[] = [];
  for (const check of results.checks.filter(c => c.status !== "green")) tasks.push(`Fix "${check.title}": ${check.fix}`);
  if (facts && !facts.privacyPage) tasks.push("Add a privacy policy page at /privacy with placeholders I will fill in (company name, contact email, services used), and link it in the footer.");
  if (facts && !facts.termsPage) tasks.push("Add a terms of service page at /terms with a refund policy placeholder, and link it in the footer.");
  for (const item of results.improvements ?? []) if (!["ci-check", "readme-badge", "node-version", "lockfile"].includes(item.id)) tasks.push(improvementCopy(item, "en").how);
  if (facts && !facts.errorMonitoring) tasks.push("Set up Sentry error monitoring for this framework, reading the DSN from an environment variable.");
  const env = [...new Set((results.deploymentInventory?.items ?? []).filter(item => item.kind === "environment").map(item => item.key))];
  if (env.length) tasks.push(`Make sure .env.example lists every environment variable the code reads, with empty values and a one-line comment each: ${env.join(", ")}.`);
  return [
    `You are working in the repository ${repo}. Make these changes, one commit per task, and keep everything else as it is.`,
    "Rules: never write a real secret or key into a file; never rename or remove an existing environment variable; run the production build after each change and stop if it fails.",
    "",
    ...tasks.map((task, index) => `${index + 1}. ${task}`),
    "",
    "When you are done, list anything I still have to do by hand in a dashboard (Vercel, Stripe, Supabase, auth provider).",
  ].join("\n");
}

function markdown(repo: string, sections: PlanSection[]): string {
  return [`# Launch plan for ${repo}`, "", "Generated by DeployDoctor from a static scan. Nothing was installed, built or executed.", "",
    ...sections.flatMap(section => [`## ${section.title}`, "", `_${section.why}_`, "",
      ...section.steps.flatMap(step => [`- [${step.done ? "x" : " "}] **${step.title}.** ${step.detail}`, ...(step.code ? ["", "  ```", ...step.code.split("\n").map(line => `  ${line}`), "  ```"] : [])]), ""]),
  ].join("\n");
}
