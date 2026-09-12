# Push notifications: local implementation for review

Nothing in this change applies SQL, deploys functions, creates webhooks, provisions
credentials, or sends a push. Existing interaction and deletion RPCs are unchanged.

## Review artifact

The COMPLETE proposed transaction is:
`supabase/migrations/20260911000200_push_notifications.sql`.
It depends on the existing account-deletion lifecycle migration.

## Client registration

The root layout runs the notification hook only after authentication and fonts
are ready. Web, nonphysical devices, and Expo Go are skipped before importing
expo-notifications. Normal app use does not depend on notification support.

No EAS projectId is present in the checked-in project configuration. The code
reads `Constants.easConfig.projectId` or `Constants.expoConfig.extra.eas.projectId`.
Without either, registration skips without prompting. Do not invent a project ID.
An authorized maintainer must later associate the app with its real EAS project,
configure its application identifiers and Android/iOS push credentials, and make
a development/release build. Android Expo Go cannot test remote push on SDK 57.

On a supported device with an EAS ID:

1. Create the Android `default` channel before checking/requesting permission.
2. Inspect permission; request only if not granted and `canAskAgain` is true.
3. Get an Expo push token for the EAS project.
4. Call `register_push_device({expo_token})` under the current Supabase session.
5. Listen for native token changes, obtain the new Expo token, register it, then
   unregister the old token. Never pass the native APNs/FCM token to this RPC.

Token values remain in memory in this integration, never UI, routes, or logs.
Registration errors are swallowed. Each authenticated lifecycle stops its
listeners and pending registration work on cleanup. Logout attempts to unregister
before Auth sign-out, with a six-second upper wait bound; cleanup failure cannot
fail logout. The database deletes devices and pending deliveries on Auth deletion.
Server eligibility checks also reject accounts still pending/prepared deletion.

As with all best-effort push logout cleanup, an offline/failed unregister can leave
a device registered until a later registration, token invalidation, or Auth deletion.
Push content is deliberately generic. A future device-management screen/expiry
policy can address abandoned devices; this change does not invent that policy.

## Database and security

`private.push_devices`: unique token, Auth owner FK with ON DELETE CASCADE,
enabled state, server timestamps; supports multiple devices. Register/unregister
derive caller solely from auth.uid(), require authenticated active account, and
take the existing shared account-deletion lock. A token ownership change deletes
the old device/delivery rows before registering it for the new account. Knowing
an Expo token is treated as possession for registration; never expose these tokens.

`private.push_outbox`: actor/recipient Auth references, exact event kind, source
ID, optional connection ID, server timestamps and 24-hour delivery eligibility.
No name, profile fields, coordinates, or message body. It is not moderation history.
Auth deletion cascades these events. Tokens are not copied into outbox rows.

`private.push_deliveries`: per-device state, unique event/device, attempt counter,
claim lease, and Expo ticket for receipt handling. All three tables enable RLS,
have no client policies, and revoke direct grants even from service_role. Narrow
service-only RPC wrappers reach postgres-owned private SECURITY DEFINER functions
with empty search_path. Ordinary app users can only register/unregister tokens;
neither RPC returns tokens or internal IDs. Keep `private` out of exposed schemas.

AFTER INSERT triggers enqueue within the SAME successful transaction:

| Operation | Event and recipient | Duplicate behavior |
| --- | --- | --- |
| Pending request inserted | connection_request to recipient | Existing send RPC conflict-do-nothing creates no second insert; event uniqueness is additional protection. |
| Active connection inserted by acceptance | connection_accepted to the other participant/original requester | Runs after the acceptance RPC updates the request and creates the connection. Cross-direction acceptance reusing an active connection does not create a duplicate event. |
| Message inserted | new_message to the other connection participant | One event per durable message; no message text copied. Separate messages are separate events. |

Existing RPCs still own proximity/auth validation and shared account/pair advisory
locks. No HTTP occurs in these transactions. A rolled-back operation also rolls
back its outbox row. Triggers defensively require active accounts, no bilateral
block, and an active connection where applicable. The worker RECHECKS those rules
and still-pending request state at claim time, dropping stale eligibility. The
existing `users_are_blocked` helper cannot be reused by a service worker because
it deliberately requires a participant user JWT; the new private worker predicate
checks the same account/block tables without granting client execution.

No existing RPC return shape, message/connection RLS, discovery radius/freshness,
photo permissions, or account-deletion logic is changed.

## send-push Edge Function

`supabase/functions/send-push/index.ts` is the server adapter; `handler.ts` is
dependency-injected for tests. POST only. No browser CORS surface. A dedicated
`x-push-webhook-secret` is compared using SHA-256 digests and a fixed-length
comparison. Missing/incorrect secret, including an ordinary authenticated-user
JWT without the secret, is rejected before privileged work. Supabase gateway
`verify_jwt=false` applies ONLY to send-push because it uses server webhook
authentication, not user JWT authentication. delete-account config is unchanged.

Supabase's standard generated INSERT webhook payload contains the inserted
`private.push_outbox` record; it does NOT literally send only an event ID. That
record may include actor ID, recipient ID, connection ID, notification kind,
source ID, timestamps, and other outbox fields. This is confidential server-to-server
data, distinct from the minimal notification data delivered to a device. Do not
log the webhook record or expose it to ordinary app clients.

The handler validates the webhook schema/table/event envelope and uses only
`record.id` from the supplied record to select work. Supplied actor ID, recipient
ID, connection ID, notification type/kind, tokens, or other record fields are
never authoritative. All authoritative recipient, token, type, and routing
information comes from the service-role database claim RPC; fixed notification
copy is selected using that database-returned type. The existing handler already
follows this rule and does not construct notifications from the webhook record.
The separate authenticated scheduler actions are not INSERT record fields.

