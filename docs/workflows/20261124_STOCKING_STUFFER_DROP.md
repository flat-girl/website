# Stocking Stuffer Pack and Drop 2 launch

Test the storefront and its Shopify cart changes on beta November 23, 2026. On November 24, at the owner's launch time (Central), publish the tested revision to production while the blanket is sold out. As soon as publication verifies, set the blanket's available stock to **500**. This makes the Shopify inventory save the action that opens the drop.

Beta and production use the same Shopify store, variants and automatic discount. The static site ships its Storefront API client with the frontend in each environment's release. For this integration, `make site-publish` delivers both the purchase panel and the cart API changes. The local Nuxt commerce endpoints are development tools.

## 1. Prepare the release

- Include the purchase panel, its imported SVG/WebP artwork, two-line cart validation, image tooling and shared image bucket policy in the reviewed release. The lower-left corner currently repeats Sarah as the couch placeholder. Beta can build a dirty tree. Record the build ID and revision, and repeat beta verification if the source changes before production.
- Use the beta stock override to exercise the purchase panel and its pre-checkout quantity check. Shopify still supplies the product and price and enforces its actual inventory policy on the cart. Temporary backorders are needed only for the live checkout rehearsal at zero blanket stock.
- Use the reviewed source revision for both builds. Production requires a clean committed tree. Have the shared image operator profile, beta Basic Auth credentials, the public Headless Storefront token, the environment-specific publisher profiles and Shopify inventory access ready.
- Record each destination's current release ID from its live `/build.json` (beta requires authentication) and confirm its verified archive for rollback. Record current Shopify available quantities, fulfillment location and overselling setting. Check that enough complete packs can ship for the edition and that the automatic discount covers multiple blankets.

## 2. Restrict the historical Sarah artwork on the shared CDN

Six WebPs from earlier releases returned HTTP 200 without authentication on November 23. Their original checksums match the current `sarah_artwork` PNGs. They include front and back views at 480, 960 and 1696 pixels wide. Removing those entries from the current catalog left the old URLs live. This step affects the image CDN used by both storefronts.

1. Renew the expired AWS source login. From the repository root, preview the **images** stack change. Confirm the variants bucket policy denies CloudFront reads for the historical `sarah-front-*.webp` and `sarah-back-*.webp` objects. Apply the reviewed change. It preserves the private source files, existing S3 object versions and current gallery images.

   ```sh
   aws login --profile flat-girl-human --region us-east-1
   aws sts get-caller-identity --profile flat-girl
   make cloud-diff PROFILE=flat-girl STACK=images
   make cloud-deploy PROFILE=flat-girl STACK=images
   ```

2. Invalidate the six old paths on the **FlatGirlImages** distribution. Use the historical release manifest on this workstation. On a fresh workstation, recover that manifest from the private sources bucket archive at `releases/production/20261107T045352Z-b8d1c6096ce4/artifact.tar.gz`. At the prompt, enter an AWS profile authorized to create and wait for invalidations on the shared distribution. The site publisher roles only invalidate their own distributions.

   ```sh
   DROP_IMAGE_DIST=$(aws cloudformation describe-stacks --stack-name FlatGirlImages --profile flat-girl --region us-east-1 --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue | [0]" --output text)
   DROP_IMAGE_ORIGIN=$(aws cloudformation describe-stacks --stack-name FlatGirlImages --profile flat-girl --region us-east-1 --query "Stacks[0].Outputs[?OutputKey=='ImageBaseUrl'].OutputValue | [0]" --output text)
   python3 - "${DROP_IMAGE_ORIGIN:?}" <<'PYPATHS'
   import json, sys
   from pathlib import Path
   from uuid import uuid4

   archive = Path('.deploy/releases/production/20261107T045352Z-b8d1c6096ce4/manifest.json')
   receipt = json.loads(archive.read_text())['images']
   assert receipt['origin'] == sys.argv[1]
   names = {f'sarah-{side}-{width}.webp' for side in ('front', 'back') for width in (480, 960, 1696)}
   paths = sorted('/' + key for key in receipt['objects'] if Path(key).name in names)
   assert len(paths) == 6 and {Path(key).name for key in paths} == names
   batch = {'Paths': {'Quantity': 6, 'Items': paths}, 'CallerReference': 'drop2-' + uuid4().hex}
   Path('.deploy/drop2-sarah-invalidation.json').write_text(json.dumps(batch))
   PYPATHS
   read -r DROP_CDN_PROFILE
   DROP_PURGE=$(aws cloudfront create-invalidation --profile "${DROP_CDN_PROFILE:?}" --distribution-id "${DROP_IMAGE_DIST:?}" --invalidation-batch file://.deploy/drop2-sarah-invalidation.json --query Invalidation.Id --output text)
   aws cloudfront wait invalidation-completed --profile "${DROP_CDN_PROFILE:?}" --distribution-id "${DROP_IMAGE_DIST:?}" --id "${DROP_PURGE:?}"
   ```

