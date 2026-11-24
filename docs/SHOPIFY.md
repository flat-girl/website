# Shopify integration proof

For Drop 2 cart verification and the switch from temporary backorders to 500 available blankets, follow the [Stocking Stuffer Pack launch workflow](workflows/20261124_STOCKING_STUFFER_DROP.md).

The [Meta sales dataset plan](plans/meta-sales-dataset-plan.md) moves website
events to the dataset already used by Shopify and active ads, then verifies click
attribution and checkout event ownership. Implementation and rollout are pending;
follow its [migration workflow](workflows/20261118_META_SALES_DATASET_MIGRATION.md).

For implementation order, contracts, and fresh-session prompts, use the
[Shopify integration plan](plans/shopify-integration-plan.md). Sessions 1–2 implement the local UI and static deployment preparation.
Sold-out signup reuses the existing endpoint: beta list 10, production list 9.
The owner reports beta running as of November 16; detailed stack/signup/rehearsal
evidence remains in the [beta workflow](workflows/20261116_BETA_SHOPIFY_COMMERCE_MIGRATION.md).
The owner reports `shopify.flatgirl.net` is set up; follow the
[Shopify Settings → Domains workflow](workflows/20261116_SHOPIFY_BRANDED_DOMAINS.md)
for the code prerequisite, DNS, admin settings and customer-link verification.
Search metadata belongs to the Nuxt landing page; its
[SEO launch workflow](workflows/20261116_STOREFRONT_SEO_LAUNCH.md) is prepared and
not yet executed.

The local smoke test targets `tepwtx-zw.myshopify.com`, product
`15491665297684`, and Storefront API `2026-10`. The default market is US.
It does not deploy or change the landing page, modify stock, submit orders,
send Brevo email, or configure pixels.

On November 16, 2026, the owner ran the live proof: the Storefront API returned
the blanket, variant `68124854681876`, available for sale at USD 60.00, and
created the expected one-unit cart. The browser initially displayed Shopify's
default password/"Opening soon" page. Later that day, the owner confirmed the
test completed through checkout and email confirmation. The exact resolution
of the password/redirect issue was not recorded here. Order-status link verification
has not yet been explicitly confirmed.

The owner subsequently confirmed the redirect theme is configured and added
`flatgirl.myshopify.com` as the branded myshopify domain. The smoke test accepts
checkout URLs on either store hostname, while retaining the original Shopify
identifier `tepwtx-zw.myshopify.com` for API requests. This is separate from the
`shopify.flatgirl.net` custom checkout domain, now set up in Shopify per the owner
and accepted by the local smoke tool/frontend. Accounts and order status use
Shopify's default URLs. Publication of the updated frontend remains pending;
see the domain workflow for verification and rollout.

## Run the proof

1. Make the product Active and publish it to Headless. Ensure its inventory
   location fulfills online orders and the US market/shipping settings allow
   the test address. Payment test mode was confirmed by the owner on November 16,
   2026; keep it on for this proof. Test mode applies to the whole store.
2. From the repository root, run `make shopify-test`. Paste the **private
   Storefront API token** from Headless at the hidden prompt. The token stays
   in process memory; it is not saved to files, command arguments, or environment
   variables. No AWS profile or Admin API token is needed.
3. Verify the printed product, variant, price/currency, availability, and cart
   total. The tool creates a cart containing one unit and opens Shopify's returned
   checkout URL. If there are multiple variants, rerun with
   `make shopify-test VARIANT=gid://shopify/ProductVariant/ACTUAL_ID` using a
   printed ID. Each run creates a new cart; network requests are not retried.
4. Complete checkout with the configured gateway's test payment details. Verify
   the order is marked as a test in Shopify, its line item and shipping/tax are
   correct, the confirmation email arrives, and its order-status link works.
   Check inventory afterward and cancel/restock the test order as appropriate;
   do not fulfill it. Account for any connected order automations before testing.
5. Record the test order number and outcome, without tokens, customer details,
   or private checkout links. API success alone does not prove a paid order,
   fulfillment, attribution, or email delivery.

