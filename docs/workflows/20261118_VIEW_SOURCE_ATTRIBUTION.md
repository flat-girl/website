# View source attribution rollout

**Prepared:** November 18, 2026. **Status:** implementation and rollout pending.
No Lambdas, tables, indexes or admin releases changed during planning.

## Scope and prerequisites

Implement stage 5 of the [Meta sales dataset plan](../plans/meta-sales-dataset-plan.md)
to label ViewContent as Meta, TikTok, Other or Direct / unknown and show recorded
view counts by source in admin. Signup/Lead attribution is outside this feature.
This release is separate from the [dataset migration](20261118_META_SALES_DATASET_MIGRATION.md).
Do not rotate credentials again as part of the source-reporting release.

Before rollout, pass the classifier/worker/admin tests, AWS typechecking and
infrastructure tests, and admin typecheck/build/browser checks. Verify the API and
frontend remain compatible with old records and missing source fields. Record
the previously deployed backend revision and admin release for rollback.

Use staged revisions so source readers are not deployed before the new index is
ACTIVE. Source tables and their existing index must be retained. Confirm the AWS
account's index quota/capacity and review every stack diff for unrelated changes.
The new index adds storage/read/write cost; it projects only the small source
label in addition to the existing attributes. Admin still cannot read raw click
IDs, emails or arbitrary URLs.

## Execution order

1. **Add the index permissions.** Review and apply the access change using the
   existing administrative profile. Keep the old index permission for rollback.

   ```sh
   make cloud-diff PROFILE=default STACK=access
   make cloud-deploy PROFILE=default STACK=access BOOTSTRAP=1
   ```

2. **Deploy compatible workers and additive indexes.** Deploy the archive-reader
   changes and new `environment-time-source-v1` GSI in beta first, then production
   after beta checks. At this stage the old admin still queries the old index.

   ```sh
   make cloud-diff PROFILE=flat-girl STACK=signup-beta
   make cloud-deploy PROFILE=flat-girl STACK=signup-beta
   make cloud-diff PROFILE=flat-girl STACK=signup-production
   make cloud-deploy PROFILE=flat-girl STACK=signup-production
   ```

   Wait for the new indexes to be ACTIVE with backfill finished. Check unchanged
   table identity, old-index availability, queue health and ordinary event delivery.
   The workers must accept old messages and the new optional source metadata.

3. **Enable edge classification.** Deploy the viewer-response changes in beta,
   verify isolated source cases, then production. Preserve routing and beta auth.

   ```sh
   make cloud-diff PROFILE=flat-girl STACK=beta
   make cloud-deploy PROFILE=flat-girl STACK=beta
   make cloud-diff PROFILE=flat-girl STACK=production
   make cloud-deploy PROFILE=flat-girl STACK=production
   ```

   Wait for CloudFront propagation. Record source-collection start per environment.
   Verify cached and uncached landing responses classify current request signals,
   GPC suppresses views, and request-specific source values are not cached into
   other visitors' responses. Check archived metadata without copying customer
   identifiers into the rollout record. Do not send synthetic paid-click IDs into
   production; use permitted real visits or isolated beta fixtures.

4. **Switch the admin reader and rebuild aggregates.** After both indexes are
   ready, deploy the admin runtime using the new index and schema-4 cache.

   ```sh
   make cloud-diff PROFILE=flat-girl STACK=admin
   make cloud-deploy PROFILE=flat-girl STACK=admin
   ```

   Use the existing authenticated ensure flow to rebuild each environment's
   cache. Do not delete source rows or clear cache tables manually. Confirm the
   old complete snapshot remains visibly stale until the schema-4 manifest is
   ready; repeated/resumed calls cannot double-count. Compare the same time
   window before/after: recorded totals remain equal and the four source buckets
   sum to recorded views. Legacy records appear under unknown. Preserve the old
   aggregate generation and index through the rollback window.

5. **Publish and verify admin.** Build and preview the updated panel before
   publication, then use the existing publisher profile.

   ```sh
   make admin-build
   make admin-publish PROFILE=flat-girl-admin DRY_RUN=1
   make admin-publish PROFILE=flat-girl-admin
   make admin-verify PROFILE=flat-girl-admin
   ```

   Check authenticated day/week/all-time ranges, source counts/shares, unknown
   history, source-collection start, old-API fallback and raw-view labeling while
   the existing unique-view toggle is active. No source-specific lead rate should
   appear. Record the published release and evidence below.

## Recovery

Roll back the admin UI using `make admin-rollback PROFILE=flat-girl-admin
RELEASE=<previous-release>` with the recorded actual release. If needed, redeploy
the prior admin runtime against the retained old GSI and compatible cache schema.
Do not remove either index during incident recovery or reset event delivery flags.
Keep additive source fields in existing events; old readers ignore them.

If edge capture is faulty, restore the prior edge code/associations through the
beta/production stack deployment path, preserving router/auth behavior and
replicated Lambda versions. Rollback stops new classifications; it does not undo
stored source labels. Keep the worker compatible with already queued messages.
No dataset, token, Shopify or ad changes are part of this recovery.

## Completion record

| Item | Status |
| --- | --- |
| Local classifier, storage, admin and compatibility checks | Pending |
| Permissions and both indexes ACTIVE | Pending |
| Beta/production edge capture and collection-start times | Pending |
| Admin schema-4 rebuild and source-total comparison | Pending |
| Published admin release, observed cases and rollback disposition | Pending |
