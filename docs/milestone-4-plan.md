# Milestone 4 — Meta Conversions API

**Approved for implementation — November 5, 2026. Local implementation and checks complete; deployment remains operator-run.**

Milestones 1–3 are complete. Add server-side Meta measurement to the existing
static site and signup Lambda. **Target: about one hour for core implementation
and local checks**, with credentials ready; account setup, AWS propagation and
live verification are separate. Keep this small for the site's low traffic.

## 1. Agreed behavior

1. **ViewContent:** send from the server when CloudFront serves the landing page,
   including cache hits. Skip when `Sec-GPC: 1`. No Nuxt tracking initializer,
   browser tracking fetch, `/events/view-content` route, or Meta Pixel.
2. **Lead:** send from the signup endpoint after a valid email passes the existing
   verification and Brevo reports successful contact/list registration. Take
   Brevo's success at face value; no additional membership verification.
3. **Attribution:** set `_fbc` immediately on an eligible landing response with
   `fbclid`. Preserve it unless a different valid click ID arrives.
4. **GPC:** suppress ViewContent, but not Lead under the requested conversion policy.
   Signup never enables or backfills page-view tracking. Target market: US only.
5. **Beta:** send normal events to the dedicated beta Meta dataset using its
   separate API token. Production uses its own dataset/token. Only the one-off
   manual regression harness adds a test code: beta `TEST83329`, production `TEST72924`.

Use SQS for both Meta events, as approved during implementation: one standard
queue, worker and dead-letter queue per environment. The November 6 addition
also retains first-party event records in DynamoDB, including requested matching
identifiers. No session store, cross-request signup deduplication or tracking framework.

## 2. Architecture and files

| Area | Change |
| --- | --- |
| `cloud/aws/lib/stacks.ts`, `routes.ts` | Production Lambda@Edge routing and attribution/ViewContent enqueue; beta uses uncached origin response |
| `cloud/aws/lambda/signup.cjs` | Send Lead after the existing successful Brevo registration operation |
| New small `cloud/aws/lambda/meta.cjs` helper | Build payloads, hash email and enqueue; worker POSTs directly to Meta |
| `cloud/aws/lib/signup-stack.ts`, `access.ts` | Credentialed CORS, SQS/worker/DynamoDB resources, scoped access and edge versions/trust |
| `web/app/components/SignupForm.vue` | Use `credentials: "include"` on the existing signup fetch; keep its body unchanged |

**AWS constraint:** CloudFront Functions cannot make outgoing Meta requests, and
AWS does not allow them alongside Lambda@Edge viewer handlers on the same cache
behavior. Use a Lambda@Edge viewer-response handler and port the existing production
viewer-request routing on that behavior. An origin-only trigger would miss cache
hits. This replaces the original CloudFront-Function-only implementation detail.
[AWS function restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html),
[association restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-function-restrictions-all.html).

Keep beta's current CloudFront Function, Basic Auth and noindex. Its cache is
already disabled, so use an origin-response Lambda for beta tracking; AWS permits
that combination. Forward only the required attribution/query/GPC/User-Agent
fields to that handler. Production uses viewer response so cache hits still count.

Lambda@Edge uses a published numbered version in `us-east-1`, x86_64, a supported
runtime, and a role trusted by Lambda and Lambda@Edge. It does not support custom
environment variables: embed only nonsecret configuration paths and queue URL,
then load settings from SSM. The worker alone loads Meta credentials. Reuse inline source assembly and the current 51,200-byte template check;
do not introduce asset publishing or CDK bootstrap implicitly.
[AWS Lambda@Edge restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html).

## 3. Attribution and ViewContent

On a successful canonical landing-page GET, read a single valid `fbclid` and create:

```text
_fbc=fb.1.<creation-time-in-milliseconds>.<fbclid>
Domain=flatgirl.net; Path=/; Max-Age=7776000;
Expires=<90 days after creation>; Secure; HttpOnly; SameSite=Lax
```

