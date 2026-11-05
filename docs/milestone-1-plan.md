# Milestone 1 — Nuxt static hello world and image carousel

Status: implemented and locally verified, November 5, 2026. Not deployed. Implementation target: about 20 minutes for this minimal scope;
dependency downloads or environment problems may add time.

## Target result

A plain page with `<h1>Boring Flat Girl</h1>`, Sarah's front/back carousel, and
Nuxt + Tailwind generating `web/.output/public` for later AWS hosting.
Final content, style, branding, and images remain milestone 6.

## Implementation sequence

### 1. Establish Nuxt and Tailwind

Create `web/` with Nuxt 4, strict TypeScript, Tailwind 4 through
`@tailwindcss/vite`, and a committed npm lockfile. Record the supported Node
version. Prerender `/` with SSR enabled and the static Nitro preset; set the
page title to `Boring Flat Girl` and language to English.

Provide dev, generate, static preview, and typecheck commands. Dev and generate
run the Python image preparation first. Use Big Naturals as the configuration
reference without copying its business UI or AWS settings.

### 2. Prepare images with Python + uv

Create a small uv project in `tools/`: `pyproject.toml`, `uv.lock`, a Python
version pin, and `prepare_images.py` using Pillow. No Node/Sharp resizing.
Run it from the repository root with:

```sh
uv run --locked --project tools python tools/prepare_images.py
```

Use this separation:

| Location | Purpose | Publication |
| --- | --- | --- |
| `images/raw/` | Untouched source PNGs | Git-ignored; never included in site/CDN uploads |
| `images/processed/` | Generated, clean WebP variants and metadata | Git-ignored; only listed image outputs are staged for publication |
| `images/manifest.json`, `images/recipes.json` | Source IDs/checksums and resize settings | Tracked build inputs, outside public output |

The two supplied originals now live in `images/raw/`, with their bytes and
filenames preserved. Both are 1696 × 2528:
`sarah_front_no_outline_v3.9.2.png` and `sarah_back_no_outline_v3.2.2.png`.
Until private source storage is set
up in milestone 2, another checkout needs these raw files supplied separately.
Any later private-source backup/import is separate from site/image publication.

Generate **three WebPs per source**:

| Variant | Dimensions | Use |
| --- | --- | --- |
| Small | 480px wide, proportional height | Normal carousel display |
| Large | 960px wide, proportional height | Sharper display on dense screens |
| Full | Original dimensions: 1696 × 2528 for these sources | Expanded view, fetched only when opened |

Limit the carousel to 480 CSS pixels wide and use the small/large pair in
`srcset` with matching `sizes`. Keep the full image out of that `srcset` so it
isn't downloaded just to show the carousel. Full means a processed WebP at native
resolution, not the raw PNG. Start at WebP quality 85 for small/large and 90 for
full. Preserve transparency and aspect ratio, apply orientation before stripping
metadata, and never crop or upscale. Deduplicate sizes for smaller future inputs.

Keep the tool small: record source checksums/dimensions, derive output keys from
source bytes + recipe + renderer versions, and reuse valid existing outputs.
Regenerate missing/corrupt processed files; fail clearly for missing sources or
unexpected source changes. Document how to refresh checksums after intentional
source replacement. Use a tiny focused test for reuse and changed-input keys.

Stage only manifest-listed WebPs into `web/public/variants/` using paths such as
`variants/<fingerprint>/sarah-front-480.webp`. Read generated metadata through a
small image helper for URLs, dimensions, and `srcset`. Keep origin separate from
variant keys so milestone 2 can switch to verified CDN URLs. Never recursively
publish `images/`; raw files and build metadata stay outside public output.

