# Access setup

**Discovered November 5, 2026:** account `066540957026`, public Route 53 zone
`Z06174692C3V38JQV6ZWT` for `flatgirl.net`. `default` is root and was used only
for authorized read-only discovery. No apex/www/beta web records or matching
CloudFront distribution were found. Existing Google/Brevo mail records must
remain unchanged. The raw DNS snapshot is ignored at `.deploy/preflight.json`.

No AWS-specific skill was found in installed Codex/plugin/shared skill directories.
The implementation uses AWS CLI v2, CDK, official AWS documentation, and the local
Big Naturals/FishLamps reference code.

## 1. Review the configuration and access template

On a fresh checkout, copy `cloud/aws/project.example.json` to
`cloud/aws/project.json`. Use the discovered account/zone above, and set
`operatorPrincipalArn` to `null` to create a dedicated `flat-girl-operator` IAM
user without a password or access keys. Alternatively, supply an existing human
IAM user/role ARN in this account; that identity must have permission to assume
the new project operator role. Do not use a root ARN as the trusted operator.

```sh
make cloud-preflight PROFILE=default
make cloud-diff PROFILE=default STACK=access
```

The diff synthesizes locally and reads the deployed template; it creates no
change set. Review `cloud/aws/cdk.out/FlatGirlAccess.template.json` and the permission
boundaries below before applying it.

## 2. Apply access setup yourself

Use an administrator session. The explicit access-only bootstrap permits the
existing root profile; routine commands reject root writes. Prefer a non-root
administrator profile when available.

```sh
make cloud-deploy PROFILE=default STACK=access BOOTSTRAP=1
```

Use this same command for later access-stack updates, including milestone 3's
signup permissions. `BOOTSTRAP=1` is the explicit access-stack administration
flag, not a first-deployment-only flag. No `flat-girl-admin` profile is required
or created by this project; `default` is the existing administrative profile in
this setup. Use `flat-girl` for the subsequent non-access stack operations.

This creates the operator user (when configured), operator role, CloudFormation
execution role, and separate beta/production publisher roles. It creates no
password, key, GitHub OIDC trust, hosting resources, or DNS records.

Privately configure the new user's console sign-in and MFA as administrator,
then sign in using the AWS CLI browser-login workflow supported by this installed
CLI. Keep its password out of chat, terminal arguments, and repository files.
Example profile layout in your private AWS configuration:

```ini
[profile flat-girl-human]
region = us-east-1

[profile flat-girl]
role_arn = arn:aws:iam::066540957026:role/flat-girl-operator
source_profile = flat-girl-human
region = us-east-1

[profile flat-girl-beta]
role_arn = arn:aws:iam::066540957026:role/flat-girl-beta-publisher
source_profile = flat-girl
region = us-east-1

[profile flat-girl-production]
role_arn = arn:aws:iam::066540957026:role/flat-girl-production-publisher
source_profile = flat-girl
region = us-east-1
```

```sh
aws login --profile flat-girl-human --region us-east-1
aws sts get-caller-identity --profile flat-girl
```

These are local CLI profiles; creating the IAM roles does not configure them on
your machine. Create the beta publication profile before building/publishing beta:

```sh
aws configure set role_arn arn:aws:iam::066540957026:role/flat-girl-beta-publisher --profile flat-girl-beta
aws configure set source_profile flat-girl --profile flat-girl-beta
aws configure set region us-east-1 --profile flat-girl-beta
aws sts get-caller-identity --profile flat-girl-beta
```

Before production, configure `flat-girl-production` with the production publisher
role shown above and the same `source_profile` and region.
Renew login when a session expires; role chaining can limit session duration.

## Permission boundaries

| Identity | Intended permission |
| --- | --- |
| Administrator | Owns the access stack and private human sign-in setup |
| Project operator | Manages six named non-access stacks, passes only the CloudFormation role, imports originals, ensures variants, rotates beta auth/shared signup secrets, reads signup health, assumes publisher roles |
| CloudFormation role | Manages hosting plus signup Lambda/API/log/metric/alarm resources and their DNS/certificates; passes only the two signup runtime roles; may create the AWS-managed API Gateway service-linked role |
| Beta publisher | Beta site writes, shared source reads/variant additions, beta release archives, beta invalidations; no production site writes |
| Production publisher | Equivalent production scope; no beta site writes |