Reject malformed, oversized or cookie-unsafe values. Preserve an existing valid
cookie and its expiry when no different click ID arrives. Keep query parameters
through existing canonical redirects; capture on the final landing response.
Do not capture on assets, HEAD, redirects, errors or unauthorized responses.

Set the cookie through Lambda@Edge's `response.headers['set-cookie']` array.
For a first visit, use that same newly created value in ViewContent: it will not
yet exist in the incoming request's cookies. On later visits, read `_fbc` from the
request. Send an eligible event even without attribution.

Before sending ViewContent, check the original request's `Sec-GPC` header. A value
of `1` skips the event and its Meta credential lookup. Immediate cookie capture
remains the requested behavior; the view gate does not also gate Lead.

Keep cookies/query strings out of the HTML cache key and S3 forwarding. Apply
viewer-specific cookie changes after cache lookup, never in the cached object.
Keep the shared image distribution unchanged.

A view means **CloudFront served the landing response**, not proof of rendering.
It works without JavaScript; a browser-cache restoration that never reaches
CloudFront cannot create an event. Skip explicit prefetches and non-page requests;
no elaborate bot-classification system is needed.

## 4. Meta payload and delivery

Send one event per Graph API request to:

```text
POST https://graph.facebook.com/<PINNED_VERSION>/<DATASET_ID>/events
Authorization: Bearer <CAPI_TOKEN>
Content-Type: application/json
```

| Parameter | ViewContent | Lead |
| --- | --- | --- |
| `event_name` | `ViewContent` | `Lead` |
| `action_source` | `website` | `website` |
| `event_time` | Current server Unix seconds | Unix seconds at Brevo success |
| `event_id` | `view:<environment>:<CloudFront-request-id>` | `lead:<UUID>` generated once for this send |
| `event_source_url` | Configured canonical landing URL | Same environment's landing URL |
| `user_data.fbc` | Existing/new valid cookie, unhashed | Valid signup request cookie, unhashed |
| `user_data.client_ip_address` | CloudFront `request.clientIp`, unhashed | API Gateway `requestContext.http.sourceIp`, unhashed |
| `user_data.client_user_agent` | Incoming User-Agent, unhashed | Incoming User-Agent, unhashed |
| `user_data.em` | Omit | Array containing SHA-256 of trimmed, lowercased email |

Omit unavailable optional matching fields; do not fabricate `_fbp`, click IDs, IPs or emails.
Meta requires a valid User-Agent for website events. If it is absent, skip tracking
while still returning the page or successful signup response.
Use milliseconds only for `fbc`; event timestamps use seconds. Strip query strings
and fragments from the source URL. Email normalization must not strip plus tags
or dots, or alter existing Brevo behavior.

The worker sends with a short timeout, checks HTTP status and Meta's
`events_received`, and optionally retries a transient failure once within budget.
Freeze the payload first: any delivery retry keeps the same ID and timestamp.
Separate signup submissions can produce separate Leads; there is no uniqueness
check across requests.

Edge and signup await only SQS acceptance: 500 ms total for edge config/enqueue,
up to 1.5 seconds for signup config/enqueue, with Lambda response time reserved.
Queue failure must not turn an otherwise successful page/signup into an error.
No background promises after returning. Only the worker can read the Meta token;
producers read nonsecret settings and send to their environment's queue.

Queue messages contain the prepared Meta event (email already hashed), original
ID/time and environment. Lead envelopes separately include the validated unhashed
email for DynamoDB; this field never goes into the Meta POST. The worker rejects
cross-environment messages. Test codes and
delivery modes are absent from the queue; manual regression checks bypass SQS.
Standard SQS can redeliver: reuse the existing event ID and timestamp on every attempt.

