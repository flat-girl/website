# Shopify integration proof

For implementation order, contracts, and fresh-session prompts, use the
[Shopify integration plan](plans/shopify-integration-plan.md). The next session
starts with local storefront UI and mocked commerce responses.

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
proposed `checkout.flatgirl.net` custom domain, which has not been configured
or added to the tool's accepted checkout hosts.

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

## Offline checks

```sh
uv run --locked --project tools python -m unittest discover -s tools/tests -p 'test_shopify.py'
```

## References

- [Shopify cart flow](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage)
- [Shopify test orders](https://help.shopify.com/en/manual/checkout-settings/test-orders)
- [Shopify Payments test details](https://help.shopify.com/en/manual/payments/shopify-payments/testing-shopify-payments)

Next implementation milestone: build the local storefront UI against mocks,
then implement the backend, sold-out Brevo signup, and beta integration in the
separate sessions defined by the plan.
