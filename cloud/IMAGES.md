# Shared image operations

The source bucket is private. Only `variants/*` in the separate variants bucket
is exposed through OAC and the image distribution's HTTPS hostname. Original
filenames/checksums live in `images/manifest.json`; import preserves their bytes.

```sh
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
Raw-file changes require explicit `prepare_images.py --refresh-manifest` and review.

Keep historical sources and variants. Recipe/renderer changes create new URLs;
old pages and rollback artifacts keep using old keys. `releases/` in the private
source bucket is reserved for deployment archives, separate from `sources/`.
