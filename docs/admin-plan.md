# Admin dashboard plan

Status: deployed November 8, 2026 at `https://admin.flatgirl.net`.
The incremental-refresh correction below was deployed November 8, 2026.
Latest authenticated live verification passed at 3:18 PM CST, including unique
views, the launch cutoff, and Sarah’s icon. See `cloud/ADMIN.md` for operations.

Build a small static Nuxt dashboard in `admin/`, hosted at
`https://admin.flatgirl.net`. DynamoDB is the source of truth. No Brevo integration
and no campaign end date. Production measurement begins November 7, 2026 at
3:00 PM America/Chicago; beta retains its independent recorded history.
Use frontend-requested rollups persisted in a dedicated DynamoDB cache table.
There is no scheduled collector. The admin runtime is read-only except for its
cache table and execution logs; locks and rollup progress live in that same table.

## 1. Dashboard and measurement

Keep total recorded Leads, estimated unique views, View → Lead event rate,
and DLQ health immediately visible. Production is the default environment;
beta is an explicit separate selection and is never combined with production.

| View | Counts and comparisons | Average pattern |
| --- | --- | --- |
| Day | Pick a date; hourly Views and Leads, daily totals, hourly and total event rates | Pick a span of days; average Views and Leads by hour of day |
| Week | Pick a Monday–Sunday week; daily Views and Leads, weekly totals and event rates | Across the selected weeks, average Views and Leads by weekday |
| All time | All available recorded history; daily and cumulative totals and event rates | Typical hour of day, typical weekday, and average Leads/Views per completed day/week |

Use date/week controls covering available history through now, not 7/30/90-day
presets. All time includes existing records from before dashboard deployment.
Ignore production Views and Leads before November 7, 2026 at 3:00 PM Chicago
(`2026-11-07T21:00:00Z`). The first 3–4 PM hour is a normal full hour once it
finishes. There is no end boundary or automatic shutdown.

Display time in `America/Chicago`; use original `event_time`, not the time Meta
accepted the event. Count every stored `Lead` or `ViewContent` row regardless of
`meta_success`. The table's event ID key already prevents an SQS retry from
creating a second row for the same event. Leads remain stored-event counts.
Default to estimated unique views, with a total-views toggle. Identify a view by
its IP address plus trimmed browser user-agent (canonicalizing IPv6). Compute
distinct counts independently per UTC hour, Chicago day/week, and all time;
never sum smaller-period uniques for a larger-period total. Cumulative counts
union identities across days. Missing identity metadata stays in total views
but is excluded from uniques and disclosed. Shared IP/browser combinations can
merge people; network/browser changes can split them. Do not read email.

For each selected period/bucket, event rate is `Leads / selected view count * 100`.
For average patterns, divide summed counts by the number of eligible complete
occurrences of that hour or weekday. Compute rates from summed counts, never
from an average of percentages. Include zero-event occurrences within coverage;
exclude future and incomplete occurrences from averages. Show current partial
counts separately and mark them incomplete. A zero denominator displays “—”.
Use only complete history-covered weeks for average weekly totals; show “—”
until one exists. A weekday pattern can use complete days from partial weeks.

Label the metric “View → Lead event rate”. Total views are recorded landing
responses; unique views are an estimate, not verified people or proof of rendering. GPC suppresses views but not Leads;
visits and Leads can land in different time buckets. Rates can exceed 100% and
must not be clamped. This is an aggregate event comparison, not a matched-person
funnel. Failed enqueues or records not yet archived are absent from these counts.

## 2. Dashboard frontend and demand-driven API

Use the existing `web/` Nuxt/Vue versions and static generation approach in a
separate `admin/` package. Use Tailwind for a conventional dashboard: a restrained
neutral background, bordered metric cards, clear navigation, a compact environment/
date toolbar, chart panels, and consistent typography and spacing. Use native
fetch and Tailwind-styled charts. A chart dependency is allowed when useful;
choose one supporting Tailwind styling. Keep the remaining dependencies small.
There is no production Nuxt server or image build pipeline.
Publish only `admin/.output/public/`. Include accessible chart descriptions or
a compact data table, responsive layout, loading/error states, and noindex.

