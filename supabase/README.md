# Active discovery presence

In the Supabase SQL Editor, paste and run the entire contents of
`migrations/20260909000100_create_active_discovery_sessions.sql` once, including
`begin` and `commit`. No credentials or substitutions are needed. The migration
does not drop or replace existing objects; a naming conflict fails the transaction.
It has not been executed against a database by the app or the development agent.

The table holds one current row per authenticated user, keyed by `user_id`.
Latitude and longitude are range-checked. Active rows require both coordinates;
inactive rows retain neither. A trigger sets `updated_at` using server time and
clears coordinates and expiration when a row is stopped. `expires_at` is nullable
and defaults to 15 minutes after insertion as an initial, adjustable session limit.

## Future session lifecycle

- Create or reactivate a row only in response to explicit START LOOKING. Installation,
  app launch, onboarding, or a background refresh must never activate a session.
- Update the same row during the active session; do not append movement records or
  introduce a location audit/history table. Renew expiration explicitly when appropriate;
  an update does not automatically renew it. Starting again must set a new deadline.
- STOP LOOKING should delete the row, preferably, or set `is_active = false` (which
  clears the coordinates). Future discovery responses must immediately exclude it.
- Future discovery must require `is_active = true`, an unexpired deadline when set,
  and a recent `updated_at` even when `expires_at` is NULL. A 15-minute freshness
  ceiling is an initial proposal, not implemented discovery behavior.
- Expiration does not automatically delete a PostgreSQL row. Before connecting real
  location collection, add a server-owned cleanup job to delete expired/stale rows.
  No cleanup job or discovery query is implemented here. Database backups/WAL may
  retain old row versions; this design is not a guarantee of immediate physical erasure.
- All actively discoverable users within the required proximity must be eligible to
  appear to each other, regardless of Dating, Friendship, Networking, or Socializing
  intentions. This table deliberately has no intention fields.
- Never show exact coordinates in UI or return another user's coordinates to a client.

## Future authenticated access

RLS is enabled with **no policies**, and privileges are revoked from `PUBLIC`,
`anon`, and `authenticated`. Publishable-key clients cannot currently read or write
these rows. No development bypass policy is provided. Trusted database owners and
Supabase's server-only service role can bypass RLS; never ship that role's key.

Once authentication is implemented, grant only the necessary operations to
`authenticated`, then add separate ownership policies:

- SELECT: `USING ((select auth.uid()) = user_id)` for the caller's own row only.
- INSERT: `WITH CHECK ((select auth.uid()) = user_id)`.
- UPDATE: both `USING` and `WITH CHECK` must enforce the same ownership condition,
  so users cannot change another user's row or transfer ownership.
- DELETE: `USING ((select auth.uid()) = user_id)` to stop/remove their own session.

Keep `anon` denied. RLS proves ownership, not that someone tapped a button: the
future session-start flow must enforce explicit activation. Do not create an
all-users SELECT policy on this coordinate-bearing table for discovery. Instead,
design a narrowly authorized server endpoint/function that verifies the caller's
own active session, checks activity/expiration/freshness and proximity, and returns
only safe profile data. It must not filter in either direction by intentions.

Before enabling that access, test anonymous denial, cross-user denial, owner-only
writes, coordinate clearing on STOP, expired/stale exclusion, and absence of raw
coordinates in discovery responses. Policies, authentication, proximity calculations,
and realtime subscriptions are intentionally deferred.
