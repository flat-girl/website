# Boring Flat Girl

Minimal Nuxt static site with plain CSS: a heading, product-photo carousel,
a zoomable full-size photo viewer, and a working launch-notification form. Milestones 1–3
are complete for their core scope; beta and production are deployed.
Production: <https://flatgirl.net>.
Final landing-page content and branding come later.
Signup is enabled with beta list **10**, production list **9** (local configuration; rollout pending), shared provider
keys, and a Brevo-managed welcome email. See the [signup runbook](SIGNUP.md)
and [milestone 3 completion handoff](plans/milestone-3-plan.md#completion-handoff--november-5-2026).
Meta CAPI is deployed with SQS delivery, durable DynamoDB event records, and a
dedicated beta dataset. See the [plan](plans/milestone-4-plan.md) and
[Meta setup/runbook](META.md).
See the [roadmap](plans/IMPLEMENTATION-PLAN.md) and
[milestone 1 plan](plans/milestone-1-plan.md).

## Admin dashboard

The separate `admin/` Nuxt/Tailwind dashboard shows recorded signups, views, event
rates, daily/weekly patterns, and DLQ health. It uses Basic Auth and a persistent
DynamoDB rollup cache. Deployed at <https://admin.flatgirl.net>; see the
[admin runbook](ADMIN.md) for development, checks, and isolated deployment.

## Run locally

Requires Node 24 (`.nvmrc`), uv, and Python 3.14 (managed by uv if needed).
From the repository root:

```sh
npm ci --prefix web
uv sync --locked --project tools
npm run dev --prefix web
```

Open the localhost URL printed by Nuxt. Both dev and generate prepare images
automatically. Development opens the purchase page; it uses mocks unless the shared Shopify source switch below is enabled. Open `/?commerce=waitlist` for
the launch form or `/?commerce=sold-out` for the sold-out form; both post to a
local mock at `/api/subscribe`. The form uses the same markup,
privacy text, and verification flow in every environment. Nuxt's development
configuration forces local endpoints and supplies Cloudflare's [public Turnstile test key](https://developers.cloudflare.com/turnstile/troubleshooting/testing/);
no signup is stored and no email is sent. No private API keys or signup environment
variables are needed. Turnstile requires a network connection; browser tests stub
its script for offline checks. Generated builds use the configured live API.
Check the local flow with
`npm run test:signup:dev --prefix web`.

### Local signup error scenarios

Open `/?commerce=waitlist` first.

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
Keep old published variants for rollback. [Shared image commands](IMAGES.md)
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
See [AWS access](ACCESS.md) and [deployment and rollback](DEPLOYMENT.md)
for ongoing operations. GitHub automation stays in
milestone 5. See the [milestone 2 plan](plans/milestone-2-plan.md).

Run `make help` for local AWS commands. Targets call the Python tools through uv:

```sh
make images-check PROFILE=flat-girl
make site-publish PROFILE=flat-girl-beta SITE_ENV=beta DRY_RUN=1
```


## Local commerce preview

```sh
npm run dev --prefix web
```

Open `http://localhost:3000/`. With `FLAT_GIRL_COMMERCE_SOURCE=local` (the default), no Shopify token is needed.
Checkout opens a clearly labeled local mock page; no cart, order, payment or email
is created. The `shopify` setting below reads real store data and creates a real
Shopify cart only when Buy now is clicked.
Photo assets are local; Turnstile uses its public test key and still needs
connectivity in manual previews. Browser tests replace its script offline.

Edit copy in `web/app/content/storefront.ts`. Add an optional `notes` array to
any policy entry there: each note is an author-written HTML string beneath
the page title, above the fetched policy. Use `<strong>`, `<em>`, links, paragraphs
or lists. Notes are trusted repository content, not API/user input, and share the
policy's rich-text styling. Notes stay editable locally when
Shopify updates its policy content. The parent supplies every
launch/sold-out-specific input to `SignupForm`, including optional request
metadata. The form itself has no purpose/mode prop. Price and stock come from
commerce responses. Current UI has no installments or subtotal; Free Shipping!
is a separate line below the price. The Christmas asterisk is plain text.

Choose a scenario with `/?commerce=NAME`; switches apply only in development
with the `local` source. Shopify mode ignores them:

| Scenarios | Behavior |
| --- | --- |
| `available` (default), `low-stock`, `unknown-stock` | 327 available, 2 available, or no exact inventory count |
| `waitlist`, `closed`, `sold-out` | Launch form, sales-closed launch form, sold-out form |
| `slow`, `timeout`, `error`, `malformed` | Delayed loading, read timeout, service failure, malformed product |
| `checkout-slow`, `checkout-timeout`, `checkout-error`, `rate-limited`, `unsafe-checkout` | Pending/timeout/retry behavior; unsafe URL cannot leave localhost |
| `price-changed`, `quantity-changed`, `stock-changed`, `sales-closed` | Checkout conflict refreshes price to $64, stock to 2, sold out, or closed sales |

For `quantity-changed`, select more than two before buying. Fixtures are
stateless: conflict refreshes include a dev-only `updated=1` query; reload resets
the scenario. Persistent errors keep failing until you select another scenario;
browser tests intercept the next request to verify successful manual retry.
No scenario selector is added to the product page.

Footer policy pages fetch `/api/commerce/policies/:handle`. Local source returns
editable drafts that are absent from generated client bundles. Shopify source
queries the store’s `shop` GraphQL fields on every request, without a content cache. Contact information and
final privacy/terms content must be supplied before launch.

```sh
npm run typecheck --prefix web
npm run test:commerce:dev --prefix web
npm run test:signup:dev --prefix web
npm run generate --prefix web
```

If the sandbox cannot write the normal uv cache, prefix these commands with
`UV_CACHE_DIR=/private/tmp/flatgirl-uv-cache`. Tests require a local Chrome install.
Dev tests can reuse an existing local Nuxt server; they do not stop it. Their
preflight refuses Shopify source before any checkout test runs. Set the source
to local and restart before running them. `npm run test:commerce:service --prefix web`
tests the Shopify adapter with injected responses, without a server or token.

Generated builds default to waitlist mode and ignore scenario query parameters.
An explicit commerce build needs `FLAT_GIRL_STOREFRONT_MODE=commerce` and
`NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN`. Leave `FLAT_GIRL_COMMERCE_ENDPOINT`
unset: static hosting calls Shopify directly. Published sold-out states use the same signup request and endpoint as the
launch form (beta list 10, production list 9 after the signup-stack rollout). Policies fetch after mounting;
without JavaScript, their page shell explains the requirement. Generation
prerenders all five policy routes. The publisher accepts only their HTML/payload
paths; the edge router serves their index documents after beta authentication.
The routing change must be deployed with the beta stack before publication. No backend routes are deployed by Nuxt generation.

For static browser validation while dev uses port 3000, run the following
**test-only builds**, whose network responses are intercepted by Playwright:

```sh
FLAT_GIRL_SIGNUP_ENDPOINT=https://signup.invalid/subscribe FLAT_GIRL_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run generate --prefix web -- --dotenv /dev/null
FLAT_GIRL_TEST_PORT=3001 FLAT_GIRL_TEST_SIGNUP=true npm run test:e2e --prefix web

FLAT_GIRL_STOREFRONT_MODE=commerce NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN=test-public-token FLAT_GIRL_SIGNUP_ENDPOINT=https://signup.invalid/subscribe FLAT_GIRL_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run generate --prefix web -- --dotenv /dev/null
FLAT_GIRL_TEST_PORT=3001 FLAT_GIRL_TEST_COMMERCE=true npm run test:e2e --prefix web -- commerce.spec.ts
```

Do not publish these test artifacts. Run ordinary `npm run generate --prefix web`
afterward to restore the default waitlist output. The normal deployment pipeline
continues to supply the environment's real signup settings.


### Load from Shopify or local

One setting controls **product, policy and checkout** data during development.
Copy `web/.env.example` to `web/.env` if it does not exist, and set:

```dotenv
FLAT_GIRL_COMMERCE_SOURCE=shopify
NUXT_SHOPIFY_STOREFRONT_TOKEN=your-private-headless-storefront-token
```

Use `FLAT_GIRL_COMMERCE_SOURCE=local` for the original local fixtures. Restart
`npm run dev --prefix web` after changing the source. Nuxt also watches `.env`
changes in an existing development session. `.env` is gitignored; the private token is
server-only and is never included in public runtime configuration. Use the
**private Storefront API token** from the Headless channel, not the storefront
password or an Admin API token. Do not overwrite an existing `.env` to switch modes.

To try direct browser access **without the private token**, add this to `web/.env`:

```dotenv
FLAT_GIRL_COMMERCE_SOURCE=shopify
NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN=your-public-headless-storefront-token
```

Restart the dev server. A nonempty public token takes precedence for products,
policies and checkout, sending requests directly from the browser to Shopify.
There is no fallback to the private token if public access fails; you can remove
or blank `NUXT_SHOPIFY_STOREFRONT_TOKEN` for this test. Clear the public token to
return to private/server access. The public token is intentionally visible in
browser configuration: never put a private or Admin token in this variable.
The shared HTML sanitizer preserves policy rich text in both modes.
In browser Network tools, verify requests to the store's `/api/2026-10/graphql.json`
with `X-Shopify-Storefront-Access-Token`, rather than `/api/commerce`.
The owner reports public-token access working locally. Generated beta checkout
remains a Session 4 check; this switch does not change Shopify payment settings.
The five-item cap is a UI convenience, not a hard purchase restriction (owner
decision November 16). Inventory and sales closure still need Shopify enforcement.

Shopify source:

- Reads the configured variant from `tepwtx-zw.myshopify.com`, API `2026-10`,
  including price and online sellable inventory. Normalizes `60.0` to `60.00`.
- Reads current Shopify policy bodies into supported rich-text elements: headings,
  bold/italic text, lists, line breaks, tables and clickable links. Vue renders a
  validated element tree, never raw HTML; scripts, event handlers and unsafe URLs
  are removed. Plain paragraphs remain in the response for older clients. Empty policies produce a 404
  and an unpublished message; there is no silent fallback to local policy text.
- Buy now validates quantity (1–5), current price and stock, creates a cart for
  the fixed variant, checks cart lines, subtotal, warnings and checkout host,
  then opens Shopify checkout. No automatic retry and no payment submission.
- Does not change Shopify payment test mode or storefront publication settings.
  Verify payment test mode in Shopify before manually completing a checkout.
- Leaves signup on its local Brevo mock. This switch selects Shopify commerce;
  it does not connect the separate signup provider.

The storefront password is for visitors to Shopify-hosted pages. It is not API
authentication. A tokenless query to this store returned “Online Store channel
is locked”; the private Headless token successfully read policies and inventory
while the store stayed private. There is no need to embed a storefront password
in our frontend. If testing hosted checkout requires storefront login, use the
Shopify password form in that browser; the redirect theme must preserve a usable
password page (see `docs/SHOPIFY.md`).

With a public token, the shared adapter runs directly in the browser, including
static AWS builds. Without it, private-token requests use the local Nuxt server
only. A normal generated build stays in waitlist mode and does not connect to
Shopify during generation. `make site-build` ignores `web/.env`, checks public
settings, removes private-token/unchecked public overrides, and records commerce
settings in the release manifest. See [beta migration workflow](workflows/20261116_BETA_SHOPIFY_COMMERCE_MIGRATION.md).
