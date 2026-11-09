# Admin dashboard

The deployed implementation serves a static Nuxt/Tailwind dashboard at
`admin.flatgirl.net`, backed by an independent read-only metrics service and one
writable cache table. No campaign end date, Brevo access, scheduler, or production
Nuxt server. The [implementation plan](../docs/admin-plan.md) defines measurement
semantics. Infrastructure and static publication completed November 8, 2026;
authenticated end-to-end verification passed at 2:58 PM CST that day.
The initial live check confirmed published bytes, authentication, direct-origin
protection, rollups in both environments, and empty DLQs. The unique-view/cutoff
update and Sarah icon were published in release `20261108T211632Z-7b3b5c5b2789`;
its authenticated verification passed at 3:18 PM CST November 8. Production
reported 460 estimated unique views, 920 total views, and 48 leads since launch.
Both DLQs were empty. Evidence is recorded in the plan.

## Local development and checks

```sh
npm ci --prefix admin
npm run dev --prefix admin
```

Open http://127.0.0.1:3010. Development uses clearly labeled generated demo data
and never calls AWS. Production static output calls the authenticated same-origin
API. Development routes are not a deployable backend and no demo data is embedded
in production metrics. SVG charts use Tailwind; no chart dependency was necessary.

```sh
npm run typecheck --prefix admin
npm test --prefix admin
npm run generate --prefix admin
npm run test:e2e --prefix admin
npm run check --prefix cloud/aws
UV_CACHE_DIR=/tmp/flat-girl-uv-cache uv run --locked --project tools python -m unittest discover -s tools/tests
```

Browser checks use installed Chrome and a local static server, with fixture API
responses. They include native browser Basic Auth reuse on a local authenticated
origin. They do not establish live CloudFront/IAM behavior.

## Data and permissions

`flat-girl-{production|beta}-events` supplies projected `event_id`, `event_name`,
`event_time`, `environment`, `client_ip_address`, and `client_user_agent`. Only Lead
and ViewContent records count; Meta delivery flags are irrelevant. No email,
email hash, click ID, or provider credential is read. IAM enforces this projection;
the admin runtime cannot write source tables.

Production includes events from **November 7, 2026, 3:00 PM America/Chicago**
(`2026-11-07T21:00:00Z`), including the entire 3–4 PM hour. Earlier Views and Leads
are ignored. Beta keeps its own full history. There is no end date.

Estimated unique views are the default; a toggle retains total recorded views.
Matching IP addresses and browser user-agents count once within each hour, day,
week, or all-time range. Range totals use distinct sets, never sums of hourly or
daily uniques. Shared network/browser combinations can merge people; changing
network/browser can split one person. Missing identity metadata is excluded from
uniques, retained in total views, and disclosed. This is not a matched conversion
funnel. The rate uses the selected view-counting basis.

The only writable table is `flat-girl-admin-cache` (plus execution-log writes).
Schema 3 stores immutable completed-hour counts and keyed fingerprints, a replaceable
current-hour snapshot, durable query progress, DLQ attributes, and one global
mutex. History is partitioned by environment/archive, UTC hour, and fingerprint
prefix. Raw IPs/user-agents are used only in Lambda memory. HMAC-SHA256 uses a
private random secret retained with the archive so visitors remain deduplicated
across refreshes. The API returns only numeric aggregates, never fingerprints or
the secret. Completed history, its manifest, and unfinished jobs do not expire;
seven-day TTL applies only to disposable live snapshots and DLQ results. Losing
an expired live snapshot does not discard historical rollups. Source records
remain intact. A schema change or missing historical cache requires a one-time
rebuild; ordinary refreshes never rebuild sealed history.

`GET /api/metrics?environment=production` reads complete persisted data. It does
not scan DynamoDB sources or call SQS. `POST /api/rollups/ensure` with
`{"environment":"production"}` advances only missing/stale dependencies; it
requires Basic Auth, JSON, and Origin `https://admin.flatgirl.net`. The browser
supplies Origin and reuses HTTP authentication. Never pass AWS resource names.

A source query page is limited to 50 items. Each invocation atomically commits
changed hour/hash chunks and the next cursor under a 45-second lease. API calls
have a bounded execution deadline; a crashed request recovers after lease expiry.
The same page cannot be counted twice following a lost transaction response.
Newly completed hours are staged under the next revision and remain invisible
until the manifest publishes. The previous complete result stays readable during
refresh. Jobs resume after long absences instead of restarting. The lease is
released between calls; no tab owns it while viewing.

Fresh source and queue results last 60 seconds. The frontend rechecks while
visible, pauses when hidden, and resumes on return. All chart ranges reuse the
aggregate payload. Source reads use the `environment-time` global secondary
index, starting at the last successfully refreshed open UTC hour and ending at
the refresh start time. Within an hour, only that hour is replaced. After rollover,
the previous open hour is finalized once; hours missed while the dashboard was
closed are collected in the same range. Previously sealed hours are never read
from the event tables or rewritten by ordinary refreshes. Unique day/week/all-time
unions still use cached fingerprints across the requested history.

This implements the requested immutable-history policy: records archived after
their hour has already been sealed will not revise that hour. The time index is
eventually consistent. A failed query preserves the previous result with its
as-of timestamp; it is not a zero-count result. Freshness is measured from query
start, so a resumed old snapshot cannot be reported as current.

## Read-only preflight

```sh
make admin-preflight PROFILE=flat-girl
```

This reads table status, approximate size/item counts, key schemas, and queue
attributes, saving a non-personal report to `.deploy/admin/preflight.json`.
DynamoDB size counters are approximate. Assess large scans before rollout;
50 items/page is deliberate to bound conditional transactions. The time index permits bounded source reads after the initial historical build.
Wait for both indexes to become ACTIVE before deploying the indexed reader.

