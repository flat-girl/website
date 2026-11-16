# Production routing-version recovery

Historical recovery from November 6, 2026. Superseded by the shared-edge architecture; retained for incident context.

Run commands from the repository root. This records a specific rollout or recovery;
check its applicability before reusing it.

Production's first delivery-fix deployment rolled back because the version-ID
change tried to publish an unchanged routing Lambda again. AWS rejected it with
`A version for this Lambda function exists (1)`. Beta has no routing Lambda@Edge
function, so its deployment succeeded.

The local fix preserves the original routing-version identity. Read-only template
comparison confirmed no beta changes and no production routing changes; only the
production tracking Lambda/version and CloudFront association change. Rollback
finished in `UPDATE_ROLLBACK_COMPLETE`, so retry the normal deployment:

```sh
make cloud-diff PROFILE=flat-girl STACK=production
make cloud-deploy PROFILE=flat-girl STACK=production
```

That version-ID correction required no deletion or repeat beta deployment. It was
verified against the deployed templates. The subsequent
[shared-router revision](20261106_SHARED_EDGE_MIGRATION.md) intentionally changes
routing code in both environments and publishes new versions.