Use two small API operations behind the same authenticated Lambda:

- `GET /api/metrics?environment=production`: read the persisted hourly dataset
  and DLQ snapshot for the selected environment. Return ready, missing, or stale status, timestamps, and any complete
  cached result. This operation never scans sources or calls SQS.
- `POST /api/rollups/ensure`: ensure the selected environment's data exists and is fresh. Recheck
  the cache, acquire the rollup mutex only if work is necessary, calculate missing/
  stale data, and persist it. Return ready, waiting, or updating plus retry/progress
  information. Inputs select an allowlisted environment, not table names, AWS operations,
  or arbitrary expressions. View/date selection uses the returned hourly dataset. This writes only the admin cache.

On opening or navigating, request the visible cards/charts first. A fresh cache
hit goes straight to viewing; missing/stale data triggers the ensure call. The
initial uncached flow uses the requested states:

1. **Waiting for rollup mutex** — another calculation owns the lease; retry with
   a short server-directed delay rather than holding an HTTP request open.
2. **Updating dashboard data** — calculate or resume the needed rollup and persist
   the result. Keep any previously complete data visible with its timestamp.
3. **Viewing** — display the complete result and its freshness.

The mutex protects calculation, not an entire viewing session or ordinary cache
reads. One active operator is the expected case; handle overlapping tabs/retries
without building a multi-user job system. A cache hit skips the first two states.

The hourly payload preloads data for adjacent dates/weeks and alternate views
without more API calls. Calculate the selected charts and averages locally;
deduplicate frontend requests and keep one ensure request in flight. Do not scan
for every chart or eagerly materialize every possible date range.

While the tab is visible, recheck the current view approximately every 60 seconds
and ensure only expired/missing dependencies. Pause refresh/preload work when
hidden and recheck on return. Manual Refresh follows the same freshness rules.
Show separate as-of/error states for events and DLQ health; failures are never
rendered as zero. Failed updates remain retryable, not an endless spinner.

## 3. Persistent rollups, mutex, and queue cache

Create one dedicated table, provisionally `flat-girl-admin-cache`. Persist source
hourly aggregates, DLQ snapshots, and mutex/progress
records there. This is the only DynamoDB table the admin runtime can write.
Cache correctness and reuse must survive cold starts, deployments, and new tabs;
warm-Lambda memory is not the cache or lock authority.

Key source aggregates by environment, generation, UTC date, and hash prefix, with explicit
schema version and freshness in the manifest. Derive chart ranges locally using
America/Chicago; no per-view source scan or duplicate cache table is necessary. Track source generation, covered range, calculation time,
and freshness deadline. Results from different source generations must not be
mixed into a total/rate. Use UTC hour identities with Chicago display/grouping so
repeated local hours cannot collide. Split each UTC day into 256 fingerprint-prefix
chunks (plus an unidentified/lead chunk) to bound per-item growth.

Use a short expiring global rollup lease in the cache table, acquired with a
conditional write. Give each calculation an owner token; condition renewal,
checkpoint, publication, and release on current ownership and an unexpired lease.
Only one rollup may advance at a time. A crashed invocation or closed tab must not
leave a permanent lock. Takeover uses explicit lease timestamps, not eventual
DynamoDB TTL deletion. An expired owner cannot publish over a newer result;
enforce ownership checks atomically with publication. The browser never owns the
lock directly or holds it while idle. Use TTL only to clean up disposable cache/
abandoned progress records, not to decide freshness or lock ownership.

