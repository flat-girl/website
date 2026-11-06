# Milestone 2 — AWS hosting, shared images, and local deployment

**Status: complete for the core hosting scope, November 5, 2026. Beta and production are deployed and verified.**

The user approved proceeding after review. This document records the design and
rollout sequence. The user completed live rollout; the agent performed read-only
verification. The user waived the live rollback drill and confirmed password
rotation. Deployed resource separation was verified; no live beta shutdown drill
was observed. See the completion evidence at the end of this document.

**Target result:** deploy the existing scaffold from your machine to protected
`beta.flatgirl.net` and public `flatgirl.net`, with independent hosting, shared
processed images, private originals, repeatable verification, and usable rollback.

**Working target:** about 30 minutes for local implementation, as requested.
User-run account setup, AWS propagation, and live verification are separate.

## Design decisions

| Decision | Proposed baseline | What remains to settle |
| --- | --- | --- |
| AWS and DNS ownership | Dedicated Flat Girl resources in `066540957026`, `us-east-1`, Route 53 zone `Z06174692C3V38JQV6ZWT` | Discovery verified public delegation; private operator login remains user-run |
| Public scaffold | Verify beta first, then publish the current heading/carousel to production; temporary production `noindex` until final launch work | Deployed and verified; temporary noindex remains intentional |
| Shared image visibility | Processed WebPs are publicly accessible through one image CDN, including images used by beta; originals remain private | Approved baseline; beta is not confidential image storage |
| Beta credentials | CloudFront Function plus KeyValueStore containing a credential digest; private local prompt sets/rotates credentials outside templates and frontend builds | Implemented; values are entered privately during rollout |
| Retention and operations | Keep originals, old variants, old hashed site assets, and deployment archives; manual rollout with separate beta/production targets | Agree the defaults; defer automated cleanup and GitHub deployment to later work |

The user approved proceeding with the design defaults. No passwords, access keys,
or tokens belong in this document. The implementation choices and verification
evidence at the end supersede the original proposed sequence where noted.

## Scope and existing foundation

| Already present | Milestone 2 addition |
| --- | --- |
| Nuxt static generation into `web/.output/public` | Environment-specific builds, deployment manifests, publication, and verification |
| Python/uv/Pillow image renderer and source checksums | Private source import/restore, remote variant checks, conditional uploads, and receipts |
| Fingerprinted WebP keys and generated image metadata | Receipt-backed CDN URL configuration and builds without local originals |
| Local carousel, responsive images, full-size links, and browser checks | The same behavior against shared-image fixtures and live HTTPS |
| Roadmap and Milestone 1 handoff | Infrastructure, access, image, deployment, and recovery runbooks |

Keep signup/API/Brevo/Turnstile in milestone 3, tracking/consent in milestone 4,
GitHub/OIDC deployments in milestone 5, and product design/content in milestone 6.
Do not introduce checkout, a Nuxt server, image transformation service, WAF,
customer login, or changes to reference projects in this milestone.

### Reference findings that affect this design

1. Big Naturals provides useful access, OAC, routing, and ordered publication
   patterns. Its route/output allowlist is narrower than this project's generated
   output and must be adapted. Its documented permission recovery is a reason to
   review the full resource lifecycle before rollout.
2. The FishLamps repository contains the Waller Creek High beta/production and
   shared-image implementation referenced by the roadmap. Reuse those boundaries
   and missing-only image preparation, without its archive, reviews, or GitHub
   trigger behavior. Its historical deployment notes are not Flat Girl evidence.
3. The reference beta function embeds an expected Basic Authorization value in
   deployed code. This plan instead keeps the credential digest in KeyValueStore
   and writes it through a separate private command.
4. `tools/prepare_images.py` currently requires every original and stages every
   WebP in `web/public/variants/`, including through npm pre-hooks. CDN mode needs
   a separate path through those hooks; changing only `useImages()` is insufficient.
5. The current generated artifact includes `200.html`, `404.html`, `_payload.json`,
   `_nuxt/builds/latest.json`, and per-build metadata. Routing, cache rules, and
   rollback must account for these actual files.

## Architecture and ownership

Use five stacks with project-specific names. Resource names below are proposed;
account-qualified bucket names are resolved only after discovery.