3. Verify all six previously public URLs anonymously. Each must return **403 or 404**. Record the invalidation ID and results. Cached copies previously downloaded to client devices can remain there.

   ```sh
   python3 - "${DROP_IMAGE_ORIGIN:?}" <<'PYVERIFY'
   import json, sys
   from pathlib import Path
   from urllib.error import HTTPError
   from urllib.request import Request, urlopen

   paths = json.loads(Path('.deploy/drop2-sarah-invalidation.json').read_text())['Paths']['Items']
   for key in paths:
       try:
           with urlopen(Request(sys.argv[1] + key, method='HEAD'), timeout=10) as response:
               status = response.status
       except HTTPError as error:
           status = error.code
       print(Path(key).name, status)
       if status not in (403, 404):
           sys.exit('Historical artwork is still accessible. Check the policy and invalidation.')
   PYVERIFY
   ```

## 3. Upload the catalog images to S3

The two new catalog sources are `images/raw/iou_front.png` and `images/raw/iou_back.png`. Each produces 480, 960 and 1860px WebPs on the shared image CDN. The purchase-panel illustrations have a separate delivery path: Nuxt bundles the optimized IOU SVGs, die-cut mask, small Sarah print and foil textures from `web/app/assets/stocking-stuffers/` into the site release. `site-publish` uploads those files to the destination's site bucket.

Run these commands from the repository root. Review the manifest diff and dry-run output. With all earlier images present, the expected additions are two private originals and six public IOU variants. Already uploaded objects count as hits. Stop if other unexpected sources appear. Keep `images/product-photos/`, the raw sticker PNG, `sarah_artwork*` and the print SVG masters out of the catalog and the site artifact.

```sh
make images-prepare
git diff -- images/manifest.json
make sources-import PROFILE=flat-girl DRY_RUN=1
make sources-import PROFILE=flat-girl
make images-ensure PROFILE=flat-girl DRY_RUN=1
make images-ensure PROFILE=flat-girl
make images-check PROFILE=flat-girl
```

Record the final image check with zero missing variants. It refreshes `.deploy/images.ready.json` for the beta build. If a variant is missing, rerun the ensure and check steps. Retain the private raw art locally. `sources-import` backs up catalog originals only. [Image operations](../IMAGES.md)

## 4. Publish and test beta at zero stock

Run from the repository root. Configure the commerce build in the same terminal. At the first `read`, enter the public Headless Storefront token. The builder ignores `web/.env`.

```sh
make signup-status PROFILE=flat-girl SITE_ENV=beta
make signup-preflight PROFILE=flat-girl SITE_ENV=beta
npm run typecheck --prefix web
npm run test:commerce:service --prefix web
unset NUXT_PUBLIC_STOREFRONT_MODE NUXT_PUBLIC_COMMERCE_SOURCE
unset FLAT_GIRL_COMMERCE_ENDPOINT NUXT_PUBLIC_COMMERCE_ENDPOINT
unset FLAT_GIRL_CHECKOUT_HOSTS NUXT_PUBLIC_CHECKOUT_HOSTS
read -r NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
export NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
export FLAT_GIRL_STOREFRONT_MODE=commerce
make site-build PROFILE=flat-girl-beta SITE_ENV=beta
```

