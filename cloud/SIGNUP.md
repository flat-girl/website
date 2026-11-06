# Signup operations

**Beta and production signup are deployed and enabled as of November 5, 2026.**
The user verified both forms and welcome emails, plus preserved unsubscribe status
on a beta re-submission. See the [completion evidence and verification limits](../docs/milestone-3-plan.md#completion-handoff--november-5-2026).

The numbered rollout steps below are retained for setup/recovery, not outstanding
closeout tasks. The initial deployment and tagging-failure recovery are complete.

| Setting | Beta | Production |
| --- | --- | --- |
| Site | `https://beta.flatgirl.net` | `https://flatgirl.net` |
| API | `https://beta-api.flatgirl.net/subscribe` | `https://api.flatgirl.net/subscribe` |
| Brevo list | **5** | **4** |
| Signup stack | `FlatGirlBetaSignup` / `STACK=signup-beta` | `FlatGirlProductionSignup` / `STACK=signup-production` |
| Function | `flat-girl-beta-signup` | `flat-girl-production-signup` |

Both use public Turnstile site key `0x4AAAAAAF1pFARkZ1vCzj0T` and the same two
SSM SecureStrings:

```text
/flat-girl/signup/turnstile-secret
/flat-girl/signup/brevo-api-key
```

The public key, list IDs, throttle settings, and enabled flags are in
[`signup.json`](signup.json). No checkbox, consent attributes, consent timestamps,
or wording-version tracking is collected. Brevo manages the welcome email;
our backend never calls an email-sending endpoint or configures automation.

## 1. Confirm providers and update AWS access

Confirm the shared Turnstile widget permits `flatgirl.net` and `beta.flatgirl.net`.
Confirm list IDs 5/4 belong to the intended Brevo account and that welcome
automation uses the intended list triggers. Testing with a controlled email may
send that welcome email. Test duplicates should not retrigger it through a new
membership write; Brevo's automation settings still govern its behavior.

Review the full access update before deploying either signup stack:

```sh
make cloud-diff PROFILE=default STACK=access
make cloud-deploy PROFILE=default STACK=access BOOTSTRAP=1
```

Use the existing `default` profile for this access-stack update, as documented in
[ACCESS.md](ACCESS.md). No `flat-girl-admin` profile is required or created by the
project. `BOOTSTRAP=1` permits this administrator-managed operation for both
initial creation and later access-stack updates. Normal signup/backend commands
use `flat-girl`; site publication uses the matching publisher profile. No changes
to mail DNS or existing site certificates are required.

## 2. Enter the shared keys privately

Run in your terminal from the repository root:

```sh
make signup-secrets PROFILE=flat-girl
make signup-preflight PROFILE=flat-girl SITE_ENV=beta
make signup-preflight PROFILE=flat-girl SITE_ENV=production
```

The first command prompts twice for each key with echo disabled. It writes
SecureStrings using the default SSM encryption key; values never enter command
arguments. The AWS CLI adapter uses a mode-600 temporary JSON file, captures its
output, and removes the file afterward. Do not use shell tracing or CLI debug
logging while entering keys.

Preflight reads the keys privately and verifies the selected Brevo list exists.
It adds no contact and sends no email. It does not prove Turnstile hostname
configuration, suppression behavior, or welcome delivery; those need the live
browser checks below. Keys are shared: rotation affects both environments.

## 3. Deploy and verify beta

If you already encountered the initial Stage tagging failure, use the
[one-time recovery procedure](#recover-the-initial-beta-tagging-failure) before
retrying. A rolled-back stack and retained log group cannot be recreated in place
with the normal deploy command.

Create the backend disabled, then review and apply its enable change:

```sh
make cloud-diff PROFILE=flat-girl STACK=signup-beta
make cloud-deploy PROFILE=flat-girl STACK=signup-beta
make signup-enabled PROFILE=flat-girl SITE_ENV=beta ENABLED=true DRY_RUN=1
make signup-enabled PROFILE=flat-girl SITE_ENV=beta ENABLED=true
make signup-status PROFILE=flat-girl SITE_ENV=beta
```

`signup-enabled` updates only the selected flag in `cloud/signup.json` and deploys
that signup stack. Dry-run restores the original config bytes after displaying
the diff. A failed real deployment leaves the intended local config visible;
inspect stack events and `signup-status` before deciding whether it became live.

Build and publish through the existing beta publisher:

```sh
make site-build PROFILE=flat-girl-beta SITE_ENV=beta
make site-publish PROFILE=flat-girl-beta SITE_ENV=beta DRY_RUN=1
make site-publish PROFILE=flat-girl-beta SITE_ENV=beta
make site-verify PROFILE=flat-girl-beta SITE_ENV=beta
```

The build checks the matching signup stack is enabled, uses its expected endpoint
and list, and records public signup settings in the release manifest. It does not
read provider secrets. `site-verify` checks published bytes/hosting/images; signup
behavior requires the separate browser verification:

1. Open beta, authenticate, and submit a controlled address through the real widget.
   Confirm membership in **list 5**, without adding membership in list 4. Check
   the welcome email separately in Brevo and the controlled inbox.
2. Submit the same address again. Confirm the same public acknowledgment, no
   extra contact, and no application-driven membership update or welcome resend.
3. Use a separate controlled blocked/unsubscribed address. Confirm its suppression
   remains intact and no unrelated memberships or attributes change. Never remove
   suppression from a real subscriber to reset a test.
4. Confirm invalid verification cannot create a contact. Exercise disabled signup,
   re-enable, and rotation using the procedures below; check failure visibility.
5. Record safe evidence: release ID, list ID, outcome, time, and any provider issue.
   Keep addresses, contact exports, keys, and unredacted screenshots out of Git.

## 4. Enable and publish production

After beta passes, provision `STACK=signup-production` disabled and run its
preflight. Enable production using `SITE_ENV=production`, then commit the reviewed
source and updated public config before the production build. The publisher
requires a clean committed tree. No new provider keys are needed.

```sh
make cloud-diff PROFILE=flat-girl STACK=signup-production
make cloud-deploy PROFILE=flat-girl STACK=signup-production
make signup-preflight PROFILE=flat-girl SITE_ENV=production
make signup-enabled PROFILE=flat-girl SITE_ENV=production ENABLED=true DRY_RUN=1
make signup-enabled PROFILE=flat-girl SITE_ENV=production ENABLED=true
```

After reviewing and committing those changes:

```sh
make site-build PROFILE=flat-girl-production SITE_ENV=production
make site-publish PROFILE=flat-girl-production SITE_ENV=production DRY_RUN=1
make site-publish PROFILE=flat-girl-production SITE_ENV=production
make site-verify PROFILE=flat-girl-production SITE_ENV=production
make signup-status PROFILE=flat-girl SITE_ENV=production
```

Submit one controlled production address and verify **list 4** and the intended
welcome behavior. Verify duplicates and disable/re-enable before promotion.
Signup completion does not enable sales or send the launch campaign. Production
noindex remains under the existing milestone 2 configuration.

## Failure visibility and recovery

`make signup-status PROFILE=flat-girl SITE_ENV=production` reports the live function
enabled state and its CloudWatch alarms. Each environment has alarms for three
handled provider failures in five minutes, a Lambda error, or a Lambda throttle.
**No alarm notification recipient is configured.** Inspect status during rollout
and connect an approved alarm action before relying on unattended alerts.

Logs at `/aws/lambda/flat-girl-{beta|production}-signup` retain 30 days of safe
outcome labels and total duration. Provider failures are logged as `secrets_failed`,
`turnstile_failed`, or `brevo_failed`. The handler does not log emails, tokens,
provider response bodies, URLs containing contacts, or exception details.

Disable the backend first to stop writes from already cached pages:

```sh
make signup-enabled PROFILE=flat-girl SITE_ENV=production ENABLED=false DRY_RUN=1
make signup-enabled PROFILE=flat-girl SITE_ENV=production ENABLED=false
make signup-status PROFILE=flat-girl SITE_ENV=production
```

This is a CloudFormation update and takes time; it is not an instantaneous switch.
Publish a disabled site build afterward if visitors should see the disabled form.
For a single-key rotation:

```sh
make signup-secrets PROFILE=flat-girl KEY=turnstile
# Or: make signup-secrets PROFILE=flat-girl KEY=brevo
```

Allow 60 seconds for warm Lambda caches to expire. Verify beta and production
because both read the same keys. To recover, fix configuration/keys, preflight,
re-enable the selected backend, and verify one controlled browser signup.

Frontend rollback uses the existing `site-rollback` command and exact archived
bytes. Older milestone 2 manifests remain valid with signup absent. Backend
rollback requires deploying the prior reviewed handler/configuration separately;
disable it first if necessary. Neither rollback removes contacts already added
or recalls a Brevo welcome email.

## Limits and local checks

The current throttles are beta 1 request/second with burst 2, production 3/second
with burst 5. Each new signup normally makes two Brevo contact calls. Confirm
account quota/shared traffic before advertising. Gateway throttling is best-effort,
and provider throttles still return a retryable error.

The handler preserves observed global and target-list suppression and never
updates email/blocklist fields or other attributes. An eligible existing contact
gets a list-only update. The lookup/update pair is not atomic; confirm the account's
unsubscribe behavior before enabling public collection. Unknown consent-group
state fails closed for membership additions; it requires explicit account-specific
handling if that Brevo feature is in use. Separate lists share contact records
and global suppression; use distinct controlled beta addresses.

There is no queue or automatic replay of uncertain writes. A browser timeout may
mean the contact was already added; the next manual attempt uses a fresh Turnstile
token and safely re-reads the contact. Acknowledgments intentionally do not reveal
whether an address is new, already subscribed, or suppressed.

```sh
npm run check --prefix cloud/aws
npm run typecheck --prefix web
npm run test:images --prefix web
npm run test:signup --prefix web
npm run test:e2e --prefix web
npm run test:cdn --prefix web
```

`test:signup` generates a fixture using mocked providers and official test-key
format, exercises the enabled form, and restores disabled local output afterward.
It does not use the real widget or contact Brevo. Do not publish that fixture;
use `make site-build` for environment-validated release artifacts.

## Recover the initial beta tagging failure

**Historical incident: resolved by the user. Both signup stacks are now live.
Do not run the deletion commands below against the current working deployment.**

Read-only inspection on November 5, 2026 found `FlatGirlBetaSignup` in
`ROLLBACK_COMPLETE`, termination protection off, and the original Stage creation
denied `apigateway:TagResource`. The API, certificate, Stage, and alarm were deleted
by rollback. Only `/aws/lambda/flat-girl-beta-signup` was retained; it has zero
stored bytes and zero log streams. The signup Lambda was never created.

The corrected access template includes Stage tagging/untagging and domain
certificate attachment/removal, checked against live CloudFormation resource
schemas. New signup log groups retain established logs but use
`RetainExceptOnCreate` to avoid leaving an orphan after a failed initial creation.

1. Apply the corrected access permissions:

   ```sh
   make cloud-diff PROFILE=default STACK=access
   make cloud-deploy PROFILE=default STACK=access BOOTSTRAP=1
   ```

2. Remove the failed signup stack record and its verified-unused log group.
   These commands delete only the failed beta signup stack and that exact log
   group. The existing beta site, production site, images, and SSM secrets are
   outside this cleanup. The log-group deletion uses the administrator profile
   because the operator intentionally has no log-deletion permission.

   ```sh
   aws --profile flat-girl --region us-east-1 cloudformation delete-stack --stack-name FlatGirlBetaSignup
   aws --profile flat-girl --region us-east-1 cloudformation wait stack-delete-complete --stack-name FlatGirlBetaSignup
   aws --profile default --region us-east-1 logs delete-log-group --log-group-name /aws/lambda/flat-girl-beta-signup
   ```

3. Recreate the beta backend:

   ```sh
   make cloud-deploy PROFILE=flat-girl STACK=signup-beta
   ```

This cleanup is specific to the failed first deployment observed above. If beta
signup has since deployed successfully or started receiving requests, inspect its
current state instead of repeating this deletion procedure. These recovery writes
remain user-run; the agent only inspected state and changed local source.


## Milestone 4 local integration

The new local code includes cookies on signup requests and enables exact-origin
credentialed CORS. Successful Brevo create/list-write results enqueue a Meta Lead;
there are no additional Brevo requests. Existing no-write suppression/membership
branches remain unchanged. Queue failures do not change successful signup responses.
The Meta worker handles remote delivery separately. These changes are not yet
live; follow [META.md](META.md) for private credentials, test events and rollout.

The November 6 event-record addition includes the validated signup email in the
SQS envelope for durable DynamoDB storage. It stays separate from the Meta event,
which contains only its normalized SHA-256 email hash. The worker also retains
available IP, user agent and click ID. Signup still awaits only enqueue acceptance;
storage and Meta delivery happen afterward. See [META.md](META.md#durable-event-records).
