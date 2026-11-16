# Local rollout and rollback

**User-run rollout completed and hosting verified November 5, 2026.** These steps
remain the operating runbook. Password rotation was confirmed by the user; the
live rollback drill was waived. Resource independence was checked in deployed
templates; a live beta disable/re-enable drill was not observed. See the
[completion evidence](plans/milestone-2-plan.md#live-completion-handoff--november-5-2026).
For a new machine/operator, complete [access setup](ACCESS.md) first.
The current production artifact is the scaffold with working signup and temporary
noindex. Milestone 3 signup is deployed; see [SIGNUP.md](SIGNUP.md).
It is still publicly accessible. Beta's password does not protect shared images.

## 1. Review and provision shared resources and beta

```sh
make cloud-diff PROFILE=flat-girl STACK=certificates
make cloud-diff PROFILE=flat-girl STACK=images
make cloud-diff PROFILE=flat-girl STACK=beta
make cloud-deploy PROFILE=flat-girl STACK=certificates
make cloud-deploy PROFILE=flat-girl STACK=images
make cloud-deploy PROFILE=flat-girl STACK=beta
make beta-auth PROFILE=flat-girl
```

Wait for certificate/DNS/CloudFront completion. An empty or unavailable auth store
denies access. Credential setup prompts privately for a username and password.
There is no password-length minimum beyond requiring a nonempty value. Only its
authorization digest reaches SSM (used by the shared Lambda@Edge router) and
the retained KVS (rollback compatibility). The AWS CLI
adapter uses a mode-600 temporary JSON file, deleted on command completion, to
keep the digest out of arguments/logs; it never writes the password. Ordinary
stack updates preserve stored credentials. Existing deployments should first use
`make beta-auth-migrate PROFILE=flat-girl` after the access update; this preserves
the password. See the [shared-edge migration](workflows/20261106_SHARED_EDGE_MIGRATION.md).
Beta and production now share viewer handlers and cache settings; the beta router
authenticates requests before cached content is served.

The shared certificate covers apex/www/beta, independent of the beta stack.
Only project A/AAAA and ACM validation records are managed. Preserve existing
MX, TXT, mail aliases, and domain delegation.

## 2. Import images and publish beta

Ensure the `flat-girl-beta` CLI role profile is configured using
[access setup](ACCESS.md). The deployed IAM role alone does not create that local
profile.

```sh
make sources-import PROFILE=flat-girl
make images-ensure PROFILE=flat-girl
make images-ensure PROFILE=flat-girl
make site-build SITE_ENV=beta PROFILE=flat-girl-beta
make site-publish SITE_ENV=beta PROFILE=flat-girl-beta DRY_RUN=1
make site-publish SITE_ENV=beta PROFILE=flat-girl-beta
```

The second image run should report zero downloads/renders/uploads. Publication
uses the artifact already built; it never rebuilds. It archives exact bytes,
uploads immutable assets before HTML, preserves older assets, invalidates `/*`
for this small site, waits, and runs HTTPS verification. Beta verification asks
for credentials privately and never forwards them to the image CDN.

Read-only verification can be rerun independently:

```sh
make site-verify SITE_ENV=beta PROFILE=flat-girl-beta
```

Verify carousel navigation, full-size links, and no-JavaScript content in a real
browser as well. The CLI verifies bytes/HTTP behavior; it does not automate a live
browser. Offline Chrome checks cover the same frontend with fixture image responses.

## 3. Exercise rollback and credential rotation on beta

1. Note the verified release ID printed after the first publication.
2. Build/publish beta again to create a distinguishable build ID.
3. Restore the first verified artifact:

   ```sh
   make site-rollback SITE_ENV=beta RELEASE=release-id PROFILE=flat-girl-beta
   ```

4. Run `make beta-auth PROFILE=flat-girl`; verify the new credential
   works and the old credential is rejected after the 60-second auth cache expires.
5. Record results in `docs/plans/milestone-2-plan.md` without passwords or digests.

Verified publication records are stored with private archives. Rollback requires
one of these records, validates the exact archived bytes, and reuses the publisher.
It does not rebuild old source. A fresh machine can restore the archived artifact.

## 4. Publish production

Production builds require a clean committed source tree. Commit/review the local
implementation through your normal workflow before this step; these tools never
commit or push automatically.

```sh
make cloud-diff PROFILE=flat-girl STACK=production
make cloud-deploy PROFILE=flat-girl STACK=production
make site-build SITE_ENV=production PROFILE=flat-girl-production
make site-publish SITE_ENV=production PROFILE=flat-girl-production DRY_RUN=1
make site-publish SITE_ENV=production PROFILE=flat-girl-production
```

Verify `https://flatgirl.net`, www/HTTP redirects, images and noindex. Then exercise
beta independence:

```sh
make beta-enabled ENABLED=false PROFILE=flat-girl
make site-verify SITE_ENV=production PROFILE=flat-girl-production
make beta-enabled ENABLED=true PROFILE=flat-girl
```

Update `productionNoindex` and regenerate/redeploy deliberately during final launch
work. Do not leave the temporary noindex setting enabled at launch.

## Failure recovery

Local journals live beside each artifact in `.deploy/releases/<env>/<id>/`.
Uploads do not delete old objects. Retry a failed publication with the same
`RELEASE=release-id`; if mutable files already changed, restore the previous verified
release with `make site-rollback`. A local lock prevents concurrent publishers through
verification; use only one publishing machine until CI serialization is added.

S3 publication is ordered, not atomic. The current Nuxt payload contains no app
data; its timestamp changes between builds. Recheck this assumption if server
data or new routes are introduced. Old hashed assets remain available. Future
incompatible payloads need versioned paths before using the same publication model.

There is no earlier production release on the first rollout. Recover by fixing
forward, or review disabling the new distribution while repairing it. If domain
content existed before a later rollout, preserve and use its documented DNS target.
Do not claim rollback succeeded until the restored bytes have been verified live.

## Signup build settings (milestone 3)

The signup backend rollout and shared-secret setup are in [SIGNUP.md](SIGNUP.md).
`make site-build` reads `cloud/signup.json` for the selected environment and
explicitly bakes the endpoint, enabled flag, environment, and shared public site
key into Nuxt. An enabled build requires matching enabled signup-stack outputs.
Publisher roles never read provider secrets. Public settings are recorded in the
private release manifest; old milestone 2 manifests remain valid without them.

Changing a flag/key requires a new site build. Backend disable is a separate
stack update and stops provider writes from cached pages once it completes.
Frontend rollback does not undo contacts or Brevo welcome emails.


## Public-token commerce builds

For the one-off beta signup/router cutover and first commerce publication, use
[Beta Shopify commerce migration](workflows/20261116_BETA_SHOPIFY_COMMERCE_MIGRATION.md).
That workflow owns prerequisites, ordered deployment commands, live verification,
rollback rehearsal and completion status. The following describes reusable build
and publication behavior.

Release manifests now include `commerce`: environment, mode, Shopify source,
public token, empty commerce endpoint and the two exact checkout hosts. Builds
remove unchecked Nuxt public overrides and private Shopify variables, then compare
the generated runtime on every HTML page with the manifest and destination's
signup settings. Publication rechecks archived bytes/configuration, fixture and
recognized private-token markers. Token validation is local; it does not prove a
token is valid at Shopify or detect an arbitrary secret mislabeled as public.
Only copy the **public** token from Headless. Older waitlist manifests without a
commerce section remain eligible for rollback; commerce output without that
section is rejected.

Only the five known `policies/<handle>/index.html` and `_payload.json` paths are
publishable. HTML/payloads keep the existing mutable cache policy (browser
revalidation; shared cache 60 seconds); hashed assets remain immutable. The router
redirects extensionless policy links to a trailing slash with query values intact,
rewrites that path to the generated index, and supports explicit index/payload
requests. Beta authentication happens before redirects/rewrites and cache access.
Unknown policy paths return 404. The verification command checks policy bytes,
cache, canonical links and unauthenticated beta access on both hostnames.

A rollback restores old bytes without deleting retained objects or changing
Shopify stock/publication. Older policy objects may remain reachable. Closing sales
requires the Shopify procedure in [SHOPIFY.md](SHOPIFY.md#sales-controls-for-the-public-token-storefront),
not only a waitlist artifact. Production launch is a separate Session 7 cutover;
its ordered deployment and list-9 automation checks belong in a dedicated dated
migration workflow before execution.
