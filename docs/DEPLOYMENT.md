# Deployment and rollback

Run commands from the repository root. This guide covers reusable operations;
it is not a checklist to reprovision infrastructure on each publication.
The owner has confirmed beta. A changed checkout hostname or build configuration
still requires a new artifact and a targeted check of that change.

One-off changes retain their existing execution records:
[beta commerce migration](workflows/20261116_BETA_SHOPIFY_COMMERCE_MIGRATION.md),
[Shopify checkout domain](workflows/20261116_SHOPIFY_BRANDED_DOMAINS.md), and
[production SEO launch](workflows/20261116_STOREFRONT_SEO_LAUNCH.md).
For a new machine/operator, complete [access setup](ACCESS.md) first.

The [November 24 Stocking Stuffer Pack workflow](workflows/20261124_STOCKING_STUFFER_DROP.md) coordinates beta checkout testing, production publication and the 500-blanket restock.

## Settings and credentials by operation

| Operation | Required inputs | What it does not need |
| --- | --- | --- |
| Infrastructure diff/deploy | Authenticated `flat-girl` operator profile, `cloud/aws/project.json`, reviewed stack/config changes | Shopify token or beta website password |
| Commerce `site-build` | Matching publisher profile, explicit commerce mode, **public Headless Storefront token**, existing image variants, matching enabled signup stack | Private Storefront/Admin token, Brevo or Turnstile secret in the shell |
| `site-publish` / dry run | Matching publisher profile, a built release for that environment, existing archived image objects | Fresh Shopify token or build environment variables; it does not rebuild |
| `site-verify` / successful publication | Matching publisher profile and release; beta additionally prompts for website username/password | Shopify login, payment credentials or provider keys |
| Signup preflight / secret maintenance | `flat-girl` operator; existing shared SSM keys, or hidden prompts when setting keys | Shopify token; publisher roles cannot read signup secrets |

`site-publish` runs verification after uploading, so a real beta publication
prompts for Basic Auth credentials. A publish dry run does not prompt for them.
An explicit `site-verify` repeats verification and prompts again. Beta website
credentials are separate from AWS login and Shopify admin login.

### Configuration sources

| Setting | Source and behavior |
| --- | --- |
| AWS account, region, zone, indexing | Local ignored `cloud/aws/project.json`; authenticated CLI profiles from [Access](ACCESS.md). `productionNoindex` controls production build metadata/robots and the deployed production stack's HTTP header. Beta is always noindex. |
| Storefront mode/token | Shell variables `FLAT_GIRL_STOREFRONT_MODE=commerce` and `NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN`; supply them in the same terminal before building. Without an explicit mode the build defaults to **waitlist**, even if a token is present. |
| Signup | Tracked `cloud/signup.json`: public Turnstile key, enabled flags and lists (beta 10 / production 9). The builder derives each API endpoint; shell signup overrides are removed. An enabled build requires matching enabled stack outputs. |
| Shopify hosts | Code supplies the original API host and exact checkout allowlist, including `shopify.flatgirl.net`. Do not set an endpoint or hostname override in the shell. Accounts use Shopify's default URLs. |
| Images | Tracked image manifest/recipes plus existing remote variants. Build checks the remote objects and refreshes `.deploy/images.ready.json`; it does not upload missing variants. |

**`make site-build` ignores `web/.env`.** A working local development session does
not supply deployment settings. Copy the **public Storefront API token** from the
Shopify Headless channel's storefront token settings. It is intentionally exposed
in browser assets and the release manifest; do not paste a private Storefront or
Admin API token into this variable. It is needed at build time, not again when
publishing the same artifact. Opening a new terminal loses unpersisted exports.

Changing source, token, hostname allowlist, signup public settings or indexing
settings requires a new build. `site-publish` cannot apply those changes to an
already-built release. The build blocks missing/malformed commerce credentials;
it does not authenticate the token against Shopify.

## 1. Review and provision shared resources and beta

Use this section for missing infrastructure or reviewed infrastructure changes.
Skip already-completed provisioning for a frontend-only update. Renew an expired
AWS source login using [Access](ACCESS.md); all commands below assume it is valid.

```sh
make cloud-diff PROFILE=flat-girl STACK=certificates
make cloud-diff PROFILE=flat-girl STACK=images
make cloud-diff PROFILE=flat-girl STACK=beta
make cloud-deploy PROFILE=flat-girl STACK=certificates
make cloud-deploy PROFILE=flat-girl STACK=images
make cloud-deploy PROFILE=flat-girl STACK=beta
```

If beta credentials are missing or you intend to rotate them, run
`make beta-auth PROFILE=flat-girl` separately. Do not rotate them for each publish.

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
profile. Check its session with
`aws sts get-caller-identity --profile flat-girl-beta`.

For new/changed originals, use the [image operations](IMAGES.md) to import and
ensure variants. Existing unchanged images only need the read-only check:

```sh
make images-check PROFILE=flat-girl
make signup-status PROFILE=flat-girl SITE_ENV=beta
make signup-preflight PROFILE=flat-girl SITE_ENV=beta
```

