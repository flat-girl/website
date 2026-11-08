import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { Admin } from '../lib/admin-stack.js'
import { Access } from '../lib/access.js'
import { config } from '../lib/config.js'
const require = createRequire(import.meta.url)
const { createStore, createService, createHandler } = require('../lambda/admin.cjs')
const auth = require('../lambda/admin-auth.cjs')
const credentials = 'Basic ' + Buffer.from('admin:fixture-password-not-live').toString('base64')
const digest = createHash('sha256').update(credentials).digest('hex')
const conditional = () => Object.assign(Error('condition'), { name: 'ConditionalCheckFailedException' })
function fixture() {
  let time = Date.parse('2026-11-08T18:00:00Z'), scanCalls = 0, queueCalls = 0, fail = false, loseReply = false
  const items = new Map<string, any>(), operations: any[] = []
  const id = (k: any) => k.pk.S + '/' + k.sk.S
  const copy = (x: any) => x === undefined ? undefined : structuredClone(x)
  const request = async (operation: string, input: any): Promise<any> => {
    operations.push([operation, copy(input)])
    if (operation === 'GetItem') return { Item: copy(items.get(id(input.Key))) }
    if (operation === 'Query') return { Items: [...items.values()].filter(x => x.pk.S === input.ExpressionAttributeValues[':pk'].S).map(copy) }
    if (operation === 'UpdateItem') {
      const old = items.get(id(input.Key)), values = input.ExpressionAttributeValues
      if (old && Number(old.leaseUntil.N) >= Number(values[':now'].N)) throw conditional()
      items.set(id(input.Key), { ...input.Key, owner: values[':owner'], leaseUntil: values[':until'] }); return {}
    }
    if (operation === 'DeleteItem') {
      if (items.get(id(input.Key))?.owner.S !== input.ExpressionAttributeValues[':owner'].S) throw conditional()
      items.delete(id(input.Key)); return {}
    }
    if (operation === 'TransactWriteItems') {
      const c = input.TransactItems[0].ConditionCheck, lock = items.get(id(c.Key))
      if (lock?.owner.S !== c.ExpressionAttributeValues[':owner'].S || Number(lock.leaseUntil.N) <= Number(c.ExpressionAttributeValues[':now'].N)) throw conditional()
      for (const a of input.TransactItems.slice(1)) {
        if (a.Put) items.set(id(a.Put.Item), copy(a.Put.Item))
        if (a.Delete) items.delete(id(a.Delete.Key))
      }
      if (loseReply) { loseReply = false; throw Error('response lost after committed transaction') }
      return {}
    }
    throw Error(operation)
  }
  const store = createStore(request, 'cache', () => time)
  const event = (name: string, hoursAgo: number, env = 'production') => ({ event_id: { S: 'ignored-id' }, event_name: { S: name }, environment: { S: env }, event_time: { N: String(time / 1000 - hoursAgo * 3600) } })
  let source = [event('ViewContent', 2), event('Lead', 1)]
  const service = () => createService({ store, now: () => time,
    scan: async (_env: string, cursor: any) => { scanCalls++; if (fail) throw Error('scan failed'); return cursor ? { Items: source.slice(1) } : { Items: source.slice(0, 1), LastEvaluatedKey: { event_id: { S: 'page1' } } } },
    queue: async () => { queueCalls++; return { visible: 0, inFlight: 0, delayed: 0 } },
  })
  return { store, service, operations, items, now: () => time, advance: (ms: number) => { time += ms }, calls: () => ({ scanCalls, queueCalls }), fail: () => { fail = true }, lose: () => { loseReply = true }, setSource: (x: any[]) => { source = x }, event }
}
test('persistent pagination survives a new service instance; cache hits do not read sources or SQS', async () => {
  const f = fixture()
  assert.equal((await f.service().read('production')).state, 'missing')
  assert.equal((await f.service().ensure('production')).state, 'updating')
  assert.equal((await f.service().read('production')).data, null)
  const result = await f.service().ensure('production')
  assert.equal(result.state, 'ready'); assert.equal(result.data.totalLeads, 1); assert.equal(result.data.totalViews, 1)
  assert.equal(result.data.hours.length, 2)
  await f.service().ensure('production'); await f.service().read('production')
  assert.deepEqual(f.calls(), { scanCalls: 2, queueCalls: 1 })
  assert.equal((await f.service().read('beta')).data, null)
  const writes = f.operations.filter(([op]) => ['UpdateItem', 'DeleteItem', 'TransactWriteItems'].includes(op))
  assert.ok(writes.every(([, r]) => r.TableName === 'cache' || r.TransactItems.every((x: any) => Object.values(x).every((v: any) => v.TableName === 'cache'))))
})
test('mutex contention, lease expiry, stale-owner fencing, and conditional release', async () => {
  const f = fixture()
  assert.equal(await f.store.acquire('old'), true)
  assert.equal(f.operations.at(-1)[1].ExpressionAttributeNames['#owner'], 'owner')
  assert.match(f.operations.at(-1)[1].UpdateExpression, /SET #owner =/)
  assert.equal((await f.service().ensure('production')).state, 'waiting')
  assert.deepEqual(f.calls(), { scanCalls: 0, queueCalls: 0 })
  f.advance(45001)
  assert.equal(await f.store.acquire('new'), true)
  await assert.rejects(f.store.commit('old', [['bad', 'state', {}]]))
  await f.store.release('old')
  assert.equal(await f.store.acquire('third'), false)
  await f.store.release('new')
  assert.equal(await f.store.acquire('third'), true)
})
test('lost checkpoint response resumes without applying a source page twice', async () => {
  const f = fixture()
  // Prime SQS, then lose the page transaction response rather than the queue write.
  await f.store.acquire('seed')
  await f.store.commit('seed', [['dlq#production', 'state', { schema: 2, freshUntil: f.now() + 60000, visible: 0, inFlight: 0, delayed: 0 }]])
  await f.store.release('seed')
  f.lose()
  await assert.rejects(f.service().ensure('production'))
  const result = await f.service().ensure('production')
  assert.equal(result.data.totalViews, 1); assert.equal(result.data.totalLeads, 1)
  assert.equal(f.calls().scanCalls, 2)
})
test('stale scan failure retains last complete generation; cache loss is not reported as zero', async () => {
  const f = fixture()
  await f.service().ensure('production'); const good = await f.service().ensure('production')
  f.advance(60001); f.fail()
  await assert.rejects(f.service().ensure('production'))
  const stale = await f.service().read('production')
  assert.equal(stale.state, 'stale'); assert.equal(stale.data.generation, good.data.generation)
  for (const k of f.items.keys()) if (k.startsWith('data#')) { f.items.delete(k); break }
  assert.equal((await f.service().read('production')).state, 'missing')
})
test('invalid events are excluded; zero rows is a complete empty result', async () => {
  const f = fixture()
  f.setSource([f.event('Lead', -3), f.event('Lead', 1, 'beta'), f.event('Other', 1)])
  await f.service().ensure('production'); const result = await f.service().ensure('production')
  assert.equal(result.data.totalLeads, 0); assert.equal(result.data.totalViews, 0); assert.deepEqual(result.data.hours, [])
})
test('API authenticates cached reads and origin requests; restricts writes to same-origin JSON', async () => {
  let calls = 0
  const service = { read: async () => { calls++; return { state: 'ready' } }, ensure: async () => { calls++; return { state: 'updating' } } }
  const handler = createHandler(service, async () => digest)
  const event = (method = 'GET', path = '/api/metrics', headers: any = {}) => ({ requestContext: { http: { method } }, rawPath: path, queryStringParameters: { environment: 'production' }, headers })
  assert.equal((await handler(event())).statusCode, 401)
  assert.equal((await handler(event('GET', '/api/metrics', { authorization: 'Basic wrong' }))).statusCode, 401)
  assert.equal(calls, 0)
  assert.equal((await handler(event('GET', '/api/metrics', { authorization: credentials }))).statusCode, 200)
  const post = { ...event('POST', '/api/rollups/ensure', { authorization: credentials, origin: 'https://evil.test', 'content-type': 'application/json' }), body: '{"environment":"production"}' }
  assert.equal((await handler(post)).statusCode, 403)
  post.headers.origin = 'https://admin.flatgirl.net'
  assert.equal((await handler(post)).statusCode, 202)
  assert.equal((await handler({ ...post, body: '{"environment":"production","table":"private"}' })).statusCode, 400)
  assert.equal((await createHandler(service, async () => { throw Error('SSM') })(event('GET', '/api/metrics', { authorization: credentials }))).statusCode, 503)
})
test('edge protects cached assets, preserves API Authorization, strips it for S3, and rotates', async () => {
  const edge = auth.createEdge({ read: async () => digest })
  const event = (uri: string, header?: string) => ({ Records: [{ cf: { request: { uri, headers: { host: [{ value: 'admin.flatgirl.net' }], ...(header ? { authorization: [{ value: header }] } : {}) } } } }] })
  for (const path of ['/', '/_nuxt/app.js', '/api/metrics']) assert.equal((await edge(event(path))).status, '401')
  assert.equal((await edge(event('/_nuxt/app.js', credentials))).headers.authorization, undefined)
  assert.equal((await edge(event('/api/metrics', credentials))).headers.authorization[0].value, credentials)
  let time = 0, reads = 0
  const reader = auth.credentialReader({ now: () => time, read: async () => { if (++reads > 1) throw Error('SSM'); return digest } })
  await reader(); await reader(); assert.equal(reads, 1); time = 60001; await assert.rejects(reader())
})
test('admin infrastructure is independent; runtime writes only cache and logs', () => {
  const p = config({ account: '111111111111', region: 'us-east-1', hostedZoneId: 'ZEXAMPLE', domain: 'flatgirl.net', operatorPrincipalArn: null, betaEnabled: true, productionNoindex: true })
  const app = new App(), access = new Access(app, p), admin = new Admin(app, p)
  const a = Template.fromStack(admin)
  a.resourceCountIs('AWS::DynamoDB::Table', 1)
  a.hasResourceProperties('AWS::DynamoDB::Table', { TableName: 'flat-girl-admin-cache', TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true } })
  a.hasResourceProperties('AWS::CertificateManager::Certificate', { DomainName: 'admin.flatgirl.net' })
  const distribution: any = Object.values(a.findResources('AWS::CloudFront::Distribution'))[0]
  assert.equal(distribution.Properties.DistributionConfig.CacheBehaviors[0].CachePolicyId, '4135ea2d-6df8-44a3-9df3-4b5a84be39ad')
  assert.equal(admin.dependencies.length, 0)
  const policies = Template.fromStack(access).findResources('AWS::IAM::Policy')
  const runtime: any = Object.entries(policies).find(([id]) => id.startsWith('AdminRuntimeDefaultPolicy'))?.[1]
  assert.ok(runtime)
  for (const s of runtime.Properties.PolicyDocument.Statement) {
    for (const action of Array.isArray(s.Action) ? s.Action : [s.Action]) {
      if (/:(Put|Update|Delete|ConditionCheck)/.test(action) && !action.startsWith('logs:')) assert.equal(s.Resource, 'arn:aws:dynamodb:us-east-1:111111111111:table/flat-girl-admin-cache')
    }
  }
  const scan = runtime.Properties.PolicyDocument.Statement.find((s: any) => s.Action === 'dynamodb:Scan')
  assert.equal(scan.Condition.StringEquals['dynamodb:Select'], 'SPECIFIC_ATTRIBUTES')
  assert.deepEqual(scan.Condition['ForAllValues:StringEquals']['dynamodb:Attributes'], ['event_id', 'event_name', 'event_time', 'environment', 'client_ip_address', 'client_user_agent'])
  assert.ok(!JSON.stringify(scan).includes('email'))
})

