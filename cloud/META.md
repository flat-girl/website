# Meta Conversions API operations

**Beta and production are deployed. November 6 production logs confirm Meta accepted ViewContent and Lead, but edge enqueue failures dropped some views. The local delivery fixes in section 5 still need deployment.**

Both events use SQS. Edge handling captures attribution and queues ViewContent;
signup queues Lead after an existing successful Brevo create/list write. A worker
stores each event in DynamoDB and sends it to Meta. Queue/storage/Meta failures
do not change a successful signup response.

| Setting | Beta | Production |
| --- | --- | --- |
| Dataset/token | Dedicated beta credentials | Separate production credentials |
| Delivery | Normal events to beta dataset | Normal events to production dataset |
| Event records | `flat-girl-beta-events` | `flat-girl-production-events` |
| Graph API | `v26.0` | `v26.0` |
| Attribution cookie | `_fbc_beta` | `_fbc` |
| Queue / worker | `flat-girl-beta-meta` / `flat-girl-beta-meta-worker` | `flat-girl-production-meta` / `flat-girl-production-meta-worker` |

`Sec-GPC: 1` prevents ViewContent enqueue; it does not suppress Lead under the
requested policy. The edge captures attribution immediately and enqueues without reading SSM settings. Privacy wording and
applicability remain a release review item; signup is not treated as blanket
permission to track other visits.

## 1. Review infrastructure and enter credentials

Use the existing access administrator and operator profiles. No live changes have
been made by the implementation session.

```sh
make cloud-diff PROFILE=default STACK=access
make cloud-deploy PROFILE=default STACK=access BOOTSTRAP=1
make meta-secrets PROFILE=flat-girl SITE_ENV=beta
make meta-secrets PROFILE=flat-girl SITE_ENV=production
```

Each secret command privately prompts for that environment's dataset ID and token,
then stores JSON in the SSM SecureString
`/flat-girl/meta/{beta|production}/credentials`. It rejects shared dataset IDs or
tokens between the two environments. Nothing private goes into argv or Git.
The existing AWS helper uses a temporary mode-600 CLI input file and removes it.
Do not run shell tracing or AWS debug logging when entering credentials.

Only the worker role reads credentials. Signup reads nonsecret settings; the edge
only sends to its own queue and has no SSM access. Publishers cannot read Meta parameters. Access changes
include edge replication/version permissions, the Lambda replication/logger
service-linked roles, SQS and worker lifecycle permissions. CDK may split the
execution policy into an inline policy and an attached managed policy to stay
within policy-size limits; both are owned by the administrator-managed access stack.

Configure each environment with its defaults:

```sh
make meta-config PROFILE=flat-girl SITE_ENV=beta
make meta-config PROFILE=flat-girl SITE_ENV=production
```