Fresh hourly result: return it. Missing derived chart result with fresh hourly
data: calculate it in the browser without another API call or event-table read. Missing or
stale underlying data: scan once and persist reusable hourly counts for the
available history, then satisfy the visible view. The same fetched dataset already supplies
adjacent dates, weekly views, and all-time charts without extra network preloads. Start with a
60-second freshness window for live source data and DLQ snapshots, enforced on
demand only; derived results are valid only against their source generation.
Do not freeze past days permanently: delayed archival can change old buckets.

The existing source tables are keyed by event ID, not time. A date filter cannot
make a source scan read just that day, and a timestamp watermark would miss late
records. A necessary source refresh therefore uses a bounded, paginated full
scan and rebuilds reusable hourly aggregates; subsequent view changes use the
cache. Do not add source indexes, streams, or worker writes in this rollout.

Scan pages using `LastEvaluatedKey`, projecting event ID, event name, event time,
environment, client IP, and user-agent. Never request email, email hashes, or click
identifiers. Use IP/user-agent only in memory to compute HMAC-SHA256 fingerprints
with a random 32-byte secret for each generation. Store fingerprints and visited
hours in cache chunks so distinct unions can span pages/days; keep the secret
only in resumable job state and delete it on completion. Return only aggregates,
never raw identifiers, fingerprints, or the secret. Schema 2 forces old caches to
rebuild. Projection/filtering do not remove full-table scan read costs.

Bound each ensure invocation below the API timeout. If more pages remain, persist
the cursor and accumulated counts together as an idempotent checkpoint in the
cache table and return updating; the frontend makes the next ensure call. A retry
must not apply a page twice. Resume the existing generation rather than starting
another scan. Publish the new generation only when all pages complete; until then
keep the previous complete generation available. On failure, retain that result
as stale or report unavailable if none exists. Scans during concurrent writes are
not point-in-time snapshots; subsequent refreshes reconcile newly archived rows.

Treat DLQ health as another cached dashboard dependency. When visible and missing/
stale, ensure reads SQS attributes once and persists the snapshot alongside the
rollups. Cache reads, view changes, and polling do not independently call SQS.
Check visible, in-flight, and delayed counts without receiving messages. Display
“Empty — approximate” only when all three were successfully read as zero,
“Needs attention” for nonzero counts, and stale/unavailable on refresh failure,
with the last successful check timestamp. No message inspection, purge, or redrive.
Queue failure must not prevent publishing valid event aggregates, or vice versa.

## 4. Security and independent hosting

Protect the dashboard and its assets with HTTPS Basic Auth at CloudFront's
viewer-request stage, before cached content is served. Use a dedicated admin
auth handler, realm, and SSM verifier parameter, independent of beta's password
and deployed edge handlers. Reuse the existing digest/constant-time comparison
pattern without attaching tracking behavior to admin. Prompt for a strong unique
admin username/password privately through CLI setup/rotation tooling.

The browser's native Basic Auth prompt establishes credentials for this origin.
Same-origin `/api/*` fetches use `credentials: 'same-origin'`; browser-managed HTTP
authentication supplies the Authorization header. Frontend JavaScript does not
read the password or issue/store an API token. Never put credentials in generated
assets, URLs, local/session storage, logs, or Git. Basic Auth has no reliable
application-controlled logout; do not present a misleading Lock button.

Apply the admin viewer authentication to both static and API behaviors. Strip
Authorization before forwarding static requests to S3, but preserve it for the
API. The API independently validates the same credential before any cache/data
access, using constant-time comparison and a short-lived server-side verifier
cache. Direct API-origin requests therefore cannot bypass authentication.
Invalid credentials get 401; unavailable auth configuration fails closed.
Require JSON and validate same-origin browser requests for the ensure POST;
do not enable cross-origin rollup execution using ambient Basic Auth credentials.
Document the bounded verifier-cache delay on rotation and test browser behavior
when previously accepted credentials expire. No token-issuance endpoint, session
store, JWT dependency, or second credential lifecycle is needed for this scope.