test('unique views deduplicate across pages/hours/days, hide fingerprints, and preserve raw counts', async () => {
  const f = fixture()
  const identified = (hours: number, agent = 'Browser A') => ({ ...f.event('ViewContent', hours), client_ip_address: { S: '192.0.2.1' }, client_user_agent: { S: agent } })
  f.setSource([identified(1), identified(1), identified(2), identified(13), identified(2, 'Browser B'), f.event('ViewContent', 3), f.event('Lead', 1)])
  await f.service().ensure('production'); const r = await f.service().ensure('production')
  assert.equal(r.data.totalViews, 6); assert.equal(r.data.totalLeads, 1)
  assert.equal(r.data.totalUniqueViews, 2); assert.equal(r.data.unidentifiedViews, 1)
  assert.equal(r.data.hours.reduce((n: number, h: number[]) => n + h[3], 0), 4)
  assert.deepEqual(r.data.uniqueDays.map((d: any[]) => d[1]), [1, 2])
  assert.deepEqual(r.data.uniqueDays.map((d: any[]) => d[2]), [1, 2])
  assert.equal(r.data.uniqueWeeks[0][1], 2)
  assert.ok(!JSON.stringify(r).includes('identities'))
  assert.ok(!JSON.stringify([...f.items.values()]).includes('192.0.2.1'))
  assert.ok(!JSON.stringify([...f.items.values()]).includes('Browser A'))
  assert.ok(![...f.items.values()].some(x => x.pk.S === 'job#production'))
})
test('production cutoff is November 7 at 3 PM Chicago; beta history remains independent', async () => {
  const f = fixture(), start = Date.parse('2026-11-07T21:00:00Z') / 1000
  const at = (name: string, seconds: number) => ({ ...f.event(name, 0), event_time: { N: String(seconds) } })
  f.setSource([at('ViewContent', start - 1), at('Lead', start - 1), at('ViewContent', start), at('Lead', start)])
  await f.service().ensure('production'); const r = await f.service().ensure('production')
  assert.equal(r.data.totalViews, 1); assert.equal(r.data.totalLeads, 1); assert.equal(r.data.coverageStart, start)
})
test('fingerprint canonicalizes IPv6 and uses a per-generation secret; missing identity is not invented', () => {
  const { fingerprint, summarize } = require('../lambda/admin-unique.cjs')
  const item = (ip: string) => ({ client_ip_address: { S: ip }, client_user_agent: { S: 'Browser' } })
  const salt = '11'.repeat(32)
  assert.equal(fingerprint(item('2001:db8::1'), salt), fingerprint(item('2001:0db8:0:0:0:0:0:1'), salt))
  assert.notEqual(fingerprint(item('192.0.2.1'), salt), fingerprint(item('192.0.2.1'), '22'.repeat(32)))
  assert.equal(fingerprint({}, salt), null)
  const a = Date.parse('2026-11-09T05:00:00Z') / 1000, b = a + 3600
  const r = summarize([{ hours: [[a, 1, 0], [b, 1, 0]], identities: { same: [a, b] } }])
  assert.equal(r.totalUniqueViews, 1); assert.deepEqual(r.uniqueWeeks.map((w: any[]) => w[1]), [1, 1])
})