Use encrypted queues, batch size 1, a 180-second visibility timeout, five receives
before dead-lettering, four-day source retention and seven-day DLQ retention.
The worker has a 10-second operation deadline/15-second Lambda timeout and refuses
Meta delivery for events over six days old; archival can still recover those rows.
Disabled or failed delivery remains retriable, then moves
to the DLQ; it is not silently acknowledged. There is no automatic DLQ redrive.

The enqueue path still adds bounded page latency. Edge platform failures can affect
availability. Measure cold/warm performance during live verification; do not promise
zero latency or exactly-once delivery. Brevo stays synchronous and unchanged.

### Durable records — November 6 addition

The same worker independently inserts an event record into its environment's
`flat-girl-{environment}-events` DynamoDB table and sends the event to Meta.
Acknowledge SQS only after both succeed. Use a conditional insert on `event_id`
so retries keep one original record; Meta retries keep the same ID/time too.
Archival still runs if Meta or its settings are unavailable. An event that never
reaches SQS is not recoverable through this worker.

Retain event name/ID/time, environment, canonical URL/action source, and available
email (unhashed for Lead), normalized email hash, IP, user agent and formatted
click ID. Never log these values or store credentials. Missing matching values
stay absent. GPC and existing eligibility checks remain upstream of both sinks.

Use an encrypted on-demand table per environment, PITR, deletion protection and
retention on stack deletion/replacement. No TTL. Only the worker gets `PutItem`;
operator read access supports inspection and a future private export. No UI,
DuckDB integration, indexes or export jobs in this change. Counts represent
eligible events, not unique visitors or confirmed Meta attribution.

## 5. Simple Lead flow

The signup endpoint is the conversion trigger; no separate browser event,
confirmation callback, contact-ID lookup, or reconciliation process is needed.

1. Keep existing email validation, honeypot, Origin and Turnstile checks.
2. Run the existing Brevo signup operation. On successful create/list addition
   (`201`/`204` in the current implementation), enqueue Lead. Do not read the contact
   again to prove the write or determine whether this was its first subscription.
3. On invalid input, failed verification or failed Brevo operation, send no Lead.
   Existing known suppression/no-write branches stay unchanged and send no Lead.
4. Catch enqueue failures separately and return the existing signup response.
   GPC alone does not suppress this Lead under the requested policy.

**No new Brevo API requests for tracking.** Retain the checks already used by
milestone 3 to preserve unsubscribe/suppression behavior; adding Meta does not
require redesigning them. Hook into their successful write result. Do not add
race handling, membership-transition proofs, deterministic contact-based IDs or
an exactly-once requirement. If Brevo accepts a repeated list operation, accept
that outcome without further investigation.

The frontend only changes to `credentials: "include"`. Configure API Gateway CORS
with the exact site origin, `allowCredentials: true`, POST/OPTIONS and content-type.
Read cookies from HTTP API v2 `event.cookies`. Production uses `api.flatgirl.net`;
beta retains `beta-api.flatgirl.net`. Keep the current signup request schema and
public response. Older cached forms remain valid but may omit optional attribution.

## 6. Configuration and beta

Keep the existing AWS/CDK/SSM conventions. Store dataset ID and CAPI token privately
in `/flat-girl/meta/{environment}/credentials` SecureStrings. Nonsecret runtime
settings use the corresponding `/settings` String parameters.
Use secure terminal entry, not tokens in command arguments, Git, public bundles
or CDK templates. Only the matching worker reads credentials; edge/signup read settings and enqueue.
Publishers cannot read either environment's parameters.

Normal setup selects delivery to each environment’s separate dataset, enables
both events and attribution, and pins Graph API **v26.0**. Neither deployed
environment includes `test_event_code`; only the manual regression harness adds it. Settings
refresh within 60 seconds. An emergency disable override is available for recovery,
not required during setup.