| Stack | Owns | Dependencies |
| --- | --- | --- |
| `FlatGirlAccess` | Human role trust, scoped publication roles, and CloudFormation execution permissions | Confirmed administrator and human identity; administrator-managed |
| `FlatGirlCertificates` | DNS-validated certificate covering `flatgirl.net`, `www.flatgirl.net`, and `beta.flatgirl.net` | Confirmed DNS authority; independent of beta |
| `FlatGirlImages` | Private source/archive bucket, private variants bucket, and image CloudFront distribution | Access setup; no dependency on either site |
| `FlatGirlBetaSite` | Beta bucket/distribution, auth/routing function, KeyValueStore, headers, and beta DNS | Shared certificate and access setup |
| `FlatGirlProductionSite` | Production bucket/distribution, routing function, headers, and apex/www DNS | Shared certificate and access setup |

This is **four S3 buckets and three CloudFront distributions**. The private
source bucket also holds deployment archives under a separate `releases/` prefix;
source operations address only `sources/`, and release operations address only
`releases/`. Neither prefix has a CloudFront origin or public reader.

All buckets block public access, disable ACLs, require TLS, enable encryption and
versioning, and retain data on stack removal. Use SSE-S3 initially; no custom KMS
key is needed for this design. Site and variant origins use S3 REST endpoints
with OAC scoped to their own distribution. AWS recommends OAC for S3 origins;
website endpoints are unsuitable for this private-origin pattern.
([AWS OAC documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html))

Use an independent ACM certificate in `us-east-1`, as required for viewer HTTPS
through CloudFront. Use the image distribution's default HTTPS hostname.
([AWS certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html))

Production must not import anything from the beta stack. Disabling beta means
updating its distribution's enabled setting, retaining its bucket and shared
resources. Removing beta is a separate maintenance procedure. Protect shared
and production stacks against accidental deletion; do not enable automatic
bucket emptying or object expiration in this milestone.

## Implementation sequence

### 1. Discover prerequisites and define access

1. **Inspect the intended AWS identity and DNS read-only.** Confirm account,
   region, active principal, session expiry, zone authority/delegation, existing
   apex/www/beta records, certificates, CloudFront aliases, and named-resource
   collisions. Use the explicitly selected profile; do not silently inherit
   another project's account or the default profile. Do not read unrelated
   secrets. Preserve the existing DNS record set for review/recovery.
2. **Record validated project configuration.** Add `cloud/aws/project.example.json`
   and a schema/validator for project name, account, region, zone ID/name,
   domains, stack/bucket/role names, and beta-enabled setting. Keep local profile
   mappings separate from deployable configuration. Import known zone attributes
   so synthesis/tests can run offline. Fail on unresolved placeholders and
   beta/production resource collisions before any write.
3. **Prepare access independently of application stacks.** Prefer the user's
   existing federated/temporary human session; do not create long-lived keys or
   assume a new IAM user is required. An administrator provisions project access.
   Separate infrastructure execution from routine publication, and provide beta
   and production publication roles whose destination writes cannot cross over.
   Keep IAM administration out of those roles. Create no GitHub trust yet.
4. **Review permissions for the full lifecycle.** Cover create, read, tag, update,
   replacement, failed-create recovery, rollback, and deliberate removal for S3,
   CloudFront/OAC/functions/KVS, ACM, Route 53, and CloudFormation. Scope DNS changes
   to the project records and certificate validation names where supported; scope
   `iam:PassRole` to the execution role and CloudFormation service. Publication
   roles can read originals, verify/add variants, archive releases, write their
   site, and invalidate their distribution; they cannot delete originals/variants,
   change IAM, or rotate beta credentials. Document unavoidable discovery wildcards.
5. **Produce a prerequisite report.** Include collisions, retained resources,
   organization-policy restrictions where visible, certificate validation needs,
   and missing actions. Policy simulation is supplementary, not proof of deployability.
   If DNS is external, resolve its apex-alias capability and validation procedure
   before rollout; do not migrate nameservers or overwrite records implicitly.

**Checkpoint:** offline configuration/synthesis works, the intended operator and
administrator are identified, and the proposed resource/permission changes can
be reviewed together.

### 2. Build independent hosting stacks and edge behavior

