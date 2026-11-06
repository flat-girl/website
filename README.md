# Boring Flat Girl

Minimal Nuxt + Tailwind static site: a heading, Sarah front/back carousel,
full-size image links, and a working launch-notification form. Milestones 1–3
are complete for their core scope; beta and production are deployed.
Production: <https://flatgirl.net>.
Final landing-page content and branding come later.
Signup is enabled with beta list **5**, production list **4**, shared provider
keys, and a Brevo-managed welcome email. See the [signup runbook](cloud/SIGNUP.md)
and [milestone 3 completion handoff](docs/milestone-3-plan.md#completion-handoff--november-5-2026).
Milestone 4 Meta CAPI is implemented and checked locally with SQS delivery, durable DynamoDB event records, and a
dedicated beta dataset. See the [plan](docs/milestone-4-plan.md) and
[Meta setup/runbook](cloud/META.md); it has not been deployed.
See the [roadmap](docs/IMPLEMENTATION-PLAN.md) and
[milestone 1 plan](docs/milestone-1-plan.md).

## Run locally

Requires Node 24 (`.nvmrc`), uv, and Python 3.14 (managed by uv if needed).
From the repository root:

```sh
npm ci --prefix web
uv sync --locked --project tools
npm run dev --prefix web
```

Open the localhost URL printed by Nuxt. Both dev and generate prepare images
automatically. On a new checkout, first restore the two supplied originals into
`images/raw/` using the filenames recorded in `images/manifest.json`; these files
are intentionally excluded from Git. After provisioning the image stack, restore
them with `make sources-pull PROFILE=flat-girl`.

## Static build and preview

```sh
npm run generate --prefix web
npm run preview --prefix web
```

Preview: <http://127.0.0.1:3000>. Deploy **only `web/.output/public/`**.
It contains `index.html`, generated `200.html`/`404.html` fallbacks, `/_nuxt/`
assets, Nuxt payload files, and `/variants/` images. CloudFront must serve asset
paths as files, not rewrite them to HTML. There is no production Nuxt server.

## Images

`tools/prepare_images.py` uses Pillow with uv-locked dependencies:

```sh
make images-prepare
uv run --locked --project tools python tools/prepare_images.py --check
```

Raw PNG/JPEG/WebP files stay in ignored `images/raw/`. Clean WebPs and metadata go to ignored
`images/processed/`. Only listed WebPs are copied to `web/public/variants/`;
metadata is imported into the app from generated source. Each image has 480px,
960px, and native-resolution versions. The full-size version loads when its link
is opened. Normal carousel display uses the smaller two with responsive markup.

Output URLs fingerprint the source, transform, Pillow/libwebp versions, and
renderer revision. Unchanged runs reuse validated outputs. Missing/corrupt local
outputs are regenerated. After adding or replacing files in `images/raw/`, run:

```sh
make images-prepare
```

This discovers new PNG/JPEG/WebP files, adds manifest entries with filename-based
IDs and default alt text, refreshes source checksums/dimensions, and prepares variants.
Existing IDs, alt text and order are preserved; new files append in filename order.
No manual manifest entry or AWS profile is needed. Review the generated alt text
and commit the manifest diff; never commit raw/processed image directories.
Keep old published variants for rollback. [Shared image commands](cloud/IMAGES.md)
now provide conditional CDN uploads and verified URL receipts.

## Checks

```sh
npm run typecheck --prefix web
npm run test:images --prefix web
npm run generate --prefix web
npm run images:check --prefix web
npm run test:e2e --prefix web
npm run test:signup --prefix web
```

Browser checks use installed Google Chrome and start/stop a static preview server.
They cover phone/desktop layout, carousel navigation, full-size links, no-JavaScript
content, and failed asset requests. Run generation before the browser checks.

## Deployment plan

Milestone 2 defines separate beta (`beta.flatgirl.net`, Basic Auth/noindex) and
production (`flatgirl.net`) S3/CloudFront sites, plus shared image hosting.
Milestone 5 adds GitHub deployment:

- Push to `main`: deploy beta only when `DEV_DEPLOY_ENABLED=true`.
- Publish a non-prerelease GitHub release: deploy its exact tagged commit to production.

Milestone 2 infrastructure and local deployment commands are live-verified.
See [AWS access](cloud/ACCESS.md) and [deployment and rollback](cloud/DEPLOYMENT.md)
for ongoing operations. GitHub automation stays in
milestone 5. See the [milestone 2 plan](docs/milestone-2-plan.md).

Run `make help` for local AWS commands. Targets call the Python tools through uv:

```sh
make images-check PROFILE=flat-girl
make site-publish PROFILE=flat-girl-beta SITE_ENV=beta DRY_RUN=1
```
