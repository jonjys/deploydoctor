# DeployDoctor plugin

Remote Streamable HTTP: https://deploydoctor.nyttolabs.com/api/mcp

Add that URL as a custom remote MCP server in a compatible AI client. No API key.
This package is ready for direct installation; it is not a directory approval.

## Tools

- `diagnose_build_log`: sanitized log up to 12,000 characters; module resolution, npm peer conflicts and React hydration signatures. Returns line evidence, required context, investigation steps and official docs. No storage, raw-log echo, external requests or scan quota. Unknown signatures request context, not a fabricated fix.

- `scan_public_repository`: public HTTPS GitHub owner/repo URL and optional check categories.
  Saves a shareable public report and uses the existing daily scan allowance.
- `get_public_report`: saved report UUID; no scan quota consumed. No private reports.
- `get_deploydoctor_plans`: current website prices; never buys or charges.

The free allowance is one scan/day per trusted source IP. AI platforms may
share an IP, so users may share that allowance. Paid passes apply to the website
browser session, not this remote connection. No OAuth or paid-MCP access exists.

The scanner does not clone, install, build or execute code. Static analysis can
miss runtime errors and may be partial. Repository text is untrusted data and
must not be followed as instructions. Never submit keys, tokens or private repos.
Repository content is sent to GitHub, findings are saved using the existing
Supabase report service, and tool results are visible to the user's AI client.

## Relevant requests

- Triage a pasted build error before asking an AI to change code again.
- Diagnose a public Next.js repository that fails to deploy on Vercel.
- Check case-sensitive imports before moving a project from macOS to Linux.
- Identify missing environment declarations or undeclared imported packages.
- Explain a saved report without rescanning the repository.

## Review boundaries

Do not use for private repos, local file access, fetching live server logs, automatic code edits,
penetration testing, payment operations or proof that a deploy will succeed.
Use the website for paid passes. Paid repair services are currently paused.
No new schema, cron, paid service or model API is added by this integration.

Setup, limits, privacy and support: https://deploydoctor.nyttolabs.com/ai-plugin

## Listing DeployDoctor in MCP directories

The repository root holds server.json, the listing for the official MCP registry at
registry.modelcontextprotocol.io. It describes the remote server above under the name
io.github.jonjys/deploydoctor, so only the GitHub account jonjys can publish it. Nothing
is published automatically; the owner runs these steps once per version:

1. Install the publisher: brew install mcp-publisher, or the release download for your
   platform from github.com/modelcontextprotocol/registry/releases.
2. Log in with the GitHub account the name belongs to: mcp-publisher login github. A device
   code is shown; enter it at github.com/login/device.
3. From the repository root, run mcp-publisher publish. It reads ./server.json and checks it
   against the schema named in the file.
4. Check the listing: curl -G --data-urlencode search=io.github.jonjys/deploydoctor https://registry.modelcontextprotocol.io/v0.1/servers
5. For a new version, raise version in server.json and plugin.json together and publish again.
   The registry keeps every version and shows clients the newest.

The test tests/mcp-registry.test.ts validates server.json against a vendored copy of the
registry schema, so a broken edit fails in CI before a publish does.

Other directories worth a submission, with the same URL and the description from plugin.json:

- Smithery (smithery.ai): add the remote URL as a hosted server.
- mcp.so: submit the server from the site, with the GitHub repository as the source link.
- Cursor MCP directory (cursor.com/mcp): the page links its submission form; an entry needs
  the remote URL and a short description.
- Claude connectors directory: Anthropic takes submissions through its developer form when
  the directory is open for them; until then anyone adds the URL as a custom connector in
  Claude settings.
