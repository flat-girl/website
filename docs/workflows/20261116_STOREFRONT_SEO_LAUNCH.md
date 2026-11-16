# Storefront SEO launch

**Prepared:** November 16, 2026. **Status: local implementation; publication and indexing pending.**

## Applicability and prerequisites

Use this once when opening the reviewed Shopify commerce release to search
engines. It covers the SEO part of the production launch, not Shopify domain,
payment, inventory or signup configuration. Complete or explicitly defer the
remaining checks in [the integration plan](../plans/shopify-integration-plan.md)
before opening sales. Keep beta authenticated and noindex.

### First: Shopify → Settings → Domains

Complete the [Shopify branded-domain setup](20261116_SHOPIFY_BRANDED_DOMAINS.md)
before this SEO launch. That workflow contains the ordered Shopify admin and DNS
steps for `shopify.flatgirl.net`, including the required
checkout allowlist update **before making the checkout domain primary**.

The target is Shopify hosting checkout on that subdomain, with accounts/order
status using Shopify's default URLs and `flatgirl.net` remaining the AWS-hosted
landing page. Changing Shopify's primary
Online Store domain does not set our landing page's canonical or enable indexing;
the SEO steps below handle that separately.

The landing page now supplies its own title, description, canonical URL, Open
Graph/Twitter preview and sitemap. Shopify's product listing editor does not
populate these Nuxt tags. Price/availability structured data is not implemented;
do not add a hardcoded offer that can disagree with Shopify.

Use the existing operator/publisher profiles in [Access](../ACCESS.md). Before
publication, record the current verified production release and the reviewed
commerce release inputs. Production builds require clean committed source; do
not include unrelated local changes. Retain the public Storefront token in the
build environment; never substitute the private/Admin token.

## Execute in order — pending

1. Rehearse the SEO-bearing artifact on beta through the existing
   [beta workflow](20261116_BETA_SHOPIFY_COMMERCE_MIGRATION.md). Verify the source
   HTML contains one canonical `https://flatgirl.net/`, a product title and
   description, and an absolute, publicly accessible CDN image for sharing.
   Verify `/sitemap.xml` contains the homepage and beta still returns noindex.
2. At the agreed production launch, set `productionNoindex` to `false` in
   `cloud/aws/project.json`. Review the production stack diff before applying:

   ```sh
   make cloud-diff PROFILE=flat-girl STACK=production
   make cloud-deploy PROFILE=flat-girl STACK=production
   ```

   This removes CloudFront's production `X-Robots-Tag` restriction. The old HTML
   remains noindex until the new artifact publishes. Changing only HTML or only
   CloudFront is insufficient.
3. Supply the public token and build the reviewed production commerce artifact:

   ```sh
   read -r NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
   export NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
   export FLAT_GIRL_STOREFRONT_MODE=commerce
   unset FLAT_GIRL_COMMERCE_ENDPOINT NUXT_PUBLIC_COMMERCE_ENDPOINT
   make site-build SITE_ENV=production PROFILE=flat-girl-production
   make site-publish SITE_ENV=production PROFILE=flat-girl-production DRY_RUN=1
   ```

   Review the release manifest and generated source. Publish only after the
   domain, checkout, payment and production signup prerequisites are satisfied:

   ```sh
   make site-publish SITE_ENV=production PROFILE=flat-girl-production
   make site-verify SITE_ENV=production PROFILE=flat-girl-production
   unset FLAT_GIRL_STOREFRONT_MODE NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
   ```
4. Confirm production has no noindex HTTP header or meta tag, its robots file
   permits crawling and advertises `https://flatgirl.net/sitemap.xml`, and the
   homepage/sitemap/image return successful responses. Check the canonical and
   social URLs contain no beta, checkout or myshopify hostname. Recheck beta's
   access and noindex protections.
5. In the owner's verified Google Search Console property for `flatgirl.net`,
   submit `sitemap.xml` and inspect/request indexing for `https://flatgirl.net/`.
   Record submission separately from actual indexing; neither canonical tags nor
   submission guarantee Google's selected URL or ranking. Verify Shopify theme
   redirects and any ad/catalog product links independently.

## Recovery

For an incorrect artifact, use the verified prior release with the existing
[rollback procedure](../DEPLOYMENT.md#failure-recovery). To restore indexing
restrictions, set `productionNoindex` back to `true`, review/deploy the production
stack, and rebuild/publish the intended release with matching noindex metadata
and robots behavior. Record the resulting release and verify both HTTP headers
and source HTML. Previously indexed URLs can take time to disappear.

Indexing restrictions and static rollback do not stop Shopify checkout. If
purchases must stop, also use the verified
[Shopify sales controls](../SHOPIFY.md#sales-controls-for-the-public-token-storefront).

## Completion record

| Item | Status |
| --- | --- |
| Shopify branded-domain prerequisite | Pending; follow the linked domain workflow first |
| Landing metadata and sitemap implementation | Local; typecheck, static generation, generated HTML/XML inspection and 11 deployment tests passed; not published |
| Beta source/share-image verification | Pending |
| Production release and indexing restrictions removed | Pending |
| Search Console submission / observed indexing | Pending / pending |

