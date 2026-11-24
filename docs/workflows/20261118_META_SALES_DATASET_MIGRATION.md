# Meta sales dataset migration

**Prepared:** November 18, 2026. **Status:** pending; no credentials, AWS resources,
Shopify settings or ads changed during planning.

**November 22 update:** target dataset `960038560247114` supplied by the owner.
The read-only AWS check was blocked by an expired `flat-girl-human` login, before
live credentials or Lambda configuration could be inspected. Production switch
remains pending. Repository Brevo configuration is production **9**, beta **10**.
No TikTok event delivery is required.

To restore AWS access before preflight, run locally:

```sh
aws login --profile flat-girl-human --region us-east-1
```

Keep the CAPI token private; the numeric target ID alone does not establish token
access. Verify the currently configured ID and deployed Brevo list IDs after login.

## Applicability and prerequisites

Use this workflow to move the existing website CAPI pipeline from the old waitlist
dataset to the sales dataset already selected by Shopify and active ads. Follow
the [implementation plan](../plans/meta-sales-dataset-plan.md) first. Commands run
from the repository root. This is a one-time migration, not a routine deployment.

- Stages 1–2 are implemented and tested: candidate credential preflight, selectable
  test code, worker-only delivery pause, and an explicit per-environment worker credential revision. Record
  the implemented preflight command here before execution; it does not exist yet.
- The target ID matches both the active ad set and Shopify. Candidate CAPI access
  is verified. The previous credential pair is privately recoverable. Do not put
  tokens, raw customer data or private checkout URLs in this record.
- The `flat-girl` AWS session can read/write the existing Meta SSM parameters and
  deploy the signup stack through CloudFormation. The beta rehearsal passed using
  beta-only credentials. No new blanket IAM grants are planned.
- Review production code/configuration drift first. The proposed release must not
  unintentionally deploy unrelated signup, notification, commerce or access work.
- Record current settings, worker revision, queue/DLQ health and migration time.
  Leave the old dataset intact. No historical backfill or automatic DLQ redrive
  is part of this change.

## Execution order

### 1. Establish the baseline and rehearse

```sh
make meta-status PROFILE=flat-girl SITE_ENV=production
make cloud-diff PROFILE=flat-girl STACK=signup-production
```

Record settings without credentials. Inspect queue age and DLQ contents through
the existing [Meta recovery guidance](../META.md); `meta-status` alone does not
prove there are no dead letters or uncertain deliveries. Investigate pre-existing
failures before switching destinations. Review any event that may have reached
Meta without its completion checkpoint. Never clear queues to make checks pass.

Privately preflight the candidate credentials against the target dataset's current
Test Events code using the implementation from stage 1. Rehearse the worker update
and actual queue path in beta, keeping its credentials isolated from production.
Before the cutover, confirm the production diff includes the intended worker
revision update and no resource replacement or unrelated change.

### 2. Pause delivery and replace the production credentials

The following pause command is planned and must be implemented before use. Do not
substitute `MODE=off`: that setting suppresses new Lead enqueue in the current
signup handler. Confirm baseline mode is live and the intended event flags are
enabled before scheduling this migration; resolve an existing incident first.

```sh
make meta-worker-pause PROFILE=flat-girl SITE_ENV=production PAUSED=true
```

Allow the 60-second settings cache to expire and prior 15-second worker invocations
to finish before replacing credentials; verify no older invocation remains active.
Keep page serving and signup available. The edge continues enqueueing views and
eligible signup events continue to queue. Paused workers retry messages, so this
must be a short, monitored window, not an overnight pause. The queue has a
180-second visibility timeout and moves messages to its DLQ after five receives.

```sh
make meta-secrets PROFILE=flat-girl SITE_ENV=production
```

Enter the sales dataset ID and its verified token at the hidden prompts. Beta is
unchanged. Record only that the write succeeded and its time. If replacement fails,
keep the old credentials and restore the prior worker pause setting after resolving
the error; do not proceed as though the new credentials were saved.

### 3. Recycle workers through the reviewed infrastructure update

```sh
make cloud-deploy PROFILE=flat-girl STACK=signup-production
```

The release must change the explicit production worker credential revision.
Confirm CloudFormation finishes and the Lambda configuration update succeeds,
with the expected new revision and unchanged queue/table identities. Do not rely
on an unchanged deployment or on the frontend publication to clear the cache.
Leave delivery paused if deployment fails; begin recovery promptly rather than
allowing repeated paused receives to accumulate unnoticed.

Restore worker delivery without overwriting the existing mode, event flags or
Graph version:

```sh
make meta-worker-pause PROFILE=flat-girl SITE_ENV=production PAUSED=false
make meta-status PROFILE=flat-girl SITE_ENV=production
```

Confirm the other settings still match the recorded baseline. Allow up to
60 seconds for settings refresh. Monitor successful delivery and
queue recovery. Pending, uncompleted events now use the new destination; this is
an intentional boundary. Completed archive rows remain completed and are not
resent. Review dead letters individually before any separate recovery action.

### 4. Verify through the actual website pipeline

```sh
make meta-test PROFILE=flat-girl SITE_ENV=production EVENT=ViewContent
make meta-test PROFILE=flat-girl SITE_ENV=production EVENT=Lead
```

Use the target dataset's current test code in the updated tool. These commands
verify credentials only. Also make one permitted real landing visit and one
eligible signup using an operator-controlled address, accounting for the normal
Brevo emails and owner notification. Match their event IDs/times between the
archive and Events Manager. Require `meta_success=true` and receipt in the sales
dataset. Check that settled post-cutover website events do not reach the old
dataset. Verify GPC suppression, repeat-signup behavior, beta isolation and queue
health. Preserve existing privacy behavior; do not invent ad-click identifiers.

Verify existing Shopify checkout/purchase receipt separately without changing its
dataset connection or payment mode just for this test. Record any test-order
limitation; synthetic events cannot establish real advertising attribution.
Stages 3–4 of the plan remain pending until the handoff and event-owner checks
are completed. Add their precise publication and recovery steps here before a
later release if code changes prove necessary.

### 5. Record the result

Complete the status table below with event IDs/times or sanitized evidence. Keep
the old credential recovery path available until the observation window is
accepted. Do not delete the old dataset. No ad/post edits or engagement migration
are required by this workflow.

## Recovery

If verification fails, pause delivery with the same `meta-worker-pause` command and allow
cached settings and in-flight invocations to settle. Determine whether the cause
is credentials, worker deployment, queue processing or Meta visibility before
changing destinations again.

If restoring the old destination is necessary, privately re-enter its credential
pair with `make meta-secrets PROFILE=flat-girl SITE_ENV=production`. Deploy a new
explicit production worker revision, or a reviewed rollback that actually changes
worker configuration. Restore worker delivery while preserving other settings and verify the real
queue path. A secret-only rollback has the same stale-cache problem as cutover.

Events successfully delivered to the sales dataset stay there. Do not reset
`meta_success`, replay the archive, purge queues, or assume cross-dataset
deduplication. Reconcile uncertain sends and DLQ entries before replay. A rollback
restores website delivery to the old dataset but does not repair the active ads'
missing website events; report that limitation explicitly.

## Completion record

| Item | Status |
| --- | --- |
| Candidate credentials and target ID verified | Pending |
| Tooling, worker revision support and beta rehearsal | Pending |
| Production pause, credential write and worker update | Pending |
| Real ViewContent/Lead receipt and queue recovery | Pending |
| Shopify click matching and checkout event ownership | Pending |

**Cutover time, deployed revision, verification evidence and recovery disposition:**
pending. All times should include America/Chicago or an explicit UTC offset.
