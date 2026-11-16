# KMS usage reduction rollout

Completed rollout: November 14, 2026. Uses AWS-owned DynamoDB keys and a lifetime Meta credential cache.

Run commands from the repository root. This records a specific rollout or recovery;
check its applicability before reusing it.

The November 14, 2026 local revision selects AWS-owned keys for both event tables
and the admin cache, and caches Meta credentials for each worker runtime's lifetime.
Infrastructure typechecking, 62 tests, and example/real-account synthesis passed.
The beta change-set preview `kms-owned-key-cache-20261114` reported no replacement
for the event table or worker. Beta is now deployed and the user reports its
regression passed. Read-only verification on November 14 confirmed the original
table ID, AWS-owned encryption, six readable pre-upgrade records, and two new
successful ViewContent/Lead records. In the 9:19–9:22 PM America/Chicago test
window, CloudTrail recorded one Meta-credential decryption for those two deliveries
and no beta-table KMS calls. Production/admin rollout is also complete, with the
user reporting a successful manual production regression. Read-only verification
confirmed both production/admin tables are ACTIVE with AWS-owned encryption and
their original creation dates, and the deployed production worker contains the
lifetime credential cache. Actual post-rollout monthly usage has not yet been measured.

The deployed access stack already matches source. Beta signup was behind on owner
notifications, so this update also added that queue, DLQ, worker, logs, and alarm.
The user seeded the beta notification thread and reports the beta regression is
working. Step 2 documents initial setup; reuse the existing thread on subsequent
rollouts. Existing Meta settings and credentials are preserved. No access
deployment or frontend publication is required for this check.

1. Deploy the beta backend from this checkout:

   ```sh
   make cloud-deploy PROFILE=flat-girl STACK=signup-beta
   make signup-status PROFILE=flat-girl SITE_ENV=beta
   make meta-status PROFILE=flat-girl SITE_ENV=beta
   ```

2. Set up beta's separate owner-notification thread and test the deployed worker:

   ```sh
   make signup-notifications PROFILE=flat-girl SITE_ENV=beta ACTION=status
   make signup-notifications PROFILE=flat-girl SITE_ENV=beta ACTION=seed
   ```

   Verify the delivered seed's Message-ID matches the saved ID, as described in
   [notification setup](20261110_SUBSCRIBER_NOTIFICATION_CUTOVER.md). If already seeded,
   reuse the existing thread. Then enable and queue the controlled worker test:

   ```sh
   make signup-notifications PROFILE=flat-girl SITE_ENV=beta ACTION=enable
   make signup-notifications PROFILE=flat-girl SITE_ENV=beta ACTION=test
   ```

   Allow 60 seconds after enabling if the worker has already cached disabled
   settings. Confirm `high@flatgirl.net` receives the synthetic test in the
   `[Beta] New Flat Girl Subscriber!` thread. The test creates no Brevo contact
   or welcome email. Check beta's Brevo workflow for an old owner-notification
   step to avoid duplicate alerts; preserve the subscriber welcome step.

3. In an authenticated browser with GPC off, load/reload beta several times and
   submit one controlled email not already in beta list 5. Verify the signup
   success UI, beta list membership, expected subscriber welcome email, and one
   owner notification with the controlled email in the same beta thread. Verify
   new ViewContent and Lead records with `meta_success=true`. Submit the same
   address again: it should still succeed without another Lead or owner alert.
   Check the beta dashboard and both Meta/notification DLQs remain empty.

4. Confirm `flat-girl-beta-events` remains the same table and existing records
   remain readable. The deployed template must show
   `SSESpecification: { SSEEnabled: false }` (AWS-owned encryption, not plaintext);
   `describe-table` should no longer show an account KMS key ARN. Inspect only
   the short test window: worker logs should show successful
   delivery, and credential decryptions should occur on first use of each warm
   worker rather than on every event. Multiple cold workers can each decrypt
   once; do not expect exactly one request across the whole function. Unit tests
   cover reuse beyond a day, runtime isolation, and retry after invalid/failed reads.

5. After beta passes, review/deploy `signup-production` and `admin` separately.
   The live template comparison shows only the event-table encryption and shared
   Meta helper changes in production signup, and only cache-table encryption in admin:

   ```sh
   make cloud-deploy PROFILE=flat-girl STACK=signup-production
   make cloud-deploy PROFILE=flat-girl STACK=admin
   ```

   The admin stack owns its own cache table; deploying beta does not migrate it.
   Keep production's existing notification thread/settings. After deployment,
   verify both tables are ACTIVE with AWS-owned keys, open the admin dashboard,
   and repeat a controlled production signup with its expected emails and Meta
   delivery. Production notifications do not need to be seeded or enabled again.
   A static-site rebuild is optional for bringing old beta UI content up to date,
   but does not exercise either of these backend changes by itself.
