import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { lambdaCode, edgeRouteCode, codeHash } from '../lib/meta.js'
import { config } from '../lib/config.js'
import { Certificates, Site } from '../lib/stacks.js'
import { Access } from '../lib/access.js'
const require = createRequire(import.meta.url)
const meta = require('../lambda/meta.cjs')
const edge = require('../lambda/edge.cjs')
const worker = require('../lambda/meta-worker.cjs')
const signup = require('../lambda/signup.cjs')
const now = 1793923200000
const fbc = `fb.1.${now - 1000}.real_click`
const cfg = (_env = 'production', extra = {}) => ({ mode: 'live', version: 'v26.0', viewEnabled: true, leadEnabled: true, ...extra })
const signal = () => AbortSignal.timeout(10000)
function edgeEvent(extra: any = {}) {
  return { Records: [{ cf: { config: { requestId: 'request123', eventType: 'viewer-response' }, request: {
    method: 'GET', uri: '/', querystring: 'fbclid=real_click', clientIp: '203.0.113.1',
    headers: { host: [{ value: 'flatgirl.net' }], 'user-agent': [{ value: 'Browser' }] }, ...extra,
  }, response: { status: '200', headers: { 'content-type': [{ value: 'text/html; charset=utf-8' }] } } } }] }
}
function edgeFixture(config = cfg()) {
  const sent: any[] = []; let failures = 0, reads = 0
  const runtime = { config: async () => { reads++; return config }, send: async (event: any, _signal?: AbortSignal) => { sent.push(event) }, failure: () => { failures++ } }
  return { runtime, sent, failures: () => failures, reads: () => reads,
    handler: edge.createHandler('production', { runtime, now: () => now }) }
}
test('hashing, optional fields and source URL are derived without fabricated attribution', () => {
  const event = meta.buildEvent('Lead', 'beta', { email: ' Reader+tag@Example.COM ', ip: '2001:db8::1', agent: 'Browser', fbc }, now)
  assert.equal(event.user_data.em[0], createHash('sha256').update('reader+tag@example.com').digest('hex'))
  assert.equal(event.user_data.fbc, fbc)
  assert.equal(event.event_time, now / 1000)
  assert.equal(event.event_source_url, 'https://beta.flatgirl.net/')
  assert.deepEqual(meta.buildEvent('ViewContent', 'production', { email: 'secret@example.com', ip: 'spoof', agent: 'Browser', fbc: 'junk' }, now).user_data, { client_user_agent: 'Browser' })
  assert.equal(meta.readCookie(['_fbc=a; other=b', '_fbc=c'], '_fbc'), undefined)
  assert.equal(meta.validFbc(`fb.1.${now - 91 * 86400000}.old`, now), undefined)
})
test('website events require a real user agent; missing headers do not break page delivery', async () => {
  for (const agent of [undefined, '', 'bad\nagent', 'x'.repeat(2049)]) {
    assert.throws(() => meta.buildEvent('Lead', 'production', { email: 'reader@example.com', agent }, now), /user-agent/)
  }
  const f = edgeFixture(), event = edgeEvent()
  delete event.Records[0].cf.request.headers['user-agent']
  const response = await f.handler(event)
  assert.ok(response.headers['set-cookie'])
  assert.equal(response, event.Records[0].cf.response)
  assert.equal(f.sent.length, 0)
  let called = false
  await assert.rejects(meta.deliver({ user_data: {} }, cfg(), { datasetId: '123', accessToken: 'secret' }, signal(), async () => { called = true }), /user-agent/)
  assert.equal(called, false)
})
test('first response sets the exact attribution queued in its view; another visitor cannot inherit it', async () => {
  const f = edgeFixture(), request = edgeEvent()
  const response = await f.handler(request)
  const cookie = response.headers['set-cookie'][0].value
  assert.ok(cookie.startsWith(`_fbc=fb.1.${now}.real_click;`))
  for (const attr of ['Domain=flatgirl.net', 'Path=/', 'Max-Age=7776000', 'Secure', 'HttpOnly', 'SameSite=Lax']) assert.ok(cookie.includes(attr))
  assert.equal(f.sent[0].user_data.fbc, `fb.1.${now}.real_click`)
  assert.equal(f.sent[0].event_id, 'view:production:request123')
  const second = await f.handler(edgeEvent({ querystring: '' }))
  assert.equal(second.headers['set-cookie'], undefined)
  assert.equal(f.sent[1].user_data.fbc, undefined)
})
test('same/no click preserves cookie; new click replaces it; unsafe or duplicate clicks do not mint cookies', async () => {
  for (const query of ['', 'fbclid=real_click', 'fbclid=x%3Bbad', 'fbclid=x&fbclid=y', 'fbclid=%zz', 'fbclid=' + 'a'.repeat(1025)]) {
    const event = edgeEvent({ querystring: query }); event.Records[0].cf.request.headers.cookie = [{ value: `_fbc=${fbc}` }]
    const f = edgeFixture(), response = await f.handler(event)
    assert.equal(response.headers['set-cookie'], undefined)
    assert.equal(f.sent[0].user_data.fbc, fbc)
  }
  const event = edgeEvent({ querystring: 'fbclid=new' }); event.Records[0].cf.request.headers.cookie = [{ value: `_fbc=${fbc}` }]
  assert.match((await edgeFixture().handler(event)).headers['set-cookie'][0].value, /\.new;/)
})
test('GPC suppresses the view but preserves immediate capture without reading settings', async () => {
  const f = edgeFixture(), event = edgeEvent(); event.Records[0].cf.request.headers['sec-gpc'] = [{ value: '1' }]
  assert.ok((await f.handler(event)).headers['set-cookie'])
  assert.equal(f.sent.length, 0)
  assert.equal(f.reads(), 0)
})
test('edge skips assets, HEAD, errors and prefetch; enqueue failure returns the page', async () => {
  for (const extra of [{ uri: '/_nuxt/app.js' }, { method: 'HEAD' }, { headers: { purpose: [{ value: 'prefetch' }] } }]) {
    const f = edgeFixture(); await f.handler(edgeEvent(extra)); assert.equal(f.reads(), 0)
  }
  const f = edgeFixture(); const error = edgeEvent(); error.Records[0].cf.response.status = '404'
  await f.handler(error); assert.equal(f.reads(), 0)
  f.runtime.send = async () => { throw new Error('private-payload') }
  const event = edgeEvent(); assert.equal(await f.handler(event), event.Records[0].cf.response); assert.equal(f.failures(), 1)
})
test('beta viewer response uses only beta attribution and its canonical viewer host', async () => {
  const f = edgeFixture(cfg('beta')), event = edgeEvent({ headers: { host: [{ value: 'beta.flatgirl.net' }], 'user-agent': [{ value: 'Browser' }], cookie: [{ value: `_fbc=${fbc}` }] } })
  event.Records[0].cf.config.eventType = 'viewer-response'
  const handler = edge.createHandler('beta', { runtime: f.runtime, now: () => now })
  assert.match((await handler(event)).headers['set-cookie'][0].value, /^_fbc_beta=/)
  assert.equal(f.sent[0].event_source_url, 'https://beta.flatgirl.net/')
})
test('edge only enqueues, allows work beyond 500 ms and counts separate visits and 304 responses', async () => {
  const f = edgeFixture(), originalSend = f.runtime.send
  f.runtime.config = async () => { throw Error('Edge must not read SSM') }
  f.runtime.send = async (event: any, signal?: AbortSignal) => {
    await new Promise(resolve => setTimeout(resolve, 600))
    signal!.throwIfAborted()
    await originalSend(event)
  }
  const first = edgeEvent()
  await f.handler(first)
  const second = edgeEvent()
  second.Records[0].cf.config.requestId = 'another-request'
  second.Records[0].cf.response.status = '304'
  delete (second.Records[0].cf.response.headers as any)['content-type']
  await f.handler(second)
  assert.equal(f.sent.length, 2)
  assert.notEqual(f.sent[0].event_id, f.sent[1].event_id)
  assert.equal(f.failures(), 0)
})
test('edge preserves response headroom when the remaining Lambda budget is short', async () => {
  const f = edgeFixture()
  f.runtime.send = async (_event: any, signal?: AbortSignal) => {
    await new Promise(resolve => setTimeout(resolve, 75))
    signal!.throwIfAborted()
  }
  const event = edgeEvent()
  assert.equal(await f.handler(event, { getRemainingTimeInMillis: () => 1050 }), event.Records[0].cf.response)
  assert.equal(f.failures(), 1)
  assert.equal(f.sent.length, 0)
})
test('producer reads no Meta credentials; queue keeps archive email separate from hashed Meta payload and safe logs', async () => {
  const reads: string[] = [], messages: any[] = [], logs: any[] = []
  const runtime = meta.createRuntime('beta', { now: () => now,
    read: async (name: string) => { reads.push(name); return cfg('beta') },
    enqueue: async (item: any) => messages.push(item), log: (v: any) => logs.push(v) })
  const event = meta.buildEvent('Lead', 'beta', { email: 'private@example.com', agent: 'Browser', fbc }, now)
  await runtime.config(signal())
  await runtime.send(event, signal(), 'private@example.com')
  assert.deepEqual(reads, ['/flat-girl/meta/beta/settings'])
  assert.deepEqual(Object.keys(messages[0]).sort(), ['email', 'environment', 'event', 'schema']); assert.equal(messages[0].event, event)
  assert.equal(messages[0].email, 'private@example.com')
  assert.ok(!JSON.stringify(messages[0].event).includes('private@example.com'))
  assert.ok(!JSON.stringify(logs).includes('private@example.com'))
  assert.ok(!JSON.stringify(logs).includes(fbc))
  assert.equal(meta.settings(cfg('beta'), 'beta').mode, 'live')
  assert.throws(() => meta.settings(cfg('beta', { mode: 'test' }), 'beta'))
})
test('expired enabled configuration fails closed instead of using stale settings', async () => {
  let clock = now, reads = 0
  const runtime = meta.createRuntime('beta', { now: () => clock, read: async () => { if (++reads > 1) throw Error('unavailable'); return cfg('beta') } })
  await runtime.config(signal()); await runtime.config(signal()); assert.equal(reads, 1)
  clock += 61000; await assert.rejects(runtime.config(signal())); assert.equal(reads, 2)
})
test('Graph retries preserve payload and token stays out of URL; deployed delivery never adds a test code', async () => {
  const calls: any[] = [], event = meta.buildEvent('Lead', 'production', { email: 'reader@example.com', agent: 'Browser' }, now)
  await meta.deliver(event, cfg(), { datasetId: '123', accessToken: 'secret' }, signal(), async (url: string, options: any) => {
    calls.push({ url, ...options }); return { ok: calls.length > 1, status: calls.length > 1 ? 200 : 503, json: async () => ({ events_received: 1 }) }
  })
  assert.equal(calls[0].body, calls[1].body); assert.ok(!calls[0].url.includes('secret'))
  assert.equal(JSON.parse(calls[0].body).test_event_code, undefined)
  await meta.deliver(event, cfg('production', { testEventCode: 'TEST72924' }), { datasetId: '123', accessToken: 'secret' }, signal(), async (_url: string, options: any) => {
    assert.equal(JSON.parse(options.body).test_event_code, undefined); return { ok: true, json: async () => ({ events_received: 1 }) }
  })
  await assert.rejects(meta.deliver(event, cfg(), { datasetId: '123', accessToken: 'secret' }, signal(), async () => ({ ok: true, json: async () => ({ events_received: 0 }) })))
})
test('manual regression wrapper adds a test code outside the Lambda transport and preserves retries', async () => {
  const { regressionFetch } = require('../../../tools/meta_test.cjs')
  const event = meta.buildEvent('ViewContent', 'beta', { agent: 'Browser', ip: '203.0.113.1' }, now)
  const config = cfg('beta'), calls: any[] = []
  const fetcher = regressionFetch('TEST83329', async (_url: string, options: any) => {
    calls.push(JSON.parse(options.body))
    return { ok: calls.length > 1, status: calls.length > 1 ? 200 : 503, json: async () => ({ events_received: 1 }) }
  })
  await meta.deliver(event, config, { datasetId: '123', accessToken: 'secret' }, signal(), fetcher)
  assert.deepEqual(calls, [{ data: [event], test_event_code: 'TEST83329' }, { data: [event], test_event_code: 'TEST83329' }])
  assert.equal('testEventCode' in config, false)
  assert.equal('test_event_code' in event, false)
  assert.throws(() => regressionFetch(undefined), /Test code required/)
})
test('worker retries original events, refuses wrong environment and old events', async () => {
  const delivered: any[] = []
  const runtime = { config: async () => cfg('beta'), deliver: async (event: any) => delivered.push(event), failure() {} }
  const handler = worker.createHandler('beta', runtime, () => now, { ensure: async () => false, complete: async () => {} })
  const envelope = { schema: 1, environment: 'beta', event: meta.buildEvent('Lead', 'beta', { email: 'reader@example.com', agent: 'Browser' }, now) }
  const record = (item: any, id = 'one') => ({ messageId: id, body: JSON.stringify(item) })
  for (let i = 0; i < 2; i++) assert.deepEqual(await handler({ Records: [record(envelope)] }), { batchItemFailures: [] })
  assert.equal(delivered[0].event_id, delivered[1].event_id); assert.equal(delivered[0].event_time, delivered[1].event_time)
  for (const item of [{ ...envelope, environment: 'production' },
    { ...envelope, event: { ...envelope.event, event_time: now / 1000 - 7 * 86400 } }]) {
    assert.deepEqual(await handler({ Records: [record(item)] }), { batchItemFailures: [{ itemIdentifier: 'one' }] })
  }
  runtime.deliver = async () => { throw Error('network') }
  assert.deepEqual(await handler({ Records: [record(envelope)] }), { batchItemFailures: [{ itemIdentifier: 'one' }] })
})
function archiveFixture() {
  const records = new Map<string, any>(), operations: string[] = [], fail = new Set<string>()
  const archive = worker.createArchive('beta', { tableName: 'flat-girl-beta-events', request: async (operation: string, input: any) => {
    operations.push(operation)
    assert.equal(input.TableName, 'flat-girl-beta-events')
    if (fail.has(operation)) throw Error('database unavailable')
    const id = input.Key?.event_id.S || input.Item.event_id.S
    if (operation === 'GetItem') {
      assert.equal(input.ConsistentRead, true)
      return records.has(id) ? { Item: structuredClone(records.get(id)) } : {}
    }
    if (operation === 'PutItem') {
      assert.equal(input.ConditionExpression, 'attribute_not_exists(event_id)')
      if (records.has(id)) throw Object.assign(Error('exists'), { name: 'ConditionalCheckFailedException', Item: records.get(id) })
      records.set(id, structuredClone(input.Item))
    } else if (operation === 'UpdateItem') {
      assert.equal(input.ConditionExpression, 'attribute_exists(event_id)')
      if (!records.has(id)) throw Error('missing row')
      Object.assign(records.get(id), { dynamo_success: { BOOL: true }, meta_success: { BOOL: true },
        meta_delivered_at: input.ExpressionAttributeValues[':time'] })
    } else throw Error('unexpected operation')
    return {}
  } })
  return { archive, records, operations, fail }
}
test('archive retains requested fields once, tracks independent success and never rewrites an existing event', async () => {
  const f = archiveFixture()
  const event = meta.buildEvent('Lead', 'beta', { email: 'Reader@example.com', agent: 'Browser', ip: '2001:db8::1', fbc }, now)
  assert.equal(await f.archive.ensure(event, signal(), 'Reader@example.com'), false)
  assert.equal(await f.archive.ensure(event, signal(), 'Reader@example.com'), false)
  assert.equal(f.records.size, 1)
  assert.deepEqual(f.records.get(event.event_id), {
    schema_version: { N: '1' }, event_id: { S: event.event_id }, environment: { S: 'beta' },
    event_name: { S: 'Lead' }, event_time: { N: String(now / 1000) },
    action_source: { S: 'website' }, event_source_url: { S: 'https://beta.flatgirl.net/' },
    email: { S: 'Reader@example.com' }, email_sha256: { S: event.user_data.em[0] },
    client_ip_address: { S: '2001:db8::1' }, client_user_agent: { S: 'Browser' }, fbc: { S: fbc },
    dynamo_success: { BOOL: true }, meta_success: { BOOL: false },
  })
  await f.archive.complete(event.event_id, signal(), now)
  assert.equal(await f.archive.ensure(event, signal()), true)
  assert.equal(f.operations.filter(x => x === 'PutItem').length, 1)
  const view = meta.buildEvent('ViewContent', 'beta', { agent: 'Browser' }, now)
  await f.archive.ensure(view, signal())
  for (const key of ['email', 'email_sha256', 'fbc', 'client_ip_address']) assert.equal(f.records.get(view.event_id)[key], undefined)
})
test('worker retries only incomplete work; a completed event skips Meta even after its age limit', async () => {
  const f = archiveFixture(), sent: any[] = [], failures: string[] = []
  let failMeta = true, clock = now
  const runtime = { config: async () => cfg('beta'),
    deliver: async (event: any) => { sent.push(event); if (failMeta) throw Error('meta') }, failure: (stage: string) => failures.push(stage) }
  const handler = worker.createHandler('beta', runtime, () => clock, f.archive)
  const envelope = { schema: 1, environment: 'beta', email: 'reader@example.com',
    event: meta.buildEvent('Lead', 'beta', { email: 'reader@example.com', agent: 'Browser' }, now) }
  const input = { Records: [{ messageId: 'one', body: JSON.stringify(envelope) }] }
  const failed = { batchItemFailures: [{ itemIdentifier: 'one' }] }
  f.fail.add('PutItem')
  assert.deepEqual(await handler(input), failed)
  assert.equal(sent.length, 0)
  assert.equal(failures.at(-1), 'dynamo_failed')
  f.fail.clear()
  assert.deepEqual(await handler(input), failed)
  assert.equal(failures.at(-1), 'meta_failed')
  assert.equal(f.records.get(envelope.event.event_id).meta_success.BOOL, false)
  failMeta = false
  assert.deepEqual(await handler(input), { batchItemFailures: [] })
  assert.equal(f.records.get(envelope.event.event_id).meta_success.BOOL, true)
  assert.deepEqual(sent[0], sent[1])
  assert.ok(!JSON.stringify(sent).includes('reader@example.com'))
  const writes = f.operations.filter(x => x !== 'GetItem').length
  clock += 8 * 86400000
  assert.deepEqual(await handler(input), { batchItemFailures: [] })
  assert.equal(sent.length, 2)
  assert.equal(f.operations.filter(x => x !== 'GetItem').length, writes)
})
test('failed completion checkpoint retries the same Meta ID; existing legacy rows are not assumed delivered', async () => {
  const f = archiveFixture(), sent: any[] = [], failures: string[] = []
  const runtime = { config: async () => cfg('beta'), deliver: async (event: any) => sent.push(event), failure: (stage: string) => failures.push(stage) }
  const handler = worker.createHandler('beta', runtime, () => now, f.archive)
  const event = meta.buildEvent('ViewContent', 'beta', { agent: 'Browser' }, now)
  f.records.set(event.event_id, { event_id: { S: event.event_id } })
  const input = { Records: [{ messageId: 'one', body: JSON.stringify({ schema: 1, environment: 'beta', event }) }] }
  f.fail.add('UpdateItem')
  assert.deepEqual(await handler(input), { batchItemFailures: [{ itemIdentifier: 'one' }] })
  assert.equal(failures.at(-1), 'checkpoint_failed')
  f.fail.clear()
  assert.deepEqual(await handler(input), { batchItemFailures: [] })
  assert.deepEqual(sent[0], sent[1])
  assert.equal(f.records.get(event.event_id).meta_success.BOOL, true)
  assert.equal(f.operations.includes('PutItem'), false)
})
test('signup queues Lead after successful Brevo operation, including GPC, without extra provider calls', async () => {
  const run = async (responses: any[], failQueue = false) => {
    const calls: any[] = [], events: any[] = []
    const runtime = { config: async () => cfg(), send: async (event: any, _signal: any, email: string) => { assert.equal(email, 'reader@example.com'); events.push(event); if (failQueue) throw Error('queue') }, failure() {} }
    const handler = signup.createHandler({ enabled: true, origin: 'https://flatgirl.net', listId: 4, environment: 'production' }, {
      fetch: async (url: string) => { calls.push(url); const [status, data] = responses.shift(); return { status, ok: status < 300, json: async () => data } },
      secrets: async () => ({ turnstile: 'private', brevo: 'private' }), meta: runtime, log() {},
    })
    const result = await handler({ requestContext: { http: { method: 'POST', sourceIp: '203.0.113.1' } },
      headers: { origin: 'https://flatgirl.net', 'content-type': 'application/json', 'sec-gpc': '1', 'user-agent': 'Browser' },
      cookies: [`_fbc=fb.1.${Date.now()}.real_click`], body: JSON.stringify({ email: 'reader@example.com', website: '', turnstileToken: 'token' }) })
    return { result, calls, events }
  }
  const verify = [200, { success: true, hostname: 'flatgirl.net', action: 'subscribe' }]
  for (const failed of [false, true]) {
    const f = await run([verify, [404], [201]], failed)
    assert.equal(f.result.statusCode, 200); assert.equal(f.calls.length, 3); assert.equal(f.events.length, 1)
    assert.equal(f.events[0].user_data.client_user_agent, 'Browser'); assert.ok(f.events[0].user_data.fbc)
  }
  const put = await run([verify, [200, { emailBlacklisted: false, listIds: [] }], [204]])
  assert.equal(put.events.length, 1); assert.equal(put.calls.length, 3)
  for (const data of [{ emailBlacklisted: false, listIds: [4] }, { emailBlacklisted: true, listIds: [] }]) {
    const f = await run([verify, [200, data]]); assert.equal(f.events.length, 0); assert.equal(f.calls.length, 2)
  }
  const failed = await run([verify, [404], [500]])
  assert.equal(failed.result.statusCode, 503); assert.equal(failed.events.length, 0)
})
test('assembled Lambda entry files load without requiring local helper files; route adapter preserves campaigns', async () => {
  for (const file of ['edge', 'signup', 'worker'] as const) {
    const context = vm.createContext({ exports: {}, require: (name: string) => { assert.ok(!name.startsWith('.')); if (name === '@aws-sdk/client-sqs') return { SQSClient: class {}, SendMessageCommand: class {} }; return require(name) } })
    vm.runInContext(lambdaCode(file, 'beta'), context)
    assert.equal(typeof context.exports.handler, 'function'); assert.equal(typeof context.exports.createHandler, 'function')
  }
  const context = vm.createContext({ exports: {}, require, Buffer, AbortSignal }); vm.runInContext(edgeRouteCode(), context)
  const request = { uri: '/offer', querystring: 'fbclid=x%2By&x=1&x=2&__proto__=safe', headers: { host: [{ value: 'www.flatgirl.net' }] } }
  const result = await context.exports.handler({ Records: [{ cf: { request } }] })
  assert.equal(result.headers.location[0].value, 'https://flatgirl.net/?' + request.querystring)
})
test('edge associations preserve production caching and beta auth; producer IAM cannot read tokens', () => {
  const p = config({ account: '111111111111', region: 'us-east-1', hostedZoneId: 'ZEXAMPLE', domain: 'flatgirl.net', operatorPrincipalArn: null, betaEnabled: true, productionNoindex: true })
  const app = new App(), access = new Access(app, p), cert = new Certificates(app, p)
  const sites = {beta:new Site(app,p,'beta',cert.certificate), production:new Site(app,p,'production',cert.certificate)}
  for (const env of ['beta', 'production'] as const) {
    const template = Template.fromStack(sites[env]).toJSON()
    const distribution: any = Object.values(template.Resources).find((r: any) => r.Type === 'AWS::CloudFront::Distribution')
    const behavior = distribution.Properties.DistributionConfig.DefaultCacheBehavior
    const events = behavior.LambdaFunctionAssociations.map((a: any) => a.EventType)
    assert.deepEqual(events, ['viewer-response', 'viewer-request'])
    assert.equal(behavior.FunctionAssociations?.length ?? 0, 0)
    const versions = Object.keys(template.Resources).filter(id => template.Resources[id].Type === 'AWS::Lambda::Version')
    const trackingCode = lambdaCode('edge', env, `https://sqs.us-east-1.amazonaws.com/${p.account}/flat-girl-${env}-meta`)
    assert.ok(versions.includes(`MetaEdgeVersion${codeHash(trackingCode + 512)}`))
    const routingId = `EdgeRoutesVersion${codeHash(edgeRouteCode(env) + 512)}`
    assert.deepEqual(versions.filter(id => id.startsWith('EdgeRoutesVersion')), [routingId])
    assert.ok(JSON.stringify(behavior.LambdaFunctionAssociations[1]).includes(routingId))
    assert.equal(behavior.OriginRequestPolicyId, undefined)
    const functions: any[] = Object.values(template.Resources).filter((r: any) => r.Type === 'AWS::Lambda::Function')
    for (const fn of functions) {
      assert.deepEqual(fn.Properties.Architectures, ['x86_64']); assert.equal(fn.Properties.Environment, undefined)
      assert.equal(fn.Properties.MemorySize, 512)
    }
  }
  const betaCache = Object.values(Template.fromStack(sites.beta).findResources('AWS::CloudFront::CachePolicy'))[0] as any
  const productionCache = Object.values(Template.fromStack(sites.production).findResources('AWS::CloudFront::CachePolicy'))[0] as any
  const comparable = (value: any) => { const result = structuredClone(value.Properties.CachePolicyConfig); delete result.Name; return result }
  assert.deepEqual(comparable(betaCache), comparable(productionCache))
  assert.equal(edgeRouteCode('beta').split('\n').slice(1).join('\n'), edgeRouteCode('production').split('\n').slice(1).join('\n'))
  assert.equal(lambdaCode('edge', 'beta', 'beta-queue').split('\n').slice(1).join('\n'),
    lambdaCode('edge', 'production', 'production-queue').split('\n').slice(1).join('\n'))
  const policies: any[] = Object.entries(Template.fromStack(access).toJSON().Resources).filter(([id, r]: any) =>
    r.Type === 'AWS::IAM::Policy' && /SignupRuntime|MetaEdgeRuntime/.test(id)).map(([, r]) => r)
  assert.equal(policies.length, 4)
  for (const policy of policies) {
    const text = JSON.stringify(policy)
    assert.ok(!text.includes('/credentials')); assert.ok(text.includes('sqs:SendMessage'))
  }
  const resources = Template.fromStack(access).toJSON().Resources
  for (const [id, resource] of Object.entries(resources) as [string, any][]) {
    if (/MetaEdgeRuntime/.test(id) && resource.Type === 'AWS::IAM::Policy')
      assert.ok(!JSON.stringify(resource).includes('ssm:'))
  }
  app.synth()
})