1. **Add the CDK project and stacks.** Use TypeScript, pinned dependencies and
   a lockfile. Adapt the small asset-free synthesizer from Big Naturals for inline
   CloudFormation templates; publish site files separately. Enforce the inline
   template size limit. Avoid CDK asset-upload roles/bootstrap unless a concrete
   new asset requires them. Add outputs for account, bucket, distribution, site
   URL, certificate, image origin, and beta KVS identity without sensitive values.
2. **Implement beta authentication before routing.** Every beta HTTPS request,
   including assets and requests to its `cloudfront.net` hostname, must pass the
   same viewer-request function. Missing/invalid credentials return `401` with
   `WWW-Authenticate`, `Cache-Control: no-store`, and `X-Robots-Tag`. Missing KVS
   data or a lookup failure denies access; it never falls through to the site.
   Remove the Authorization header before forwarding an authenticated request.
3. **Add private credential setup/rotation.** Prompt locally without echo, accept
   a nonempty password with no additional length minimum, and store only a SHA-256
   digest of the expected Basic Authorization value in KVS. Compute the same
   digest in the function and compare fixed-length values without early exit.
   This is shared preview access, not a customer authentication system. Keep
   credentials and digests out of Git, templates, frontend artifacts, shell
   arguments, command history, and tool logs. Use an SDK in-process for the
   update, restrict KVS management permission, and preserve the value across
   ordinary stack updates. Verify rotation before discarding the old credential.
4. **Implement the routing and cache contracts below.** Use one routing policy
   shared by tests and publication validation. Add explicit noindex headers to
   all beta responses, including redirects/errors, plus beta robots/meta tags.
   Add temporary production noindex as the proposed scaffold default. Configure
   HTTPS, `nosniff`, framing protection, and a referrer policy; avoid preload or
   include-subdomains HSTS until domain ownership/use is known.
5. **Test independence and failure behavior.** Synthesis must show no production
   dependency on beta, no public bucket policy, no credential material in code or
   templates, and no accidental shared-resource replacement when beta is disabled.
   Test unauthenticated access after an authenticated cache warm-up, auth storage
   failures, invalid hosts, path routing, and query preservation.

CloudFront KeyValueStore supports independent data updates and access-control
logic in JavaScript runtime 2.0. This avoids putting credential material into
the function source. ([AWS KeyValueStore documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html))
The runtime provides hashing; the credential helper must also use supported
regional STS sessions for KVS API authentication, checked during preflight.
([Runtime features](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-20.html),
[KVS session restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html))

**Checkpoint:** templates and meaningful edge tests pass locally; no AWS
resources have to be created to reach this point.

#### Routing contract

| Request | Expected behavior |
| --- | --- |
| HTTP site URL | Redirect to HTTPS; no site content served over HTTP |
| Production `/` and `/index.html` | Serve the landing page; normalize `/index.html` to `/` |
| `www.flatgirl.net` or production distribution hostname | Redirect to `https://flatgirl.net`, preserving valid asset paths and query values |
| Beta distribution hostname | Require authentication first, then redirect to `beta.flatgirl.net`; never bypass auth |
| Known static files and `/_nuxt/*` | Serve the file with its correct type; never redirect an asset request to the landing page |
| Unknown page-like paths such as `/offer` | Temporary `302` to `/`, preserving campaign parameters |
| Missing asset-like paths, `/variants/*` on a CDN-mode site, and private/hidden paths | Return an error response; never return successful landing-page HTML |
| Image CDN `variants/<fingerprint>/<file>.webp` | Serve the processed image independently of beta auth; no index/gallery/listing route |

Use permanent redirects for canonical host/index normalization and temporary
redirects for unknown pages. Test repeated query keys, empty values, `%` escapes,
`+`, and encoded separators. Derive destinations from configured hosts, never an
untrusted Host header. AWS represents query parameters and repeated values in
its function event object; preserve their meaning without double encoding.
([CloudFront event format](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html))

The allowlist initially covers `index.html`, generated `200.html`/`404.html`,
`_payload.json`, and Nuxt assets/build metadata. Add a small `robots.txt` and a
public `build.json` with release ID/environment/source revision only. Treat
`200.html` as an explicit generated artifact, never a global SPA error fallback.
Allow future icons, sitemap, and ownership-verification files only when actually
added and classified. Do not create a wildcard S3 403/404-to-index rewrite.

