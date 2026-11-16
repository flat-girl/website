# Admin incremental-refresh migration

Deployed migration: November 8, 2026. Adds event-time indexes and upgrades the rollup cache to schema 3.

Run commands from the repository root. This records a specific rollout or recovery;
check its applicability before reusing it.

The November 8 incremental-refresh change replaces repeated full scans with
indexed time-range queries and durable completed-hour rollups. All 53 backend/infrastructure tests, TypeScript checking, and synthesis pass.
The live diff confirms exactly two additive event-table indexes, one admin read
policy change, and metrics Lambda code; no other resource changes. Review:
`.deploy/admin/incremental-review.json`. Both indexes are now ACTIVE; the approved
access and admin stack updates are deployed. Live verification at 9:07 PM CST
confirmed that all four stack resource templates, the read policy, and the Lambda
source match the reviewed changes. Public-site HTTP 200, signup preflight HTTP 204,
and unauthenticated admin API HTTP 401 passed. Receipt:
`.deploy/admin/incremental-verification-first.json`.

The initial verification still found schema 2 snapshots because an authenticated
refresh had not yet initialized schema 3. The first refresh performs that one-time
build. Signed-in refresh behavior has local regression coverage; deployment checks
alone do not establish live authenticated refresh success.

1. Review and deploy `signup-beta` and `signup-production`; the intended changes
   add only the `environment-time` index to each existing event table. It uses
   existing `environment` and `event_time` attributes and projects only event
   name, IP address, and user-agent (event ID is included automatically). No event
   rewrite or primary-key replacement is needed. Wait for both indexes to be ACTIVE.
2. Review `access`: replace the admin runtime's projected table Scan permission
   with projected Query permission on those two specific indexes. Deploy this
   immediately before `admin` to minimize the old reader's permission gap.
3. Deploy `admin`: only metrics Lambda code changes. No static frontend release
   is required. The first refresh initializes schema 3 once; subsequent refreshes
   query only the unfinished interval. Verify a second refresh and hour rollover.

Do not deploy unrelated pending changes in any stack. For rollback, restore the
previous projected Scan permission before restoring the schema 2 Lambda. Leave
the additive indexes in place; deleting an index is unnecessary for rollback.
Do not purge source records or historical cache as a recovery step.