## Incremental-refresh rollout (deployed November 8, 2026)

The November 8 incremental-refresh change replaces repeated full scans with
indexed time-range queries and durable completed-hour rollups. All 53 backend/infrastructure tests, TypeScript checking, and synthesis pass.
The live diff confirms exactly two additive event-table indexes, one admin read
policy change, and metrics Lambda code; no other resource changes. Review:
`.deploy/admin/incremental-review.json`. Both indexes are now ACTIVE; the approved
access and admin stack updates are deployed. Live verification at 9:07 PM CST
confirmed that all four stack resource templates, the read policy, and the Lambda
source match the reviewed changes. Public-site HTTP 200, signup preflight HTTP 204,
and unauthenticated admin API HTTP 401 passed. Receipt:
`.deploy/admin/incremental-verification-first.json`.

The initial verification still found schema 2 snapshots because an authenticated
refresh had not yet initialized schema 3. The first refresh performs that one-time
build. Signed-in refresh behavior has local regression coverage; deployment checks
alone do not establish live authenticated refresh success.

1. Review and deploy `signup-beta` and `signup-production`; the intended changes
   add only the `environment-time` index to each existing event table. It uses
   existing `environment` and `event_time` attributes and projects only event
   name, IP address, and user-agent (event ID is included automatically). No event
   rewrite or primary-key replacement is needed. Wait for both indexes to be ACTIVE.
2. Review `access`: replace the admin runtime's projected table Scan permission
   with projected Query permission on those two specific indexes. Deploy this
   immediately before `admin` to minimize the old reader's permission gap.
3. Deploy `admin`: only metrics Lambda code changes. No static frontend release
   is required. The first refresh initializes schema 3 once; subsequent refreshes
   query only the unfinished interval. Verify a second refresh and hour rollover.

Do not deploy unrelated pending changes in any stack. For rollback, restore the
previous projected Scan permission before restoring the schema 2 Lambda. Leave
the additive indexes in place; deleting an index is unnecessary for rollback.
Do not purge source records or historical cache as a recovery step.

## Infrastructure and credential setup

Use the established access administrator and operator profiles. Review these
explicit stacks only; do not deploy all stacks. Existing pending beta/production
edge migrations are unrelated and must not be included.

```sh
make cloud-diff PROFILE=default STACK=access
make cloud-deploy PROFILE=default STACK=access BOOTSTRAP=1
make admin-auth PROFILE=flat-girl
make cloud-diff PROFILE=flat-girl STACK=admin
make cloud-deploy PROFILE=flat-girl STACK=admin
```

The access update adds dedicated admin runtime, edge, and publisher roles plus
provisioning permissions. Review the live diff for unrelated pending changes
before executing it. The admin stack owns its bucket, distribution, certificate,
DNS records, HTTP API, metrics Lambda, cache table, and separate Lambda@Edge auth.
The six existing serving/data stack templates must remain unchanged by this work.

`admin-auth` privately prompts for a username and nonempty password, then
asks you to confirm the password. There is no minimum length. Only the SHA-256 authorization verifier is stored in
`/flat-girl/admin/authorization-sha256`; beta credentials are untouched. Do not
paste the password into chat, command arguments, or source files. Both edge and
API verifiers cache for up to 60 seconds. Missing credentials/config fail closed.

Configure the publisher profile once, using the project's actual region/source
profile conventions:

```ini
[profile flat-girl-admin]
role_arn = arn:aws:iam::<account-id>:role/flat-girl-admin-publisher
source_profile = flat-girl-human
region = us-east-1
```

This role can publish only admin objects and invalidate admin-tagged
distributions. It has no provider credentials, table writes, or public-site
publication privileges. The operator can also assume this publisher role.

## Build, publish, verify, and rollback

```sh
make admin-build
make admin-publish PROFILE=flat-girl-admin DRY_RUN=1
make admin-publish PROFILE=flat-girl-admin
make admin-verify PROFILE=flat-girl-admin
```

Build records the exact source revision and dirty-state flag and saves a
checksummed release under `.deploy/releases/admin/`. Publication does not rebuild:
it uploads assets before HTML, retains old assets, archives the exact release
privately in the admin bucket, and invalidates only the admin distribution.
The edge refuses `/releases/*`, including for authenticated viewers. The origin
bucket blocks public access and is served through OAC.

Verification prompts privately for admin credentials and checks published bytes,
rejection of incorrect/missing credentials, authenticated metrics reads, direct
API-origin rejection, and blocked archive paths. It never submits a signup or
forces a rollup by default. Use `make admin-verify PROFILE=flat-girl-admin ROLLUPS=1`
to also exercise on-demand rollups in both environments, validate raw/unique totals and the launch cutoff,
and confirm queue reads. This writes only the aggregate cache. The command stores
a credential-free receipt at `.deploy/admin/verification.json`. Compare counts
with a projected operator read, allowing for incoming events. Check existing
public website/API availability before, during, and after rollout.

Restore an archived release without rebuilding or touching public resources:

```sh
make admin-rollback PROFILE=flat-girl-admin RELEASE=<release-id> DRY_RUN=1
make admin-rollback PROFILE=flat-girl-admin RELEASE=<release-id>
make admin-verify PROFILE=flat-girl-admin RELEASE=<release-id>
```

Frontend rollback does not roll back Lambda code or IAM. Infrastructure recovery
uses the previous reviewed admin template. Cache data is disposable; source data
must never be purged as a dashboard recovery action. Rotate credentials with
`make admin-auth PROFILE=flat-girl`, then verify both old rejection and new access
after 60 seconds. Browser Basic Auth has no reliable application logout button.