#### Cache contract

| Content | Proposed cache rule |
| --- | --- |
| Fingerprinted JS/CSS and per-build immutable metadata | `public, max-age=31536000, immutable`; never overwrite with different bytes |
| Processed image variants | Same one-year immutable rule; old keys remain available |
| HTML, `_payload.json`, `_nuxt/builds/latest.json`, robots, public build marker | `public, max-age=0, s-maxage=60, must-revalidate`; invalidate changed entrypoints |
| Beta site responses | Start with caching disabled and viewer `no-store`; shared image CDN keeps its independent immutable cache |
| Auth failures and generated error responses | `no-store`; minimize origin-error caching so newly published files recover promptly |

Use a zero minimum TTL for site caching so short/no-cache directives are honored.
Query strings stay in the browser URL but do not vary static origin content;
exclude cookies and Authorization from origin forwarding/cache keys. AWS notes
that a positive minimum TTL can override origin no-cache/no-store directives.
([AWS cache-policy behavior](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html))

### 3. Extend the image pipeline for private sources and CDN builds

1. **Separate planning, rendering, and staging.** Derive the expected keys and
   dimensions from tracked manifest/recipes plus renderer identity without
   requiring raw files. Keep the existing fingerprint algorithm and current
   keys unless a deliberate renderer change requires invalidation. Preserve
   transparent pixels, orientation handling, metadata stripping, no upscaling,
   and the 480/960/native-size policy. Validate manifests and prevent path traversal.
2. **Add explicit source import and restore.** Import only manifest-listed files
   into `sources/<sha256>/<filename>` after checking their bytes/dimensions.
   Preserve old source versions and never refresh checksums implicitly. Restore
   through a temporary file and checksum before rename; refuse to overwrite a
   differing local original. Neither operation recursively uploads `images/`.
3. **Implement missing-only remote preparation.** HEAD every expected variant
   and verify fingerprint, S3 SHA-256, size, dimensions, content type, and cache
   metadata. Existing valid objects need no download/render/upload. For missing
   variants, obtain only the required sources, reuse valid local outputs, render
   missing sizes, and upload using `If-None-Match: *` with an S3 checksum.
   A 403, service failure, or checksum conflict is an error, not a cache miss.
4. **Write and validate a private readiness receipt.** Record schema version,
   account/bucket/distribution/origin, plan digest, manifest/recipe/renderer
   identities, verified time, and each key/checksum/size/dimension. The plan digest
   also covers app image metadata such as IDs/alt text so changes cannot leave
   stale generated metadata. Validate receipts before build and refresh remote
   checks before publication; an old receipt alone is not proof objects still exist.
5. **Support two explicit build modes.** Local remains the default and stages
   WebPs for offline development. CDN mode creates generated app metadata from
   a validated receipt and uses its verified HTTPS image origin; it must work
   with no raw/processed files present. Update all npm pre-hooks and the image
   helper accordingly. Remove only the generated local staging directory when
   entering CDN mode, clean the generated output, and reject local variants,
   originals, receipts, and private metadata in the publishable artifact.

Conditional writes prevent silent replacement of existing keys. On a competing
upload's `412`, re-read and validate the winner; retry bounded transient `409`
conflicts and then verify. Enforce immutable-write conditions on the variants
prefix and keep deletion out of routine roles.
([AWS conditional-write behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html))

Image command output should show counts for remote hits, downloads, rendered
files, uploads, and conflicts. The second unchanged remote run must show
**zero source downloads, zero renders, zero uploads**. Public delivery checks may
download the six processed variants; report those separately from preparation.

**Checkpoint:** a clean CDN-mode build succeeds from a valid receipt without
originals, the local workflow still works, and conflict/stale-receipt tests fail
before any site publication.

### 4. Build publication, verification, and rollback commands

1. **Build a destination-specific artifact.** Resolve stack outputs using the
   selected profile; verify account, stack state, bucket owner, distribution, and
   expected domain. Require an explicit `beta` or `production` target. Produce
   clean output and an external manifest containing file checksums, content types,
   cache classes, image receipt identity, public config, and source revision/dirty
   state. Require a clean source tree for normal production releases; beta can
   record a dirty snapshot explicitly. Never relabel a beta build as production.
