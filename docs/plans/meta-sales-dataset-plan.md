# Meta sales dataset implementation plan

**Prepared:** November 18, 2026. **Status:** planned; implementation and rollout pending.

**November 22 priority:** the owner supplied sales dataset ID `960038560247114`.
Move production website `ViewContent` and `Lead` there before the waitlist period.
Keep beta's Meta credentials isolated. Brevo remains production list **9**, beta
list **10**, confirmed in repository configuration and validation. A live AWS
check on November 22 was blocked by an expired login; deployed values and the
current production dataset have not yet been verified. No credentials changed.

No outbound TikTok integration is required. This supersedes the older Shopify
plan's TikTok delivery work; identifying TikTok-origin visits in admin remains
separate and does not require sending anything to TikTok.

Sending genuine Leads to the sales dataset consolidates tracking but does not
make them Purchase optimization events or guarantee preservation of a purchase
ad set's learning. Keep event names truthful. Campaign pausing or a separate
Lead-optimized campaign is an advertising decision, not part of this deployment.

Send the website's existing production `ViewContent` and `Lead` events to the
sales dataset already used by Shopify and the active ads. The owner cannot change
the current ads' data source. Keep those ads and Shopify's current connection in
place. When the website returns to waitlist mode, continue sending `Lead` to this
same destination; do not switch credentials back with the website mode.