These commands enable Meta delivery for ViewContent and Lead, select normal
delivery to each environment’s dataset, and pin Graph API **v26.0**. No mode or
version variable is needed. The pinned version matches
[Meta's maintained Business SDK](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/api.js).
The application still uses direct HTTPS calls, not that SDK.

Settings live in `/flat-girl/meta/{environment}/settings` and refresh within
60 seconds in signup/worker runtimes. Configuring an already-deployed environment changes its behavior;
on the initial rollout, events begin after the new code is deployed.

## 2. One-off manual regression check against Meta

Run this locally once during setup, or manually after a relevant delivery change.
It uses the shared Lambda payload/delivery helper with a local transport wrapper
that adds `test_event_code`. It bypasses Lambda and SQS, never runs automatically,
and does not store test codes in runtime settings. It does not write DynamoDB records.

Keep the selected dataset's **Events Manager → Test Events** page open:

```sh
make meta-test PROFILE=flat-girl SITE_ENV=beta EVENT=ViewContent
make meta-test PROFILE=flat-girl SITE_ENV=beta EVENT=Lead
```

The regression harness uses `TEST83329` for beta or `TEST72924` for production,
without changing runtime settings. It prompts privately for your actual matching
data; the Lead check requires an operator-controlled email. Both events require your browser
User-Agent; ViewContent also requires your actual client IP. No Brevo/Turnstile calls occur.
The script prints only safe event IDs, field names and delivery outcome.

Meta's supplied [Using the API guide](https://developers.facebook.com/documentation/ads-commerce/conversions-api/using-the-api#testEvents)
says events with `test_event_code` can still be used for targeting and ads
measurement. The separate beta dataset provides isolation; the test code does not.
Use beta for the manual regression check. Selecting production intentionally sends
the check to the production dataset.

Verify both events in Test Events. A successful POST proves payload/credential
acceptance, not browser cookies, deployed GPC behavior or advertising attribution.
The user confirmed Meta accepted the manual regression events on November 6,
2026. The user subsequently confirmed deployed beta records appear in both
DynamoDB and Meta. Production-specific checks remain below.

## 3. Deploy and verify beta

Deploy the table/queue/worker before associating the edge producer. Apply the
access-stack update first so the worker can write its own table:

```sh
make cloud-diff PROFILE=flat-girl STACK=signup-beta
make cloud-deploy PROFILE=flat-girl STACK=signup-beta
make cloud-diff PROFILE=flat-girl STACK=beta
make cloud-deploy PROFILE=flat-girl STACK=beta
```

Beta remains uncached and keeps its CloudFront Function for Basic Auth. Its
origin-response Lambda runs after authorization and receives `_fbc_beta`, the
viewer User-Agent/GPC/prefetch headers, and query strings. Production uses viewer
response so cache hits also generate events. There is no browser view request.

Commit reviewed source before using the existing clean-tree site publisher, then:

```sh
make site-build PROFILE=flat-girl-beta SITE_ENV=beta
make site-publish PROFILE=flat-girl-beta SITE_ENV=beta DRY_RUN=1
make site-publish PROFILE=flat-girl-beta SITE_ENV=beta
make site-verify PROFILE=flat-girl-beta SITE_ENV=beta
make meta-status PROFILE=flat-girl SITE_ENV=beta
```

Check these behaviors in the browser and the selected dataset’s Events Manager
Overview. Deployed beta and production events omit `test_event_code`:

1. A landing visit produces ViewContent, including with JavaScript disabled.
   A visit with `Sec-GPC: 1` produces none; a normal visit without `fbclid` can count.
2. A genuine ad-click landing sets the HttpOnly/Secure/Lax parent-domain cookie.
   A new click replaces it; the same click or a direct return preserves it.
   Inspect cookies privately; do not save full values in screenshots/logs.
3. Signup sends the cookie with `credentials: include`; a successful Brevo list
   write produces Lead, including when GPC is present. Invalid input, failed
   verification/provider calls and existing no-write branches do not enqueue Lead.
4. Beta uses only list 5 and the beta Meta dataset. A real signup may trigger the
   existing Brevo welcome email; a synthetic direct Meta test does not.
5. Measure cold/warm landing latency. Edge enqueue has a 3-second budget with one second reserved for returning the page;
   signup settings/enqueue have up to 1.5 seconds with response time reserved.
   Check safe failure logs if cold requests miss those deadlines. Verify both
   event types in the beta DynamoDB table; inspect identifiers privately.

## 4. Production rollout

Beta records are confirmed in DynamoDB and Meta. Run the commands below from the
repository root. The shared access-stack update used for beta also grants the
production roles their permissions; it does not need repeating for an unchanged
access template. If that template has changed since beta rollout, review/apply it first:

```sh
make cloud-diff PROFILE=default STACK=access
make cloud-deploy PROFILE=default STACK=access BOOTSTRAP=1
```

If the operator session has expired, renew its source-profile login:

```sh
aws login --profile flat-girl-human --region us-east-1
```

1. **Configure production's separate Meta dataset and token.** Skip the secret-entry
   command if the correct production credentials are already stored. The configuration
   command enables Meta delivery for both events with Graph API v26.0.

   ```sh
   make meta-secrets PROFILE=flat-girl SITE_ENV=production
   make meta-config PROFILE=flat-girl SITE_ENV=production
   ```

2. **Optionally verify production credentials with the manual regression harness.**
   Keep the production dataset's **Events Manager → Test Events** page open. These
   commands add `TEST72924`, bypass SQS/DynamoDB, and do not change runtime settings.
   Skip this step if production credentials have already passed the check.

   ```sh
   make meta-test PROFILE=flat-girl SITE_ENV=production EVENT=ViewContent
   make meta-test PROFILE=flat-girl SITE_ENV=production EVENT=Lead
   ```

3. **Deploy the production table, queue, worker and signup integration, then the site
   edge functions.** Review each diff before its deploy command. Finish the signup
   deployment before deploying the site, so its event queue is available. Allow
   the production CloudFront/Lambda@Edge deployment to complete before browser checks.

   ```sh
   make cloud-diff PROFILE=flat-girl STACK=signup-production
   make cloud-deploy PROFILE=flat-girl STACK=signup-production
   make signup-status PROFILE=flat-girl SITE_ENV=production
   make cloud-diff PROFILE=flat-girl STACK=production
   make cloud-deploy PROFILE=flat-girl STACK=production
   ```

4. **Build and publish the production frontend.** Commit the reviewed release
   changes first: the production build requires a clean committed source tree.
   `git status --short` should print nothing before the build. Review the publish
   dry run before running the actual publish command.

   ```sh
   git status --short
   make site-build PROFILE=flat-girl-production SITE_ENV=production
   make site-publish PROFILE=flat-girl-production SITE_ENV=production DRY_RUN=1
   make site-publish PROFILE=flat-girl-production SITE_ENV=production
   make site-verify PROFILE=flat-girl-production SITE_ENV=production
   ```

5. **Verify the deployed production pipeline.** Visit `https://flatgirl.net/`, then
   submit a controlled email eligible for addition to production Brevo list **4**.
   This real signup may trigger the existing Brevo welcome email. An already-listed
   address takes the no-write path and does not create a Lead.

   ```sh
   make meta-status PROFILE=flat-girl SITE_ENV=production
   aws dynamodb scan \
     --profile flat-girl \
     --region us-east-1 \
     --table-name flat-girl-production-events \
     --projection-expression 'event_id,event_name,event_time,dynamo_success,meta_success' \
     --limit 20 \
     --no-paginate \
     --query 'Items[].{Event:event_name.S,Time:event_time.N,ID:event_id.S,Dynamo:dynamo_success.BOOL,Meta:meta_success.BOOL}' \
     --output table
   ```

   The scan displays a sample of up to 20 records, not a chronological list.
   Check for ViewContent and Lead in the **production dataset's Overview** in
   Events Manager. Deployed events omit `test_event_code`, so they are not expected
   in Test Events. Queue counts should drain and the dead-letter alarm should remain clear.

Before calling production verified, check credentialed signup CORS, `_fbc` cookie
capture/reuse, GPC suppression of ViewContent, and cache hits/misses with separate
browser cookie jars. Production uses viewer-response tracking on cached HTML;
confirm attribution does not leak between visitors and canonical redirects/assets
still work. Record the production verification result here when complete.

## 5. Apply the November 6 delivery fixes to existing deployments

Read-only production inspection found nine edge failures before enqueue, including
one shortly before the phone signup. The old edge fetched SSM settings and loaded
AWS SDK clients inside a 500 ms request budget. This was an overly tight deadline,
not visitor/email deduplication. The failing requests cannot be reconstructed from
SQS because they never reached it.

The edge now handles cookies/GPC and makes one SQS call. It initializes the SQS
client during Lambda startup, uses 512 MB memory and a 3-second enqueue deadline,
and retains one second of the 5-second handler timeout for response handling.
Cold starts/network waits still add page latency; verify that latency after rollout.
Eligible `304` page revalidations count too. Restoring a browser tab without making
a server request cannot produce a server-side ViewContent event.
[AWS's current Lambda@Edge quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html#limits-lambda-at-edge)
allow the increased memory. No browser tracking request or new tracking SDK is added.

Runtime switches now control Meta delivery in the worker; the edge continues to
capture cookies and enqueue eligible views. `CAPTURE_ENABLED`/`--capture` has been
removed; old `captureEnabled` settings are ignored. Pausing worker delivery does
not stop archival of already queued events, and outstanding work can reach the DLQ.

The same update adds durable `dynamo_success`/`meta_success` checkpoints. Apply IAM
first for the worker's new GetItem/UpdateItem permissions, then beta, verify a fresh
visit/signup, and apply production. Existing credentials/settings remain valid.
No frontend rebuild or publication is required for this backend update.

```sh
make cloud-diff PROFILE=default STACK=access
make cloud-deploy PROFILE=default STACK=access BOOTSTRAP=1
make cloud-diff PROFILE=flat-girl STACK=signup-beta
make cloud-deploy PROFILE=flat-girl STACK=signup-beta
make cloud-diff PROFILE=flat-girl STACK=beta
make cloud-deploy PROFILE=flat-girl STACK=beta
make meta-status PROFILE=flat-girl SITE_ENV=beta
```

After beta verification:

```sh
make cloud-diff PROFILE=flat-girl STACK=signup-production
make cloud-deploy PROFILE=flat-girl STACK=signup-production
make cloud-diff PROFILE=flat-girl STACK=production
make cloud-deploy PROFILE=flat-girl STACK=production
make meta-status PROFILE=flat-girl SITE_ENV=production
```

Wait for CloudFront deployment to finish, reload the page on the phone, and make
one eligible signup. New ViewContent and Lead rows should show both flags true.
Use the scan in section 4 and the production dataset's Overview. If a view is
missing, inspect the named edge outcome in the execution region (the observed
production requests ran in `us-east-2` and `us-west-1`).

## Queue behavior and recovery

Each environment has an encrypted standard queue and encrypted DLQ. Messages
contain the Meta payload, original ID/time and environment. Lead messages also
include the validated, unhashed email in a separate envelope field for our records.
Only the event payload is sent to Meta; its email remains SHA-256 hashed. No
provider tokens, test code or delivery mode are queued. Treat both queues as
containing personal data. The worker stores/checks the DynamoDB record first, then sends unfinished Meta
delivery and persists its acknowledgment, within a 10-second deadline and a
15-second Lambda timeout. A storage failure prevents the Meta attempt.

Batch size is 1, visibility timeout 180 seconds, and five unsuccessful receives lead to the DLQ; one failed attempt does not dead-letter it.
Main-queue retention is four days; DLQ retention is seven days from the original
message timestamp. The worker refuses Meta delivery for events older than six
days, but can still archive them during recovery. A message is acknowledged only
after both storage and Meta delivery succeed; transient failures retry with the same event ID
and timestamp. Standard SQS can redeliver; this is not an exactly-once guarantee.
Meta's [batch request guidance](https://developers.facebook.com/documentation/ads-commerce/conversions-api/using-the-api#batch-requests)
says repeated `event_id` + `event_name` pairs are deduplicated, which is why retries preserve both.
There is no contact-level deduplication or additional Brevo lookup for tracking.

A queue-send failure is logged but cannot undo a successful Brevo write. An event
that never reached SQS cannot be recovered by the worker. Turning delivery off leaves queued messages failed; after retries they move to
the DLQ. Records already in SQS are still archived while Meta delivery is off.
Do not blindly redrive them after a configuration change.

`make meta-status` shows settings, main-queue counts and the DLQ alarm. Worker logs
are `/aws/lambda/flat-girl-{environment}-meta-worker`; signup logs retain their
existing name. Edge logs appear in execution regions, usually under
`/aws/lambda/us-east-1.flat-girl-{environment}-meta-edge`. Logs contain fixed outcomes,
not request bodies, IPs, emails, cookies or tokens. Worker outcomes distinguish
`dynamo_failed`, `meta_failed`, `checkpoint_failed`, `dynamo_succeeded`,
`meta_checkpointed` and `already_completed`; `view_delivered`/`lead_delivered`
mean Meta returned one accepted event. Edge outcomes distinguish
`edge_enqueue_failed`, `edge_payload_failed`, `edge_budget_exhausted`,
`view_queued` and `view_gpc_skipped`. The DLQ alarm has no notification
action configured; inspect it during rollout.

The operator has read-only queue diagnostics, not purge/redrive rights. For recovery,
inspect configuration and safe logs first. Any manual redrive needs separately
scoped access and review of event age/environment; never mint new timestamps
to make old events appear fresh.

## Durable event records

Each signup stack owns one on-demand DynamoDB table, keyed by `event_id`, with
AWS-managed encryption, point-in-time recovery, deletion protection, and retention
on stack removal/replacement. There is no TTL or automatic expiry. Only its worker
can insert records and update delivery status; the operator can read them. Edge/signup/publisher roles cannot
access the tables. The stack exposes `EventsTableName`.

| Stored fields | Meaning |
| --- | --- |
| `dynamo_success`, `meta_success`, `meta_delivered_at` | Stored record; confirmed Meta acceptance; acknowledgment time in Unix seconds |
| `schema_version`, `environment`, `event_id` | Schema version 1, beta/production, stable event identifier |
| `event_name`, `event_time` | ViewContent/Lead and original Unix timestamp in seconds |
| `action_source`, `event_source_url` | Website and canonical landing URL, without query/fragment |
| `email`, `email_sha256` | Lead's validated email as submitted (trimmed), plus the normalized hash sent to Meta |
| `client_ip_address`, `client_user_agent`, `fbc` | Available client IP, user agent and complete formatted click ID, unhashed |

Missing fields are omitted. We retain the requested identifiers in records, never
in logs. No provider credentials or arbitrary request headers are stored.

A [conditional insert](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html)
creates one record per event ID with `dynamo_success=true` and `meta_success=false`.
A strongly consistent read on retries reuses the row. After Meta accepts the event,
the worker sets `meta_success=true` and `meta_delivered_at`; it acknowledges SQS
only after that update succeeds. A completed row skips Meta entirely on redelivery.
Existing records are not rewritten and separate page requests always get separate IDs.

If Meta accepts a request but the response or completion update is lost, a retry
may send the same event again, with the same ID/time for Meta deduplication. This
is not an exactly-once delivery guarantee. Records written before this update lack
the new flags: absence means unknown, not failure. There is no automatic backfill
or replay of those historical rows. A row alone does not establish Meta acceptance;
`meta_success=true` does, but does not establish advertising attribution.

Counts cover the existing event rules: GPC-suppressed views are absent, failed or
no-write signup branches are absent, and a failed initial enqueue cannot be
reconstructed. These are event counts, not unique visitors or guaranteed attribution.

No dashboard, index, export job or DuckDB dependency is added. The flat schema can
support future queries from a private paginated scan or an
[S3 export](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/S3DataExport_Requesting.html).
PITR supports that future export path; export permissions/storage and a DuckDB
reader can be added when needed. The manual Meta regression harness bypasses
these records, so it cannot add synthetic rows.

## Recovery only

To pause Meta delivery during an incident, use this optional emergency command.
It leaves page serving, edge cookie capture and ViewContent enqueueing active:

```sh
make meta-config PROFILE=flat-girl SITE_ENV=production MODE=off
```

Allow up to 60 seconds for caches to expire. Signup and page serving remain active.
Explicit `VIEW_ENABLED=false` or `LEAD_ENABLED=false` overrides pause those Meta
sends. Outstanding messages remain retriable and can reach the DLQ. Stopping
edge capture/enqueue requires a reviewed edge-code/association deployment. Rerun
the normal `meta-config` command to restore delivery defaults.

Restore reviewed edge associations and signup code through the existing stack
workflow if needed; allow CloudFront replication time. Preserve replicated Lambda
versions until AWS allows deletion. Rolling back HTML alone does not undo edge
tracking. Queue/log resources are retained on updates/deletion; do not treat
backlogs or DLQs as disposable. Never publish or switch modes merely to clear them.