2. **Verify and archive before publication.** Check output paths, symlinks,
   secret/raw-file exclusions, all referenced image keys, and environment values.
   Archive the exact static artifact and private manifest under
   `releases/<environment>/<release-id>/` in private storage. The release ID should
   include an artifact digest so two builds of one commit cannot collide. Record
   the currently verified release as the rollback target.
3. **Publish in dependency order.** Upload immutable assets first, then mutable
   supporting files/error pages, then `index.html`, with Nuxt's latest-build marker
   and `build.json` last. Do not run `sync --delete`. Existing immutable keys must
   match or fail. Keep old assets and images. Invalidate `/`, `/index.html`, changed
   mutable paths, and necessary cached error paths; wait for completion.
4. **Verify the actual public build.** Compare the homepage, public build marker,
   and generated asset bytes/checksums with the archived artifact. Check all six
   current image variants via HTTPS, type/cache headers, auth, redirects, noindex,
   and carousel/full-size/no-JavaScript behavior. Do not forward beta credentials
   to image or alternate origins. Mark a release live-verified only after these
   checks pass; keep failures and partial writes visible in the local journal.
5. **Implement rollback through the same publisher.** Select a previous verified
   release for the same environment, restore its archived bytes/config/manifest,
   verify its images remain available, republish in the same order, invalidate,
   and run the same live checks. Do not rebuild old source with today's packages
   or image renderer. Preserve the failed release for diagnosis.

Use a local per-destination lock to prevent overlapping commands on this machine;
document single-operator publication until milestone 5 adds CI serialization.
Conditional image writes protect shared variants independently. Another machine
is not covered by a local lock and must not publish concurrently.

Ordered S3 uploads are not an atomic multi-file release. A failure before HTML
publication should leave the old page usable; failures after mutable files change
may require rollback. Test old-page behavior during publication, especially
`_payload.json` and Nuxt build metadata. If those files prove incompatible across
the current build transition, add release-specific paths for the affected files
before declaring the publisher ready. Do not claim zero-downtime atomic switching.

**Checkpoint:** local failure-injection tests prove destination validation,
ordering, retention, and rollback behavior; the runbook contains exact user-run
commands and distinguishes preview, dry-run, writes, and live verification.

### 5. User-run rollout and recorded verification

1. **Complete local checks and review the live diff.** Run frontend checks,
   Python/image tests, infrastructure assertions, routing/publication tests, and
   both build modes. Inspect prerequisites read-only. Review the proposed access,
   certificate, image, and site changes as a whole before the user executes them.
2. **Provision shared resources and beta.** The user applies access setup with
   the administrator session, then certificate/images/beta with project access.
   Set beta credentials privately; an empty KVS must already deny requests.
   Import the two originals, ensure variants, build beta, archive/publish it, and
   verify both authenticated and unauthenticated behavior.
3. **Exercise beta recovery and repeatability.** Run image preparation again and
   record zero transfers/renders/uploads. Publish a second distinguishable test
   build, roll back to the first archived artifact, and verify its bytes. Rotate
   the beta credential and verify the old one stops working after propagation.
4. **Provision and publish production after beta passes.** Review any existing
   domain content/DNS conflict before replacing it. Generate the production
   artifact independently with the same verified image origin, publish, and
   verify apex/www/HTTP behavior and build identity. Disable beta temporarily
   through its supported command and confirm production/shared images still work;
   re-enable beta after the check.
5. **Write the handoff from observed evidence.** Record the resource IDs/domains,
   deployed release IDs, exact commands/results, image counts, invalidation IDs,
   rollback result, credential-rotation result without values, and unresolved
   issues. Mark local-ready and live-verified separately. Milestone 2 remains
   incomplete if only synthesis passes or production has not been verified.

For the first rollout there is no prior production release. The runbook must
record whether an existing site/DNS target needs restoration; otherwise the
recovery action is to fix forward or disable the new distribution while repairing
it. Never describe an empty release history as a working rollback target.

## Local command interface

**Makefile targets call the Python tools through uv; see the runbooks for profile names and rollout order.**
The existing uv project supplies Python dependencies and the CDK package supplies
infrastructure commands. All commands run from
the repository root; use the actual profile conventions in [ACCESS.md](../cloud/ACCESS.md).