Claiming uses SKIP LOCKED, per-delivery UUID leases, a
two-minute lease timeout and maximum five attempts. A webhook handles up to 100
devices; the scheduled drain handles further devices and retries. Zero devices
is successful. Terminal/ticket deliveries are not resent by duplicate webhooks.

Expo requests use the `/push/send` API with at most 100 payloads and a 15-second
timeout. Titles/bodies are fixed:

| Type | Title | Body | Notification data |
| --- | --- | --- | --- |
| connection_request | New connection request | Someone wants to connect with you. | type only |
| connection_accepted | Connection accepted | You have a new connection. | type only |
| new_message | New message | You received a new message. | type and connection_id only |

Tickets are stored privately. A separate authenticated `{"action":"receipts"}`
call checks due receipts after 15 minutes. Ticket/receipt DeviceNotRegistered
disables the device. Network failures use scheduled backoff (2,4,8,16 minutes;
five attempts maximum), not aggressive in-function loops. Missing receipts are
rechecked, and unresolved receipt work ends after 24 hours. Expo ticket acceptance
does not mean the notification reached the phone. Errors returned to callers
are generic; no provider response, tokens, user IDs, or contents are logged.

## Notification responses

Only process responses after authentication:

- connection_request -> `/requests`
- connection_accepted -> `/connections`
- new_message -> validate UUID format, load the caller's connections using the
  existing authorized RPC, then open `/connection-detail` only if that connection
  is returned. Chat RPCs authorize again and remain authoritative.

Unknown/malformed payloads and unauthorized/stale connections are ignored. The
integration never uses an arbitrary notification URL as a navigation destination.
Response IDs suppress duplicate handling within a lifecycle; the last response
is cleared after handling. Foreground banner/list/sound is enabled. No polling.

## Future manual setup — DO NOT perform during this review

First review/apply the proposed SQL separately. Then build with the real EAS
projectId and valid push credentials. Configure these server variables:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: existing built-in Edge Function
  server environment. Do not copy the privileged key into Expo or webhook bodies.
- `PUSH_WEBHOOK_SECRET`: a newly generated high-entropy random secret (at least
  32 random bytes), stored as a Supabase function secret and in the webhook's
  custom header. Never EXPO_PUBLIC, git, screenshots, or logs.
- `EXPO_ACCESS_TOKEN`: optional server-only Expo access token. Required if Expo
  Enhanced Push Security is enabled for this project. Never EXPO_PUBLIC.

After a separately authorized deployment of send-push, create exactly this
Database Webhook in Supabase Dashboard:

| Setting | Value |
| --- | --- |
| Name | push_outbox_insert |
| Schema/table | private.push_outbox |
| Events | INSERT only |
| Target | HTTP request |
| Method | POST |
| URL | https://<PROJECT_REF>.supabase.co/functions/v1/send-push |
| Content-Type | application/json |
| Custom header | x-push-webhook-secret: <same PUSH_WEBHOOK_SECRET> |
| Body | Supabase's normal generated INSERT webhook payload, unmodified |
| Timeout | 10000 ms (worker may finish after webhook timeout; claims prevent immediate duplicate sends) |

Do not add UPDATE webhooks or a public/private-table read policy. If the Dashboard
does not offer the private schema table, stop for a reviewed manual webhook setup;
do not move the table into an exposed schema or grant client SELECT.

A reviewed server scheduler is ALSO required for reliability. POST to the same
function with the same secret header and JSON body `{"action":"drain"}` every
minute, and `{"action":"receipts"}` every five minutes (SQL only returns receipts
due after 15 minutes). No scheduler or webhook is created by this change. Protect
the scheduler secret just as the webhook secret. At MVP volume each call handles
100 deliveries; tune/monitor backlog before larger rollouts. Do not rely on
Database Webhooks alone for retries or receipt checking.

## Validation and remaining review

Mocked tests cover unsupported environments, missing projectId, permissions,
registration/rotation, logout cancellation/failure, routes and authorization,
server-call authentication, zero/multiple devices, generic payloads, tickets,
invalid devices, receipt cleanup, and transport retries. Existing logout,
safety, Realtime, and deletion suites are included. SQL invariant tests are static
review checks, NOT a substitute for executing the migration and role/concurrency
tests in an isolated database after approval. No SQL has been run here.

Important unavoidable boundaries and follow-up decisions:

- A block/deletion after claim but before Expo accepts a request cannot be made
  atomic with the external HTTP call. Eligibility is checked immediately before
  handing tokens to the worker; generic pushes already in transit cannot be
  recalled. Token reassignment/logout has the same narrow in-flight boundary.
  Routing and all reads remain server-authorized.
- Network ambiguity after Expo acceptance but before saving a ticket can cause
  duplicate delivery on retry. This is at-least-once best effort, not exactly once.
- A push trigger error rolls back the interaction transaction; validate migration
  privileges/types against the deployed schema before applying it.
- Configure monitoring/rate limits for aggregate Expo throughput (600/sec/project)
  before scale. No aggregate distributed limiter is claimed in this MVP.
- Outbox/delivery operational-record retention and stale-device expiry require
  a reviewed cleanup policy/job. Delivery expires after 24 hours, but that does
  not physically delete operational rows. Auth deletion does cascade them.
- Physical-device delivery, native credentials, server ACL enforcement, and
  webhook/scheduler connectivity remain untested until separately approved setup.

References: Expo SDK 57 notifications documentation
https://docs.expo.dev/versions/v57.0.0/sdk/notifications/ ; Expo sending/receipts
https://docs.expo.dev/push-notifications/sending-notifications/ ; Supabase webhooks
https://supabase.com/docs/guides/database/webhooks .
