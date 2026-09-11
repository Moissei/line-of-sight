# Account deletion design review

Review only, 2026-09-11. No deletion endpoint, SQL, Edge Function, or deletion UI is implemented. Findings describe repository migrations 001–010, not a live database audit. Supabase-managed schemas and any dashboard-only changes must be verified before deployment.

## Current data and deletion behavior

| Data | Personal/history content | Current FK behavior on Auth user deletion |
| --- | --- | --- |
| `auth.users` and managed Auth records | Login identity, email, credentials/metadata, identities, sessions | Use Auth Admin deletion, not manual SQL. Managed relationships are not defined in this repo. Supabase documents session/refresh-token removal; verify provider identities, MFA and operational retention in the deployed project. |
| `public.profiles` | Name, exact DOB, gender, bio, intents, timestamps, legacy photo reference | `user_id → auth.users(id) ON DELETE CASCADE`: entire profile deleted. |
| `public.profile_photos` | Numbered photo positions, paths, timestamp | `user_id → auth.users(id) ON DELETE CASCADE`: metadata deleted, NOT file bytes. |
| `public.active_discovery_sessions` | Current coordinates, active flag, freshness and expiration | `user_id → auth.users(id) ON DELETE CASCADE`: row deleted. STOP already clears coordinates in the prepare trigger. |
| `public.connection_requests` | Sender/recipient, pending/accepted/declined status, timestamps | BOTH participant FKs cascade: all requests sent or received deleted. |
| `public.connections` | Unordered participants, active/ended relationship and end reason | BOTH participant FKs cascade: active AND historical connections deleted. The lifecycle trigger prevents updates reopening ended rows; it does not prevent cascade deletion. |
| `public.messages` | Message body, sender, timestamp, connection | Sender FK cascades directly; connection FK cascades too. Deleting either participant deletes the connection and ALL messages in it, including messages authored by the surviving participant. |
| `public.user_blocks` | Directional block history | BOTH participant FKs cascade: incoming and outgoing blocks deleted. |
| `public.user_reports` | Reporter, reported user, reason, free-text details, timestamp | BOTH participant FKs cascade: reports BY the user and reports ABOUT the user deleted. There is no durable evidence snapshot, message/report join, legal hold, or anonymization design in the current migrations. |
| Storage `profile-photos` | Private uploaded file bytes and managed object metadata | No application FK connects photo metadata deletion to file removal. Use Storage API. Owner is `owner_id`, canonical keys are `<uid>/1`, `/2`, `/3`, plus temporary `/profile`. Alias uniqueness makes `/profile` and `/1` share slot 1 (max THREE photos). |
| Realtime connection channels | Private `connection:<id>` topics and empty change hints | Not durable conversation storage. Authorization checks connection membership/activity, but existing channel authorization is cached. Database deletion is not an immediate channel eviction mechanism. |
| App/device and service operational data | Auth session persistence; in-memory drafts/messages/signed URLs; selected local photo URIs; backups/logs | Not controlled by these FKs. Logout clears the current app tree and SDK session. Other devices, already-downloaded content, local library originals, backups and platform logs require separate lifecycle/retention review. No guarantee of remote erasure. |

Sources in repo: migrations `20260909000100`, `20260909000300`, `20260910000100` through `20260910001000`. The later migrations do not replace the above cascading Auth FKs. `messages` has no direct client grants; Storage policies and Realtime authorization are separate from table metadata.

If someone simply deletes `auth.users`, normal Supabase deletion may FAIL while owned Storage objects exist. It must not be advertised as automatic file cleanup. If Auth deletion succeeds with path-owned/ownerless or otherwise exceptional objects left behind, their bytes/managed metadata can remain orphaned and owner access disappears. The bucket itself remains. Remaining unrelated reports can also mention the deleted person in free text; FKs cannot detect or scrub that. Unrelated users' records remain, but their messages in the deleted user's connections do not.

## Recommended architecture: coordinated server workflow

Use a narrowly scoped authenticated Edge Function as orchestrator, with reviewed private database operations for atomic state transitions and race protection. Do not expose an Auth-admin API or service-role credential in Expo. A database-only SECURITY DEFINER RPC cannot safely remove Storage bytes or coordinate the supported Auth Admin API. Keep privileged credentials only in the server environment and scope all work to the caller validated by Auth; never accept a client-chosen target identity.

Proposed sequence (requires future backend review and migrations):

