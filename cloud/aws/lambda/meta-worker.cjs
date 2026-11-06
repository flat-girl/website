const metaApi = typeof __meta !== 'undefined' ? __meta : require('./meta.cjs')
function parse(body, env, now) {
  const item = JSON.parse(body), event = item?.event
  if (item?.schema !== 1 || item.environment !== env || !['ViewContent', 'Lead'].includes(event?.event_name) ||
      !Number.isInteger(event.event_time) || event.event_time < 0 || event.event_time > now / 1000 + 60 ||
      typeof event.event_id !== 'string' || event.event_id.length > 200 || !event.event_id.startsWith(event.event_name === 'Lead' ? 'lead:' : 'view:') ||
      event.action_source !== 'website' || event.event_source_url !== (env === 'beta' ? 'https://beta.flatgirl.net/' : 'https://flatgirl.net/') ||
      !event.user_data || Array.isArray(event.user_data) || typeof event.user_data !== 'object' ||
      Object.keys(event.user_data).some(key => !['fbc', 'client_ip_address', 'client_user_agent', 'em'].includes(key))) throw new Error('envelope')
  const user = event.user_data
  if (user.em !== undefined && (event.event_name !== 'Lead' || !Array.isArray(user.em) || user.em.length !== 1 || !/^[a-f0-9]{64}$/.test(user.em[0])))
    throw new Error('email')
  if (item.email !== undefined && (event.event_name !== 'Lead' || typeof item.email !== 'string' ||
      item.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email))) throw new Error('archive-email')
  return item
}
function createArchive(env, deps = {}) {
  if (!['beta', 'production'].includes(env)) throw new Error('environment')
  let client, sdk
  const request = deps.request || (async (operation, input, signal) => {
    if (!client) {
      sdk = require('@aws-sdk/client-dynamodb')
      client = new sdk.DynamoDBClient({ region: 'us-east-1', maxAttempts: 1 })
    }
    return client.send(new sdk[operation + 'Command'](input), { abortSignal: signal })
  })
  const table = () => {
    const name = deps.tableName || process.env.EVENTS_TABLE
    if (!name) throw new Error('table')
    return name
  }
  return {
    async ensure(event, signal, email) {
      const TableName = table(), Key = { event_id: { S: event.event_id } }
      const existing = await request('GetItem', { TableName, Key, ConsistentRead: true,
        ProjectionExpression: 'event_id, meta_success' }, signal)
      if (existing.Item) return existing.Item.meta_success?.BOOL === true
      // Explicit event/matching fields only; no request headers or provider credentials.
      const Item = {
        schema_version: { N: '1' }, event_id: { S: event.event_id },
        environment: { S: env }, event_name: { S: event.event_name },
        event_time: { N: String(event.event_time) }, action_source: { S: event.action_source },
        event_source_url: { S: event.event_source_url },
        dynamo_success: { BOOL: true }, meta_success: { BOOL: false },
      }
      const user = event.user_data
      for (const key of ['fbc', 'client_ip_address', 'client_user_agent']) {
        if (typeof user[key] === 'string') Item[key] = { S: user[key] }
      }
      if (user.em) Item.email_sha256 = { S: user.em[0] }
      if (email !== undefined) Item.email = { S: email }
      try {
        await request('PutItem', { TableName, Item, ConditionExpression: 'attribute_not_exists(event_id)',
          ReturnValuesOnConditionCheckFailure: 'ALL_OLD' }, signal)
        return false
      } catch (error) {
        // Another delivery may have created the row after our read. Never overwrite it.
        if (error?.name !== 'ConditionalCheckFailedException' || !error.Item) throw error
        return error.Item.meta_success?.BOOL === true
      }
    },
    async complete(eventId, signal, timestamp) {
      await request('UpdateItem', { TableName: table(), Key: { event_id: { S: eventId } },
        ConditionExpression: 'attribute_exists(event_id)',
        UpdateExpression: 'SET dynamo_success = :yes, meta_success = :yes, meta_delivered_at = if_not_exists(meta_delivered_at, :time)',
        ExpressionAttributeValues: { ':yes': { BOOL: true }, ':time': { N: String(Math.floor(timestamp / 1000)) } },
      }, signal)
    },
  }
}
function createHandler(env, runtime, now = Date.now, archive = createArchive(env)) {
  return async event => {
    const batchItemFailures = []
    for (const record of event.Records) {
      let stage = 'delivery_failed'
      try {
        const item = parse(record.body, env, now())
        const signal = AbortSignal.timeout(10000)
        stage = 'dynamo_failed'
        const completed = await archive.ensure(item.event, signal, item.email)
        runtime.progress?.('dynamo_succeeded')
        if (completed) {
          runtime.progress?.('already_completed')
          continue
        }
        stage = 'meta_failed'
        if (now() / 1000 - item.event.event_time > 6 * 86400) throw new Error('expired')
        const config = await runtime.config(signal)
        if (config.mode === 'off' ||
            !(item.event.event_name === 'Lead' ? config.leadEnabled : config.viewEnabled)) throw new Error('paused')
        await runtime.deliver(item.event, config, signal)
        stage = 'checkpoint_failed'
        await archive.complete(item.event.event_id, signal, now())
        runtime.progress?.('meta_checkpointed')
      } catch {
        runtime.failure(stage)
        batchItemFailures.push({ itemIdentifier: record.messageId })
      }
    }
    return { batchItemFailures }
  }
}

let handler
exports.handler = event => {
  if (!handler) handler = createHandler(__environment, metaApi.createRuntime(__environment))
  return handler(event)
}
exports.createHandler = createHandler
exports.createArchive = createArchive
