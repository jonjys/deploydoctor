# Private repositories without personal access tokens

The scanner accepts GitHub repository URLs. An active existing pass plus GitHub's explicit repository authorization is required for private source. The payment does not itself grant GitHub access.

## One-time owner activation

Apply the `github_app_connection` migration. In the existing authenticated `/growth` dashboard choose **Activate GitHub connection**. The next page explains the requested permissions before posting a manifest to GitHub. Review and create the GitHub App under the account that should own DeployDoctor. Use a unique app name if GitHub requests it.

The manifest requests only Contents read and Metadata read, is public for installation by customers, and disables webhook delivery. The server validates the returned app's homepage and permissions and rejects any additional/write permission. Credentials return straight to the server through GitHub's one-time manifest conversion. Only the OAuth client ID, client secret and app slug are kept, encrypted using a purpose-separated key derived from `SESSION_SECRET`, in the service-role-only `github_app_settings` table. Generated app private keys and webhook secrets are discarded. Existing configuration cannot be overwritten by this setup route.

This owner action must be completed before Connect GitHub is usable. Deployment alone does not register or install an app and does not authorize any private repository. No customer creates a personal token.

For a manually registered **GitHub App**, optional server environment variables are `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and `GITHUB_APP_SLUG`. Set its user callback to the production origin plus `/api/github/callback`, setup URL `/api/github/installed`, read-only permissions as above, and keep automatic OAuth on install disabled. Prefer the guided setup. Do not use an OAuth App with broad `repo` permissions.

## Customer flow

1. Paste a repository URL or open **Scan a private repo** with an active pass.
2. Connect GitHub. The OAuth flow checks state, uses PKCE S256 and is bound to the existing Stripe customer session.
3. Select allowed repositories through GitHub's app installation page if needed. Installation IDs supplied by the browser never grant access. A subsequent user-authorized token must still be able to read the repository.
4. Choose a private repo from the first 100 most recently pushed accessible private repositories, or paste any repository URL directly.
5. Scan using the existing analyzer. Payment is rechecked server-side, including expiry/refunds, and private reports keep the existing owner permissions.

User access tokens are encrypted in HttpOnly, SameSite=Lax cookies, Secure in production, bound to the paying customer, and limited to the earlier of GitHub expiry, eight hours, customer-session expiry or pass expiry. No user token is returned to browser JavaScript or saved in the database. Reconnect after expiry. Refresh tokens are not retained. Disconnect clears credentials from this browser; revoke the app in GitHub settings to revoke access globally. Manual ephemeral tokens remain optional under Advanced and the existing CI API remains backward compatible. The new connection does not give the paid patch flow write access.

Only the production domain is registered by the guided setup. Preview deployments do not imply a working OAuth callback. Keep `SESSION_SECRET` configured and stable; key rotation invalidates connections and requires explicitly restoring/re-encrypting owner app configuration. Never expose it or app secrets in chat, logs or public responses.

## Framework coverage

Repository input and general JS/TS import analysis are not restricted to Next.js. General deployment checks now include the existing import analyzer for other Node projects, including Vite, Astro, SvelteKit, Express and Nuxt manifests. Existing framework-specific checks still run only where applicable. The accompanying portable checks add Rust/Cargo and Netlify configuration analysis, Go/Python environment references and source inventory across common languages. See portable-scanning.md for exact coverage. No compiler, live build execution or arbitrary platform compatibility is claimed. An unknown framework is a coverage limitation, not a reason to hide source-backed findings.

## Verification

Tests cover encrypted credentials, expiry, purpose separation, cross-customer rejection, paid-plan checks, OAuth state/PKCE and replay, no token disclosure, repository-list filtering, disconnect CSRF, owner-only setup, rejection of write permissions, SQL RLS/grants and multi-stack import findings. Real GitHub consent and `jonjys/askrank` scanning require the owner activation and customer's GitHub approval; fixture tests do not establish that the real integration is connected.

References: GitHub's [manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest), [user access tokens and PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app), and [selected-repository installations](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party).

## Saved optional manual token

Advanced users can explicitly save a GitHub personal token in the same encrypted HttpOnly cookie through same-origin `POST /api/github/token`. An active pass and GitHub `/user` verification are required. Nothing returns the token to JavaScript or persists it in the database. It expires within eight hours and no later than the customer session or pass. The subsequent scan still verifies repository access; a valid identity is not proof of permission to an arbitrary repository. Disconnect clears it. Do not put this credential in localStorage or URL parameters.
