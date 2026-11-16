# Shopify checkout domain

**Prepared:** November 16, 2026. **Status: shopify.flatgirl.net set up per owner; compatible code is local; publication pending.**

The owner confirmed beta and selected one custom hostname: `shopify.flatgirl.net`
for checkout. Accounts and order status retain Shopify's default URLs. Use this
for Session 5 before the [storefront SEO launch](20261116_STOREFRONT_SEO_LAUNCH.md).
No external settings were changed by the agent.

## Target configuration

| Host | Purpose | Destination |
| --- | --- | --- |
| `flatgirl.net` / `www.flatgirl.net` | Nuxt landing page | Existing AWS hosting |
| `shopify.flatgirl.net` | Shopify checkout | CNAME `shops.myshopify.com`; Online Store primary domain |
| Shopify-provided account URL | Accounts and order status | Default Customer Accounts domain |

Keep the API identifier `tepwtx-zw.myshopify.com` unchanged. Copy account links
from Shopify rather than constructing a store ID or account path.

## Prerequisites

Record the current Online Store primary domain, beta release ID and DNS record
for the selected checkout hostname. Preserve apex/www, mail records and domain
delegation. The owner reports the custom domain set up; verify its actual target,
primary status and TLS instead of repeating completed connection steps.

Local allowlists in `web/shared/utils/shopify.ts`, `web/nuxt.config.ts`,
`tools/commerce_build.py` and `tools/shopify.py` now accept `shopify.flatgirl.net`.
The original myshopify hosts remain accepted. Unsafe-URL checks and validation of
archived artifacts using the original host list are preserved. New builds require
the expanded list. Shopify's returned checkout URL is never rewritten.

The locally recorded beta release `20261116T222528Z-044298cbce3a` still uses the
original myshopify-only list. Publish a compatible build before relying on the
custom hostname. The owner's beta confirmation stands; only the changed domain
handoff needs a fresh targeted check.

Local validation for the selected hostname: web typecheck, 27 adapter/policy tests
and 18 Python commerce/smoke tests passed. A workspace search found no remaining
references to the retired custom hostnames. No live checkout or deployment was
performed during this update.

## Execute in order

1. **Verify the existing connection.** In **Shopify → Settings → Domains**, select
   `shopify.flatgirl.net` and confirm connection/TLS readiness. If connection is
   incomplete, verify the DNS CNAME `shopify` points to `shops.myshopify.com` and
   finish **Connect existing domain** for that hostname. Leave apex/www on AWS.
2. **Publish compatible code.** Use the [beta workflow](20261116_BETA_SHOPIFY_COMMERCE_MIGRATION.md)
   to build/publish the updated allowlist. Every active commerce frontend must
   accept the custom checkout host before the primary-domain switch. If it is
   already primary, the compatible frontend publication is the remaining code step.
3. **Verify the primary target.** In **Settings → Domains → shopify.flatgirl.net**,
   use target **Online Store** and type **Primary**. In **Settings → Customer
   accounts**, retain the default Shopify account URL. From beta, open a fresh
   checkout and confirm the branded hostname works. Record only the hostname,
   not the private checkout URL.
4. **Verify customer navigation.** Check logo/continue-shopping links return to
   `flatgirl.net`, including the product path
   `/products/boring-flat-girl-plush-blanket` resolving to `/`. Check existing
   order-status email links in a private browser and account login on Shopify's
   default domain. Preserve Shopify-generated order-status links in confirmation
   and shipping templates. Any additional purchase test requires the confirmed
   test-payment setup and controlled recipients; do not change payment mode once
   real sales begin.
5. **Record the result.** Confirm apex AWS hosting and beta protection still work.
   Record the active Shopify domain, deployed release and targeted check results.
   Continue with the SEO/production launch once these checks pass.

## Recovery

If branded checkout fails, restore the recorded prior Online Store primary domain
in Shopify and verify newly created checkouts before considering an older frontend
release. Keep the compatible allowlist deployed while investigating. A frontend
rollback to code that rejects the active hostname can break Buy now.

Reverting DNS alone does not restore Shopify's primary-domain setting. Preserve
connections used by issued links while investigating. Record the resulting domain,
DNS state and release. This workflow does not change Customer Accounts routing.

## Completion record

| Item | Status |
| --- | --- |
| Hostname decision and setup | shopify.flatgirl.net selected and set up per owner |
| Compatible allowlists | Implemented locally; publication pending |
| Primary Online Store target and TLS | Owner setup reported; targeted verification pending |
| Default account URLs and return navigation | Targeted verification pending |
| Compatible release and handoff result | Pending |

## References

- [Shopify checkout-domain setup](https://shopify.dev/docs/storefronts/hydrogen/deploy/go-live).
  Its Oxygen-specific apex instructions do not apply to this AWS-hosted storefront.
- [Shopify customer-account domains](https://help.shopify.com/en/manual/customers/customer-accounts/customize-customer-accounts/connect-domain-customer-account).