This decision supersedes Session 6's instruction to preserve the old production
dataset in the [Shopify integration plan](shopify-integration-plan.md#session-6--meta-and-tiktok-website-attribution).
Preserve the existing server pipeline and historical records. Do not dual-send
events to the old and new datasets or replay previously completed events.

The ordered rollout, verification and recovery procedure lives in the
[sales dataset migration workflow](../workflows/20261118_META_SALES_DATASET_MIGRATION.md).
This plan does not authorize or record an executed deployment.

**Additional requirement, November 18:** classify `ViewContent` by where the visit
came from and show that breakdown in admin. The owner clarified that this is
visit-source reporting, not signup/Lead attribution. See stage 5 and the separate
[view source rollout](../workflows/20261118_VIEW_SOURCE_ATTRIBUTION.md).

## Current implementation

| Area | Repository evidence and implication |
| --- | --- |
| Credentials | `tools/meta.py` stores `{datasetId, accessToken}` in `/flat-girl/meta/production/credentials`, an SSM SecureString. The destination is not a frontend pixel constant. |
| Credential cache | `cloud/aws/lambda/meta.cjs` caches credentials for each warm worker's lifetime. SSM replacement alone leaves existing workers using the old destination. |
| Events | `edge.cjs` queues landing-page `ViewContent`; signup queues `Lead` after the eligible Brevo write. The worker accepts only these event types. |
| Attribution | The edge captures genuine `fbclid` as a parent-domain, HttpOnly `_fbc` cookie. Beta uses `_fbc_beta`. Browser JavaScript cannot read either cookie. |
| Checkout | `useCommerceRequest.ts` supports direct browser Storefront requests with the public token. `useCommerce.ts` validates and navigates to Shopify's checkout URL. There is no explicit click-ID handoff. The Nuxt checkout route is development-only. |
| Delivery history | DynamoDB checkpoints are keyed by event ID, without destination ID. Completed rows are skipped on retry. Queue envelopes do not pin a destination. |
| Manual tests | `tools/meta.py` has fixed test-event codes per environment. Its direct sender bypasses the queue, worker cache and DynamoDB. |

The owner reports Shopify events arrive in the sales dataset. Actual dataset IDs,
token access, deployed revisions and Shopify checkout-event behavior must be
verified during implementation; they were not inspected in the planning session.

## Event ownership after the change

| Event | Owner and trigger | Destination |
| --- | --- | --- |
| `ViewContent` | Existing edge sender on an eligible landing-page response, preserving GPC suppression | Active sales dataset |
| `Lead` | Existing signup sender after its eligible successful write, including future waitlist mode | Active sales dataset |
| `InitiateCheckout` | Shopify if the real headless checkout journey already produces it correctly; add a website sender only after proving a gap and resolving overlap | Active sales dataset |
| `Purchase` | Existing Shopify integration | Active sales dataset |
| Beta website events | Existing isolated beta pipeline and credentials | Separate beta dataset |

Inspect Shopify's observed `ViewContent` source URLs too. Distinguish a separate
Shopify page view from duplicate reporting of the same landing view. Do not try
to deduplicate different actions simply because their event names match.

## 1. Prepare the destination and test tooling

Use the owner-supplied target `960038560247114` and verify it matches the active
Sales ad set and Shopify. Generate or obtain a CAPI token authorized for that destination;
do not assume the old token can access it. Enter credentials only through the
existing hidden prompts, never in source, frontend configuration, chat or logs.
Keep a recoverable private copy of the previous credential pair until verification
finishes. Beta's dataset and token must remain distinct.

Change the manual test tool to accept the destination's current Test Events code
through an interactive prompt instead of assuming the existing production code.
Keep normal queued events free of test codes. Add a preflight path that can test
a privately supplied candidate credential pair before overwriting SSM. Return
only a sanitized acceptance/error result, never credentials or customer fields.
The existing `make meta-test` interface should remain usable after migration.

Add an optional boolean `deliveryPaused` setting, defaulting to false for existing
settings, which only the worker uses to defer delivery. Add a
`make meta-worker-pause PROFILE=flat-girl SITE_ENV=production PAUSED=true|false`
command that patches only this field and preserves other settings. Validate its
type in both Python and JavaScript. Preserve it across other configuration writes
unless deliberately changed. The current `MODE=off` also suppresses Lead enqueue
in signup, so it is unsuitable for a migration that must retain new signup events.

**Acceptance:** candidate credentials produce a controlled test event in the
intended dataset; the test tool does not mutate production credentials during
preflight. An accepted direct test is credential evidence, not worker evidence.

## 2. Make worker recycling explicit

Add a nonsecret, independently versioned `META_CREDENTIAL_REVISION` environment
variable to the Meta worker in `cloud/aws/lib/signup-stack.ts`. Keep its value in
reviewed infrastructure source for each environment. Changing the production
revision must cause a production worker configuration update without replacing
its queue/table or changing beta's revision. It contains a revision label only,
not the dataset ID or token. Preserve the lifetime credential cache and its KMS
cost benefit; do not introduce periodic secret polling for this migration.

Use the new revision to force fresh worker environments after the credential
write. In-flight work and the settings cache require the bounded pause described
in the migration workflow. A no-change stack deployment is insufficient.

Keep the event archive and admin counts unchanged. A pending event is delivered
using the credentials loaded by its worker; already completed events stay in
their original dataset. Record the migration boundary rather than pretending
historical events moved. Uncertain sends accepted before a lost checkpoint need
individual reconciliation because cross-dataset deduplication cannot be assumed.

**Acceptance:** the infrastructure diff shows the intended worker configuration
change; a real queued production event is observed in the new dataset after
cutover. No new events continue to arrive in the old dataset after prior work
has settled. No unrelated infrastructure changes are included.

## 3. Implement and verify the Shopify click handoff

Treat this as a separate release after the destination switch so it cannot delay
restoring landing-page events to the active dataset. Start by inspecting the real
browser journey, checkout host, cookie availability and Shopify event parameters.
The shared `shopify.flatgirl.net` domain may allow cookie transmission, but the
existing HttpOnly cookie is not readable by Shopify's browser pixel. Verify actual
integration behavior rather than assuming the hostname solves attribution.

Prefer a small same-origin, uncached handoff endpoint if the stored click ID must
be recovered for direct browser checkout. It should read only the environment's
validated attribution cookie, validate the returned Shopify destination against
the existing exact host/protocol rules, and preserve its existing query parameters.
It must not become an open redirect. Forward only the genuine, case-preserved
click ID as `fbclid`; do not put the whole formatted `_fbc` value in that parameter.
Confirm Shopify consumes it before accepting this as the final implementation.
Merely putting `fbc` in arbitrary cart attributes is not a verified integration.

Choose the endpoint's AWS routing after inspecting existing request behaviors;
the development-only Nuxt route cannot provide production functionality. Keep the
current HttpOnly cookie rather than exposing it solely to simplify JavaScript.
If no handoff is needed because Shopify already receives usable attribution,
record the evidence and avoid adding an endpoint.

Respect existing privacy controls, including GPC for this new advertising handoff,
and the store's consent state. No click ID means no fabricated click ID. An absent,
invalid or unavailable attribution value must still allow a valid checkout to
open. Do not block checkout on a tracking request. Keep beta attribution separate;
Shopify settings are store-wide, so AWS beta isolation alone does not isolate its
purchase events.

**Acceptance:** a permitted genuine ad-click journey carries the matching click
identifier into the checkout/purchase integration; missing attribution still
allows checkout. Report event receipt and ad attribution separately. If Shopify
does not expose enough evidence, mark matching unverified rather than claiming
that URL decoration proves success.

## 4. Resolve checkout event ownership

Observe one successful checkout handoff in Events Manager before adding a sender.
If Shopify emits one correct `InitiateCheckout`, retain it. If it does not, define
the website trigger as a successful, user-requested checkout creation and handoff,
not page load, a failed Buy action or a completed purchase.

A custom sender requires extending the event builder, queue validator, feature
settings and tests together, with a stable event ID across retries of the same
action. Include verified currency/value and catalog-matching content IDs where
available. Preserve the admin dashboard's explicit ViewContent/Lead semantics.
If Shopify also emits the same action, establish one sender or demonstrate a
supported shared-ID deduplication path before enabling the additional sender.
Do not assume independently generated IDs or a shared click ID deduplicate events.
Do not add a second Purchase sender.

**Acceptance:** the chosen owner reports the intended action once, including
double-click/retry/back-navigation checks. A failed checkout creation reports no
successful checkout initiation. This stage may close with verification only.

## 5. Capture view sources and display them in admin

Add a source label to each newly captured `ViewContent`, independent of which
advertising API receives it. A TikTok-origin view may still be delivered to the
configured Meta dataset; destination is not acquisition source. This work does
not introduce a TikTok Events API sender or change signup/Lead attribution.

### Source rules

Use the current landing request in `cloud/aws/lambda/edge.cjs`, with this precedence:

| Evidence | Stored source | Stored method |
| --- | --- | --- |
| One valid current `fbclid`, no valid `ttclid` | `meta` | `click_id` |
| One valid current `ttclid`, no valid `fbclid` | `tiktok` | `click_id` |
| No click signal; recognized `utm_source` | `meta`, `tiktok`, or `other` | `utm` |
| No click/UTM signal; external Referer hostname | `meta`, `tiktok`, or `other` | `referrer` |
| No usable evidence, conflicting signals, or legacy record | `unknown` | `none`, `conflict`, or `legacy` |

Explicitly support case-insensitive UTM aliases `meta`, `facebook`, `fb`,
`instagram`, `ig`, and `tiktok`, `tik_tok`, `tt`. A bounded nonempty unrecognized
UTM source is `other`. For referrers, parse the URL and match exact hosts or true
subdomains of the supported Facebook, Instagram and TikTok domains, including
their observed redirect hosts. A hostname such as `facebook.com.attacker.test`
must not match. Same-site referrers provide no acquisition evidence. Do not store
the full referrer URL or arbitrary UTM text.

A current click signal takes precedence over a contradictory UTM/referrer.
Simultaneous valid Meta and TikTok click signals are `unknown/conflict`; conflicting
duplicate source parameters must not silently select the first value. Define
bounded validation for each provider's opaque click ID from current documentation
and observed valid examples; do not assume TikTok uses Meta's character grammar.
Malformed optional attribution must not break page serving or event capture.

Do not classify using an old `_fbc`, `_fbc_beta` or other stored click cookie.
For example, an earlier Meta click followed by a current TikTok click is TikTok;
an untagged return visit without a usable external referrer is unknown. This is
current-visit source reporting, not persistent last-touch conversion attribution.
Do not add a new attribution cookie for this feature. Keep existing Meta matching
cookies and the separate Shopify handoff work intact.

These labels report observed signals, not verified paid-ad credit. Referrers and
query parameters can be stripped or supplied manually; Meta/TikTok sources can
include organic visits. The UI label for `unknown` is **Direct / unknown**, since
missing evidence cannot reliably distinguish direct visits from stripped tracking.

### Capture and storage

Add a small shared source classifier and include it in the existing inline Lambda
bundle through `cloud/aws/lib/meta.ts`. Attach versioned, allowlisted metadata to
the queue envelope outside the Meta event: `trafficSource`, `trafficSourceMethod`,
and `trafficSourceVersion: 1`. Retain compatibility with existing schema-1
messages without these optional fields. The worker validates and archives these
as `traffic_source`, `traffic_source_method` and `traffic_source_version` only for
views; old/missing metadata reads as unknown. Invalid optional metadata falls back
to unknown rather than poisoning delivery of an otherwise valid event.

Store the metadata in the original conditional DynamoDB insert, so retries keep
the same classification. Do not rewrite completed historical records, infer their
source from `_fbc`, or send TikTok click IDs/referrers to Meta. The admin feature
needs only the normalized source label, not the raw `ttclid`. Preserve GPC view
suppression, beta isolation, existing prefetch/path rules and PII-free logs.
An eligible event is counted after archival whether Meta delivery succeeds or not.

### Admin query and aggregate contract

The current `environment-time` GSI does not project source metadata, and admin
IAM allows only its existing projected attributes. Add a separately named
`environment-time-source-v1` index with the same keys and existing projected
attributes plus `traffic_source`. Retain the old index for rollback; do not try
to fetch unprojected attributes from the current GSI or broaden the admin role to
read raw identifiers. Add narrowly scoped Query permission for the new index and
attribute. Wait for index backfill/ACTIVE before switching the admin query.

Update `admin.cjs` and `admin-unique.cjs` to accumulate source counts alongside
each hour's existing view count. Add explicit `viewSources` totals and hourly
source counts to the API and `admin/shared/metrics.ts`; preserve existing tuple
meanings, Lead counts and unique-view calculations. For every hour and selected
range, `meta + tiktok + other + unknown` must equal total recorded ViewContent.
Do not sum source counts against estimated unique visitors.

Bump the aggregate cache schema from 3 to 4 and rebuild from the source tables
once. Historical rows lacking source labels count as unknown. Keep a complete
schema-3 snapshot available as stale during rebuilding, publish the new source
counts and manifest atomically, and preserve resumable/lease-protected page
processing. Normal refreshes remain incremental; pending work cannot double-count
a page. The source breakdown covers the same archived-event population as the
existing dashboard; preserve its delayed-archival limitations explicitly.

### Admin display and checks

Add a **Recorded page views by source** panel showing Meta, TikTok, Other and
Direct / unknown with counts and shares of recorded views. Respect the existing
day/week/all-time selection and America/Chicago boundaries. Label these as total
page views even when the existing dashboard is showing estimated unique views.
Keep the existing combined views/leads chart and overall rate; do not invent
per-source conversion rates without matching source-specific signup data.
Show unknown historical counts and the source-collection start time. Old API
responses must show the breakdown as unavailable, not four misleading zeros.

Test precedence, duplicate/conflicting tags, referrer host boundaries, malformed
input, old Meta cookie plus new TikTok visit, no cookies, GPC, beta isolation,
legacy queue/archive rows and retry stability. Test exact source-total equality,
schema-3 to schema-4 rebuild/resume, IAM projection restrictions, UI range changes,
timezone boundaries and fallback to an older API. Use synthetic signals only in
isolated fixtures/beta; do not fabricate production ad clicks for acceptance.

**Acceptance:** a permitted Meta visit and TikTok visit produce distinct source
labels in their stored ViewContent rows and the matching admin range; untagged
visits remain visible under Direct / unknown. No signup change is required.
Estimated engineering time: 4–6 hours plus AWS index/edge propagation.
Deployment, cache migration and recovery use the
[view source workflow](../workflows/20261118_VIEW_SOURCE_ATTRIBUTION.md).

## 6. Validate and hand off

| Check | Required result |
| --- | --- |
| Credential/test tooling | Candidate preflight does not write SSM; selected test code reaches only the direct test payload; errors remain sanitized; beta/production isolation remains enforced. Worker-only pause preserves other settings and keeps eligible Lead enqueue active while delivery retries. |
| Infrastructure and cache | Typecheck and infrastructure tests pass; revision changes only the intended worker; existing cache-reuse and failed-read-retry tests remain green. |
| Landing and signup | Real queued `ViewContent` and one eligible `Lead` reach the active sales dataset; GPC still suppresses views; repeat signup preserves existing deduplication behavior. |
| Attribution and checkout | Cover genuine/missing/malformed/expired click IDs, query preservation, untrusted checkout hosts, consent/GPC, tracking failure, retries and navigation. Verify native Shopify event ownership before adding events. |
| Return to waitlist | Waitlist UI and signup operate with the same destination; no credential rotation is coupled to sales availability. Shopify's separate sales-closure controls still apply. |

Run the relevant existing AWS, Python and frontend suites for files actually
changed. Add focused tests for new behavior, not copies of unchanged event rules.
No application tests are required for this planning-only documentation change.

Update `docs/META.md` with the resulting reusable credential-rotation/test behavior
and event ownership, and `docs/SHOPIFY.md` with verified attribution behavior.
Keep execution evidence, credential revisions, rollback disposition and remaining
gaps in the [migration workflow](../workflows/20261118_META_SALES_DATASET_MIGRATION.md).

Estimated implementation effort: 2–3 hours for tooling, worker revision support
and destination verification once access is available; 3–6 additional hours if a
custom attribution handoff or checkout sender is needed. Meta reporting and access
delays are separate from engineering time.

## Next session

Implement stages 1–2 first, then use the linked workflow for the production
cutover. Inspect current code and deployment differences before changing anything.
Stage 5 is a confirmed requirement and can proceed independently of the Shopify
investigation after the destination migration. Keep stages 3–4 separately pending
until end-to-end Shopify evidence resolves their scope. Do not change the active
ads, posts or Shopify dataset connection.

## References

- [Meta click ID and fbc handling](https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/fbp-and-fbc)
- [Meta browser and server event deduplication](https://developers.facebook.com/documentation/ads-commerce/conversions-api/deduplicate-pixel-and-server-events)
- [Shopify Meta data sharing and supported events](https://help.shopify.com/en/manual/promoting-marketing/analyze-marketing/meta-data-sharing)
- [AWS Lambda environment configuration](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)
- [TikTok click ID](https://ads.tiktok.com/resources/help/article/tiktok-click-id?lang=en)
- [DynamoDB index projections](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)
