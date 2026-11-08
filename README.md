# Boring Flat Girl

Minimal Nuxt static site with plain CSS: a heading, product-photo carousel,
a zoomable full-size photo viewer, and a working launch-notification form. Milestones 1–3
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

## Admin dashboard

The separate `admin/` Nuxt/Tailwind dashboard shows recorded signups, views, event
rates, daily/weekly patterns, and DLQ health. It uses Basic Auth and a persistent
DynamoDB rollup cache. Deployed at <https://admin.flatgirl.net>; see the
[admin runbook](cloud/ADMIN.md) for development, checks, and isolated deployment.

## Run locally

Requires Node 24 (`.nvmrc`), uv, and Python 3.14 (managed by uv if needed).
From the repository root:

```sh
npm ci --prefix web
uv sync --locked --project tools
npm run dev --prefix web
```

Open the localhost URL printed by Nuxt. Both dev and generate prepare images
automatically. The notification form is always shown. In `npm run dev`, it
posts to a local mock at `/api/subscribe`. The form uses the same markup,
privacy text, and verification flow in every environment. Nuxt's development
configuration supplies Cloudflare's [public Turnstile test key](https://developers.cloudflare.com/turnstile/troubleshooting/testing/);
no signup is stored and no email is sent. No private API keys or signup environment
variables are needed. Turnstile requires a network connection; browser tests stub
its script for offline checks. Generated builds use the configured live API.
Check the local flow with
`npm run test:signup:dev --prefix web`.

### Local signup error scenarios

Enter these in the email field while running `npm run dev`. The mock backend
returns the corresponding response; the frontend uses its normal error handling.

| Input | Backend response | Expected form behavior |
| --- | --- | --- |
| `not-an-email` | 400, invalid email syntax | “Please check your email address and try again.” |
| `rate-limit@example.com` | 429 | “Too many requests right now. Please wait a minute and try again.” |
| `verification@example.com` | 403 | “Please complete a new verification and try again.” |
| `server-error@example.com` | 503 | “We couldn’t confirm your signup. Your email is still here—please try again.” |
| `timeout@example.com` | Delays 20 seconds | The form aborts after 18 seconds and shows the same confirmation-failed message. |
| `malformed@example.com` | 200 with invalid JSON | Same confirmation-failed message. |
| `unexpected@example.com` | 200 with `{ "accepted": false }` | Same confirmation-failed message. |
| `reader@example.com` | 200 with `{ "accepted": true }` | Success message. |

Special addresses are case-insensitive and ignore surrounding whitespace.
Each submission repeats that scenario. Editing the email clears the error;
change to `reader@example.com` to test recovery. Other syntactically valid
addresses also succeed. These scenarios exist only in the local backend and
never send email or create contacts.

Browser-side failures cannot be selected through a backend email address:

- For a network failure, finish verification, set DevTools Network to Offline,
  then submit. Restore connectivity before retrying.
- For a Turnstile loading failure, block `challenges.cloudflare.com` in DevTools
  and reload. Unblock it and select “Retry verification” to recover.
- Turnstile expiry and widget failures happen before submission and need widget
  callbacks/test fixtures; the API's `verification@example.com` case tests a
  rejected token after submission instead.
- The hidden spam-trap message happens before any API request. To exercise it,
  set `#signup-website` to a nonempty value in DevTools, dispatch an `input` event
  so Vue receives the change, then submit.

On a new checkout, first restore the two supplied originals into
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

To regenerate the square head icon from `sarah-front`:

```sh
make image-crop
make images-prepare
```

Adjust `LEFT`, `TOP`, and `SIZE` at the top of `tools/crop_icon.py` to tweak the framing.
Values are pixels in the original image: `LEFT`/`TOP` locate the upper-left corner,
and `SIZE` sets both square dimensions. The default intentionally cuts off outer
hair. Each crop run overwrites `images/raw/sarah-icon.png` at native resolution,
preserving transparency. The original front image is preserved. Run
`make images-prepare` after each crop to refresh its manifest entry and web variants.

The `sarah-icon.png` manifest entry selects `"recipe": "favicon"`. Its settings in
`images/recipes.json` generate lossless PNGs at 32×32 and 64×64 for browser favicons
and 180×180 for the Apple touch icon. The raw input must be square and at least
180×180. The page uses the generated icon URLs in local and CDN builds; a new
crop produces new fingerprinted URLs after `make images-prepare`.

`tools/prepare_images.py` uses Pillow with uv-locked dependencies:

```sh
make images-prepare
uv run --locked --project tools python tools/prepare_images.py --check
```

Raw PNG/JPEG/WebP files stay in ignored `images/raw/`. Clean WebPs, favicon PNGs, and metadata go to ignored
`images/processed/`. Only listed variants are copied to `web/public/variants/`;
metadata is imported into the app from generated source. Each default-recipe image has 480px,
960px, and native-resolution versions. Normal carousel display uses the smaller
two with responsive markup. After the page loads, the selected carousel-sized
photos preload first, followed by native-resolution photos one at a time at low
priority. Clicking “View full size” opens a full-screen viewer with
next/previous navigation, click or pinch zoom, and drag-to-pan. Zoom buttons,
arrow keys, and Escape are also supported. Without JavaScript, the full-size
links still open the original images.

Output URLs fingerprint the source, transform, Pillow/libwebp versions, and
renderer revision. Unchanged runs reuse validated outputs. Missing/corrupt local
outputs are regenerated. After adding, replacing, or removing files in `images/raw/`, run:

```sh
make images-prepare
```

This discovers new PNG/JPEG/WebP files, adds manifest entries with filename-based
IDs and default alt text, refreshes source checksums/dimensions, and prepares variants.
Existing IDs, alt text and order are preserved; new files append in filename order.
Deleted sources are removed from the manifest and generated metadata, and obsolete
local variants are removed from `images/processed/` and `web/public/variants/`.
Ordinary builds and checks still reject missing sources until this refresh is run.
No manual manifest entry or AWS profile is needed. Prepared assets are available
to the app but do not automatically appear on the page: the Sarah carousel explicitly
selects image IDs in `web/app/components/SarahCarousel.vue`. Remove any deleted
images from that selection too. Review the generated alt text
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
They cover phone/desktop layout, carousel navigation, photo zoom/pan, preload ordering, no-JavaScript
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