**Why these sizes:** there is no universal Shopify/WordPress size set to copy.
Shopify's [carousel example](https://shopify.dev/docs/storefronts/themes/best-practices/performance/use-shopify-image-filters-efficiently)
uses 400/600/800px with layout-specific `sizes`. WordPress supports
[responsive candidates](https://developer.wordpress.org/apis/responsive-images/)
and adds [1536/2048px sizes](https://developer.wordpress.org/reference/functions/_wp_add_additional_image_sizes/)
for larger, dense displays. Multiple variants are normal; two display widths
plus full resolution is our simpler choice for this bounded carousel.
The [uv project workflow](https://docs.astral.sh/uv/guides/projects/) supplies
locked Python dependencies and the run command.

### 3. Add the plain page and carousel

Render the exact H1 and a small carousel component: front first, Previous/Next
buttons with wraparound, and `1 of 2`. Use minimal Tailwind spacing/sizing,
semantic controls, visible focus, descriptive alt text, and reserved image space.
No carousel library, autoplay, or branding work.

Add a `View full size` link to the current slide's processed full-resolution
image, opening in a new tab with that behavior labeled. This provides expansion
without building a lightbox. With JavaScript disabled, show both images as a
static gallery with their full-size links and no inactive carousel controls.

### 4. Produce the AWS-ready static output

Generate `web/.output/public` with HTML, client JS/CSS, and processed image
variants. It must work from an ordinary static file server. No production Nuxt
server or request-time image processing is needed.

AWS resources, private source storage, image CDN uploads/receipts, and live
verification stay in milestone 2. CDN-mode builds will omit local image copies.
That milestone adds separate beta/production hosting modeled on Waller Creek High.
Milestone 5 deploys main pushes to beta only when `DEV_DEPLOY_ENABLED=true`, and
published non-prerelease releases to production at the exact tagged commit.

### 5. Check and document

Run typecheck, static generation, and the focused image checks. Preview the
built output at phone/desktop widths; check both slides, keyboard controls,
full-size links, and the no-JavaScript gallery. Confirm no raw PNGs or build
metadata appear in the output and an unchanged image run does no resizing.

Document the install/run commands and source-file prerequisite in README.
Record checks actually run and any remaining issues in the handoff.

## Done when

- [x] Nuxt + Tailwind generates and previews the plain H1/carousel page.
- [x] Python/uv produces two display sizes plus a full-resolution WebP per source.
- [x] Carousel, full-size links, keyboard controls, and no-JavaScript fallback work.
- [x] Raw files stay out of Git/public output; image reuse and static checks pass.
- [x] AWS handoff and commands are documented; final landing-page work stays deferred.

## Implementation handoff — November 5, 2026

Nuxt/Tailwind lives in `web/`; Python/Pillow tooling and its uv lockfile live in
`tools/`. Original PNG bytes were preserved in ignored `images/raw/`. All six
processed WebPs are generated/staged locally; no original PNG or private metadata
is present in the static output. The image display is plain and responsive, with
full-size links and a static gallery when JavaScript is disabled.

| Check | Result |
| --- | --- |
| `npm run typecheck --prefix web` | Passed |
| `npm run test:images --prefix web` | 2 passed: reuse/invalidation/corruption/source errors; small-source deduplication |
| `npm run generate --prefix web` | Passed; `web/.output/public` generated |
| `npm run images:check --prefix web` | Passed; 0 rendered, 6 reused |
| `npm run test:e2e --prefix web` | 4 Chrome tests passed: 375px/1280px, dense phone, no JavaScript |

Browser checks also verified keyboard navigation, carousel wraparound, full-size
image links, no initial full-size download, and no page/hydration errors. Mobile
screenshot inspected. The image-only tab can request an unbranded `/favicon.ico`;
final branding/favicon remains milestone 6. The page itself uses an empty data
favicon to avoid that request.

The sandbox required approved network access for dependencies and local server/
Chrome execution. Local uv runs used `UV_CACHE_DIR=/tmp/flat-girl-uv-cache` because
its default cache is outside the writable workspace. Ordinary user-run commands
are documented in README. npm installation reported 6 low and 6 moderate
transitive dependency advisories; no audit remediation was attempted in this step.

AWS and GitHub have not been changed. The roadmap now specifies independent
beta/production hosting, main pushes gated by `DEV_DEPLOY_ENABLED`, and production
publication from the exact commit of a published non-prerelease release. Live
verification belongs to milestones 2 and 5.

Next action: run `npm run preview --prefix web` and review http://127.0.0.1:3000.

