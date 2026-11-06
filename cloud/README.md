# Flat Girl AWS hosting

Local infrastructure and deployment tooling for milestone 2. Nothing has been
deployed by the agent. Start with [access setup](ACCESS.md), then follow
[deployment](DEPLOYMENT.md). [Images](IMAGES.md) describes source recovery and
the shared CDN.

Run `make help` to list the operator commands. The root Makefile calls the Python
tools through uv; there are no shell-wrapper scripts. AWS targets require an
explicit `PROFILE`, and site targets also require `SITE_ENV`.

The architecture uses five stacks: access, shared certificate, shared images,
beta site, production site. Four private/versioned S3 buckets hold sources plus
release archives, processed variants, beta, and production. Three CloudFront
distributions expose the two sites and the processed images. Production and
images do not depend on beta. Basic Auth protects beta's site files; shared
images are public.

## Local checks

```sh
npm ci --prefix cloud/aws
npm run check --prefix cloud/aws
npm run test:images --prefix web
npm run typecheck --prefix web
npm run generate --prefix web
npm run test:e2e --prefix web
npm run test:cdn --prefix web
```

The CDN test uses an isolated checkout without originals/processed files and
mock image responses in Chrome. It does not contact AWS. Runbooks assume the
repository root, Node 24, uv/Python, AWS CLI v2, and Google Chrome for browser
checks. In the restricted agent environment, use
`UV_CACHE_DIR=/tmp/flat-girl-uv-cache` and permit localhost for browser checks.

Configuration lives in ignored `cloud/aws/project.json`, initialized on this
machine from read-only discovery. `project.example.json` supports offline checks.
Keep credentials out of both. `.deploy/` contains ignored receipts, DNS snapshots,
artifacts, verification records, and operation journals.

CDK synthesizes inline templates without CDK bootstrap or asset publishing.
Local commands execute explicit stacks; certificate must precede the sites.
Templates exceeding the inline size limit fail instead of gaining implicit
asset-upload privileges. The shared certificate is retained on removal.
