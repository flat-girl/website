# Subscriber owner notifications

**Production live, November 10, 2026.** Access and production signup stacks
deployed successfully. SES reports the domain verified and DKIM successful;
all preexisting DNS records were preserved. The owner confirmed removal of
Brevo's notification step, verified the delivered seed's Message-ID and passing
DKIM/SPF/DMARC, and confirmed that the queued test containing
`threading-test@flatgirl.invalid` grouped into the same Gmail conversation.
Beta was subsequently deployed and enabled during the
[November 14 rollout](workflows/20261114_KMS_USAGE_REDUCTION.md). Both environments
now have their own notification threads.

The [initial SES/Brevo cutover workflow](workflows/20261110_SUBSCRIBER_NOTIFICATION_CUTOVER.md)
contains the deployment, thread-seeding, Message-ID verification, and enablement
steps. Reuse existing configured threads on ordinary deployments.

Brevo still sends the subscriber's welcome email. After a successful contact
creation or list addition, signup enqueues an owner notification; a separate
Lambda sends through SES. The HTTP request waits for queue acceptance only,
never SES delivery. Existing members, suppressed contacts and rejected requests
produce no notification. This reports a successful signup, not confirmation that
Brevo has delivered the welcome email.

Production messages use:

```text
From: high@flatgirl.net
To: high@flatgirl.net
Subject: New Flat Girl Subscriber!

Customer <subscriber email> subscribed to email updates off of the flatgirl.net site!
```

Every notification includes `In-Reply-To` and `References` pointing to the actual
Message-ID of a setup email already in the owner inbox. SES assigns unique
Message-IDs itself. Beta uses a separate anchor and `[Beta]` subject prefix.
Settings are stored at `/flat-girl/signup/{environment}/notification` as
`{"enabled":false,"threadMessageId":"<actual-message-id@email.amazonses.com>"}`.
A missing parameter disables delivery. Workers refresh cached settings within
60 seconds. No subscriber email or provider payload is logged.

## Failure handling and rollback

Queue acceptance has a 1.5-second budget, bounded by remaining Lambda time.
An enqueue failure logs `notification_enqueue_failed` and still accepts the
completed signup. That failed enqueue is not automatically recoverable; inspect
the provider-failure metric and Brevo when reconciling missing notifications.
Delivery failures retry independently of signup, up to five receives, then move
to `flat-girl-{environment}-notification-dlq` with a visible-message alarm.
The main queue retains messages four days; the DLQ retains them fourteen days.
Messages contain the subscriber email and use SQS-managed encryption.

SQS/SES delivery is at least once: a crash after SES accepts a message can result
in a repeated notification. No exactly-once guarantee is claimed. Disabled
notifications are acknowledged and discarded rather than saved for backfill.
Worker logs are `/aws/lambda/flat-girl-{environment}-notification`; outcomes are
`notification_sent`, `notification_disabled`, and `notification_failed`.

To stop SES delivery, run:

```sh
make signup-notifications PROFILE=flat-girl SITE_ENV=production ACTION=disable
```

Allow 60 seconds for settings-cache expiry, then restore Brevo's notification
step if desired. Disabling SES does not change Brevo welcomes or signup itself.

Email clients control conversation display. Gmail requires conversation view and
may start a new conversation after 100 messages; this does not retroactively
merge old Brevo alerts. See [Gmail conversation behavior](https://support.google.com/mail/answer/5900?hl=en)
and [SES header handling](https://docs.aws.amazon.com/ses/latest/dg/header-fields.html).