`make shopify-check` only reads the product. It is useful for diagnosing a missing
Headless publication or scope without creating a cart. Exact inventory quantities
are not queried; `availableForSale` establishes whether a variant can be purchased.
For another market, run:

```sh
uv run --locked --project tools python tools/shopify.py --country CA
```

Replace CA with the desired country code.

Only the configured shop and Shopify checkout hosts are accepted for the browser
handoff. A future custom checkout domain requires updating this validation.
The Storefront API cannot confirm payment test mode. Cart creation itself does
not charge anyone or reserve stock. A stock change between reading the product
and checkout can still prevent a purchase. Cart errors, warnings, and unexpected
line contents prevent the tool from opening checkout.

## Checkout opens "Opening soon"

This is Shopify's Online Store password page. Its newsletter form belongs to
Shopify email marketing and does not use this project's Brevo signup endpoint.
A successful product/cart API response does not prove the checkout is accessible.

Correction, November 16, 2026: the owner confirmed Shopify refuses first launch
while payment test mode is enabled. Shopify's current launch documentation also
requires test mode to be deactivated. The earlier instruction to make the store
public while leaving test mode on was incorrect for this store's first launch.
Keep the store private and test payments enabled for prelaunch investigation.

A live public GET reached `/password`; the installed redirect theme then sent
that page to `flatgirl.net/password`. The upstream redirect theme uses its
redirect section for the password template too, so it provides no password-entry
form. It must not be treated as a prelaunch password-login theme without changes.

Historical proposed diagnostic (before the owner confirmed successful checkout):
temporarily use the original theme while retaining private
access, open `https://flatgirl.myshopify.com/password`, and enter the storefront
password from Online Store → Preferences. Rerun `make shopify-test` in the same
browser/profile after unlocking. This checks whether an authenticated storefront
session allows this store's headless test checkout. The owner has since confirmed
checkout and confirmation email work; do not repeat this diagnostic unless the
password issue returns. Do not turn live payments on just to work around testing.

Before public sales, handle redirects from the unused Shopify storefront and
checkout navigation back to flatgirl.net. Do not use the Online Store password
as the production headless launch gate.