| Purpose | Proposed command | Side effects |
| --- | --- | --- |
| Inspect prerequisites | `make cloud-preflight PROFILE=flat-girl` | AWS/DNS reads; local report |
| Check local infrastructure | `npm run check --prefix cloud/aws` | Typecheck, tests, offline synthesis |
| Preview infrastructure changes | `make cloud-diff PROFILE=flat-girl STACK=beta` | AWS reads and local comparison; no change-set creation |
| Provision access | `make cloud-deploy PROFILE=flat-girl-admin STACK=access BOOTSTRAP=1` | User-run IAM/CloudFormation writes |
| Provision other stacks | `make cloud-deploy PROFILE=flat-girl STACK=certificates` | User-run writes; repeat explicitly for images/beta/production |
| Set/rotate beta login | `make beta-auth PROFILE=flat-girl` | Private prompt and KVS update; no values echoed |
| Import original files | `make sources-import PROFILE=flat-girl` | Verified, missing-only private S3 writes |
| Restore originals | `make sources-pull PROFILE=flat-girl` | Private reads; checksummed local files |
| Preview image work | `make images-ensure PROFILE=flat-girl DRY_RUN=1` | Remote metadata reads; report only |
| Ensure/check variants | `make images-ensure PROFILE=flat-girl` | Missing-only uploads and local receipt; `check` performs reads only remotely |
| Build a site | `make site-build SITE_ENV=beta PROFILE=flat-girl-beta` | Remote verification and local build/archive staging |
| Preview publication | `make site-publish SITE_ENV=beta PROFILE=flat-girl-beta DRY_RUN=1` | Verify artifact/destination and report ordered operations; no AWS writes |
| Publish the built artifact | `make site-publish SITE_ENV=beta PROFILE=flat-girl-beta` | Private archive, site uploads, invalidation; no rebuild |
| Verify live output | `make site-verify SITE_ENV=beta PROFILE=flat-girl-beta` | HTTPS/AWS reads; private auth prompt when needed |
| Restore a release | `make site-rollback SITE_ENV=beta RELEASE=release-id PROFILE=flat-girl-beta` | Archive restore, uploads, invalidation, verification |
| Disable/re-enable beta | `make beta-enabled ENABLED=false PROFILE=flat-girl` | Beta distribution update only; use `true` to restore |

Production site commands use `SITE_ENV=production`; none defaults to production.
Commands that write must validate identity and destination again immediately before
writing. Dry-run must never create a change set, import sources, populate KVS,
upload a release, or invalidate CloudFront. Commands should fail with an actionable
phase/error and preserve a resumable local journal rather than continuing silently.

## Planned file changes

| Area | Files/directories | Responsibility |
| --- | --- | --- |
| Infrastructure | `cloud/aws/{package.json,package-lock.json,cdk.json,project.example.json,bin/,lib/,test/}` | Config/access/stacks, edge policy, offline synthesis, assertions |
| Operator commands | `Makefile` and tested helpers in `tools/` | Prerequisites, private credentials, images, build/publication/verification/rollback |
| Image tooling | `tools/prepare_images.py`, new focused image modules/tests, `tools/pyproject.toml`, `tools/uv.lock` | Plan/render/stage separation and remote/receipt behavior; lock any added SDK dependency |
| Frontend/build | `web/nuxt.config.ts`, `web/app/composables/useImages.ts`, `web/package.json`, browser fixtures/tests, `.gitignore` | Explicit local/CDN mode, generated metadata, noindex, public build marker, generated-file exclusions |
| Documentation | `cloud/{README,ACCESS,IMAGES,DEPLOYMENT}.md`, `README.md`, milestone plans | Exact runbook, resource ownership, credentials/recovery, status and evidence |

Use `.deploy/` for ignored receipts, local reports, manifests, locks, journals,
and release staging; ignore `cloud/aws/cdk.out/` and local profile configuration.
Do not persist plaintext beta credentials. Keep new tooling proportional to this
single static site rather than building a general deployment framework.

## Verification matrix