Create a dedicated admin CDK stack: private S3/OAC hosting, CloudFront, its own
certificate, admin DNS records, admin-only Lambda@Edge auth, HTTP API, metrics
Lambda, the admin cache table, and logs. Route `/api/*`
to the new API and static paths to S3. Forward Authorization explicitly, disable
CloudFront caching for API responses, and return `Cache-Control: no-store`.
Browser requests remain same-origin; no changes to public signup CORS are needed.

Add dedicated edge/runtime/publisher roles through the existing access infrastructure.
The edge role may read only the admin auth parameter and write its execution logs.
Restrict runtime access to the two known event tables, approved event attributes,
the admin cache table, the two DLQs' attributes, its own auth parameter, and its
logs. Source tables are strictly read-only with approved projected attributes;
the cache table alone allows item reads/writes, conditional updates, and the
transactions needed for lease/checkpoint/publication integrity. Validate IAM
attribute constraints as well as application projections. Grant no writes to
source tables, table-management permissions, queue receive/delete/purge/send
permissions, or provider credential access. Routine execution-log writes are the
only non-cache writes; deployment and credential rotation use separate operator
roles. The frontend receives API access, never AWS credentials.

Do not modify existing website/API DNS records, shared certificates, CloudFront
distributions, Lambda@Edge associations, signup handlers, queues, or event tables.
Use existing resource names/ARNs as read targets without changing their owning
stacks or adding grants through mutable imports. Add admin permissions without
altering existing runtime permissions. Deploy explicit admin/access targets;
never a blanket CDK deployment. Existing pending migrations are out of scope.

## 5. Implementation, checks, and rollout

Estimated hands-on work: 4–6 hours for implementation, tests, and deployment
tooling; AWS propagation and live verification are additional.

1. Read-only preflight: confirm live event tables/DLQs, approximate table sizes,
   current infrastructure, and historical coverage using projected metadata.
   Establish scan limits before building around them. Do not export personal data.
2. Implement cache-read/ensure/auth code, the persistent cache/mutex, and the
   Tailwind `admin/` frontend with local fixture responses. Add admin stack/config,
   scoped access, and independent commands for
   credential setup, build, publish, verify, and rollback. Keep public-site publishing
   paths unchanged. Document operations in `cloud/ADMIN.md`.
3. Verify pagination, count/rate calculations, Chicago day/week boundaries,
   zero/partial periods, environment isolation, cache reuse after cold starts,
   lock contention/expiry/crash recovery, fenced publication, checkpoint retries,
   scan failures, source-generation consistency, and cached DLQ freshness. Check
   demand/preload ordering, hidden-tab behavior, all three UI states,
   authentication/rotation, and payload privacy. Verify IAM permits writes only
   to the admin cache table (plus execution logs). Run frontend
   typecheck/static build and focused browser checks. Run existing infrastructure
   checks and relevant deployment-tool regressions.
4. Review synthesized templates and live changesets. Require no updates or
   replacements to existing serving/data resources. Apply only additive access
   permissions and the new admin resources; publish admin assets independently.
   Verify correct, incorrect, and missing credentials through CloudFront and at
   the API origin, including after authorized requests populate static/data caches.
   Verify browser fetches reuse HTTP authentication without exposing credentials
   to JavaScript, and confirm beta's credentials do not unlock admin.
5. Verify public website/API availability before, during, and after rollout using
   non-mutating checks; do not create synthetic production signups. Compare admin
   aggregates with an independent projected read, allowing for incoming events.
   Verify private bucket access and independent admin rollback. Record evidence
   and any limits; do not claim an absolute availability guarantee from spot checks.

Acceptance: an authorized operator can immediately find recorded signup totals,
compare traffic/Leads/rates within and across days/weeks, and see current DLQ
health in a standard Tailwind dashboard. Visible data is fetched or calculated
on demand, persistent caches survive new sessions, and only one rollup advances
at a time. Data freshness and coverage are explicit. Unauthorized callers cannot
obtain metrics or start rollups; the runtime can mutate only its cache and logs.
The frontend is static, and rollout requires no interruption or
deployment of `flatgirl.net` or `api.flatgirl.net`.