| Environment | Default | Optional verification |
| --- | --- | --- |
| Automated checks | Mock all providers | No network calls to Meta |
| Manual regression harness | Run locally once during setup | Explicit POST with test code to Meta Test Events |
| Beta | Normal delivery to dedicated dataset; Basic Auth unchanged | Inspect events in beta dataset Overview |
| Production | Normal delivery to production dataset | Inspect events in production dataset Overview |

The beta dataset and separate API token have been created. Use **`TEST83329`**
for beta and **`TEST72924`** for production only in the manual regression harness.
Never fall back from beta to production credentials. Dataset IDs and tokens
are entered privately during setup; test codes are not access credentials.

If beta tracking is explicitly enabled, use `_fbc_beta` with parent-domain scope
and read it only in beta; production reads only `_fbc`. Missing beta credentials
prevent delivery. Test signup can be enabled without migrating beta's edge path.

Privacy wording remains a live-enablement review item. The requested GPC split
and immediate capture are implementation policy, not a legal conclusion that an
email submission overrides every applicable sharing opt-out. Keep this review
separate from signup implementation; do not add a consent framework to this scope.

## 7. One-off manual regression check and automated tests

Run the live regression check locally once during setup, or manually after a
relevant delivery change. It is separate from Lambda/SQS and automated tests.

1. Open the selected dataset's **Events Manager → Test Events** and keep it open.
   Privately supply the dataset ID/token; use the pinned Graph API v26.0 and
   use `TEST83329` for beta or `TEST72924` for a production regression check.
2. Use the manual regression harness importing the same Meta helper as Lambda.
   Its local transport wrapper adds the test code without modifying runtime settings.
   Send ViewContent without `fbc`, then a synthetic Lead using an operator-owned
   email. Supply the real browser User-Agent for both and client IP for ViewContent.
   These test POSTs do not call Brevo or create real subscribers.
3. Send `{ "data": [event], "test_event_code": "TEST83329" }` for beta. Generate fresh IDs
   and current timestamps. Add a genuine `fbc` only when available; do not invent
   a click ID for a live test.
4. Check the API result and both events in Test Events. Inspect event names,
   website action source, URL, matching fields and server connection.
5. Exercise the actual edge/signup handlers locally with injected provider mocks.
   Normal automated tests never call Meta, Brevo or Turnstile.

Keep output to event name/ID, status, accepted count and sanitized error codes.
The supplied Meta guide says test-code events can still affect targeting and ads
measurement. Use the separate beta dataset for the manual regression check; `test_event_code`
alone does not isolate events from production measurement.
Do not log payloads, raw/hashed emails, full cookies, IPs, tokens or provider
exceptions. Graph API Explorer is optional; ordinary HTTPS POSTs are sufficient.

Direct POSTs prove payload acceptance and credentials. Browser cookie delivery,
CORS, cache isolation and deployed edge behavior still need a live check.

## 8. Focused checks and rollout

| Check | Expected result |
| --- | --- |
| New/same/different/no `fbclid` | Correct cookie attributes; preserve or replace appropriately |
| Cached landing response and first visit | Per-viewer cookie isolation; new `fbc` used in the first event |
| GPC, assets, errors, redirects, no JavaScript | GPC suppresses views; only eligible page responses count; JavaScript unnecessary |
| Brevo success/failure and Meta outage | Lead follows successful list operation; no extra Brevo calls; signup survives Meta failure |
| Hashing, retries, modes and cookies | Correct fields/IDs; beta off by default; credentialed signup works; no secrets logged |

Run infrastructure checks, frontend typecheck/generation, and the relevant existing
signup/browser tests. Add targeted edge/helper tests rather than a broad new test
framework. Verify synthesis preserves routing, cache settings, secret boundaries
and compatible edge associations.

Deploy through the existing operator workflow: review access changes, configure
secrets, verify direct test events, deploy production edge/signup changes, and publish the small
signup frontend update. Beta testing is optional when configured. Test controlled
production page loads and signup in Events Manager after deployment;
a real signup may trigger the existing Brevo welcome email.