`signup-status` must report the intended enabled backend/list. `signup-preflight`
reads the existing SSM keys and checks the Brevo list without adding a contact.
If either fails, resolve the backend through [Signup](SIGNUP.md) before building;
do not work around it by changing frontend environment variables. Existing working
shared keys need no re-entry. Run `make signup-secrets PROFILE=flat-girl` only for
missing keys or deliberate rotation, using its hidden prompts.

### Build beta commerce — same terminal

Run this complete block for each new commerce build. Clear stale Nuxt overrides
because they take precedence over the intended mode/default hosts. When `read`
waits, paste the public token and press Enter; it is ordinary echoed input.

```sh
unset NUXT_PUBLIC_STOREFRONT_MODE NUXT_PUBLIC_COMMERCE_SOURCE
unset FLAT_GIRL_COMMERCE_ENDPOINT NUXT_PUBLIC_COMMERCE_ENDPOINT
unset FLAT_GIRL_CHECKOUT_HOSTS NUXT_PUBLIC_CHECKOUT_HOSTS
read -r NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
export NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
export FLAT_GIRL_STOREFRONT_MODE=commerce
make site-build SITE_ENV=beta PROFILE=flat-girl-beta
```

Stop if the build fails; do not publish the previous artifact by accident. On
success, copy the release ID from `Built beta ...`. In the next block, paste that
ID when `read` waits. The dry run previews publication; it does not deploy.

```sh
read -r FLAT_GIRL_BETA_RELEASE
make site-publish SITE_ENV=beta PROFILE=flat-girl-beta RELEASE="${FLAT_GIRL_BETA_RELEASE:?Set the beta release ID first}" DRY_RUN=1
```

Confirm the dry run names the intended release. Publish those exact bytes:

```sh
make site-publish SITE_ENV=beta PROFILE=flat-girl-beta RELEASE="${FLAT_GIRL_BETA_RELEASE:?Set the beta release ID first}"
unset FLAT_GIRL_STOREFRONT_MODE NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
```

Publication uses the artifact already built; it never rebuilds. It archives exact bytes,
uploads immutable assets before HTML, preserves older assets, invalidates `/*`
for this small site, waits, and runs HTTPS verification. Beta verification asks
for credentials privately and never forwards them to the image CDN.

Read-only verification can be rerun independently:

```sh
make site-verify SITE_ENV=beta PROFILE=flat-girl-beta RELEASE="${FLAT_GIRL_BETA_RELEASE:?Set the beta release ID first}"
```

If resuming in a new terminal, set `FLAT_GIRL_BETA_RELEASE` to the same recorded
ID first. Without `RELEASE`, publish/verify use `.deploy/beta/current.json`, which
selects the **latest local build**, not necessarily the currently deployed site.
The release-variable guard stops these examples if the ID is unset or empty.
No token is needed to resume publication or verification of that release.

Verify carousel navigation, full-size links, and no-JavaScript content in a real
browser as well. The CLI verifies bytes/HTTP behavior; it does not automate a live
browser. Offline Chrome checks cover the same frontend with fixture image responses.

## 3. Exercise rollback and credential rotation on beta

