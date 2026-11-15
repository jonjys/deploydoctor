import type { ErrorPage } from "./error-pages";

/** Problem-specific references, checked against the linked official documentation. */
export const incidentPages: ErrorPage[] = [
  {
    "slug": "prisma-p1001-supabase-vercel",
    "title": "Prisma P1001 on Vercel with Supabase: check the connection path",
    "description": "Prisma cannot reach Supabase after a Vercel deploy. Check the database host, pooler mode, environment scope and migration connection before changing your schema.",
    "errorText": "P1001: Can't reach database server",
    "updated": "2026-11-15",
    "sections": [
      {
        "heading": "Connection failure or generated client failure?",
        "body": [
          "Treat a P1001 message from an existing Prisma client as a connection investigation. A missing generated client is a different failure. Keep the first complete error and the failing command; never paste the database password into a public log."
        ]
      },
      {
        "heading": "Checks in order",
        "steps": [
          "Confirm the Supabase project is available. Copy the connection details from its Connect panel instead of constructing a hostname from an API URL.",
          "Check which connection your installed Prisma version and deployment use. Supabase documents transaction pooling for serverless runtime traffic and session or direct connections for migrations.",
          "If a direct connection cannot be reached from the deployment network, check IPv4 versus IPv6 support and the documented pooler alternative.",
          "Set the required connection variables for the actual Vercel environment, then create a new deployment. Preview and Production may use different databases."
        ]
      },
      {
        "heading": "Do not mix API keys with database passwords",
        "body": [
          "A Supabase publishable or secret API key is not a Postgres password. Check URL encoding of password characters and the project reference in the database username. Use the configuration format documented for your Prisma version."
        ]
      },
      {
        "heading": "Verify without changing data",
        "body": [
          "Test a harmless database read from the deployed server and inspect the new request log. Do not run reset or destructive migrations to diagnose connectivity."
        ]
      }
    ],
    "docs": [
      {
        "label": "Supabase: Prisma connection modes",
        "url": "https://supabase.com/docs/guides/database/prisma"
      },
      {
        "label": "Prisma: error reference",
        "url": "https://www.prisma.io/docs/orm/reference/error-reference"
      },
      {
        "label": "Vercel: environment variables",
        "url": "https://vercel.com/docs/environment-variables"
      }
    ],
    "relatedGuides": [
      "prisma-generate-vercel-deploy"
    ],
    "scanNote": "A repository scan can flag visible configuration risks. It cannot inspect dashboard settings, private credentials, DNS propagation or live service responses. Confirm the result in the deployed environment."
  },
  {
    "slug": "supabase-sb-secret-401",
    "title": "Supabase sb_secret returns 401: browser keys versus server keys",
    "description": "A Supabase secret key returns 401 when sent from a browser. Use a publishable key in client code and keep elevated access on an authenticated server.",
    "errorText": "401 Unauthorized with sb_secret_",
    "updated": "2026-11-15",
    "sections": [
      {
        "heading": "A browser 401 may be intentional",
        "body": [
          "Supabase rejects secret keys in browser requests using the User-Agent header. This does not make an exposed secret safe: another client may still use it. Secret keys have elevated database access and must stay on the server."
        ]
      },
      {
        "heading": "Checks in order",
        "steps": [
          "Find where the request originates: browser, your server, or an Edge Function. Identify the failing URL and response before changing permissions.",
          "Use a publishable key with the signed-in user session in browser code. Keep Row Level Security policies enabled.",
          "Move privileged operations to an authenticated server endpoint and authorize the operation there. Never place a secret key in NEXT_PUBLIC_ or VITE_ variables.",
          "If a secret reached a client bundle or public log, remove the exposure and rotate that key. Rebuild the affected deployment."
        ]
      },
      {
        "heading": "Not every 401 has this cause",
        "body": [
          "A missing or expired user session and an invalid project key are separate issues. Do not treat a new secret key as a user JWT, or disable authentication to hide the error."
        ]
      },
      {
        "heading": "Confirm the boundary",
        "body": [
          "Inspect the built browser bundle and network requests for accidental secret exposure, then test with both an authorized and an unauthorized user."
        ]
      }
    ],
    "docs": [
      {
        "label": "Supabase: API key types and browser restrictions",
        "url": "https://supabase.com/docs/guides/getting-started/api-keys"
      },
      {
        "label": "Supabase: migrating API keys",
        "url": "https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys"
      }
    ],
    "relatedGuides": [
      "vercel-environment-variable-undefined",
      "supabase-rls-insert-policy-denied"
    ],
    "scanNote": "A repository scan can flag visible configuration risks. It cannot inspect dashboard settings, private credentials, DNS propagation or live service responses. Confirm the result in the deployed environment."
  },
  {
    "slug": "vercel-blob-hobby-store-blocked",
    "title": "Vercel Blob blocked on Hobby: usage limit or wrong token?",
    "description": "A Vercel Blob store stops serving or accepting files on Hobby. Separate exhausted usage from an invalid store token and check the dashboard before redeploying.",
    "errorText": "Vercel Blob store unavailable",
    "updated": "2026-11-15",
    "sections": [
      {
        "heading": "A successful deploy does not restore storage",
        "body": [
          "Blob usage and application builds are separate. Hobby access can stop after included usage is exceeded. Rebuilding unchanged application code does not replenish that allowance."
        ]
      },
      {
        "heading": "Checks in order",
        "steps": [
          "Read the exact Blob error and check Usage for the owning team. Confirm which store and environment the application uses.",
          "Check whether reads, writes or both fail. A missing or wrong store token is different from a plan usage restriction.",
          "Review storage, transfer and operation usage. Dashboard browsing and listing can consume operations too.",
          "Use the recovery date and plan options shown by Vercel. Its Hobby documentation describes waiting after exceeded limits; do not assume deleting files immediately restores access."
        ]
      },
      {
        "heading": "Preserve data while diagnosing",
        "body": [
          "Do not delete the store or recreate customer uploads as a troubleshooting shortcut. Keep backups and show a controlled storage-unavailable state to users."
        ]
      },
      {
        "heading": "Check recovery",
        "body": [
          "After access returns, test one upload and one authorized read. Investigate repeated list calls and oversized transfers before resuming normal traffic."
        ]
      }
    ],
    "docs": [
      {
        "label": "Vercel: Blob usage and pricing",
        "url": "https://vercel.com/docs/vercel-blob/usage-and-pricing"
      },
      {
        "label": "Vercel: Blob operations and storage",
        "url": "https://vercel.com/docs/vercel-blob"
      }
    ],
    "relatedGuides": [
      "vercel-function-invocation-failed"
    ],
    "scanNote": "A repository scan can flag visible configuration risks. It cannot inspect dashboard settings, private credentials, DNS propagation or live service responses. Confirm the result in the deployed environment."
  },
  {
    "slug": "vercel-domain-connected-not-loading",
    "title": "Vercel domain connected but not loading: DNS, TLS or app error?",
    "description": "Your custom domain says connected but the site will not load. Compare the production deployment URL, DNS, certificate and redirect behavior to isolate the failure.",
    "errorText": "Domain connected, website not loading",
    "updated": "2026-11-15",
    "sections": [
      {
        "heading": "Compare two URLs first",
        "body": [
          "Open the production deployment URL and the exact custom hostname. If both fail with the same application error, investigate the app. If only the custom hostname fails, focus on DNS, domain assignment and TLS."
        ]
      },
      {
        "heading": "Checks in order",
        "steps": [
          "Check the domain belongs to the intended Vercel project and its production deployment, rather than an old project or preview.",
          "Compare the authoritative DNS records with the values currently shown in Vercel. Do not copy an old IP address from a tutorial.",
          "Test the apex domain and www separately. Check certificate status, conflicting records and any proxy at the DNS provider.",
          "Inspect redirects for a loop between apex and www or between two applications. Keep one intended destination."
        ]
      },
      {
        "heading": "Connected is not an application health check",
        "body": [
          "A dashboard configuration label does not prove that every route, login callback or API responds correctly."
        ]
      },
      {
        "heading": "Verify the actual destination",
        "body": [
          "Request the homepage and a nested route over HTTPS from a fresh browser session. Keep the observed error and hostname when asking for help."
        ]
      }
    ],
    "docs": [
      {
        "label": "Vercel: troubleshoot domain configuration",
        "url": "https://vercel.com/docs/domains/troubleshooting"
      },
      {
        "label": "Vercel: add and configure a domain",
        "url": "https://vercel.com/docs/domains/working-with-domains/add-a-domain"
      }
    ],
    "relatedGuides": [
      "vercel-404-not-found-ready-deployment"
    ],
    "scanNote": "A repository scan can flag visible configuration risks. It cannot inspect dashboard settings, private credentials, DNS propagation or live service responses. Confirm the result in the deployed environment."
  },
  {
    "slug": "vercel-www-already-in-use",
    "title": "Vercel www already in use: find the domain owner and project",
    "description": "Vercel says www is already in use when adding your domain. Check the exact hostname, team and existing project before attempting ownership verification.",
    "errorText": "Domain already in use",
    "updated": "2026-11-15",
    "sections": [
      {
        "heading": "Assignment is different from DNS",
        "body": [
          "Changing a CNAME alone does not resolve a domain assignment held by another Vercel project or account. First identify the exact hostname named in the error."
        ]
      },
      {
        "heading": "Checks in order",
        "steps": [
          "Search domains and projects in the Vercel teams you control. Compare www.example.com with example.com; they are separate hostnames.",
          "If an older project owns the hostname, plan the move to the correct project and check the production destination before removing the old assignment.",
          "If another account is involved, follow the domain dashboard verification flow. Add the exact TXT record it requests only when you control the domain.",
          "After verification or transfer, use the DNS instructions shown for the destination project and check HTTPS for both apex and www."
        ]
      },
      {
        "heading": "Do not remove unrelated DNS records",
        "body": [
          "Preserve mail records and other subdomains. An ownership check should not become an unplanned DNS migration."
        ]
      },
      {
        "heading": "Test the final redirect",
        "body": [
          "Choose the canonical hostname and verify that the alternative redirects to it without a loop. Confirm that the intended application, not an old deployment, loads."
        ]
      }
    ],
    "docs": [
      {
        "label": "Vercel: domain ownership and troubleshooting",
        "url": "https://vercel.com/docs/domains/troubleshooting"
      },
      {
        "label": "Vercel: configuring a domain",
        "url": "https://vercel.com/docs/domains/working-with-domains/add-a-domain"
      }
    ],
    "relatedGuides": [
      "vercel-404-not-found-ready-deployment"
    ],
    "scanNote": "A repository scan can flag visible configuration risks. It cannot inspect dashboard settings, private credentials, DNS propagation or live service responses. Confirm the result in the deployed environment."
  },
  {
    "slug": "lovable-vercel-build-failed",
    "title": "Lovable app fails to build on Vercel after GitHub export",
    "description": "A Lovable app works in preview but fails after import to Vercel. Identify Vite versus TanStack Start, check the exported commit and restore environment settings.",
    "errorText": "Lovable export: Vercel build failed",
    "updated": "2026-11-15",
    "sections": [
      {
        "heading": "Identify the exported framework",
        "body": [
          "Do not apply a Vite dist configuration to every Lovable export. Older projects may be client-side Vite apps; newer projects can use TanStack Start and Nitro with server-side routes. Inspect package.json and framework configuration first."
        ]
      },
      {
        "heading": "Checks in order",
        "steps": [
          "Sync the project to GitHub and confirm Vercel builds the intended branch and commit. A change visible only in the builder is not in that checkout.",
          "Check the first actionable build error and compare the framework detection with the exported dependencies. Use the current Lovable and Vercel integration instructions.",
          "Restore environment variables for the target environment. Hosting the code elsewhere does not automatically move managed databases, authentication settings or secrets.",
          "Run the repository build command with the committed lockfile. Fix the failing import or dependency rather than repeatedly changing Output Directory."
        ]
      },
      {
        "heading": "Separate build success from authentication success",
        "body": [
          "Add the deployed URL to the authentication provider when required. A successful build can still have broken sign-in callbacks."
        ]
      },
      {
        "heading": "Verify after deployment",
        "body": [
          "Test the homepage, a nested route and sign-in from a fresh session. A static SPA fallback is only appropriate for a client-routed SPA, not every exported application."
        ]
      }
    ],
    "docs": [
      {
        "label": "Lovable: hosting and ownership options",
        "url": "https://docs.lovable.dev/tips-tricks/deployment-hosting-ownership"
      },
      {
        "label": "Vercel: deploying Lovable apps",
        "url": "https://vercel.com/changelog/you-can-now-deploy-lovable-apps-to-vercel"
      },
      {
        "label": "Vercel: Vite integration",
        "url": "https://vercel.com/docs/frameworks/frontend/vite"
      }
    ],
    "relatedGuides": [
      "vite-spa-vercel-deep-link-404",
      "vercel-environment-variable-undefined"
    ],
    "scanNote": "A repository scan can flag visible configuration risks. It cannot inspect dashboard settings, private credentials, DNS propagation or live service responses. Confirm the result in the deployed environment."
  },
  {
    "slug": "bolt-vercel-build-failed",
    "title": "Bolt export fails on Vercel: build settings and missing services",
    "description": "Your Bolt app works in the builder but its GitHub export fails on Vercel. Check the exported files, real build script, lockfile and external service configuration.",
    "errorText": "Bolt export: Vercel build failed",
    "updated": "2026-11-15",
    "sections": [
      {
        "heading": "The builder and the deployed checkout differ",
        "body": [
          "Bolt can manage hosting and backend services. Exporting source code to a separate host does not prove those services, secrets and settings moved with it."
        ]
      },
      {
        "heading": "Checks in order",
        "steps": [
          "Confirm the latest Bolt changes are in the GitHub commit Vercel is building. Inspect package.json and keep the lockfile for its package manager.",
          "Run the exported build script locally from a clean install and read the first failing log line. A generic exit code does not identify the cause.",
          "Set the Vercel Root Directory, framework and output to match the actual project. Only use dist for a build that really emits static files there.",
          "Configure required database and authentication services for the new host. Keep browser-safe configuration separate from server secrets."
        ]
      },
      {
        "heading": "Do not hide a failed build with routing changes",
        "body": [
          "An SPA rewrite can solve nested-route refresh failures after a successful static build. It cannot install a missing dependency or repair a server handler."
        ]
      },
      {
        "heading": "Verify the exported app",
        "body": [
          "Open a nested route directly, test sign-in and exercise one backend operation. Compare the deployed commit and request logs before asking the builder to rewrite the whole app."
        ]
      }
    ],
    "docs": [
      {
        "label": "Bolt: GitHub version control",
        "url": "https://support.bolt.new/integrations/git"
      },
      {
        "label": "Bolt: hosting and managed services",
        "url": "https://support.bolt.new/building/intro-bolt"
      },
      {
        "label": "Vercel: build troubleshooting",
        "url": "https://vercel.com/docs/deployments/troubleshoot-a-build"
      }
    ],
    "relatedGuides": [
      "vite-spa-vercel-deep-link-404",
      "nextjs-works-locally-fails-on-vercel"
    ],
    "scanNote": "A repository scan can flag visible configuration risks. It cannot inspect dashboard settings, private credentials, DNS propagation or live service responses. Confirm the result in the deployed environment."
  },
  {
    "slug": "v0-vercel-build-failed",
    "title": "v0 works in preview but fails on Vercel production",
    "description": "A v0 app works in its preview but fails when published to production. Check the connected Vercel project, environment scope, integration settings and build log.",
    "errorText": "v0 preview works, production fails",
    "updated": "2026-11-15",
    "sections": [
      {
        "heading": "Check which project the chat uses",
        "body": [
          "A v0 chat is associated with a Vercel project. Before editing code, verify that the published project and Git source are the ones you intend to deploy."
        ]
      },
      {
        "heading": "Checks in order",
        "steps": [
          "Inspect the failed deployment in Vercel and retain the first build error. Confirm the branch and commit match your changes.",
          "Compare Development variables used by the v0 preview with the Production variables used by publishing. A working preview does not establish Production configuration.",
          "Check the connected integrations and their target database or account. Add required configuration through the connected project without exposing server secrets to client components.",
          "Create a new deployment after configuration changes. If the error is a missing import, dependency or incompatible runtime, fix that specific code path instead of changing unrelated settings."
        ]
      },
      {
        "heading": "A published URL is not a full test",
        "body": [
          "Confirm authentication callbacks and backend requests on the production hostname. Keep preview and production resources distinct when they should not share data."
        ]
      },
      {
        "heading": "Verify the same user journey",
        "body": [
          "Repeat the operation that worked in preview using a fresh production session. Check both the response and the runtime log."
        ]
      }
    ],
    "docs": [
      {
        "label": "v0: Vercel integration and environment scope",
        "url": "https://v0.app/docs/vercel-integration"
      },
      {
        "label": "v0: production deployments",
        "url": "https://v0.app/docs/deployments"
      },
      {
        "label": "Vercel: environment variables",
        "url": "https://vercel.com/docs/environment-variables"
      }
    ],
    "relatedGuides": [
      "vercel-environment-variable-undefined",
      "nextjs-works-locally-fails-on-vercel"
    ],
    "scanNote": "A repository scan can flag visible configuration risks. It cannot inspect dashboard settings, private credentials, DNS propagation or live service responses. Confirm the result in the deployed environment."
  }
];