After a successful build, enter its printed beta release ID. Review the dry run before publishing. Live publish prompts for beta Basic Auth and verifies the deployed bytes, content types, image CDN and CloudFront responses. Confirm the authenticated beta `/build.json` matches this release.

```sh
read -r DROP_BETA_RELEASE
python3 - "${DROP_BETA_RELEASE:?}" <<'PYART'
import json, sys
from pathlib import Path

manifest = json.loads((Path('.deploy/releases/beta') / sys.argv[1] / 'manifest.json').read_text())
assert manifest['release'] == sys.argv[1] and manifest['environment'] == 'beta'
assert manifest['commerce']['storefrontMode'] == 'commerce'
keys = {entry['key'] for entry in manifest['files']}
for stem in ('iou-front', 'iou-back', 'flat-girl-print-small', 'flat-girl-cutline',
             'holographic-foil', 'laminate-reflection'):
    matches = [key for key in keys if key.startswith('_nuxt/' + stem + '.')]
    assert len(matches) == 1, f'Review bundled artwork for {stem}'
    print(matches[0])
PYART
make site-publish PROFILE=flat-girl-beta SITE_ENV=beta RELEASE="${DROP_BETA_RELEASE:?}" DRY_RUN=1
```

Publish after the artwork check succeeds and the dry run identifies the intended beta destination.

```sh
make site-publish PROFILE=flat-girl-beta SITE_ENV=beta RELEASE="${DROP_BETA_RELEASE:?}"
```

