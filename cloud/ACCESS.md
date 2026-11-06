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
| Project operator | Manages four named non-access stacks, passes only the CloudFormation role, imports originals, ensures variants, rotates beta auth, assumes publisher roles |
| CloudFormation role | Manages the four named buckets, domain/validation DNS records, certificates, and CloudFront resources; no IAM administration |
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
Their distribution permissions use Project/Environment tags. Live IAM behavior,
organization restrictions, certificate issuance, and create/update/recovery are
not proven by synthesis or local assertions and remain rollout checks.

If an initial stack reaches `ROLLBACK_COMPLETE`, inspect its events and retained
resources before recovery. Do not repeatedly broaden IAM one failing action at
a time, delete retained buckets, or change other projects. Correct the access
template through the administrator, then review the recovery change together.
