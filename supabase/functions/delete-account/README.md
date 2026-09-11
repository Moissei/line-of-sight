# delete-account (not deployed)

Authenticated POST with an Authorization Bearer access token, **no request body or query parameters**. Returns only `{ "success": true }` or a generic error. OPTIONS supports web preflight. Never invoke this function against a real account while reviewing/testing it.

## Authentication and server configuration

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: hosted Supabase server environment values. The anonymous key creates the JWT verifier; only the separate admin client uses the service-role key. Never put it in Expo, EXPO_PUBLIC variables, or source control.
- `DELETE_ACCOUNT_ALLOWED_ORIGINS`: comma-separated exact web origins, with scheme/port and no trailing slash. Default accepts no browser origins. Native requests without Origin are permitted but still require authenticated JWTs. CORS is not authentication.
- `supabase/config.toml` sets `verify_jwt = true` for defense in depth. No repository evidence requires disabling the gateway check. The handler independently uses getClaims to verify signature, issuer, authenticated role/audience, expiry, optional not-before time, and subject shape. It checks the server-only tombstone before calling getUser; destructive work still requires getUser to match the verified subject. Validate deployed gateway signing-key and web-preflight compatibility in staging before launch; do not disable verification speculatively.
- No client target ID is accepted. Only verified JWT `sub` supplies `p_user_id` to the existing server-only lifecycle RPCs. The caller JWT is never forwarded as the admin client's Authorization header.
- No logs of request bodies, headers, IDs, SDK errors, paths or personal data are emitted by this code. Review platform logging/redaction configuration separately before deployment.

## Lifecycle

1. Verify token, then read `account_deletion_status`.
2. If already deleted, acknowledge success without any new mutation. Otherwise verify current Auth user.
3. Call `begin_account_deletion` (also safe for pending/prepared retries).
4. Recursively list `profile-photos/<verified-id>/`, paginating sorted folder entries in pages of 100. Enumerate before removing, so removals do not shift pagination offsets within that pass. Remove files in batches of 100 using Storage API; canonical and legacy paths need no special cases.
5. Re-enumerate; repeat cleanup at most three times, then independently verify zero remaining files. Listing/removal errors or a nonempty final inventory fail closed. Inventory traversal is bounded to 2,000 pages per pass to limit pathological workloads; exceeding that requires trusted operational cleanup before retry.
6. Call `prepare_account_auth_deletion`. This RPC also rejects other owned Storage objects outside this function's prefix/bucket scope. Such objects require separately reviewed server cleanup; do not bypass the preparation check.
7. Call `auth.admin.deleteUser(id, false)` (hard delete). Verify lifecycle reaches `deleted`. An Admin error followed by confirmed `deleted` is successful, accommodating concurrent retries or transport loss after commit.

Pending/prepared retries never reactivate accounts. Storage removal success is never inferred from metadata alone: remove API calls and fresh listing are required. No direct Storage table mutation, Auth SQL deletion, RLS changes, or duplication of database cleanup logic.

## Retry and security limits

- A lost success response can be acknowledged on retry with a still-verifiable, unexpired signed JWT and a `deleted` tombstone. With asymmetric signing keys, getClaims can verify via JWKS after the Auth row is gone. With legacy symmetric signing keys, SDK verification may require the deleted Auth user and return 401 instead. Expired tokens also return 401. Never fall back to decoding unverified claims. A later client must handle a lost response without treating 401 alone as proof of deletion.
- Pending/prepared failures can be retried while the caller can authenticate. A durable trusted recovery worker is still needed for abandoned jobs or expired sessions; this function does not add a worker or accept unauthenticated retry capabilities.
- Deletion-pending application gates do not instantly invalidate existing JWTs or cached Realtime channel authorization. Existing database functions deny further sensitive interaction. This function does not claim to evict existing remote WebSockets.
- Storage is a separate service. Existing in-flight uploads, privileged writes, or pre-issued upload capabilities require production race testing and reconciliation. The function verifies the Storage API view and the existing prepare RPC checks managed inventory; it cannot prove a storage provider has physically purged all replicas or late untracked bytes. Do not run privileged uploads concurrently with deletion.
- The later UI must supply explicit, deliberate confirmation. The endpoint authenticates but does not add recent-password/MFA reauthentication. Add product-required recent-auth checks and abuse/rate limiting before public launch; CORS alone cannot stop a stolen valid access token.
- The existing migration preserves history/reports. This implementation does not add moderation retention decisions or purge evidence.

## Local validation / eventual deployment

Safe validation (does not execute the function):

```sh
deno check supabase/functions/delete-account/index.ts
node --test scripts/delete-account.test.cjs
```

Future deployment command, **not run by this change**:

```sh
supabase functions deploy delete-account --project-ref <project-ref>
```

Use the repository's function-specific config; configure allowed origins through server secret management. Do not include credentials in CLI examples, commit them, or change the Expo environment. This directory has an isolated Deno config/lock; root Expo TypeScript excludes server-only functions.

Review note: the existing SUPABASE_SERVICE_ROLE_KEY is retained. Database deletion RPCs explicitly require the service_role role; the separate admin client already supplies it. No server-key migration or new signing secret is introduced. The asymmetric-JWKS lost-response path does not require getUser; legacy symmetric getClaims may internally require it, so that limitation remains fail-closed until the actual project signing-key setup is verified.
