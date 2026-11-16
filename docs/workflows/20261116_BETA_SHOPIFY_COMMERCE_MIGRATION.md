# Beta Shopify commerce migration

**Prepared:** November 16, 2026. **Status: beta running per owner; detailed verification record pending.**
This is the one-off Session 4 rollout for the locally implemented Sessions 1–3.
Run all commands from the repository root.

November 16 update: the owner reports beta up and running and Shopify looking
ready. Do not rerun completed deployment steps solely because the detailed record
below is incomplete. The readiness audit confirmed unauthenticated beta returns
401; it did not inspect authenticated checkout, AWS stack state or Brevo delivery.

## Applicability and prerequisites

Use this workflow to move the existing beta waitlist to public-token Shopify
commerce, add policy routing, and change beta signup to Brevo list **10**.
Production's local list-9 configuration is outside this beta migration; do not
apply the production signup or site stacks here. A later production launch needs
its own dated migration workflow.

Before execution, confirm the `flat-girl` operator and `flat-girl-beta` publisher
profiles from [Access](../ACCESS.md), existing beta credentials, prepared image
receipt, and the public Headless Storefront token. Read the current
[Session 4 test matrix](../plans/shopify-integration-plan.md#session-4--beta-wiring-and-end-to-end-rehearsal)
and [Shopify sales controls](../SHOPIFY.md#sales-controls-for-the-public-token-storefront).
Confirm Shopify payment test mode and controlled recipients before testing purchases
or emails. Beta and production share Shopify inventory and payment settings.

Record the currently verified beta waitlist release ID before building. Also
record the deployed beta signup list ID and source revision for recovery; do not
assume local configuration is already deployed. Confirm Brevo list 10 exists and
has the intended welcome automation. Existing contacts and suppression stay intact.

## Execute in order

1. Deploy beta signup (list 10) and the reviewed policy router:

   ```sh
   make cloud-diff PROFILE=flat-girl STACK=signup-beta
   make cloud-deploy PROFILE=flat-girl STACK=signup-beta
   make cloud-diff PROFILE=flat-girl STACK=beta
   make cloud-deploy PROFILE=flat-girl STACK=beta
   ```

2. Supply the **public** Headless token to the build process (never a private or
   Admin token). The read command waits for you to paste it; it is intentionally
   public in the generated site and release manifest. `web/.env` is ignored by
   `site-build`, so private local-development settings cannot leak into this build.

   ```sh
   read -r NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
   export NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
   export FLAT_GIRL_STOREFRONT_MODE=commerce
   unset FLAT_GIRL_COMMERCE_ENDPOINT NUXT_PUBLIC_COMMERCE_ENDPOINT
   make site-build SITE_ENV=beta PROFILE=flat-girl-beta
   make site-publish SITE_ENV=beta PROFILE=flat-girl-beta DRY_RUN=1
   ```

3. Publish those checked bytes and rehearse the purchase/signup flow:

   ```sh
   make site-publish SITE_ENV=beta PROFILE=flat-girl-beta
   make site-verify SITE_ENV=beta PROFILE=flat-girl-beta
   ```

4. Rehearse rollback using the saved **verified** waitlist release:

   ```sh
   make site-rollback SITE_ENV=beta PROFILE=flat-girl-beta RELEASE=previous-waitlist-release-id DRY_RUN=1
   make site-rollback SITE_ENV=beta PROFILE=flat-girl-beta RELEASE=previous-waitlist-release-id
   unset FLAT_GIRL_STOREFRONT_MODE NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN
   ```


The rollback commands above deliberately restore the waitlist for the rehearsal.
Record the new commerce release ID before doing so. If beta should end in commerce
mode after the rehearsal, publish that same checked release with
`make site-publish SITE_ENV=beta PROFILE=flat-girl-beta RELEASE=commerce-release-id`.
Do not rebuild merely to switch between the two checked artifacts.

## Verify and record results

1. Confirm the signup stack reports list **10** and the expected beta endpoint:
   `make signup-status PROFILE=flat-girl SITE_ENV=beta`. Submit controlled launch
   and sold-out signups; verify list-10 membership, intended welcome/owner email
   behavior, duplicates and suppression. Both forms use the existing request;
   neither sends a purpose field or list ID. Production signup must stay unchanged.
2. Verify beta authentication on direct links and refreshed policy pages. Run
   `site-verify` as shown above for bytes, cache rules, redirects and protected
   access on the canonical and raw distribution hostnames.
3. Complete the Session 4 purchase/failure matrix. Check direct public-token
   Shopify requests, test order confirmation, email and fresh-browser order-status
   access. Five items is a UI convenience, not a required hard limit. Verify sales
   closure separately, including an already-issued checkout URL.
4. Verify the restored waitlist release and production's existing site/signup.
   Record the final beta release, stack/source revisions, signup list, observed
   outcomes and unresolved checks in the completion record below. Never record
   tokens, private checkout URLs, passwords or customer details.

## Failure recovery

If a stack update fails, inspect its events and resolve that stack before
publishing the frontend. A failed publication can be retried with the same
`RELEASE`, or restored with the verified waitlist rollback commands above. Keep
old assets and release archives; do not delete objects to recover.

Frontend rollback does not undo Shopify stock/publication, invalidate issued
checkouts, or restore the former Brevo list. The policy router remains compatible
with the old waitlist. If the signup migration itself must be reversed, restore
its previous reviewed runtime/configuration together and review/deploy only
`signup-beta`; changing the list ID alone can conflict with code validation.
Already-created memberships and emails are not undone. Use the Shopify sales
control procedure if purchases must stop.

## Completion record

| Item | Recorded outcome |
| --- | --- |
| Beta signup/list-10 deployment | Pending |
| Beta policy-router deployment | Pending |
| Commerce release and publication | Beta running per owner, November 16; exact release identifier not recorded |
| Purchase, policy and signup rehearsal | Pending |
| Waitlist rollback and final beta release | Pending |

Local implementation checks are recorded in the plan handoffs. They are not
live deployment evidence. Record remaining stack identifiers and observed flow
results; the owner report confirms beta is running, not every rehearsal check.
