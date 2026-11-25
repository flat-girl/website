# Shopify theme price and inventory proof

## Status and scope

**Decision, November 17, 2026: a custom inventory check is needed before treating
the displayed count as current and accurate.** The owner concluded that the
Storefront/theme approach is insufficient. Keep these endpoints as diagnostics;
do not adopt the theme as a proven inventory fix. Custom-check implementation
and rollout are **pending**; this session records the shortcoming only.

**Current template: schema 2, installed and responding per owner.** At the owner's request,
quantity now reads `product.selected_or_first_available_variant.inventory_quantity`
directly. No hardcoded variant ID or loop is used. Price and availability remain
`product.price`, `product.price_varies` and `product.available`. The intermediate
local revision that always returned null quantity has been superseded.
The observations below describe the earlier schema-1 template and remain
historical evidence; they do not validate this new revision. The owner reports
the revised lookup received an update before their Admin API read refreshed;
repeatability has not yet been independently established.

## Observation and shortcoming

Repeated successful responses did not consistently match the owner's current
Admin quantity. At 2:32 PM Central, all ten Storefront reads returned 369 or 370
against the reported count of 364. At 2:46 PM, the original theme returned 364
seven times and the correct 358 three times, including reversions to 364 after
358 had already appeared. These direct reads reproduce the problem outside the
site's browser UI. HTTP success, agreement in one snapshot, and a stable-looking
price do not establish inventory freshness.

The later selected-or-first-available lookup initially picked up an update
before the owner's Admin API read refreshed. That is an owner-reported success
for schema 2, not evidence of consistently current counts. No additional numeric
results from the revised paired checker were supplied with the owner's final
decision; do not attribute the schema-1 failure sequence to schema 2. Likewise,
the earlier matching US-context reads do not establish a reliable fix.

**Practical limitation:** the current integration cannot substantiate an exact
remaining-stock claim on every refresh. It can show an older number and then
return to that number after showing a newer one. Refreshing more often or
substituting the Liquid endpoint has not established a freshness guarantee.
The underlying Shopify cache, replication or inventory-context mechanism has
not been isolated; these remain hypotheses. Admin counts in the recorded
comparisons were supplied by the owner, not independently read by this agent.

## Next approach — planned, not implemented

Revisit the owner's proposed server-side check: securely read the Admin API in
AWS Lambda, cache the verified quantity, refresh from relevant Shopify events,
and expose that quantity to the frontend. This is the chosen direction to
investigate, not a claim that an Admin read or a cache is automatically current.
The owner has also observed an Admin API refresh lag.

Before implementing, define and verify:

1. Which Admin inventory state and online fulfillment locations represent the
   displayed sellable quantity, using the current store configuration.
2. How sales and other inventory changes trigger a refresh, with reconciliation
   for missed events and handling for duplicate/out-of-order events so an older
   result cannot overwrite a newer confirmed count.
3. A measurable freshness target, a last-successful-check timestamp, and frontend
   behavior when verification is stale or unavailable. Preserve Shopify's final
   cart/checkout stock enforcement; do not promise a reservation from a display count.
4. Repeated comparisons around real stock changes before changing the frontend's
   source, including its pre-checkout refresh. Keep Admin credentials server-side.

The existing frontend remains unchanged. Prepare a separate dated rollout
workflow when there is a concrete custom implementation to deploy.

## Diagnostic assets