Lifecycle scope is broader for CloudFront/ACM than for S3: execution permissions
cover CloudFront resources and certificates in this account because generated
IDs and some untaggable resource types prevent uniform name/tag scoping. KVS
management similarly uses account-level KVS resource ARNs; the helper targets
only the beta stack's store. Create/list APIs needing `*` are documented in
`cloud/aws/lib/access.ts`. This is an infrastructure-administration role, not a
frontend/CI identity. Review this breadth before bootstrap; OIDC/CI comes later.

Publishers explicitly deny object/version deletion and have no IAM administration.
They have no signup-secret access. Milestone 3 adds two runtime roles in the
administrator-managed access stack; both read only the shared
`/flat-girl/signup/turnstile-secret` and `/flat-girl/signup/brevo-api-key`
SecureStrings and write their own Lambda logs. No custom KMS key is used.

API Gateway lifecycle permissions cover regional `/apis/*` because API IDs are
generated, plus the two exact custom domain names and tagging APIs. This grants
the infrastructure execution role broader regional API management, not the
publisher/runtime roles. Review that scope with the access diff. The only added
IAM creation permission is restricted to API Gateway's AWS-managed service-linked
role. Ordinary runtime roles/policies are still created by the administrator.
The policy includes Stage handler permissions `apigateway:TagResource` and
`apigateway:UntagResource`, plus `AddCertificateToDomain` and
`RemoveCertificateFromDomain` restricted to the two signup domain ARNs. These
named actions are required in addition to the HTTP verb permissions; the initial
signup rollout exposed the missing Stage tagging permission. The correction was
checked against AWS's registered resource-handler schemas.
The full signup rollout is in [SIGNUP.md](SIGNUP.md).

Publisher distribution permissions use Project/Environment tags. Live IAM behavior,
organization restrictions, certificate issuance, and create/update/recovery are
not proven by synthesis or local assertions and remain rollout checks.

If an initial stack reaches `ROLLBACK_COMPLETE`, inspect its events and retained
resources before recovery. Do not repeatedly broaden IAM one failing action at
a time, delete retained buckets, or change other projects. Correct the access
template through the administrator, then review the recovery change together.


## Milestone 4 access update

The local Meta implementation adds per-environment edge and worker roles, two
queues (main/DLQ), and explicit Lambda version/replication lifecycle permissions.
Signup reads its own nonsecret Meta settings and enqueues; the edge only enqueues;
only the matching worker reads its Meta credentials. Publishers cannot read these
parameters. Operator queue access is diagnostic only; purge/redrive is not granted.
Edge log access spans AWS execution regions but only the named project functions.
CDK splits the execution role's larger policy into an inline policy and an attached
managed policy when needed. Review both in the access diff before applying.
See [META.md](META.md) for deployment order and verification limits.

The November 6 event-record addition creates retained DynamoDB tables named
`flat-girl-beta-events` and `flat-girl-production-events`. Each worker has only
`GetItem`, `PutItem` and `UpdateItem` on its own table; the operator has describe/get/scan access. Publishers,
edge and signup roles have no table access. The execution role gets named-table
lifecycle, tagging and PITR permissions. Apply the access update before the signup
stacks. These tables and SQS/DLQ messages contain the requested customer identifiers;
logs continue to exclude them. Retention/deletion protection keeps records through
stack removal; no automatic expiry is configured.


The shared-router revision adds dedicated `flat-girl-{environment}-edge-routes`
roles. Beta's router alone reads `/flat-girl/beta/authorization-sha256`; production
has no auth-read permission. The operator can copy the existing KVS digest into
that SecureString using `beta-auth-migrate` and rotate both stores using `beta-auth`.
Tracking roles keep queue-only access. Apply access before migration and site updates.

## Subscriber notification access

The SES notification change adds `flat-girl-{environment}-notification` worker
roles, the `flatgirl.net` SES domain identity and three SES DKIM CNAME records.
Existing Google/Brevo DNS records are preserved. Signup can only enqueue to its matching notification queue; it cannot
send email. Each worker reads its own nonsecret notification settings, consumes
its queue and sends from/to **high@flatgirl.net only**. It cannot read Brevo keys.
The operator can configure these settings, check SES readiness, send owner-only
thread seed emails and enqueue controlled worker tests. Existing sender and
recipient restrictions also apply to operator email sends.

Access-stack policies merge equivalent statements to stay within the existing
51,200-byte inline template limit without granting asset-publication permissions.
Apply the access stack before deploying the signup stacks. See
[NOTIFICATIONS.md](NOTIFICATIONS.md) for the staged rollout.