References: [Shopify store access](https://help.shopify.com/en/manual/online-store/themes/password-page)
and [current prelaunch testing and launch requirements](https://help.shopify.com/en/manual/intro-to-shopify/initial-setup/setup-prepare-for-launch).

## Theme price and inventory experiment

**Known shortcoming:** repeated Storefront and original theme responses returned
older counts, including reversions after a correct count appeared. The revised
theme lookup had an owner-reported success, but consistent freshness has not been
established. The owner decided a custom inventory check is needed for an accurate
displayed count. Server-side Admin API verification/caching and event refresh are
the planned direction; implementation is pending. An Admin-backed cache must
also be tested for freshness. The recorded evidence and next-step requirements
are in the [experiment workflow](workflows/20261117_SHOPIFY_THEME_DATA_PROOF.md#observation-and-shortcoming).

The schema-2 template in `.shopify/theme/templates/product.flatgirl-data.liquid`
uses product-level price/availability and the owner's requested
`product.selected_or_first_available_variant.inventory_quantity` lookup.
It has no hardcoded variant ID or loop. The owner reports it is installed and
received an update before their Admin API read refreshed. The frontend remains
unchanged. Installation, verification and recovery are in the
[November 17 theme-data proof workflow](workflows/20261117_SHOPIFY_THEME_DATA_PROOF.md).

The following observations concern the earlier schema-1 template.
On November 17 at 2:32 PM Central, ten identical direct Storefront product reads
returned 369/370 against the owner's actual count of 364. The theme and explicit
US-context API reads matched 364 in preceding snapshots. At 2:46 PM, against the
owner's updated actual count of 358, ten theme reads returned 364 seven times and
358 three times. The theme also fails the repeated-read comparison. US-context
stability and browser-origin access remain unverified; frontend integration is
deferred. Exact observations are recorded in the workflow.

## Repeat the ten-read theme check

From the repository root, using Python 3.9 or newer (standard library only):

```sh
python3 tools/shopify_stock_check.py --expected 358
```

Replace `358` with the current Admin quantity, or omit `--expected` to compare
only the two sources and their stability. The checker reads the **public** token
from `NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN` in the environment, falling back
to the same entry in `web/.env`. It never prints the token or uses a private token.
No additional dependencies are required.

Each of ten rounds requests both sources concurrently, then prints their counts
side by side with `AGREE`/`DIFFER` and optional Admin-count matches. There is no
deliberate delay between rounds: **ten theme GETs and ten Storefront POSTs**.
The theme uses the identical URL, `Accept: text/html`, `Cache-Control: no-cache`,
and schema-2/product-ID validation. Storefront uses API `2026-10` and the website's
product query (`totalInventory`, with no explicit country context). It does not
substitute a variant query or US-context query.

Rows show the round-start time in America/Chicago; summaries show frequencies,
errors and expected-count matches for each source, plus pair disagreements.
An error from one source does not prevent checking the other or later rounds.
Exit code 1 means a request/validation error, a source disagreement, changing
counts, or an expected-count mismatch. Exit code 0 means both sources agree
throughout (and match `--expected` when supplied). Null quantity is an error,
never zero. Missing/invalid token configuration exits before sending requests.
Each request has a ten-second timeout. This checks endpoint responses, not
browser CORS or guaranteed freshness of Shopify's upstream data.

The template is at `.shopify/theme/templates/product.flatgirl-data.liquid` and
remains ignored by Git under the existing `.shopify` rule. The checker itself
lives in tracked source under `tools/`.

## Offline checks

```sh
uv run --locked --project tools python -m unittest discover -s tools/tests -p 'test_shopify.py'
```

## References

- [Shopify cart flow](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage)
- [Shopify test orders](https://help.shopify.com/en/manual/checkout-settings/test-orders)
- [Shopify Payments test details](https://help.shopify.com/en/manual/payments/shopify-payments/testing-shopify-payments)

## Sales controls for the public-token storefront

Decision, November 16, 2026: **five items is a UI cap only**. The owner accepts
that someone can bypass it. No checkout validation app, custom backend, or hard
quantity enforcement is required for launch. Shopify offers an optional per-variant
add-to-cart limit; it has exceptions including untracked inventory and overselling.
Its presence/value in this store has not been inspected or changed. It is not a
per-customer limit. [Shopify add-to-cart limits](https://help.shopify.com/en/manual/checkout-settings/add-to-cart-limit).

The working setup is Headless with public Storefront reads, the pinned `2026-10`
API, and the owner's completed test purchase. Static waitlist mode only changes
our UI. Public tokens remain usable outside it, and issued checkout URLs can
outlive a website rollback. No Shopify settings changed during Session 2.
[Storefront public access](https://shopify.dev/docs/api/storefront/2026-10).

Prepare and rehearse these controls in Session 4; repeat the checks in Session 7:

1. **Before opening:** verify inventory tracking, online fulfillment locations,
   US market/shipping, the quantity reserved for replacements, and that
   **Continue selling when out of stock** is off. Record the actual sellable
   stock. Verify payment test/live mode deliberately; the Storefront API does
   not report it. Inventory and overselling configuration determine whether
   stock prevents further orders.
   [Shopify stock controls](https://help.shopify.com/en/manual/inventory-and-locations/setup/selling-when-out-of-stock).
2. **Open sales:** confirm the product is Active and published to Headless with
   the intended available inventory. Publish the checked commerce release.
   Complete the beta test purchase/email/order-status rehearsal before the
   production launch decision; do not repeat historical password workarounds.
3. **Close sales:** record current inventory first, remove Headless publication
   to stop new product access, and make online sellable stock unavailable with
   tracking on and overselling off. Coordinate any other sales channels and
   locations. Publish the waitlist release for messaging. These are intended
   controls; test both a new direct API cart and an already-issued checkout URL
   before relying on them as the store's closure procedure.
4. **Reopen:** restore only the verified sellable stock/publication, accounting
   for intervening orders, cancellations and reserved replacements. Verify
   checkout availability before restoring the commerce release.

Remaining store verification: actual inventory/overselling settings, closure of
already-issued checkout URLs, generated beta purchase and fresh-browser order
status access. These checks are deferred to Session 4, not implied by local tests.
