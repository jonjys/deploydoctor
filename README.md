# DeployDoctor

DeployDoctor scans a public GitHub repository for five common Vercel deployment failures and saves a shareable report in Supabase. It reads repository metadata and files through the GitHub REST API; it does not clone, install, build, or execute the target repository.

## Checks

1. Next.js is declared but no `app/` or `pages/` route folder exists.
2. Relative or `@/` imports point to files missing from the repository tree.
3. Playwright, Puppeteer, SQLite bindings, or filesystem writes appear in API routes.
4. `process.env` variables are undocumented or secret-looking values use `NEXT_PUBLIC_`.
5. Supabase browser clients cross into server code or a service role key crosses into client code.

## Local setup

Requirements: Node.js 22+, npm, and a Supabase project.

```powershell
npm install
Copy-Item .env.example .env.local
```

Fill in the four values in `.env.local`. `GITHUB_TOKEN` is optional, but raises GitHub's API limit and allows a broader source scan. Supabase's URL and publishable key are public values; keep `SUPABASE_SECRET_KEY` private.

Apply [`supabase/migrations/20260926072909_create_reports.sql`](supabase/migrations/20260926072909_create_reports.sql) to the Supabase project, then run:

```powershell
npm run dev
```

Open `http://localhost:3000`, paste a public GitHub repository URL, and the API will analyze and persist the report before redirecting to `/r/[id]`.

## Verification

```powershell
npm test
npm run lint
npm run build
```

The fixture test confirms that `https://github.com/manasvmoon/post-image-generator`'s current shape triggers checks 1 and 3 as red.

## Vercel preview

Add all four variables to the Preview environment, then deploy without `--prod`:

```powershell
npx.cmd vercel@50.16.1 login
npx.cmd vercel@50.16.1 link --yes
npx.cmd vercel@50.16.1 env add GITHUB_TOKEN preview
npx.cmd vercel@50.16.1 env add NEXT_PUBLIC_SUPABASE_URL preview
npx.cmd vercel@50.16.1 env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY preview
npx.cmd vercel@50.16.1 env add SUPABASE_SECRET_KEY preview
npx.cmd vercel@50.16.1 deploy --yes
```
