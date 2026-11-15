import { incidentPages } from "./incident-pages";
import { consolidatedErrors } from "./seo-routes";
/**
 * One short reference page per common Vercel deployment error, served at /errors/[slug].
 * Every fix is taken from the official Vercel or Next.js documentation listed in `docs`.
 * `scanNote` says exactly what a DeployDoctor repository scan can and cannot see for that error.
 */
export type ErrorDoc = { label: string; url: string };

export type ErrorSection = { heading: string; body?: string[]; steps?: string[]; code?: string };

export type ErrorPage = {
  slug: string;
  /** The H1: the error as a person searches for it. */
  title: string;
  description: string;
  /** The message as it appears in Vercel or the build log, shown in a code block. Omitted when the problem has no single message. */
  errorText?: string;
  /** The date the documentation below was last checked. */
  updated: string;
  sections: ErrorSection[];
  /** What a repository scan can and cannot find for this error. */
  scanNote: string;
  docs: ErrorDoc[];
  /** Slugs of existing /guides pages that go deeper on the same topic. */
  relatedGuides: string[];
};

const CHECKED = "2026-10-28";

export const errorPages: ErrorPage[] = [
  {
    slug: "vercel-build-failed-command-exited-with-1",
    title: "Vercel build failed: Command exited with 1",
    description: "The exit line is a summary. Find the real error a few lines above it in the build log, reproduce it locally and check the documented limits.",
    errorText: "Error: Command \"npm run build\" exited with 1",
    updated: CHECKED,
    sections: [
      {
        heading: "What it means",
        body: [
          "The command Vercel runs in the Build step returned a non-zero exit code. The command named in the message depends on your Build Command and package manager. Vercel's documentation points out that the last mention of an error in the log is often not the useful one: a line such as yarn run build exited with 1 only reports the result.",
        ],
      },
      {
        heading: "How to fix it",
        steps: [
          "Open the project in the Vercel dashboard, choose Deployments, select the failed deployment and expand the Building accordion.",
          "Scroll to the red section where the word Error appears. Read a few lines above the final exit line; the cause is usually there.",
          "Run the same build command on your own machine. Vercel recommends building locally first, because that catches problems in your code or dependencies.",
          "If no build log is shown, the build never started. The documented causes are an invalid vercel.json, Ignored Build Steps, a commit from someone who is not a team member, or a Marketplace integration resource that failed to provision. Vercel shows the message in an overlay instead.",
          "Check the build limits: the build container has 8192 MB of memory and 32 GB of disk, and a build can run for at most 45 minutes. A build that exceeds a limit is cancelled.",
        ],
      },
    ],
    scanNote: "A scan can find several common causes before you push: broken imports, a missing build script, more than one lockfile, imported packages missing from package.json, and an engines.node range Vercel cannot run. It cannot reproduce a build, so a failure caused by build limits or by code that only fails at build time may not show up.",
    docs: [{ label: "Vercel documentation: Troubleshooting Build Errors", url: "https://vercel.com/docs/deployments/troubleshoot-a-build" }],
    relatedGuides: ["nextjs-works-locally-fails-on-vercel"],
  },
  {
    slug: "vercel-missing-environment-variable",
    title: "Missing environment variable on Vercel",
    description: "A variable that exists in your local .env file is undefined on Vercel until it is added to the project for the right environment and the app is redeployed.",
    updated: CHECKED,
    sections: [
      {
        heading: "What it means",
        body: [
          "Environment variables are key-value pairs configured outside your source code. Vercel applies each one to the environments you select: Production, Preview, Development or a custom environment. Your code reads them during the Build step or during function execution.",
          "Any change to an environment variable is not applied to previous deployments. It only applies to new deployments.",
        ],
      },
      {
        heading: "How to fix it",
        steps: [
          "List every process.env value your code reads and compare it with the variables in the project settings.",
          "Add each missing variable under Environment Variables for every environment you deploy to. Production applies to the next Production deployment. Preview applies to deployments from branches other than the Production Branch.",
          "Redeploy. The new value is not applied to a deployment that already exists.",
          "To use the same values locally, run vercel env pull. It writes the Development variables to a .env file.",
          "In Next.js, a variable without the NEXT_PUBLIC_ prefix is only available on the server. A NEXT_PUBLIC_ variable is inlined into the JavaScript bundle at build time, so changing it requires a new build.",
        ],
      },
      {
        heading: "Limits to know",
        body: ["A deployment can use 64 KB of environment variables in total. Functions and Middleware that use the edge runtime are limited to 5 KB per variable."],
      },
    ],
    scanNote: "The environment variable check reports process.env reads that are not documented in .env.example, secret-looking values exposed through NEXT_PUBLIC_, and an .env.example that .gitignore keeps out of the repository. A scan reads the repository only. It cannot see the values or names saved in your Vercel project settings.",
    docs: [
      { label: "Vercel documentation: Environment variables", url: "https://vercel.com/docs/environment-variables" },
      { label: "Next.js documentation: Environment Variables", url: "https://nextjs.org/docs/app/guides/environment-variables" },
    ],
    relatedGuides: ["vercel-environment-variable-undefined", "nextjs-works-locally-fails-on-vercel"],
  },
  {
    slug: "vercel-404-not-found-after-deploy",
    title: "404 NOT_FOUND after a Vercel deploy",
    description: "The deployment finished but the page returns 404: NOT_FOUND. Check the URL, the build output, the Output Directory, the Root Directory and the domain.",
    errorText: "404: NOT_FOUND",
    updated: CHECKED,
    sections: [
      {
        heading: "What it means",
        body: ["Vercel documents NOT_FOUND as an error that occurs when a requested resource could not be found. The resource may have been moved or deleted, or the URL may contain a typo."],
      },
      {
        heading: "How to fix it",
        steps: [
          "Check the URL for typos or wrong paths. This matters most for generated deployment URLs, which contain a unique hash.",
          "Open the deployment list and confirm the deployment succeeded, was not deleted, and is the one you are visiting.",
          "Open the deployment, choose the Source tab and inspect the Output. The file your framework uses as the homepage must be present, usually index.html at the root of the output.",
          "Check capitalization. A file named Index.html should be renamed to index.html and redeployed.",
          "Review the Framework Preset, Build Command, Output Directory and Root Directory in the project settings. Only the contents of the Output Directory are served statically.",
          "For a single-page app that routes on the client, add a rewrite so every path reaches the router.",
          "Confirm the domain is added to the project and shows a valid configuration. If your team restricts access by Trusted IPs, a visit from another IP address also returns 404.",
        ],
        code: "{\n  \"rewrites\": [{ \"source\": \"/(.*)\", \"destination\": \"/\" }]\n}",
      },
    ],
    scanNote: "A scan can report a Next.js app that declares next but has no app/ or pages/ route folder, and build configuration problems such as a missing build script. It cannot see which domain is assigned to which deployment, your team's access settings, or the Output Directory saved in your Vercel project.",
    docs: [
      { label: "Vercel documentation: NOT_FOUND", url: "https://vercel.com/docs/errors/NOT_FOUND" },
      { label: "Vercel guide: How to debug 404 errors", url: "https://vercel.com/kb/guide/how-to-debug-404-errors" },
    ],
    relatedGuides: ["vercel-404-not-found-ready-deployment", "vite-spa-vercel-deep-link-404", "vercel-monorepo-root-directory"],
  },
  {
    slug: "vercel-module-not-found-cant-resolve",
    title: "Module not found: Can't resolve on Vercel",
    description: "Works locally, fails on Vercel with Module not found. The usual cause is a file name and an import that differ only in letter case. Two other causes are covered.",
    errorText: "Module not found: Can't resolve './components/usercard'",
    updated: CHECKED,
    sections: [
      {
        heading: "What it means",
        body: [
          "Windows and macOS use case-insensitive file systems by default, so Header.tsx and header.tsx are the same file there. Vercel builds on a case-sensitive Linux file system, where they are two different paths. Vercel's guide calls a casing mismatch the almost-always cause of this error.",
          "Git can hide the problem: on a case-insensitive system it often does not record a rename that only changes letter case.",
        ],
      },
      {
        heading: "How to fix it",
        steps: [
          "In the failed deployment's Build Logs, find the Module not found line and note the import path it names.",
          "Compare that path character by character with the real file name in the repository, not in your local file explorer.",
          "Make the import and the file name use the same casing, commit and redeploy.",
          "If Git never recorded the rename, rename through a temporary name so Git sees an explicit change. Commit both steps together.",
          "If the unresolved path is a package name, confirm the package is listed in package.json and committed.",
          "If the path is relative, count the ../ segments against the file's real folder depth. An editor with path aliases can hide a wrong path.",
        ],
        code: "git config core.ignorecase false\ngit mv header.tsx header-tmp.tsx\ngit mv header-tmp.tsx Header.tsx",
      },
    ],
    scanNote: "The broken imports check reports relative, @/ and tsconfig alias imports that point to files missing from the repository, including files that differ only by letter case. The dependencies check reports imported packages that are not declared in package.json. A scan reads the repository on GitHub, so it cannot confirm that your build passes.",
    docs: [{ label: "Vercel guide: How do I resolve a module not found error?", url: "https://vercel.com/kb/guide/how-do-i-resolve-a-module-not-found-error" }],
    relatedGuides: ["module-not-found-vercel-case-sensitive-imports", "nextjs-works-locally-fails-on-vercel"],
  },
  {
    slug: "vercel-function-invocation-timeout",
    title: "FUNCTION_INVOCATION_TIMEOUT on Vercel",
    description: "A Vercel Function ran longer than its allowed duration. The documented causes are slow upstream calls, no response, an infinite loop or an unhandled exception.",
    errorText: "FUNCTION_INVOCATION_TIMEOUT (Gateway Timeout)",
    updated: CHECKED,
    sections: [
      {
        heading: "What it means",
        body: ["Vercel documents this error as a function invocation that takes longer than the allowed execution time. The cause can be an error in the function, a slow network call, or the environment the function runs in."],
      },
      {
        heading: "How to fix it",
        steps: [
          "Make sure API and database requests made by the function answer within the maximum duration for your plan.",
          "If the work needs more time, Vercel suggests enabling Fluid compute for significantly longer durations. For work that needs unlimited execution time, it points to Vercel Workflows.",
          "Make sure the function always returns an HTTP response, even an error response. A function that returns nothing times out.",
          "Check that no loop runs forever.",
          "Check that any external API or database the function calls is not failing.",
          "Look for unhandled exceptions in the application logs, which are available at the deployment's host URL under the /_logs path.",
        ],
      },
    ],
    scanNote: "A repository scan cannot measure how long a request takes, so it cannot confirm or diagnose a timeout. It can flag server code that Vercel cannot run at all, such as Playwright, Puppeteer, SQLite bindings and filesystem writes.",
    docs: [{ label: "Vercel documentation: FUNCTION_INVOCATION_TIMEOUT", url: "https://vercel.com/docs/errors/FUNCTION_INVOCATION_TIMEOUT" }],
    relatedGuides: ["vercel-function-invocation-failed"],
  },
  {
    slug: "vercel-500-internal-server-error",
    title: "500 Internal Server Error on Vercel: FUNCTION_INVOCATION_FAILED",
    description: "A Vercel Function crashed or threw an unhandled error. Read the application logs, then check the function code, its configuration and the services it calls.",
    errorText: "FUNCTION_INVOCATION_FAILED (Internal Server Error)",
    updated: CHECKED,
    sections: [
      {
        heading: "What it means",
        body: [
          "Vercel documents FUNCTION_INVOCATION_FAILED, and the related INTERNAL_FUNCTION_INVOCATION_FAILED, as a function invocation that fails. The possible causes it lists are a crashed runtime process (Node.js, Bun, Python and others) and an unhandled rejection or uncaught exception.",
        ],
      },
      {
        heading: "How to fix it",
        steps: [
          "Read the application logs to find the error behind the invocation. They are under the Logs tab, or at the deployment's host URL under the /_logs path.",
          "Review the function code for errors and infinite loops.",
          "Wrap the work in a try/catch block so an error produces a response you can log.",
          "Verify the function configuration, including its environment variables.",
          "If the function calls an external service, check that the service is responding.",
        ],
        code: "// Example: return a response instead of letting the invocation crash\nexport async function GET() {\n  try {\n    const data = await loadData();\n    return Response.json(data);\n  } catch (error) {\n    console.error(\"loadData failed\", error);\n    return Response.json({ error: \"Internal error\" }, { status: 500 });\n  }\n}",
      },
    ],
    scanNote: "A scan cannot see an exception that only happens at runtime. It can report two documented configuration causes ahead of time: process.env reads that are missing from .env.example, and server code Vercel cannot run, such as packages that need Node-only APIs in an Edge route.",
    docs: [
      { label: "Vercel documentation: FUNCTION_INVOCATION_FAILED", url: "https://vercel.com/docs/errors/FUNCTION_INVOCATION_FAILED" },
      { label: "Vercel documentation: INTERNAL_FUNCTION_INVOCATION_FAILED", url: "https://vercel.com/docs/errors/INTERNAL_FUNCTION_INVOCATION_FAILED" },
    ],
    relatedGuides: ["vercel-function-invocation-failed", "edge-runtime-node-module-error-vercel"],
  },
  {
    slug: "vercel-no-output-directory-found",
    title: "No Output Directory found on Vercel",
    description: "The build ran but the folder Vercel was told to serve does not exist. Match the Output Directory, Framework Preset and Root Directory to what your build produces.",
    errorText: "No Output Directory named \"dist\" found after the Build completed.",
    updated: CHECKED,
    sections: [
      {
        heading: "What it means",
        body: [
          "Vercel documents that the build step fails when the output directory is missing, empty or invalid, for example when it is not a directory. Only the contents of the Output Directory are served statically. When Vercel detects a framework it sets the Output Directory for you.",
        ],
      },
      {
        heading: "How to fix it",
        steps: [
          "Run the build command locally and see which folder it creates. Confirm the files are generated where the Output Directory setting points.",
          "In the project settings, check the Framework Preset and the Output Directory. When Vercel detects a framework it sets the Output Directory for you, so a manual override that does not match your build is worth removing.",
          "Check the Build Command and the Root Directory. If the app lives in a subfolder or monorepo package, the Root Directory must point to it.",
          "Check vercel.json. An outputDirectory value there overrides the setting for that deployment.",
          "For a project that needs no build, choose Other as the Framework Preset. Vercel then serves public if it exists, and the project root otherwise.",
          "If you use Turborepo or Nx caching, redeploy without the build cache. If that succeeds, the output directories are not configured in turbo.json or nx.json.",
        ],
        code: "{\n  \"outputDirectory\": \"dist\"\n}",
      },
    ],
    scanNote: "The build configuration check reports a missing build script, more than one lockfile and an engines.node range that Vercel cannot run. A scan reads the repository only. It cannot see the Output Directory or Framework Preset saved in your Vercel project settings.",
    docs: [
      { label: "Vercel documentation: Error List, Missing public directory", url: "https://vercel.com/docs/errors/error-list" },
      { label: "Vercel documentation: Configuring a Build, Output Directory", url: "https://vercel.com/docs/builds/configure-a-build" },
      { label: "Vercel guide: Missing routes-manifest.json or No Output Directory with Turborepo or Nx", url: "https://vercel.com/kb/guide/missing-routes-manifest-or-output-turborepo-nx" },
    ],
    relatedGuides: ["vercel-monorepo-root-directory", "nextjs-static-export-unsupported-features"],
  },
  {
    slug: "vercel-node-version-mismatch",
    title: "Node.js version mismatch on Vercel",
    description: "Your local Node.js version and the version Vercel builds with can differ. Set the version in the project settings or in package.json engines, then verify it.",
    updated: CHECKED,
    sections: [
      {
        heading: "What it means",
        body: [
          "A new Vercel project uses the latest Node.js LTS version available on Vercel. Only major versions are offered, and Vercel rolls out minor and patch updates itself. At the time this page was checked, the documentation listed 24.x (the default) and 22.x. Check the documentation for the current list.",
          "A version set in the engines.node field of package.json overrides the version chosen in the project settings.",
        ],
      },
      {
        heading: "How to fix it",
        steps: [
          "Run node -v on your machine and note the major version you develop with.",
          "Find the version Vercel uses by running node -v in the Build Command, or by logging process.version.",
          "Choose the version under Settings, Build and Deployment, Node.js Version. It applies to new deployments.",
          "Or set engines.node in package.json, which overrides the project setting.",
          "Mind the range you write. The documentation shows that >=22.0.0 deploys the latest 24.x version, while 22.x and ^22.0.0 deploy 22.x.",
        ],
        code: "{\n  \"engines\": {\n    \"node\": \"24.x\"\n  }\n}",
      },
    ],
    scanNote: "The build configuration check reports an engines.node range that Vercel cannot run. A scan reads package.json from the repository. It cannot see the Node.js version saved in your Vercel project settings.",
    docs: [{ label: "Vercel documentation: Supported Node.js versions", url: "https://vercel.com/docs/functions/runtimes/node-js/node-js-versions" }],
    relatedGuides: ["nextjs-works-locally-fails-on-vercel"],
  },
  {
    slug: "vercel-hardcoded-secret-in-repository",
    title: "Hardcoded API key in a repository deployed to Vercel",
    description: "A key written into source code ships with the repository. Move it to an environment variable, store it as a Secret, rotate it and keep it out of NEXT_PUBLIC_.",
    updated: CHECKED,
    sections: [
      {
        heading: "What it means",
        body: [
          "Vercel environment variables are key-value pairs configured outside your source code. A key written directly into a file is part of the repository and of any build that includes it. Vercel offers two types: Config values stay readable to members with project access, while Secret values are write-only after saving. Vercel recommends Secrets for passwords, API keys and tokens.",
          "GitHub's guidance on sensitive data is that a leaked credential should first be revoked or rotated, and that rewriting history may not be warranted once it is.",
        ],
      },
      {
        heading: "How to fix it",
        steps: [
          "Replace the value in code with a read from process.env.",
          "Add the variable in the Vercel project as a Secret, for the environments that need it.",
          "Rotate the key at the provider. Vercel documents steps for rotating environment variables without downtime. Treat the old value as exposed.",
          "Do not put a secret behind a NEXT_PUBLIC_ name. Next.js inlines NEXT_PUBLIC_ values into the JavaScript sent to the browser at build time.",
          "Keep .env files out of Git. The default Next.js template adds all .env files to .gitignore, and the documentation says you almost never want to commit them.",
          "Redeploy. Changed variables only apply to new deployments.",
        ],
        code: "// Before\nconst stripe = new Stripe(\"<secret key pasted here>\");\n\n// After\nconst key = process.env.STRIPE_SECRET_KEY;\nif (!key) throw new Error(\"STRIPE_SECRET_KEY is not set\");\nconst stripe = new Stripe(key);",
      },
    ],
    scanNote: "The hardcoded secrets check looks for live Stripe, AWS, GitHub and Supabase keys and private keys in source. Reports show only the prefix and the last four characters. The environment variable check also reports secret-looking values exposed through NEXT_PUBLIC_. It does not cover every kind of secret, and it does not rotate a key for you.",
    docs: [
      { label: "Vercel documentation: Environment variables", url: "https://vercel.com/docs/environment-variables" },
      { label: "Vercel documentation: Config and Secret environment variables", url: "https://vercel.com/docs/environment-variables/sensitive-environment-variables" },
      { label: "Next.js documentation: Environment Variables", url: "https://nextjs.org/docs/app/guides/environment-variables" },
      { label: "GitHub documentation: Removing sensitive data from a repository", url: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository" },
    ],
    relatedGuides: ["vercel-environment-variable-undefined"],
  },
  {
    slug: "vercel-err-pnpm-unsupported-engine",
    title: "ERR_PNPM_UNSUPPORTED_ENGINE on Vercel",
    description: "The pnpm version on Vercel does not match engines.pnpm in package.json. Pin pnpm with Corepack or remove the engines.pnpm value.",
    errorText: "ERR_PNPM_UNSUPPORTED_ENGINE",
    updated: CHECKED,
    sections: [
      {
        heading: "What it means",
        body: ["Vercel documents this error as occurring when package.json#engines.pnpm does not match the version of pnpm that is running. The engine-strict setting cannot solve it, because engine-strict only handles dependencies."],
      },
      {
        heading: "How to fix it",
        steps: [
          "Either set the environment variable ENABLE_EXPERIMENTAL_COREPACK to 1 in the Vercel project and set packageManager in package.json to the pnpm version you want.",
          "Or remove the engines.pnpm value from package.json.",
          "Corepack is described by Vercel as experimental, so breaking changes or removal may occur in a future Node.js release.",
        ],
        code: "{\n  \"engines\": {\n    \"pnpm\": \"^7.5.1\"\n  },\n  \"packageManager\": \"pnpm@7.5.1\"\n}",
      },
    ],
    scanNote: "The checks DeployDoctor documents do not include engines.pnpm. A scan can report a lockfile that is out of step with package.json and more than one lockfile in the repository, which are separate install problems.",
    docs: [
      { label: "Vercel documentation: Error List, Pnpm engine unsupported", url: "https://vercel.com/docs/errors/error-list" },
      { label: "Vercel documentation: Configuring a Build, Corepack", url: "https://vercel.com/docs/builds/configure-a-build" },
    ],
    relatedGuides: ["err-pnpm-outdated-lockfile-vercel", "pnpm-10-ignored-build-scripts-vercel"],
  },
  ...incidentPages,
];

export const activeErrorPages = errorPages.filter((page) => !consolidatedErrors[page.slug]);

export function errorPageBySlug(slug: string): ErrorPage | undefined {
  return errorPages.find((page) => page.slug === slug);
}

/** The other error pages shown at the bottom of a page: the rest of the list, in order. */
export function otherErrorPages(page: ErrorPage): ErrorPage[] {
  return activeErrorPages.filter((other) => other.slug !== page.slug);
}