| Area | Local evidence required | Live evidence required |
| --- | --- | --- |
| Infrastructure/access | Private/versioned/retained buckets; OAC scope; bounded permissions; no beta-to-production dependency; offline synth | Correct identity/resources; stack operations complete; no unrelated DNS changes |
| Beta protection | Missing/wrong auth, cache warm-up, KVS failure, redirects, raw hostname, credential stripping, noindex | Unauthorized page/assets denied; valid login works; rotation verified |
| Routing/cache | Asset versus page paths; repeated/encoded campaign parameters; methods; mutable versus immutable classification | HTTPS and canonical redirects; correct asset types; expected cache/noindex headers |
| Source/variant storage | Missing-only generation; checksum conflict; denied access; conditional-write race; local-source preservation; stale receipt | Originals denied anonymously; six variants delivered; unchanged run has zero source downloads/renders/uploads |
| Build/publication | Clean CDN build without originals; local-mode regression; wrong destination/receipt rejection; upload failure/order; retained assets | Site/image bytes match release; browser carousel/full-size/no-JS passes; private metadata absent |
| Recovery/independence | Archived artifact restores with matching manifest; production artifact cannot use beta config | Beta rollback restores exact build; disabling beta leaves production/images working |

Use mocked AWS responses for deterministic failure tests and a local image-CDN
fixture for browser tests. Live checks are a separate phase against real resources.
Do not make ordinary tests depend on AWS credentials, beta secrets, or external
providers. No signup/tracking requests are expected in this milestone.

## Completion and handoff

- [x] Local implementation is complete, required checks pass, and documented commands match the actual CLI.
- [x] Beta has a live verification record; unauthenticated page/assets are denied, noindex works, and the user confirmed password rotation.
- [x] Production is live-verified at `flatgirl.net`, with working www/HTTPS redirects and the expected release/images.
- [x] Originals remain private, clean CDN builds work, unchanged image checks report zero transfers/renders/uploads, and deployed site/shared resources are independent.
- [x] Release archives and recovery instructions are recorded. The live rollback demonstration was waived by the user; it is not claimed as tested.

**Original planning handoff (before implementation):** inspected the current scaffold, image tool, generated file
layout, and relevant local reference code; consulted AWS documentation for OAC,
certificates, KVS/runtime, caching, and conditional writes. No infrastructure was
inspected live or modified, no dependencies were installed, and no application or
deployment code was changed. Development was subsequently approved; the implementation handoff below supersedes this planning snapshot.

**Next action:** plan milestone 3, Turnstile and Brevo signup.

## Implementation handoff — November 5, 2026

Local implementation is ready for review and user-run rollout. No IAM, storage,
certificate, CDN, DNS, or hosting changes were applied to AWS. No commits or pushes
were made. No AWS-specific skill was installed; AWS CLI/CDK and local references
provided the needed tooling.

| Check | Result |
| --- | --- |
| `npm run check --prefix cloud/aws` | Typecheck, 3 routing/auth/infrastructure tests, and offline example synthesis passed |
| `npm run synth --prefix cloud/aws` | All 5 stacks synthesized for the discovered account/zone; inline templates remain below the size limit |
| `npm run test:images --prefix web` | 8 Python tests passed, including remote reuse/conflicts, source preservation, publication ordering/failure, artifact restoration and tamper rejection |
| `npm run typecheck --prefix web` and `npm run generate --prefix web` | Passed in local mode |
| `npm run test:e2e --prefix web` | 4 local-image Chrome tests passed |
| `npm run test:cdn --prefix web` | Isolated typecheck/build and 4 Chrome tests passed without raw/processed images in that checkout; mock CDN requests served prepared fixtures |
| `make cloud-preflight PROFILE=default` | Underlying tool passed before Makefile migration; account/zone and public NS delegation match; DNS snapshot saved privately |
| `make cloud-diff PROFILE=default STACK=access` | Underlying tool passed before Makefile migration; proposed access changes saved to ignored `.deploy/access.diff` |

The reference image keys are preserved. Current local preparation reports
0 rendered / 6 reused. Remote zero-transfer behavior is tested with mocked AWS;
it still needs real deployment verification. Read-only inventory found no Flat Girl
buckets, stacks, matching certificate, or CloudFront alias. Existing email DNS was
read and preserved.

Implementation adjustments to the draft:

1. Discovery found only root in the selected profile and no Flat Girl human
   operator. The access template therefore prepares a dedicated operator user
   without a password/access keys, plus the project roles. Private login setup
   remains user-run; an existing human ARN can be selected instead.