1. Open [beta with zero stock](https://beta.flatgirl.net/?FORCE_STOCK=0) and confirm sold out. Open [beta with two blankets](https://beta.flatgirl.net/?FORCE_STOCK=2), check the four corner illustrations on mobile and desktop, the small Sarah download, both delivery promises, and verify the quantity selector stops at two. The artwork should appear after loading for both stock states. At zero, verify the disabled button and clear signup form. For the live checkout rehearsal only, enable **Continue selling when out of stock** on the zero-stock blanket if needed. This changes the shared Shopify store. From the two-blanket preview, open separate checkouts for quantities 1 and 2. [Beta with 500 blankets](https://beta.flatgirl.net/?FORCE_STOCK=500) previews the launch count and the usual five-blanket limit.
2. Verify the following merchandise totals before tax. Enter an eligible US delivery address and confirm the advertised free shipping still applies with the pack. Review the rate name and transit description. The previous checkout showed “Ships starting December 16.” Update the Shopify shipping copy before launch if it still implies the blanket ships before Christmas. Stop before payment. Record both outcomes and the release ID.

   | Blankets | Blanket line | Pack line | Merchandise total |
   | --- | --- | --- | --- |
   | 1 | 1 × $60 | 1 pack, $16 discount, $0 due | $60 |
   | 2 | 2 × $60 | 2 packs, $32 discount, $0 due | $120 |

3. Immediately after the backorder test, turn **Continue selling when out of stock** off for the blanket variant in Shopify. Keep available stock at zero. Open [beta without an override](https://beta.flatgirl.net/) and confirm sold out. Check production also shows sold out and an existing test checkout cannot purchase the blanket at zero. The inventory policy applies store-wide, including during the beta test.

## 5. Stage production before the launch window

Build a production artifact from the beta-tested source once beta passes. In a fresh shell, repeat the commerce environment setup above. Verify the working tree is clean and the revision matches beta. Keep the blanket at zero with overselling off during staging.

```sh
git status --short
git rev-parse HEAD
make site-build PROFILE=flat-girl-production SITE_ENV=production
```

Enter the release ID from the successful **production** build. Confirm the dry run names that release and destination. Save the ID for launch.

```sh
read -r DROP_PROD_RELEASE
make site-publish PROFILE=flat-girl-production SITE_ENV=production RELEASE="${DROP_PROD_RELEASE:?}" DRY_RUN=1
```

## 6. Launch November 24

1. At the owner's go-ahead, open Shopify Admin on the blanket variant's inventory at the online fulfillment location. Confirm the automatic pack discount is active, overselling is off and available stock is still zero. Have the inventory editor ready.
2. Publish the staged production artifact. Restore the recorded release variable if using a new terminal.

   ```sh
   make site-publish PROFILE=flat-girl-production SITE_ENV=production RELEASE="${DROP_PROD_RELEASE:?}"
   ```

3. Wait for the publisher's CloudFront invalidation and live verification to succeed. Check [production build identity](https://flatgirl.net/build.json). Open [production with the beta parameter](https://flatgirl.net/?FORCE_STOCK=500) and confirm Drop 2 still shows sold out. As soon as these checks pass, **set blanket Available to 500** and save once. Leave overselling off. Record the release ID, save time and resulting Admin quantity. If publication fails, keep inventory closed.
4. From the public Buy button, verify one blanket and one free pack at checkout, then two of each. Check delivery copy, free shipping and the blanket's remaining count against Admin, allowing for intervening orders and Storefront read lag. If the page still shows sold out, refresh and compare Shopify's response with Admin before changing stock again. Close the drop manually if needed.

## Recovery

Keep the CDN privacy policy in place during storefront rollback. Choose a verified release whose image receipt excludes the six retired variants. Older receipts that require them will fail HTTPS verification. If a current gallery or IOU image fails after the privacy change, check the denied key patterns and the image receipt before retrying.

- **Before restocking:** if beta testing fails, disable temporary backorders and keep stock at zero while fixing the release. If publication fails, inspect the journal, correct the cause and retry the same release ID. Repeat the affected verification before opening sales.
- **After restocking:** if checkout omits or charges for the pack, record current inventory and close blanket sales in Shopify first. With tracking on and overselling off, set available stock to zero at the online sellable location(s). Verify closure with a fresh cart and an already-issued checkout. Review orders since opening for missing or charged packs.
- **Restore the site if needed:** enter the destination's prior verified release ID. For beta, use `SITE_ENV=beta PROFILE=flat-girl-beta` in the commands below. For production:

  ```sh
  read -r DROP_PREVIOUS_RELEASE
  make site-rollback SITE_ENV=production PROFILE=flat-girl-production RELEASE="${DROP_PREVIOUS_RELEASE:?}" DRY_RUN=1
  make site-rollback SITE_ENV=production PROFILE=flat-girl-production RELEASE="${DROP_PREVIOUS_RELEASE:?}"
  ```

  Verify the restored release and sold-out state. Keep sales closed if the restored checkout only adds a blanket. Before reopening, retest the corrected two-line checkout and reconcile remaining stock against accepted orders and adjustments. A second reset to 500 could oversell the edition.

## Execution record

| Milestone | Status / evidence |
| --- | --- |
| Shopify-only cart proof, November 23 | Verified in the US market. Pack product `15528208531732`, variant `68279777100052`. One blanket (variant `68124854681876`) at zero stock with backorders enabled plus one pack produced $60 total with the full $16 pack discount. Cart only. |
| Local verification, November 23 | CDN fixture passed typecheck, static generation and site file classification. All 60 Python tests, 35 commerce service tests and 63 infrastructure tests passed. CDK synthesized the updated images stack. Live beta verification pending. |
| Two-line storefront checkout | Verified November 23 from the local Buy button with live Shopify. Quantities 1 and 2 returned matching free pack quantities and $60 and $120 merchandise subtotals. Both redirected to the Shopify checkout host. Verification stopped before payment. |
| Purchase panel and release packaging | Implemented locally, including sold-out artwork and a WebP content type for Nuxt assets. Couch illustration uses the Sarah placeholder. Reviewed release revision pending. |
| Public Sarah variants | Six historical URLs returned HTTP 200 anonymously on November 23. Shared policy prepared locally. Stack deployment, cache invalidation and confirmation of denial pending. |
| Catalog upload | Local catalog includes two new IOU PNGs. S3 dry run stopped at an expired AWS login. Source import, variant upload and remote verification pending. |
| Beta release, quantity 1 and 2 checkouts, shipping, backorders disabled and sold-out verification | Pending |
| Production build, dry run and previous verified release IDs | Pending |
| Production publish, inventory save to 500, launch time and checkout verification | Pending |
