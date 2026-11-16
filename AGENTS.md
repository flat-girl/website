# Repository instructions

## Deployment documentation

Before writing or changing deployment instructions, read [docs/README.md](docs/README.md)
and [docs/workflows/README.md](docs/workflows/README.md).

- One-off deployment, migration, rollout, cutover, and recovery instructions belong
  in `docs/workflows/YYYYMMDD_NAME.md`, including procedures prepared for a later session.
- Use a dated migration workflow for the ordered commands, prerequisites,
  verification, recovery, and actual completion status. Mark unexecuted work pending.
- Link the workflow from its index, relevant operational guides, and plan handoff.
  Do not duplicate the steps in `docs/DEPLOYMENT.md` or a plan.
- Keep routine reusable operations in the operational guides. Before finishing a
  deployment-related implementation, check that its one-off rollout has a workflow
  and give the user that workflow's link.