Record configuration commands, queue/DLQ state, safe delivery outcomes and function versions
and verification results in `cloud/META.md`. Reuse existing logging/health patterns;
no new alerting project is required. Disable Meta sends through server configuration
while leaving signup enabled; cookie capture can be disabled separately. Rollback
restores the previous edge version associations and signup code. HTML rollback
alone does not undo edge tracking; allow for CloudFront propagation.

## 9. Remaining inputs and completion

Before manual regression verification: dataset ID, CAPI token, and a valid
test code. Beta already has a separate dataset/token; its regression code is `TEST83329`. No new-subscriber/race-condition
decision remains open. See [the runbook](../cloud/META.md) for executable setup commands.

Complete when immediate attribution, server-side ViewContent with the GPC gate,
and the simple signup Lead path work; both events appear in Events Manager;
production caching and signup remain functional; and setup/disable steps are saved.
Implementation is authorized. Live rollout remains operator-run using the runbook.

## References

[Meta parameters](https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters),
[customer information](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters),
[fbc format](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc),
[API usage and testing](https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api).
Meta's pages returned HTTP 429 during initial research; use the supplied parameter
requirements and verify current API details during the first direct test.

[AWS credentialed CORS](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html)
and [HTTP API cookie payloads](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html).


## Local implementation handoff — November 5, 2026

Implemented shared payload/enqueue/delivery code, production viewer edge handling,
beta origin-response handling preserving Basic Auth, credentialed signup, and
separate SQS/worker/DLQ/IAM resources. Added private setup/test commands and
[the operator runbook](../cloud/META.md). Beta uses its dedicated dataset/token
for normal deployed events. The one-off manual regression harness alone uses
TEST83329 for beta or TEST72924 for production.

Validation: `npm run check --prefix cloud/aws` passed (30 tests, TypeScript and
all seven example stacks synthesized below 51,200 bytes). Python tooling passed
22 tests. Frontend typecheck passed. `npm run test:signup --prefix web` passed
13 browser tests with one expected disabled-build skip, and generated/restored
static output. Browser tests needed localhost/Chrome access outside the sandbox.
`git diff --check` passed.

No AWS deployment, secret entry, real Brevo write or Meta POST occurred. Live cookie/
CORS/cache behavior, cold edge timing, permissions and Events Manager delivery
remain operator verification tasks. Graph API v26.0 is pinned, verified against Meta’s maintained Business SDK source;
normal setup no longer asks the operator to choose a version or mode. Start with section 1
of the runbook to review access and enter environment-specific credentials privately.


### Setup simplification

`make meta-config PROFILE=flat-girl SITE_ENV=beta` selects normal delivery to
the beta dataset; the production equivalent uses its own dataset. Both enable the
required features and default to v26.0, matching
[Meta's SDK API version](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/api.js).
No SDK was added to this project. The one-off manual regression harness uses the selected
environment's test code without changing runtime settings or going through SQS.


### Durable records validation — November 6, 2026

Added retained per-environment DynamoDB tables and independent worker archival,
including the requested email/IP/user-agent/click-ID fields. Raw signup email is
separate from the hashed Meta payload. `npm run check --prefix cloud/aws` passed
32 tests, TypeScript and all seven example stack syntheses. Tests cover retries,
independent destination failures, omitted optional fields, Meta/email separation,
PITR/retention/encryption and worker-only table writes. No AWS deployment or live
record/Meta write was performed; use the updated runbook for operator rollout.


### Manual Meta regression confirmed — November 6, 2026

The user confirmed Meta accepted the test events from the manual regression check.
This validates direct CAPI acceptance. It does not establish deployed edge/cookie,
SQS, DynamoDB, GPC or signup integration behavior. Next: review/deploy beta signup
resources and edge changes, then verify both event types through the full pipeline
using section 3 of [the runbook](../cloud/META.md).