1. Require deliberate confirmation (e.g. type DELETE) and recent reauthentication appropriate to the sign-in method; explain permanence and the approved retention policy. Avoid a single-tap destructive action. Rate-limit the endpoint. Do not log tokens, profile data, report contents, or message text.
2. Validate the caller server-side. Atomically record an idempotent deletion job and mark the account deletion-pending. Immediately stop discovery/clear coordinates, end active connections, and retire pending requests. Use consistent account/pair locking compatible with existing advisory locks. Add deletion-pending/session-validity guards to relevant RPCs, table RLS, Storage writes/signing and channel joins. All write paths must honor the gate; otherwise uploads or presence can race cleanup. The current schema DOES NOT have these gates or job states.
3. Revoke sessions/login access using supported Auth administration and the pending-account gate. A ban alone is insufficient. Existing JWTs can remain cryptographically valid until expiry; sensitive operations must also reject pending/deleted accounts or invalid sessions. Keep public messages RPC-only. Dispose channels on cooperative clients; do not promise that cached Realtime authorization can be instantly evicted through SQL. Empty hints never authorize a read. Before promising immediate remote eviction, review a supported server-side disconnect mechanism; durable reads/writes must deny independently.
4. Apply the product-approved retention/evidence policy BEFORE destructive cascades. If evidence must survive, write minimized evidence into a separate access-restricted moderation store with appropriate non-cascading/anonymized references and an expiry process, then verify the snapshot. Do not retain every conversation by default or call reversible pseudonymization anonymous. This needs schema review; no such store is proposed for execution here.
5. Enumerate and delete actual objects through Storage API, including numbered and legacy keys. Reconcile metadata AND actual Storage inventory; do not rely on `profile_photos` alone (partial migrations/uploads can leave an object without metadata). Check other owned buckets/objects in the live deployment too. Verify cleanup with privileged Storage operations and re-enumeration. Do not manually delete `storage.objects` rows. Keep writes disabled and retry safely if any object removal fails.
6. Only after Storage and approved evidence handling succeed, use server-side `auth.admin.deleteUser` for hard deletion. Existing application cascades then remove the rows described above. Never report completion when only a deletion request was accepted. If Auth deletion fails after files were removed, keep the account gated and retry the same job; do not recreate deleted files or re-enable the account automatically.
7. Verify Auth removal and Storage absence. Keep only the approved minimal job/audit tombstone needed for retries and retention enforcement, outside a cascading FK to the deleted Auth row. Return a generic completion result; current clients clear local state and navigate to Welcome. Explicitly handle retry after Auth removal (a server job must complete without requiring a now-invalid user token).

Storage, Auth, and Postgres do not share one transaction. Use a resumable job with checkpointed phases and bounded retries; the eventual implementation needs a recovery executor, not just an Edge Function call assumed to finish before timeout. No executor or function is created in this change.

## Product decisions required before destructive implementation

- Should reports **about** a deleted user survive, and should reports **by** a deleted user survive? Define each purpose, duration, access group, appeal/legal-hold handling, and purge policy.
- Should specific reported-message evidence survive? Define what qualifies, how evidence is captured, and what unrelated content is excluded. Current reports do not identify a message or connection, so evidence cannot be reliably reconstructed by a report FK.
- What should the surviving conversation participant see? Current cascades remove the whole conversation, not just the deleting user's messages. Preserving a transcript requires a different schema/retention policy and careful redaction.
- Should connection history be retained in minimized form? For how long, and without which identifying fields? Ending a connection is not anonymization.
- Define operational backup/log expiry and exceptional legal holds. No jurisdiction-specific retention requirement is assumed here. Do not silently choose hard deletion or indefinite retention as policy.

## Verification plan for a later deletion implementation

Test zero-photo users, all three slots, legacy `/profile`, orphan metadata, object-without-metadata, unexpected owned objects, and partial Storage failures. Test concurrent send/accept/upload/START, repeated deletion requests, expired/revoked tokens, unauthorized target substitution, Auth deletion failure after Storage success, worker retry after Auth removal, and retained-evidence expiry. Verify both participants lose old chat access and no new Realtime authorization is issued. Existing bearer photo URLs and cached channel permissions have lifetime limitations; downloaded content cannot be recalled.

## Official references

- [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data): owned Storage objects can block deletion; Auth deletion and issued-JWT limitations.
- [Storage schema](https://supabase.com/docs/guides/storage/schema/design): managed metadata is distinct from underlying files; use Storage APIs for deletion.
- [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization): private channel policy checks and cached authorization.
- [Sign out](https://supabase.com/docs/reference/javascript/auth-signout): local versus global scope and access-token lifetime.

## Implemented logout boundary

Account is available from Discovery. Logout confirms, attempts STOP before local-scope Auth signout, removes channels, and resets the root navigation/provider tree on SIGNED_OUT. Protected routes cannot be reopened unauthenticated. Focus cleanup cancels nearby polling/photo caches and Realtime watchers; remount discards screen and onboarding state. STOP failure does not trap the user: the existing server freshness/expiry limits remain the fallback (up to 15 minutes from the last activity). Logout does not delete an account, files, messages, or reports, and cannot invalidate an already-issued JWT before its expiry.
