# Meta delivery fixes rollout

Migration date: November 6, 2026. Updates edge enqueue behavior and durable delivery checkpoints.

Run commands from the repository root. This records a specific rollout or recovery;
check its applicability before reusing it.

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
make beta-auth-migrate PROFILE=flat-girl
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
Use the scan in the [production runbook](../META.md#4-production-rollout) and the production dataset's Overview. If a view is
missing, inspect the named edge outcome in the execution region (the observed
production requests ran in `us-east-2` and `us-west-1`).