This is an optional recovery rehearsal, not part of every frontend update.
For an actual rollback, use the release selection and compatibility notes under
[Failure recovery](#failure-recovery). Rotation is independent of rollback.

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

Use this for routine production updates after completing the applicable one-off
workflow prerequisites. Shopify payment mode, sellable inventory, shipping and
the primary checkout domain are Shopify settings, not deployment environment
variables. A production website build does not enable real payments or prove
that checkout works. Review these before exposing Buy now.

Production builds require a clean committed source tree. Commit/review the local
implementation through your normal workflow before this step; these tools never
commit or push automatically. Staged but uncommitted changes still fail this check.
Any tracked configuration changes made while preparing the backend must also be
committed. Local ignored `cloud/aws/project.json` is not part of that Git check.

```sh
git status --short
aws sts get-caller-identity --profile flat-girl-production
make images-check PROFILE=flat-girl
make signup-status PROFILE=flat-girl SITE_ENV=production
make signup-preflight PROFILE=flat-girl SITE_ENV=production
```

The production signup backend must match the enabled configuration and list 9.
The beta backend's state does not establish production readiness. Resolve a
configuration mismatch through [Signup](SIGNUP.md) and the applicable rollout
workflow before building. The shared Brevo/Turnstile keys already in SSM do not
need to be supplied again for a production website build.

Review `productionNoindex` in `cloud/aws/project.json`. The website build reads it;
the production CloudFront header changes only when the production stack deploys.
For an intentional indexing change, follow the existing
[SEO launch workflow](workflows/20261116_STOREFRONT_SEO_LAUNCH.md). A routine
frontend update with unchanged infrastructure does not need a stack deployment.

### Build production commerce — same terminal

Supply the public token again if this is a new terminal or you cleared it after
beta. Production gets its own build; do not publish the beta artifact to production.

```sh
unset NUXT_PUBLIC_STOREFRONT_MODE NUXT_PUBLIC_COMMERCE_SOURCE
unset FLAT_GIRL_COMMERCE_ENDPOINT NUXT_PUBLIC_COMMERCE_ENDPOINT
unset FLAT_GIRL_CHECKOUT_HOSTS NUXT_PUBLIC_CHECKOUT_HOSTS
read -r NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
export NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
export FLAT_GIRL_STOREFRONT_MODE=commerce
make site-build SITE_ENV=production PROFILE=flat-girl-production
```

Only after a successful build, paste its `Built production ...` release ID:

```sh
read -r FLAT_GIRL_PRODUCTION_RELEASE
make site-publish SITE_ENV=production PROFILE=flat-girl-production RELEASE="${FLAT_GIRL_PRODUCTION_RELEASE:?Set the production release ID first}" DRY_RUN=1
```

After reviewing the dry run:

```sh
make site-publish SITE_ENV=production PROFILE=flat-girl-production RELEASE="${FLAT_GIRL_PRODUCTION_RELEASE:?Set the production release ID first}"
unset FLAT_GIRL_STOREFRONT_MODE NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
```

Production publication verifies automatically and has no beta Basic Auth prompt.
For a later read-only verification, restore the release variable in a new terminal
and run:

```sh
make site-verify SITE_ENV=production PROFILE=flat-girl-production RELEASE="${FLAT_GIRL_PRODUCTION_RELEASE:?Set the production release ID first}"
```

Verify `https://flatgirl.net`, www/HTTP redirects, images, and the intended indexing
state. When indexing is enabled, inspect both the HTTP `X-Robots-Tag` and HTML
robots meta tag: the verifier checks for required noindex, but does **not** reject
an unexpected noindex header on an indexable artifact. Also check `/robots.txt`
and `/sitemap.xml`. Exercise checkout and signup separately; byte verification
does not authenticate Shopify or test provider delivery.

## Failure recovery

No new Shopify token or build is required to retry or restore an existing release.
Use the destination's publisher profile and an explicit release ID. A rollback
requires the archive's verified publication record; a failed or merely built
release is not a verified recovery point. See [Access](ACCESS.md) if AWS login
expires. A beta rollback prompts for website credentials during verification.

If publication uploaded files but verification failed, fix the reported issue and
rerun `site-publish` with the **same** `RELEASE` to complete verification and the
remote verified record. A standalone `site-verify` writes local proof but does not
finish uploading that publication record. Changing the token in your terminal
cannot repair a bad token already baked into an artifact; that requires a new build.

Local journals live beside each artifact in `.deploy/releases/<env>/<id>/`.
Uploads do not delete old objects. Retry a failed publication with the same
`RELEASE=release-id`; if mutable files already changed, restore the previous verified
release with `make site-rollback`. A local lock prevents concurrent publishers through
verification; use only one publishing machine until CI serialization is added.

S3 publication is ordered, not atomic. The current Nuxt payload contains no app
data; its timestamp changes between builds. Recheck this assumption if server
data or new routes are introduced. Old hashed assets remain available. Future
incompatible payloads need versioned paths before using the same publication model.

An archived commerce release may accept only the original myshopify checkout hosts.
Its artifact can validate successfully yet reject today's branded checkout URL.
Check host compatibility before restoring it; the
[domain workflow](workflows/20261116_SHOPIFY_BRANDED_DOMAINS.md) covers domain recovery.
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
public token, empty commerce endpoint and three exact checkout hosts:
`tepwtx-zw.myshopify.com`, `flatgirl.myshopify.com`, `shopify.flatgirl.net`. Builds
remove unchecked Nuxt public overrides and private Shopify variables, then compare
the generated runtime on every HTML page with the manifest and destination's
signup settings. Publication rechecks archived bytes/configuration, fixture and
recognized private-token markers. Token validation is local; it does not prove a
token is valid at Shopify or detect an arbitrary secret mislabeled as public.
Only copy the **public** token from Headless. Older waitlist manifests without a
commerce section remain eligible for rollback; commerce output without that
section is rejected.

### Deliberate waitlist builds

The examples above explicitly build commerce. To build a waitlist intentionally,
clear commerce overrides/token before using the chosen environment's `site-build`:

```sh
unset NUXT_PUBLIC_STOREFRONT_MODE NUXT_PUBLIC_COMMERCE_SOURCE
unset FLAT_GIRL_COMMERCE_ENDPOINT NUXT_PUBLIC_COMMERCE_ENDPOINT
unset FLAT_GIRL_CHECKOUT_HOSTS NUXT_PUBLIC_CHECKOUT_HOSTS
unset NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN FLAT_GIRL_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
export FLAT_GIRL_STOREFRONT_MODE=waitlist
```

The AWS, image and signup requirements still apply. Build/publish using the
environment-specific commands above, skipping their commerce-token setup block.
Restoring a verified waitlist artifact avoids rebuilding entirely.

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
