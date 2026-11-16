# Shared beta and production edge migration

Migration date: November 6, 2026. Replaces the original beta edge architecture and preserves its password.

Run commands from the repository root. This records a specific rollout or recovery;
check its applicability before reusing it.

This supersedes beta's original CloudFront-Function/origin-response arrangement.
Both distributions now use the exact same handler source files:

| Concern | Shared implementation |
| --- | --- |
| Routing | `edge-router.cjs`, Lambda@Edge viewer request |
| Attribution and ViewContent | `edge.cjs`, Lambda@Edge viewer response |
| Runtime | Node.js 24, x86_64, 512 MB, 5-second function timeout |
| Caching | Same cache policy and published object Cache-Control values |
| Environment configuration | Hostname, queues, cookies, credentials and beta-only Basic Auth/noindex |

CloudFront Functions are suitable for faster lightweight routing, but cannot send
to SQS. AWS [disallows mixing them with Lambda@Edge viewer handlers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-function-restrictions-all.html).
Using shared Lambda@Edge handlers makes beta exercise production's tracking/cache
path. It is a parity correction, not a claim that Lambda is faster for routing.

Beta auth moves to an SSM SecureString at
`/flat-girl/beta/authorization-sha256`. The migration copies the existing digest
from the retained KVS without displaying it or changing the password. Only beta's
routing role can read that parameter; the tracking role cannot read SSM. Auth reads
are cached for 60 seconds and fail closed after expiry. Missing credentials return
503; incorrect/missing Authorization returns 401. Production never reads auth configuration.

Wait for any current deployment to finish. Then apply this revision in order:

```sh
make cloud-diff PROFILE=default STACK=access
make cloud-deploy PROFILE=default STACK=access BOOTSTRAP=1
make beta-auth-migrate PROFILE=flat-girl
make cloud-diff PROFILE=flat-girl STACK=beta
make cloud-deploy PROFILE=flat-girl STACK=beta
make site-verify PROFILE=flat-girl-beta SITE_ENV=beta
```

Verify beta still requires the existing password, including for cached assets,
and that authorized page reloads produce ViewContent records on cache hits.
Then deploy the same handlers to production:

```sh
make cloud-diff PROFILE=flat-girl STACK=production
make cloud-deploy PROFILE=flat-girl STACK=production
make site-verify PROFILE=flat-girl-production SITE_ENV=production
make meta-status PROFILE=flat-girl SITE_ENV=production
```

No frontend rebuild, signup deployment or Meta credential changes are needed for
this parity revision. For future password rotation, `make beta-auth PROFILE=flat-girl`
updates both SSM and the retained KVS; allow 60 seconds for auth caches to refresh.
Keep the KVS for rollback compatibility. IaC tests assert matching triggers,
cache policy and router source. Synthesized JSON is compacted to keep the existing
inline-template limit without adding an asset-publishing system.
