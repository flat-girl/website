# Local rollout and rollback

**User-run rollout; not yet executed.** Complete [access setup](ACCESS.md) first.
The current production artifact is the plain scaffold with temporary noindex.
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
denies access. Credential setup prompts privately for a username and a generated
24+ character password. Only its authorization digest reaches KVS. The AWS CLI
adapter uses a mode-600 temporary JSON file, deleted on command completion, to
keep the digest out of arguments/logs; it never writes the password. Ordinary
stack updates preserve KVS contents.

The shared certificate covers apex/www/beta, independent of the beta stack.
Only project A/AAAA and ACM validation records are managed. Preserve existing
MX, TXT, mail aliases, and domain delegation.

## 2. Import images and publish beta

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
   works and the old credential is rejected after edge propagation.
5. Record results in `docs/milestone-2-plan.md` without passwords or digests.

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
