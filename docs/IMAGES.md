# Shared image operations

The source bucket is private. Only `variants/*` in the separate variants bucket
is exposed through OAC and the image distribution's HTTPS hostname. Original
filenames/checksums live in `images/manifest.json`; import preserves their bytes.

After adding, replacing, or removing PNG/JPEG/WebP files in `images/raw/`, run the following
from the repository root. `images-prepare` discovers new files, adds them to the
manifest, refreshes source metadata and renders local variants. It needs no AWS
profile. Existing IDs/alt text/order are preserved; new entries use filename-based
IDs and default alt text, with numeric suffixes for ID collisions. Review the
generated alt text and manifest diff before committing. This explicit refresh removes
deleted sources from the manifest and generated metadata and removes obsolete local
variants. Ordinary builds/checks still reject missing tracked sources until refreshed.

The source with `recipe: "favicon"` also regenerates the committed
`web/public/favicon.ico` with 16, 32, and 48px sizes. Unchanged ICO bytes are left
untouched; `images:check` detects a missing or stale ICO. Commit the ICO alongside
source manifest changes. Nuxt derives its icon URL version from the ICO bytes at
startup/build time, so no manual version edit is needed. CDN builds use the
committed ICO without requiring raw images.

```sh
make images-prepare
make sources-import PROFILE=flat-girl DRY_RUN=1
make sources-import PROFILE=flat-girl
make images-ensure PROFILE=flat-girl DRY_RUN=1
make images-ensure PROFILE=flat-girl
make images-check PROFILE=flat-girl
```

Source keys are `sources/<sha256>/<filename>`. Import/check validates checksums;
restore refuses to overwrite a changed local file:

```sh
make sources-pull PROFILE=flat-girl
```

An unchanged remote ensure/check uses metadata reads only: zero source downloads,
zero renders, zero uploads. Missing variants reuse validated local outputs or
restore the necessary source and render only missing sizes. Corrupt metadata,
denied access, or a conflicting immutable key fails; it is never treated as a
missing file. Conditional uploads verify the object after competing writes.

`.deploy/images.ready.json` binds the expected plan to an account, bucket, CDN
origin, and verified output checksums/dimensions. Local mode remains the default:

```sh
npm run dev --prefix web
```

CDN mode installs generated image metadata from that receipt, removes only the
generated local `web/public/variants` staging directory, and needs no originals:

```sh
FLAT_GIRL_IMAGE_MODE=cdn npm run generate --prefix web
```

Use `make site-build` for a deployable artifact; it verifies remote images and
cleans build output first. A direct Nuxt build is a preview, not an archived release.
Receipts, originals, and processed-cache metadata are never published with the site.
Run `make images-prepare` for raw-file additions, replacements, or removals. Review and commit
the manifest changes. Preparation adds assets to the catalog, not to the page.
`SarahCarousel.vue` explicitly selects image IDs; add or remove those selections
in the component and rebuild/publish to update the displayed photos.

Neither `sources-import` nor `images-ensure` deletes remote objects. Import uploads
missing originals; ensure uploads missing variants and refreshes the image receipt
for the current manifest. For removals alone, `images-check` refreshes the receipt
without uploads, provided all remaining variants already exist remotely.

Keep historical sources and variants. Recipe/renderer changes create new URLs;
old pages and rollback artifacts keep using old keys. `releases/` in the private
source bucket is reserved for deployment archives, separate from `sources/`.
