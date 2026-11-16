# Migration and recovery workflows

**One-off deployment instructions are migration workflows, including rollouts
prepared during an implementation session but not yet executed.** Keep their
ordered commands here; operational guides and plan handoffs link to them.

One-time procedures live in `YYYYMMDD_NAME.md` files. Dates identify the original
rollout or incident, not the date a document was moved. Commands run from the
repository root. Read the recorded status and prerequisites before using a
historical procedure, especially one containing cleanup commands.

| Date | Workflow |
| --- | --- |
| 2026-11-16 | [Beta Shopify commerce migration — pending](20261116_BETA_SHOPIFY_COMMERCE_MIGRATION.md) |
| 2026-11-14 | [KMS usage reduction](20261114_KMS_USAGE_REDUCTION.md) |
| 2026-11-10 | [Subscriber owner-notification cutover](20261110_SUBSCRIBER_NOTIFICATION_CUTOVER.md) |
| 2026-11-08 | [Admin incremental refresh](20261108_ADMIN_INCREMENTAL_REFRESH.md) |
| 2026-11-06 | [Shared beta/production edge migration](20261106_SHARED_EDGE_MIGRATION.md) |
| 2026-11-06 | [Meta delivery fixes](20261106_META_DELIVERY_FIXES.md) |
| 2026-11-06 | [Production routing-version recovery](20261106_PRODUCTION_ROUTING_VERSION_RECOVERY.md) |
| 2026-11-05 | [Initial beta signup tagging recovery](20261105_BETA_SIGNUP_TAGGING_RECOVERY.md) |

Routine deployments, regression tests, secret changes, and troubleshooting stay
in the [operational guides](../README.md). Do not create a dated migration for
each ordinary use of those commands.
