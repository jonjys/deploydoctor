# DeployDoctor

License: BSL 1.1 · Live: [deploydoctor.nyttolabs.com](https://deploydoctor.nyttolabs.com)

DeployDoctor scans a GitHub repository for the most common Vercel deployment failures and saves a shareable report in Supabase. It reads repository metadata and files through the GitHub REST API; it does not clone, install, build, or execute the target repository.

## Checks

The stack is detected first (package.json, `.env.example`), and only the checks that fit it run.

1. Next.js is declared but no `app/` or `pages/` route folder exists.
2. Relative or `@/` imports point to files missing from the repository tree.
3. Playwright, Puppeteer, SQLite bindings, or filesystem writes appear in API routes.
4. `process.env` variables are undocumented or secret-looking values use `NEXT_PUBLIC_`.
5. Supabase browser clients cross into server code or a service role key crosses into client code.
6. Prisma is used without `prisma generate` in the build.

## Local setup

Requirements: Node.js 22+, npm, and a Supabase project.

```powershell
npm install
Copy-Item .env.example .env.local
```

Fill in `.env.local` (every variable is listed in `.env.example`). Free scans need only the Supabase values; the Stripe values and `SESSION_SECRET` enable payments. `GITHUB_TOKEN` is optional, but raises GitHub's API limit and allows a broader source scan. Supabase's URL and publishable key are public values; keep `SUPABASE_SECRET_KEY` private.

Apply the migrations in [`supabase/migrations`](supabase/migrations) to the Supabase project, then run:

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
npx.cmd vercel@60.1.3 login
npx.cmd vercel@60.1.3 link --yes
npx.cmd vercel@60.1.3 env add GITHUB_TOKEN preview
npx.cmd vercel@60.1.3 env add NEXT_PUBLIC_SUPABASE_URL preview
npx.cmd vercel@60.1.3 env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY preview
npx.cmd vercel@60.1.3 env add SUPABASE_SECRET_KEY preview
npx.cmd vercel@60.1.3 deploy --yes
```

## License

DeployDoctor is source-available under the [Business Source License 1.1](LICENSE). You may read, fork, run it locally for private use and contribute. You may not offer it as a commercial hosted service that competes with [deploydoctor.nyttolabs.com](https://deploydoctor.nyttolabs.com). On 2029-09-27 the license changes to MIT.