References used in planning:

- [DynamoDB scan pagination, projection, and capacity](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html)
- [SQS queue attribute semantics and eventual consistency](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_GetQueueAttributes.html)
- [CloudFront Authorization forwarding](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html)
- [DynamoDB expressions and conditional writes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.html)
- [DynamoDB TTL is asynchronous cleanup](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
- [Tailwind framework integration guides](https://tailwindcss.com/docs/installation/framework-guides)

## Implementation evidence — November 8, 2026

- Static Nuxt/Tailwind build, frontend typecheck, three time/rate unit tests, four
  Chrome browser checks, 44 infrastructure/backend tests, and 39 Python tooling
  tests pass. Browser checks include phone/desktop layout, state transitions,
  refresh failure, cached navigation, and native same-origin Basic Auth reuse.
- The six existing serving/data templates are byte-for-byte equivalent as JSON
  to the pre-implementation synth baseline. Admin is an independent stack;
  access changes add its dedicated roles and provisioning rights.
- Read-only AWS preflight: production table ACTIVE, approximately 1,122 items /
  581,752 bytes; beta ACTIVE, approximately 6 items / 2,136 bytes. Both DLQs
  reported zero visible/in-flight/delayed messages. These are a point-in-time
  operational check, not a continuing emptiness guarantee.
- Independent projected source read: production 1,084 Views / 48 Leads; beta
  5 Views / 1 Lead at 20:38 UTC November 8. Counts can change as events arrive.
- Admin release `20261108T203902Z-9fc10a932450` is published; only the admin
  distribution was invalidated. Private archive download/restoration and a
  rollback dry run passed for all 15 artifact files.
- The user explicitly approved the reviewed IAM update; `FlatGirlAccess` and
  the isolated `FlatGirlAdmin` stack are deployed. No existing site/signup stack
  was deployed. The admin password has been set privately; no minimum length
  is enforced beyond nonempty input and confirmation.
- The lock expressions alias DynamoDB's reserved `owner` name, with a regression
  assertion. The fix was deployed before publishing the frontend.
- Authenticated byte verification, API-origin protection, and live rollups passed
  at 2:58 PM CST November 8 via `make admin-verify PROFILE=flat-girl-admin ROLLUPS=1`.
  Production: 1,126 Views, 48 Leads, 50 populated hourly buckets. Beta: 5 Views,
  1 Lead, 5 populated hourly buckets. Both DLQs reported zero visible, in-flight,
  and delayed messages. Hourly aggregates reconcile with their returned totals.
  Initial receipt: `.deploy/admin/verification-before-unique.json`; credentials were entered privately.
- Existing live beta/production site and signup templates remain unchanged.
  Availability probes observed HTTP 200 for the public site and HTTP 204 for
  signup API preflight; no interruption was observed. These checks are sampled,
  not a guarantee of continuous availability. No signup or source-data write
  was triggered by authenticated verification.
- Deployment and verification are complete. Changes remain in the local working
  tree; no commit or push was requested or performed.

## Unique-view and launch-cutoff update (November 8, 2026)

Admin IAM/Lambda updates and Sarah-icon frontend release
`20261108T211632Z-7b3b5c5b2789` are deployed and authenticated verification passed
at 3:18 PM CST November 8. Production starts at 3 PM
Chicago on November 7, with no special partial-hour handling. Independent projected
read at 21:06 UTC November 8 found 887 total views, 458 estimated unique views,
47 leads, and no views missing identity metadata after the cutoff. Beta had 5
views, 3 estimated uniques, and 1 lead. Source records were not modified.

Local checks: 47 infrastructure/backend tests, 39 Python tooling tests, 4 metric
unit tests, and 4 browser tests passed; Nuxt typecheck and static build passed.
The reviewed IAM update adds only IP/user-agent projection reads to the admin
role; the admin stack diff changes only metrics Lambda code. Post-update checks
confirmed unchanged beta/production site/signup templates, public-site HTTP 200,
signup preflight HTTP 204, and admin page/API HTTP 401 without credentials.
Sarah's existing icon replaces the header badge and supplies the favicon.

The first Sarah-icon verification failed because `/favicon.ico` was outside the
admin edge's root-path allowlist, producing HTTP 404. The corrected release bundles
the favicon under `/_nuxt/`, covered by existing authenticated asset routing. No
edge or public-site infrastructure change is needed. A browser regression check
now passes the generated favicon URL through the real edge handler, and verifies
the asset loads. Verification errors now identify the failing asset and distinguish
HTTP status from checksum mismatch. Authenticated verification passed after this fix.

Final live receipt: `.deploy/admin/verification.json`, release
`20261108T211632Z-7b3b5c5b2789`. Published assets, authentication, direct API-origin
protection, and both environment rollups passed. Production: 920 total views,
460 estimated unique views, 48 leads, 25 populated hourly buckets, and coverage
starting `2026-11-07T21:00:00Z` (3 PM Chicago). Beta: 5 total views, 3 estimated
uniques, and 1 lead. Neither environment had views missing identity metadata;
both DLQs had zero visible, in-flight, and delayed messages. Counts increased
since the earlier independent read as new events arrived. No fake signups were
submitted, and no source-data writes were performed. Test/demo records exist
only in local fixtures; live verification writes only the admin aggregate cache.
Deployment and verification are complete.

## Incremental refresh correction — November 8, 2026 (deployed)

The user's immutable-history requirement supersedes section 3's full-scan,
late-archival reconciliation, per-generation secret, and no-index decisions.
The previous 60-second expiry rebuilt all source history and exposed every scan
page as another dashboard update section.

Schema 3 now retains sealed hourly chunks and refreshes from the last published
open UTC hour through the refresh start time. A rollover finalizes that previously
partial hour once and catches up any missed hours. A projected `environment-time`
GSI on each existing event table makes this a true bounded Query, not a filtered
Scan. The index uses existing attributes, so source event writes need no changes.
The two additive source indexes are the intended exception to section 4's
original prohibition on event-table infrastructure changes.

History and manifests have no TTL. Disposable live snapshots retain seven-day
TTL; their expiration triggers only live-interval recovery. Durable jobs resume
instead of expiring, and revisions hide staged historical chunks until publication.
A private archive-level HMAC secret preserves cross-refresh distinct unions and
is stripped from API responses along with all fingerprints. Previously sealed
source periods are intentionally never revisited, including for delayed archival.

Validation: 53 backend/infrastructure tests, TypeScript checking, and example/live
configuration synthesis pass. Regression coverage includes a one-hour absence,
same-hour replacement, eight-day absence with expired live cache, cross-refresh
visitor deduplication, hidden staged history, lost checkpoint replies, and resumed
snapshots older than one hour. Frontend behavior is unchanged. See cloud/ADMIN.md
for deployment order and the one-time schema 3 cache initialization.

Deployment completed November 8, 2026. The user explicitly approved the two time
indexes, scoped read-permission change, and metrics backend update. Both indexes
are ACTIVE. Read-only verification at 9:07 PM CST confirmed exact deployed source,
policy, and resource-template matches for the four approved stacks, plus public
HTTP 200, signup preflight HTTP 204, and admin API HTTP 401 without credentials.
Receipts: `.deploy/admin/incremental-indexes.json` and
`.deploy/admin/incremental-verification-first.json`. The local rollup verifier was
updated for schema 3; all seven admin tooling tests pass. Initial live cache reads
still showed schema 2 pending the next authenticated refresh; authenticated
incremental refresh is not claimed by these deployment checks.
