function notificationMessage(email, threadMessageId, environment) {
  // Only a real, previously delivered Message-ID is usable as the thread anchor.
  if (!/^<[^<>\s@]+@[^<>\s@]+>$/.test(threadMessageId) || threadMessageId.length > 254)
    throw new Error('invalid_notification_thread')
  const beta = environment === 'beta'
  const body = `Customer ${email} subscribed to email updates off of the ${beta ? 'beta.' : ''}flatgirl.net site!`
  return Buffer.from([
    'From: high@flatgirl.net', 'To: high@flatgirl.net',
    `Subject: ${beta ? '[Beta] ' : ''}New Flat Girl Subscriber!`,
    `In-Reply-To: ${threadMessageId}`, `References: ${threadMessageId}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '',
    Buffer.from(body).toString('base64').match(/.{1,76}/g).join('\r\n'), '',
  ].join('\r\n'))
}

function createNotifier(ssm, GetParameter, ses, SendRawEmail, parameter, environment) {
  let cached, expires = 0
  return async (email, signal) => {
    if (!cached || Date.now() >= expires) {
      try {
        const result = await ssm.send(new GetParameter({ Name: parameter }), { abortSignal: signal })
        const value = JSON.parse(result.Parameter.Value)
        if (typeof value.enabled !== 'boolean') throw new Error('invalid_notification_settings')
        if (value.enabled) notificationMessage('', value.threadMessageId, environment)
        cached = value
      } catch (error) {
        // Safe staged rollout: absence means notifications have not been enabled yet.
        if (error.name !== 'ParameterNotFound') throw error
        cached = { enabled: false }
      }
      expires = Date.now() + 60000
    }
    if (!cached.enabled) return false
    const result = await ses.send(new SendRawEmail({
      Source: 'high@flatgirl.net', Destinations: ['high@flatgirl.net'],
      RawMessage: { Data: notificationMessage(email, cached.threadMessageId, environment) },
    }), { abortSignal: signal })
    if (!result.MessageId) throw new Error('notification_send')
    return true
  }
}

function createHandler(environment, notify, log) {
  return async event => {
    const batchItemFailures = []
    for (const record of event.Records) {
      try {
        const item = JSON.parse(record.body)
        if (item.schema !== 1 || item.environment !== environment || typeof item.email !== 'string' ||
            item.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)) throw new Error('envelope')
        const sent = await notify(item.email, AbortSignal.timeout(10000))
        log({ outcome: sent ? 'notification_sent' : 'notification_disabled' })
      } catch {
        log({ outcome: 'notification_failed' })
        batchItemFailures.push({ itemIdentifier: record.messageId })
      }
    }
    return { batchItemFailures }
  }
}
let handler
exports.handler = event => {
  if (!handler) {
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm')
    const { SESClient, SendRawEmailCommand } = require('@aws-sdk/client-ses')
    handler = createHandler(process.env.ENVIRONMENT,
      createNotifier(new SSMClient({ maxAttempts: 1 }), GetParameterCommand,
        new SESClient({ maxAttempts: 1 }), SendRawEmailCommand,
        process.env.NOTIFICATION_PARAMETER, process.env.ENVIRONMENT),
      value => console.info(JSON.stringify(value)))
  }
  return handler(event)
}
exports.createHandler = createHandler
exports.createNotifier = createNotifier
exports.notificationMessage = notificationMessage
