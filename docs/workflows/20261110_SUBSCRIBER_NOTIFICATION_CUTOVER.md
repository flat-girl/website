# Subscriber owner-notification cutover

Production cutover: November 10, 2026. Beta was subsequently enabled during the November 14 KMS rollout. Existing environments should reuse their configured threads.

Run commands from the repository root. This records a specific rollout or recovery;
check its applicability before reusing it.

1. Review/apply the access-stack update with the existing administrator profile,
   then review/deploy the production signup stack with the operator:

   ```sh
   make cloud-diff PROFILE=default STACK=access
   make cloud-deploy PROFILE=default STACK=access BOOTSTRAP=1
   make cloud-diff PROFILE=flat-girl STACK=signup-production
   make cloud-deploy PROFILE=flat-girl STACK=signup-production
   ```

   For a beta rollout, run the same signup commands with `STACK=signup-beta`.

2. Wait for SES in **us-east-1** to verify `flatgirl.net`. The access stack creates
   its SES identity and three dedicated DKIM CNAME records; existing Google and
   Brevo records are not changed. The setup command checks verification and
   account sending status before sending.
   The same verified sender/recipient works in the SES sandbox. Create the new
   production thread (sends one setup email, keeps delivery disabled):

   ```sh
   make signup-notifications PROFILE=flat-girl SITE_ENV=production ACTION=seed
   ```

   In the delivered setup email, use **Show original** to verify its Message-ID
   matches the saved ID. The tool uses SES's us-east-1 `email.amazonses.com`
   suffix. If different, pass the complete observed header when enabling:
   `uv run --locked --project tools python tools/notifications.py enable --profile flat-girl --env production --thread-message-id '<actual-id>'`.

3. Remove or deactivate only the Brevo **Notify by email** step addressed to
   `high@flatgirl.net`, after the welcome step. Keep the welcome email and list
   trigger. This repository cannot edit that Brevo workflow. In the new editor,
   the step's three-dot menu offers Delete or Deactivate; save the workflow.

4. Enable production SES notifications and queue one controlled worker test:

   ```sh
   make signup-notifications PROFILE=flat-girl SITE_ENV=production ACTION=enable
   make signup-notifications PROFILE=flat-girl SITE_ENV=production ACTION=test
   ```

   Allow up to 60 seconds for cached settings to refresh before the test if the
   worker has recently processed a signup. The test identifies the address as
   `threading-test@flatgirl.invalid`; it creates no Brevo contact or welcome email.
   Confirm the setup email and test appear in the same conversation and the test
   contains both reference headers. Repeat the setup separately for beta only if
   beta notifications are wanted; beta is disabled by default.
