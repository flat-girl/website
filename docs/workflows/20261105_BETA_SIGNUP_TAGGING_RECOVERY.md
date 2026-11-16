# Initial beta signup tagging recovery

Historical recovery: November 5, 2026. Resolved; the destructive cleanup below is not a procedure for a working stack.

Run commands from the repository root. This records a specific rollout or recovery;
check its applicability before reusing it.

**Historical incident: resolved by the user. Both signup stacks are now live.
Do not run the deletion commands below against the current working deployment.**

Read-only inspection on November 5, 2026 found `FlatGirlBetaSignup` in
`ROLLBACK_COMPLETE`, termination protection off, and the original Stage creation
denied `apigateway:TagResource`. The API, certificate, Stage, and alarm were deleted
by rollback. Only `/aws/lambda/flat-girl-beta-signup` was retained; it has zero
stored bytes and zero log streams. The signup Lambda was never created.

The corrected access template includes Stage tagging/untagging and domain
certificate attachment/removal, checked against live CloudFormation resource
schemas. New signup log groups retain established logs but use
`RetainExceptOnCreate` to avoid leaving an orphan after a failed initial creation.

1. Apply the corrected access permissions:

   ```sh
   make cloud-diff PROFILE=default STACK=access
   make cloud-deploy PROFILE=default STACK=access BOOTSTRAP=1
   ```

2. Remove the failed signup stack record and its verified-unused log group.
   These commands delete only the failed beta signup stack and that exact log
   group. The existing beta site, production site, images, and SSM secrets are
   outside this cleanup. The log-group deletion uses the administrator profile
   because the operator intentionally has no log-deletion permission.

   ```sh
   aws --profile flat-girl --region us-east-1 cloudformation delete-stack --stack-name FlatGirlBetaSignup
   aws --profile flat-girl --region us-east-1 cloudformation wait stack-delete-complete --stack-name FlatGirlBetaSignup
   aws --profile default --region us-east-1 logs delete-log-group --log-group-name /aws/lambda/flat-girl-beta-signup
   ```

3. Recreate the beta backend:

   ```sh
   make cloud-deploy PROFILE=flat-girl STACK=signup-beta
   ```

This cleanup is specific to the failed first deployment observed above. If beta
signup has since deployed successfully or started receiving requests, inspect its
current state instead of repeating this deletion procedure. These recovery writes
remain user-run; the agent only inspected state and changed local source.
