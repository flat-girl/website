const { createHash, randomUUID } = require('node:crypto')
const { isIP } = require('node:net')
const cookieName = env => env === 'beta' ? '_fbc_beta' : '_fbc'
const parameterNames = env => {
  if (!['beta', 'production'].includes(env)) throw new Error('environment')
  return { settings: `/flat-girl/meta/${env}/settings`, credentials: `/flat-girl/meta/${env}/credentials` }
}
function settings(value, env) {
  if (!value || !['off', 'live'].includes(value.mode) ||
      !/^v\d{1,3}\.0$/.test(value.version) ||
      ['viewEnabled', 'leadEnabled'].some(k => typeof value[k] !== 'boolean'))
    throw new Error('configuration')
  return value
}
function validFbc(value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 1100) return undefined
  const match = /^fb\.1\.(\d{13})\.([A-Za-z0-9_-]{1,1024})$/.exec(value)
  if (!match || +match[1] > now + 60000 || now - +match[1] > 7776000000) return undefined
  return value
}
function readCookie(lines, name) {
  if (!Array.isArray(lines)) return undefined
  const values = lines.flatMap(line => typeof line === 'string' ? line.split(';') : [])
    .map(v => v.trim()).filter(v => v.startsWith(name + '='))
  return values.length === 1 ? values[0].slice(name.length + 1) : undefined
}
function userData({ fbc, ip, agent, email }, now = Date.now()) {
  const data = {}
  if (validFbc(fbc, now)) data.fbc = fbc
  if (typeof ip === 'string' && isIP(ip)) data.client_ip_address = ip
  if (typeof agent === 'string' && agent.length > 0 && agent.length <= 2048 && !/[\x00-\x1f\x7f]/.test(agent)) data.client_user_agent = agent
  if (typeof email === 'string' && email.trim()) data.em = [createHash('sha256').update(email.trim().toLowerCase()).digest('hex')]
  return data
}
function buildEvent(name, env, input, now = Date.now()) {
  if (!['ViewContent', 'Lead'].includes(name) || !['beta', 'production'].includes(env)) throw new Error('event')
  const user = userData({ ...input, email: name === 'Lead' ? input.email : undefined }, now)
  if (!user.client_user_agent) throw new Error('user-agent')
  return { event_name: name, event_time: Math.floor(now / 1000),
    event_id: input.id || `${name === 'Lead' ? 'lead' : 'view'}:${randomUUID()}`,
    action_source: 'website', event_source_url: env === 'beta' ? 'https://beta.flatgirl.net/' : 'https://flatgirl.net/',
    user_data: user }
}
async function deliver(event, config, credentials, signal, fetcher = fetch) {
  if (!userData({ agent: event?.user_data?.client_user_agent }).client_user_agent) throw new Error('user-agent')
  if (!/^\d{1,30}$/.test(credentials?.datasetId) || typeof credentials.accessToken !== 'string' ||
      !credentials.accessToken || /\s/.test(credentials.accessToken)) throw new Error('credentials')
  const body = JSON.stringify({ data: [event] })
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted()
    let result
    try {
      result = await fetcher(`https://graph.facebook.com/${config.version}/${credentials.datasetId}/events`, {
        method: 'POST', redirect: 'error', signal,
        headers: { authorization: `Bearer ${credentials.accessToken}`, 'content-type': 'application/json' }, body,
      })
    } catch {
      if (attempt || signal.aborted) throw new Error('transport')
      continue
    }
    if (result.ok) {
      if ((await result.json())?.events_received !== 1) throw new Error('response')
      return
    }
    // No long waits or detached work: respect Retry-After by declining an immediate retry.
    const retryAfter = result.headers?.get('retry-after')
    if (attempt || (result.status !== 429 && result.status < 500) || (retryAfter && retryAfter !== '0'))
      throw new Error('upstream')
    await result.body?.cancel()
  }
  throw new Error('upstream')
}
function createRuntime(env, deps = {}) {
  const names = parameterNames(env), now = deps.now || Date.now
  let cached, expires = 0, client, Command, sqs, SendMessage
  const read = deps.read || (async (Name, signal) => {
    if (!client) {
      const sdk = require('@aws-sdk/client-ssm')
      client = new sdk.SSMClient({ region: 'us-east-1', maxAttempts: 1 })
      Command = sdk.GetParameterCommand
    }
    const result = await client.send(new Command({ Name, WithDecryption: true }), { abortSignal: signal })
    return JSON.parse(result.Parameter.Value)
  })
  const initializeQueue = () => {
    if (!sqs) {
      const sdk = require('@aws-sdk/client-sqs')
      sqs = new sdk.SQSClient({ region: 'us-east-1', maxAttempts: 1 }); SendMessage = sdk.SendMessageCommand
    }
  }
  if (deps.initializeQueue && !deps.enqueue) initializeQueue()
  const log = outcome => (deps.log || (value => console.info(JSON.stringify(value))))({ component: 'meta', environment: env, outcome })
  return {
    async config(signal) {
      if (cached && now() < expires) return cached
      // Never keep using an expired enabled setting when a refresh fails.
      cached = undefined
      const value = settings(await read(names.settings, signal), env)
      cached = value; expires = now() + 60000
      return value
    },
    async deliver(event, config, signal) {
      if (config.mode === 'off' || !(event.event_name === 'Lead' ? config.leadEnabled : config.viewEnabled)) return
      // Credentials are independent of signup secrets and are not needed for skipped views.
      const credentials = await read(names.credentials, signal)
      await deliver(event, config, credentials, signal, deps.fetch || fetch)
      log(event.event_name === 'Lead' ? 'lead_delivered' : 'view_delivered')
    },
    async send(event, signal, email) {
      const envelope = { schema: 1, environment: env, event }
      // First-party archive only. The Meta request contains event, never this envelope.
      if (event.event_name === 'Lead' && typeof email === 'string') envelope.email = email
      if (deps.enqueue) await deps.enqueue(envelope, signal)
      else {
        if (!deps.queueUrl) throw new Error('queue')
        initializeQueue()
        const result = await sqs.send(new SendMessage({ QueueUrl: deps.queueUrl, MessageBody: JSON.stringify(envelope) }), { abortSignal: signal })
        if (!result.MessageId) throw new Error('queue')
      }
      log(event.event_name === 'Lead' ? 'lead_queued' : 'view_queued')
    },
    progress(outcome) {
      if (['dynamo_succeeded', 'already_completed', 'meta_checkpointed', 'view_gpc_skipped'].includes(outcome)) log(outcome)
    },
    failure(outcome) {
      log(['dynamo_failed', 'meta_failed', 'checkpoint_failed', 'edge_enqueue_failed', 'edge_payload_failed', 'edge_budget_exhausted'].includes(outcome) ? outcome : 'delivery_failed')
    },
  }
}
exports.cookieName = cookieName
exports.parameterNames = parameterNames
exports.settings = settings
exports.validFbc = validFbc
exports.readCookie = readCookie
exports.buildEvent = buildEvent
exports.deliver = deliver
exports.createRuntime = createRuntime