The template now lives under `.shopify/theme/templates/`, following the existing
Git-ignore policy for `.shopify`. The reusable checker runs ten paired theme/Storefront reads and is tracked at
`tools/shopify_stock_check.py`; usage is in [SHOPIFY.md](../SHOPIFY.md#repeat-the-ten-read-theme-check).

Updated November 17, 2026, 2:46 PM Central. **Both Storefront and theme reads have
reproduced inconsistent quantities.** Against the owner's new actual count of
**358**, ten identical theme requests returned 364 seven times and 358 three
times. Earlier Storefront reads fluctuated between 369 and 370 against the then
actual count of 364. The theme has not passed the freshness/stability proof;
US-context API stability remains untested. See the recorded comparisons below.
Admin price verification and cross-origin browser reads remain **pending**. The
frontend data source, payment settings and AWS infrastructure are unchanged.

The initial numeric-ID URL redirected; the subsequent handle-based URL worked.
The shared successful link included a trailing semicolon after `flatgirl-data`;
the comparison URL below uses the template suffix exactly, without that semicolon.

The owner requested trying the existing Shopify redirect theme before considering
an Admin API cache in Lambda. The current frontend reads product `totalInventory`;
the original proof read Liquid inventory and price. The current local revision
uses product price/availability and the owner's requested quantity lookup.

Source: [Shopify/hydrogen-redirect-theme](https://github.com/Shopify/hydrogen-redirect-theme),
inspected at `1aa35ac9dfbab3a497d407c6e4df5e198412a8bc`. Its redirect is in
`layout/theme.liquid`. The new alternate template uses `layout none` to bypass it.
Only our additive file is kept in this repository; the installed theme's settings
and existing files remain the source of truth for its redirects.

## Prerequisites

- Access to the installed redirect theme's Shopify code editor and a saved backup
  or duplicate of that theme.
- The blanket's actual Online Store product handle, copied from its Shopify
  product URL. Product `15491665297684` must be published
  to the Online Store for this route to work. Headless publication alone does not
  establish Online Store access.
- The existing working password/payment configuration. Do not disable protection
  or change payment mode just to run this proof. A password page or challenge is
  a failed anonymous-data-access test, not inventory JSON.

## Installation and verification

1. In Shopify → Online Store → Themes → the existing redirect theme → Edit code,
   add or update **`templates/product.flatgirl-data.liquid`**. Copy the complete contents of
   [the repository template](../../.shopify/theme/templates/product.flatgirl-data.liquid)
   and save. Use a Liquid file, not a JSON template. Do not assign it to the
   product or replace `product.json` / `layout/theme.liquid`. This adds only an
   opt-in `?view=flatgirl-data` response; normal product visits keep redirecting.
2. Open the endpoint below in a fresh browser. Expect
   a JSON body with `schemaVersion: 2`, `source: "shopify-theme"` and the configured product ID:

   ```text
   https://shopify.flatgirl.net/products/boring-flat-girl-plush-blanket?view=flatgirl-data
   ```

   **Use the handle, not `15491665297684`.** Find it in Shopify Admin → Products →
   the blanket → Search engine listing → URL and handle. Copy the text after
   `/products/` from the Online Store URL; the number in the Admin URL is not
   the handle. An incorrect product route can render the theme's 404 page, which
   also runs the redirect layout, so a redirect alone does not show that
   `layout none` failed. If the correct handle still redirects, verify that the
   file is saved in the theme being served and that the product is available to
   the Online Store, then inspect the response for a password/challenge redirect.

   An error body, HTML, login, redirect or challenge is a failure even if HTTP
   status is 200. The template cannot set a JSON content type or error status.
   If first testing a duplicate theme, use its preview URL; repeat without
   preview cookies/parameters against the installed theme before accepting it.
3. Compare `price.amountInSubunits`, `price.currencyCode`, `price.varies` and
   `availableForSale` with the product in Shopify Admin. For USD, `6000` means
   `$60.00`; that is an example, not a hardcoded price. The price follows the
   visitor's presentment currency, so require USD for the current US frontend.
   `product.price` is the product's minimum price; `price.varies: true` means
   that it does not have one uniform price. Compare `inventory.quantity` with
   Admin for the selected item. Keep inventory tracking enabled for this stock
   comparison: Liquid reports units sold when inventory is untracked. A `variant`
   URL parameter can affect the selected item; use the comparison URL as written.
4. On **`https://flatgirl.net`**, run this in the browser console.
   Repeat from **`https://beta.flatgirl.net`**. This is required because
   navigating to a JSON page or reading it with curl does not prove browser fetch
   access from another origin:

   ```js
   const url = new URL('https://shopify.flatgirl.net/products/boring-flat-girl-plush-blanket');
   url.searchParams.set('view', 'flatgirl-data');
   url.searchParams.set('_proof', String(Date.now()));
   const response = await fetch(url, {
     headers: { Accept: 'text/html' },
     mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error',
     signal: AbortSignal.timeout(8000),
   });
   if (!response.ok) throw new Error(`Shopify HTTP ${response.status}`);
   const data = await response.json();
   if (data.error || data.schemaVersion !== 2 || data.source !== 'shopify-theme'
     || data.productId !== 'gid://shopify/Product/15491665297684'
     || data.price?.currencyCode !== 'USD') throw new Error('Unexpected theme response');
   console.log(data);
   ```

   CORS failures cannot be fixed with an HTML meta tag or `mode: 'no-cors'` (that
   produces an unreadable response). Liquid does not supply arbitrary response
   headers. If blocked, record the result before choosing a transport or backend.
5. Repeat quantity reads against the current Admin count to check stability,
   including after a known stock change. Repeat price/availability reads after
   a planned change when available. Also visit the ordinary product
   URL without `view` and confirm its existing redirect still works.

## Acceptance and next implementation

The theme experiment has not established the required freshness. Retain the
current revision and paired checker for diagnosis. Follow the custom-check
direction above; further theme reads alone are not an implementation plan.

The Admin API/Lambda/webhook implementation and frontend integration remain
pending. No private credentials belong in the template or browser. Any later
source change must cover both product reads and the pre-checkout refresh, while
preserving Shopify cart/checkout stock enforcement and subtotal validation.

## Recovery

Restore the saved prior contents of `product.flatgirl-data.liquid` to revert
this revision, or remove that file to remove the diagnostic endpoint entirely. Check that ordinary product visits still
redirect. No frontend rollback is needed because this proof does not switch it.
Preserve existing theme settings and all unrelated files.

## Evidence

Historical schema-1 results below precede the revised quantity lookup. Schema-2
installation and a successful update are owner-reported; repeated verification
is pending.

### Direct comparison, November 17, 2026

Owner-supplied Admin reference: **364**, not independently read from Admin.
All requests below returned HTTP 200 without GraphQL errors. Reads used the
locally configured public Storefront token, pinned API `2026-10`, and the exact
product/variant IDs above. No cart mutations or private/Admin credentials used.

| Read at 2:31 PM Central | Quantity |
| --- | --- |
| Theme at 14:31:14 and 14:31:30, including a unique query parameter on the latter | 364 |
| Storefront product `totalInventory`, no explicit country, at 14:31:01/14/30 | 369 |
| Storefront product `totalInventory`, US context, at 14:31:30 | 364 |
| Storefront variant `quantityAvailable`, no explicit country, at 14:31:14 / 14:31:30 (different field selections) | 368 / 369 |
| Storefront variant `quantityAvailable`, US context, at 14:31:01/14/30 | 364 |

Theme and Storefront prices agreed at USD 60.00; Admin price was not supplied.
The theme returned the expected `source: "shopify-theme"` and IDs, tracked
inventory and `policy: "deny"`. Both the exact suffix and the owner's original
trailing-semicolon URL worked in this check. `Accept: application/json` instead
returned generic product JSON without inventory, so use `Accept: text/html` and
validate the expected schema. The theme returned `Access-Control-Allow-Origin: *`
and `Cache-Control: private, max-age=0, must-revalidate`; this header observation
is not a completed browser-origin test or proof of upstream freshness.

At the owner's request, ran **10 sequential identical current-site product
queries with no deliberate delay**, from **14:32:02.453 to 14:32:04.045 Central**
(request start times). Results in order:

```text
370, 369, 370, 370, 370, 370, 369, 369, 370, 369
```

All ten differed from the reported actual quantity of 364. These are raw API
responses, so the discrepancy is not solely a frontend rendering/browser-cache
issue. Stale caches or replicas are hypotheses, not a confirmed root cause.
The owner independently reports refreshes alternating among 370, 369 and 364.

### Theme repeated reads, November 17, 2026, 2:46 PM Central

The owner supplied a new actual quantity of **358** and requested ten rapid theme
reads. Ran ten sequential GETs with no deliberate delay against the same exact
`?view=flatgirl-data` URL, with `Accept: text/html` and `Cache-Control: no-cache`.
Request start times spanned **14:46:05.615–14:46:07.327 Central**. Each returned
HTTP 200, the expected theme schema and the configured product/variant IDs.

```text
364, 364, 364, 358, 364, 358, 364, 364, 364, 358
```

**3/10 matched 358; 7/10 returned the prior count of 364.** The value reverted to
364 after returning 358, so this is not just one observed transition to the new
count. The template is not a demonstrated solution to inconsistent inventory.
These requests used identical URLs (no unique query parameter); the test does
not isolate Shopify rendering/data caches or establish which layer is stale.
Storefront API was not rerun during this batch. No frontend or infrastructure
changes were made.

| Check | Result |
| --- | --- |
| Upstream redirect location | Confirmed in `layout/theme.liquid` at the revision above |
| Local template rendering | Passed fixture checks for exact variant selection, price subunits, sold-out, untracked inventory, negative stock, and missing/wrong product or variant using temporary Python Liquid 3.0.0; Shopify-only `layout` directive asserted and omitted, `json` filter emulated. This does not validate Shopify HTTP behavior. |
| Public product discovery from this environment | HTTP 429 on November 17; no product handle or inventory inferred |
| Theme installation / owner test | Independently read expected template JSON at 14:31 Central after the owner reported success. |
| Initial inventory comparison | Earlier owner report: both sources agreed; subsequent direct discrepancy reproduced as recorded above. |
| Live price and freshness | Theme/API agree at USD 60.00; Admin price and update latency remain unverified |
| Browser reads from production and beta | Pending |
| Ordinary product redirect regression | Pending |

References: [product properties](https://shopify.dev/docs/api/liquid/objects/product),
[alternate templates](https://shopify.dev/docs/storefronts/themes/architecture/templates/alternate-templates),
[layout tag](https://shopify.dev/docs/api/liquid/tags/layout),
[variant properties](https://shopify.dev/docs/api/liquid/objects/variant), and
[JSON filter inventory exclusion](https://shopify.dev/docs/api/liquid/filters/json).