2. Beta and production publication use separate role profiles, documented in
   [ACCESS.md](../cloud/ACCESS.md). The operator handles infrastructure/auth/source
   import; publisher roles cannot administer IAM or rotate beta credentials.
3. AWS CLI JSON via `/dev/stdin` failed on this installation. The adapter uses a
   mode-600 temporary JSON file and deletes it afterward. Plaintext beta passwords
   never enter that file, command arguments, templates, artifacts, or logs.
4. This small site uses a single `/*` invalidation per publication to refresh
   entrypoints and cached missing paths. All old immutable objects remain available.
   Rollback requires a remotely recorded verified release and restores archived bytes.
5. Clean-checkout testing required an explicit pinned `@types/node` dependency.
   The CDN fixture copies dependencies instead of symlinking them because Nuxt
   resolves server imports/caches against real module paths.

At the original implementation handoff, live rollout was still pending. The
completion record below supersedes that status and records the user's waiver
and the limits of observed verification.

The shell wrappers were subsequently replaced with root Makefile targets at the
user's request. Python tool behavior is unchanged. `make help` lists commands;
profile/environment inputs are explicit. Make target dispatch and argument guards
were checked offline without calling AWS.

## Live completion handoff — November 5, 2026

The core milestone 2 acceptance criteria in the roadmap are satisfied. Both sites
serve the scaffold through independent hosting, shared processed images work,
originals remain private, and local publication/verification/recovery commands are
documented. Rollout was executed by the user; completion checks were read-only.

| Area | Observed evidence |
| --- | --- |
| Infrastructure | All five Flat Girl stacks are `CREATE_COMPLETE` |
| Production | `https://flatgirl.net`; release `20261106T011721Z-320dc4f4099d`, reverified at 7:22 p.m. America/Chicago on November 5 |
| Beta | `https://beta.flatgirl.net`; release `20261106T001153Z-c2bcf2c1e246`, verified at 7:11 p.m. America/Chicago; private verification proof is archived |
| Authentication | Fresh unauthenticated requests to beta's homepage and a JS asset returned 401/noindex on both custom and CloudFront hostnames; password rotation confirmed by the user |
| Images and privacy | Six CDN variants passed checksum/type/cache checks; metadata check reported 6 hits, 0 downloads, 0 renders, 0 uploads, 0 missing; anonymous source/site-origin access denied |
| Routing and browser behavior | Production bytes, redirects, headers, and noindex passed the verifier; live Chrome checks passed at 375px and 1280px, including carousel navigation/full-size CDN links, plus the no-JavaScript gallery |
| Separation and DNS | Separate beta/production buckets and three distinct distributions; production/images/certificate templates have no beta-stack references; all original DNS records preserved |

Release IDs use UTC timestamps, so their `20261106` prefix corresponds to the
evening of November 5 in the user's America/Chicago timezone.

| Resource | Deployed identity |
| --- | --- |
| Beta distribution | `EC80IE7BRT77J` / `d2juao8jjhvglt.cloudfront.net` |
| Production distribution | `EN7BI4NYGI7I9` / `d3i47mphxtr1dk.cloudfront.net` |
| Image distribution | `EMQHOGJ7843NP` / `d3b8w3sq5hpb4e.cloudfront.net` |
| Site buckets | `flat-girl-beta-066540957026-us-east-1`, `flat-girl-production-066540957026-us-east-1` |
| Private source/archive and variants buckets | `flat-girl-sources-066540957026-us-east-1`, `flat-girl-variants-066540957026-us-east-1` |

Verification limits and scope decisions:

1. The user explicitly does not require the live rollback drill. Only one beta
   release is archived; no rollback to a distinct prior release is claimed.
   Offline artifact-restoration tests and the operating instructions remain available.
2. Password rotation is user-confirmed. No password or credential digest was
   requested or read during this audit.
3. The beta distribution is enabled and its stack history contains no updates.
   Resource independence is established by deployed topology, not by a live
   disable/re-enable exercise. That additional operational drill remains untested.
4. The older local beta journal still says `awaiting-verification`, despite the
   later successful local and archived verification records. Those proof records
   establish verification; the stale journal is not used as evidence of a failure.

Production intentionally remains the minimal scaffold with noindex. Signup,
tracking, GitHub automation, and final page content remain milestones 3–6.

**Next action:** write the detailed milestone 3 plan before implementation.
