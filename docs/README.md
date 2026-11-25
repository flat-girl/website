# Documentation

All project documentation lives here. Commands in these guides run from the
repository root, even when the guide is inside `docs/workflows/`.

## Development and operations

| Guide | Use it for |
| --- | --- |
| [Development](DEVELOPMENT.md) | Local setup, frontend checks, images, and previews |
| [AWS hosting](HOSTING.md) | Infrastructure layout and AWS tooling |
| [Access](ACCESS.md) | Profiles, permissions, and operator setup |
| [Deployment](DEPLOYMENT.md) | Publishing, verification, and rollback |
| [Images](IMAGES.md) | Image imports, variants, and source recovery |
| [Signup](SIGNUP.md) | Turnstile, Brevo, and signup operations |
| [Shopify](SHOPIFY.md) | Local product/cart proof and manual test checkout |
| [Meta](META.md) | Event delivery, credentials, checks, and queue recovery |
| [Notifications](NOTIFICATIONS.md) | Subscriber owner alerts and failure handling |
| [Admin](ADMIN.md) | Dashboard, aggregate cache, and admin deployment |

## Migrations and incident recovery

Use [dated workflows](workflows/README.md) for one-time upgrades, cutovers, and
historical recovery procedures. Their prerequisites and recorded status determine
whether they apply; they are not a checklist to rerun on every deployment.

## Plans and implementation history

Start with the [plans index](plans/README.md) and
[implementation roadmap](plans/IMPLEMENTATION-PLAN.md). Detailed plans and
historical evidence live together in `docs/plans/`.
These preserve decisions as recorded at the time; use the operational guides
for current behavior.

## Where new documentation belongs

**Before writing deployment instructions, decide whether they are routine operations
or a one-off change.** A first rollout, required deployment order across stacks,
list/configuration cutover, or recovery for a specific revision belongs in a dated
**migration workflow**, even when the commands themselves are ordinary `make`
commands and execution is deferred to another session.

Create or update that workflow before completing the implementation handoff. Mark
unexecuted work **pending**, index it in `docs/workflows/README.md`, and link it from
the affected guides and plan. Keep the execution steps in one place: do not append
a session-specific rollout checklist to `DEPLOYMENT.md`, another operational guide,
or a plan. Those documents retain reusable behavior and a link to the workflow.

- Keep reusable setup, commands, architecture, and troubleshooting in the relevant guide.
- Keep implementation plans, the roadmap, and their historical evidence in `docs/plans/`.
- Put one-time migration, rollout, cutover, and incident-recovery procedures in
  `docs/workflows/YYYYMMDD_NAME.md`, using the event date and an uppercase descriptive name.
- Include applicability, prerequisites, execution order, verification, recovery
  guidance when relevant, and recorded completion status in each workflow.
- Link to workflows from the relevant guide and workflow index; do not copy their steps back into the guide.
- Keep the repository-root README as a navigation entry point. Keep source and configuration in their existing directories.
