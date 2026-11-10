import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { config } from '../lib/config.js'
import { Access } from '../lib/access.js'
import { Signup } from '../lib/signup-stack.js'
import { signupConfig, signupParameters } from '../lib/signup-config.js'
const { createHandler, createSecretLoader } = createRequire(import.meta.url)('../lambda/signup.cjs')
const cfg = signupConfig({ turnstileSiteKey: '0xTestSiteKeyForSynthesis',
  beta: { enabled: true, listId: 5, rateLimit: 1, burstLimit: 2 },
  production: { enabled: true, listId: 4, rateLimit: 3, burstLimit: 5 } })
const p = config({ account: '111111111111', region: 'us-east-1', hostedZoneId: 'ZEXAMPLE', domain: 'flatgirl.net', operatorPrincipalArn: null, betaEnabled: true, productionNoindex: true })
const accepted = { accepted: true }
const contact = (extra = {}) => ({ emailBlacklisted: false, listIds: [], ...extra })
const reply = (status: number, body?: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const tokenReply = { success: true, hostname: 'flatgirl.net', action: 'subscribe' }
function event(body: any = {}) {
  return { requestContext: { http: { method: 'POST' } }, headers: { origin: 'https://flatgirl.net', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'reader+launch@example.com', turnstileToken: 'test-token', website: '', ...body }), isBase64Encoded: false }
}
function fixture(responses: any[], settings: any = {}, extra: any = {}) {
  const calls: any[] = [], logs: any[] = [], notifications: string[] = []
  let secretCalls = 0
  const handler = createHandler({ enabled: true, origin: 'https://flatgirl.net', listId: 4, ...settings }, {
    secrets: async () => { secretCalls++; return { turnstile: 'private-turnstile', brevo: 'private-brevo' } },
    fetch: async (url: string, options: any) => {
      calls.push({ url, ...options })
      const next = responses.shift()
      if (next instanceof Error) throw next
      if (!next) throw new Error('Unexpected request')
      return next
    },
    log: (value: unknown) => logs.push(value),
    notify: async (email: string) => { notifications.push(email) },
    ...extra,
  })
  return { handler, calls, logs, notifications, secretCalls: () => secretCalls }
}

test('new signup validates server-side and creates only the configured membership', async () => {
  const f = fixture([reply(200, tokenReply), reply(404), reply(201, { id: 22 })])
  assert.deepEqual(JSON.parse((await f.handler(event())).body), accepted)
  assert.deepEqual(JSON.parse(f.calls[2].body), { email: 'reader+launch@example.com', listIds: [4], updateEnabled: false })
  assert.equal(f.calls[0].redirect, 'error')
  assert.ok(f.calls.every(c => c.signal instanceof AbortSignal))
  assert.equal(f.calls.length, 3)
  assert.deepEqual(f.notifications, ['reader+launch@example.com'])
})

test('beta shares keys but targets list 5 and accepts only its hostname/origin', async () => {
  const f = fixture([reply(200, { ...tokenReply, hostname: 'beta.flatgirl.net' }), reply(404), reply(201)], { origin: 'https://beta.flatgirl.net', listId: 5 })
  const request = event(); request.headers.origin = 'https://beta.flatgirl.net'
  assert.equal((await f.handler(request)).statusCode, 200)
  assert.deepEqual(JSON.parse(f.calls[2].body).listIds, [5])
  assert.equal(f.calls[1].headers['api-key'], 'private-brevo')
})

test('invalid requests never read secrets or call providers', async () => {
  const cases = [event({ email: 'bad' }), event({ website: 'bot' }), event({ consent: true }), event({ email: 5 }),
    event({ turnstileToken: '' }), event({ turnstileToken: 'a'.repeat(2049) }), event({ email: 'a..b@example.com' }),
    { ...event(), body: 'x'.repeat(4097) }, { ...event(), body: '{' }, { ...event(), body: 'null' },
    { ...event(), body: '[]' }, { ...event(), body: '!!!', isBase64Encoded: true },
    { ...event(), body: Buffer.from([0xff]).toString('base64'), isBase64Encoded: true },
    { ...event(), requestContext: { http: { method: 'GET' } } },
    { ...event(), headers: { origin: 'https://beta.flatgirl.net', 'content-type': 'application/json' } },
    { ...event(), headers: { origin: 'https://flatgirl.net', 'content-type': 'text/plain' } },
    { ...event(), headers: {} }]
  for (const request of cases) {
    const f = fixture([])
    assert.ok((await f.handler(request)).statusCode >= 400)
    assert.equal(f.calls.length, 0); assert.equal(f.secretCalls(), 0)
    assert.deepEqual(f.notifications, [])
  }
})

test('valid base64 and mixed-case headers are accepted', async () => {
  const f = fixture([reply(200, tokenReply), reply(200, contact({ listIds: [4] }))])
  const request = event()
  request.body = Buffer.from(request.body).toString('base64'); request.isBase64Encoded = true
  const mixed = { ...request, headers: { Origin: 'https://flatgirl.net', 'Content-Type': 'application/json; charset=utf-8' } }
  assert.equal((await f.handler(mixed)).statusCode, 200)
})

test('rejected, expired/replayed and mismatched Turnstile responses never contact Brevo', async () => {
  for (const result of [{ success: false, 'error-codes': ['timeout-or-duplicate'] },
    { ...tokenReply, hostname: 'beta.flatgirl.net' }, { ...tokenReply, action: 'other' }]) {
    const f = fixture([reply(200, result)])
    assert.equal((await f.handler(event())).statusCode, 403); assert.equal(f.calls.length, 1)
  }
  for (const result of [reply(500), reply(200, {}), new Error('network')]) {
    const f = fixture([result])
    assert.equal((await f.handler(event())).statusCode, 503); assert.equal(f.calls.length, 1)
  }
})

test('duplicates and global/list suppression are identical no-write acceptances', async () => {
  for (const state of [contact({ listIds: [4] }), contact({ emailBlacklisted: true }), contact({ listUnsubscribed: [4] })]) {
    const f = fixture([reply(200, tokenReply), reply(200, state)])
    const response = await f.handler(event())
    assert.equal(response.statusCode, 200); assert.deepEqual(JSON.parse(response.body), accepted)
    assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(f.calls.length, 2)
    assert.deepEqual(f.notifications, [])
  }
})

test('existing eligible contact gets a list-only update, preserving attributes and suppression flags', async () => {
  const f = fixture([reply(200, tokenReply), reply(200, contact({ listIds: [5, 42], attributes: { NAME: 'Reader' } })), reply(204)])
  assert.equal((await f.handler(event())).statusCode, 200)
  assert.equal(f.calls[2].method, 'PUT')
  assert.deepEqual(JSON.parse(f.calls[2].body), { listIds: [4] })
  assert.equal(f.notifications.length, 1)
})

test('unknown contact state or consent-group configuration fails without updating', async () => {
  for (const state of [null, {}, contact({ listIds: '4' }), contact({ listUnsubscribed: ['4'] }), contact({ consentGroups: [] })]) {
    const f = fixture([reply(200, tokenReply), reply(200, state)])
    assert.equal((await f.handler(event())).statusCode, 503); assert.equal(f.calls.length, 2)
  }
})

test('duplicate-create race re-reads state and respects new suppression', async () => {
  const f = fixture([reply(200, tokenReply), reply(404), reply(400, { code: 'duplicate_parameter' }), reply(200, contact({ emailBlacklisted: true }))])
  assert.equal((await f.handler(event())).statusCode, 200); assert.equal(f.calls.length, 4)
  assert.deepEqual(f.notifications, [])
  const g = fixture([reply(200, tokenReply), reply(404), reply(400, { code: 'duplicate_parameter' }), reply(200, contact()), reply(204)])
  assert.equal((await g.handler(event())).statusCode, 200); assert.equal(g.calls[4].method, 'PUT')
  assert.equal(g.notifications.length, 1)
})

test('provider errors and ambiguous writes fail without automatic write replay or sensitive logs', async () => {
  for (const failure of [reply(401), reply(429), reply(500), new Error('reader+launch@example.com private-brevo')]) {
    const f = fixture([reply(200, tokenReply), reply(404), failure])
    assert.equal((await f.handler(event())).statusCode, 503); assert.equal(f.calls.length, 3)
    const log = JSON.stringify(f.logs)
    for (const secret of ['reader+', 'private-brevo', 'test-token']) assert.ok(!log.includes(secret))
    assert.equal(f.logs[0].outcome, 'brevo_failed')
    assert.deepEqual(f.notifications, [])
  }
  const lookupFailure = fixture([reply(200, tokenReply), reply(429)])
  assert.equal((await lookupFailure.handler(event())).statusCode, 503); assert.equal(lookupFailure.calls.length, 2)
  const retry = fixture([reply(200, tokenReply), reply(200, contact({ listIds: [4] }))])
  assert.equal((await retry.handler(event())).statusCode, 200)
})

test('notification queue failure preserves signup acceptance, privacy and Meta tracking', async () => {
  let tracked = false
  const f = fixture([reply(200, tokenReply), reply(404), reply(201)], {}, {
    notify: async () => { throw Error('reader+launch@example.com secret') },
    meta: { config: async () => { tracked = true; return { mode: 'off' } } },
  })
  assert.equal((await f.handler(event())).statusCode, 200)
  assert.ok(tracked)
  assert.equal(f.logs[0].outcome, 'notification_enqueue_failed')
  assert.ok(!JSON.stringify(f.logs).includes('reader+'))
})

test('signup awaits queue acceptance only and skips enqueue when its time budget is exhausted', async () => {
  let queued = false
  const f = fixture([reply(200, tokenReply), reply(404), reply(201)], {}, {
    notify: async (_email: string, signal: AbortSignal) => {
      assert.ok(signal instanceof AbortSignal)
      await Promise.resolve(); queued = true
    },
  })
  assert.equal((await f.handler(event())).statusCode, 200)
  assert.ok(queued)
  const g = fixture([reply(200, tokenReply), reply(404), reply(201)])
  assert.equal((await g.handler(event(), { getRemainingTimeInMillis: () => 500 })).statusCode, 200)
  assert.deepEqual(g.notifications, [])
  assert.equal(g.logs[0].outcome, 'notification_enqueue_failed')
})

test('disabled backend does not read secrets and secret loader caches only complete results', async () => {
  const f = fixture([], { enabled: false })
  assert.equal((await f.handler(event())).statusCode, 503); assert.equal(f.secretCalls(), 0)
  let calls = 0, now = 1000
  const oldNow = Date.now; Date.now = () => now
  try {
    class Command { constructor(public input: unknown) {} }
    const loader = createSecretLoader({ send: async () => { calls++; return { Parameter: { Value: 'private' } } } }, Command, { a: 'a', b: 'b' })
    await loader(new AbortController().signal); await loader(new AbortController().signal)
    assert.equal(calls, 2); now += 61000; await loader(new AbortController().signal); assert.equal(calls, 4)
    const bad = createSecretLoader({ send: async () => ({}) }, Command, { a: 'a' })
    await assert.rejects(() => bad(new AbortController().signal))
  } finally { Date.now = oldNow }
})

test('signup stacks share secret paths, isolate origins/lists, and retain hosting independence', () => {
  const app = new App(); const access = new Access(app, p)
  const signupStacks = { beta: new Signup(app, p, 'beta', cfg), production: new Signup(app, p, 'production', cfg) }
  for (const env of ['beta', 'production'] as const) {
    const template = Template.fromStack(signupStacks[env])
    template.hasResourceProperties('AWS::Lambda::Function', { Runtime: 'nodejs24.x', Timeout: 15,
      Environment: { Variables: { SIGNUP_ENABLED: 'true', BREVO_LIST_ID: String(env === 'beta' ? 5 : 4),
        ALLOWED_ORIGIN: env === 'beta' ? 'https://beta.flatgirl.net' : 'https://flatgirl.net',
        BREVO_PARAMETER: signupParameters.brevo, TURNSTILE_PARAMETER: signupParameters.turnstile } } })
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', { DisableExecuteApiEndpoint: true, ProtocolType: 'HTTP',
      CorsConfiguration: { AllowCredentials: true, AllowOrigins: [env === 'beta' ? 'https://beta.flatgirl.net' : 'https://flatgirl.net'], AllowMethods: ['POST','OPTIONS'], AllowHeaders: ['content-type'] } })
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: `flat-girl-${env}-events`, BillingMode: 'PAY_PER_REQUEST', DeletionProtectionEnabled: true,
      KeySchema: [{ AttributeName: 'event_id', KeyType: 'HASH' }],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      SSESpecification: { SSEEnabled: true },
    })
    const table: any = Object.values(template.findResources('AWS::DynamoDB::Table'))[0]
    assert.equal(table.Properties.TimeToLiveSpecification, undefined)
    template.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' })
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: `flat-girl-${env}-meta-worker`, Environment: { Variables: { EVENTS_TABLE: { Ref: Object.keys(template.findResources('AWS::DynamoDB::Table'))[0] } } },
    })
    template.resourceCountIs('AWS::IAM::Role', 0)
    template.resourceCountIs('AWS::CloudWatch::Alarm', 5)
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: `flat-girl-${env}-notification`, SqsManagedSseEnabled: true,
      VisibilityTimeout: 180, RedrivePolicy: { maxReceiveCount: 5 },
    })
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: `flat-girl-${env}-notification`, Timeout: 15,
      Environment: { Variables: { ENVIRONMENT: env, NOTIFICATION_PARAMETER: `/flat-girl/signup/${env}/notification` } },
    })
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', { BatchSize: 1, FunctionResponseTypes: ['ReportBatchItemFailures'] })
    template.hasResource('AWS::Logs::LogGroup', { DeletionPolicy: 'RetainExceptOnCreate', UpdateReplacePolicy: 'Retain' })
    assert.ok(!JSON.stringify(template.toJSON()).includes('FlatGirlBetaSite'))
  }
  const accessJson = Template.fromStack(access).toJSON()
  Template.fromStack(access).hasResourceProperties('AWS::SES::EmailIdentity', { EmailIdentity: 'flatgirl.net' })
  const mailRecords = Object.values(Template.fromStack(access).findResources('AWS::Route53::RecordSet')) as any[]
  assert.equal(mailRecords.length, 3)
  assert.ok(mailRecords.every(record => record.Properties.Type === 'CNAME'))
  const executionPolicy = Object.entries(accessJson.Resources).filter(([id, resource]: [string, any]) =>
    id.startsWith('Execution') && ['AWS::IAM::Policy','AWS::IAM::ManagedPolicy'].includes(resource.Type))
    .flatMap(([, resource]: [string, any]) => resource.Properties.PolicyDocument.Statement)
  // Required by live CloudFormation Stage and DomainName handler schemas, not just the REST verbs.
  for (const action of ['apigateway:TagResource', 'apigateway:UntagResource']) {
    assert.ok(executionPolicy.some((statement: any) => statement.Action.includes(action) &&
      statement.Resource.includes('arn:aws:apigateway:us-east-1::/apis/*')))
  }
  for (const action of ['apigateway:AddCertificateToDomain', 'apigateway:RemoveCertificateFromDomain']) {
    const statement = executionPolicy.find((statement: any) => statement.Action.includes(action))
    assert.deepEqual(statement.Resource, ['arn:aws:apigateway:us-east-1::/domainnames/api.flatgirl.net',
      'arn:aws:apigateway:us-east-1::/domainnames/beta-api.flatgirl.net'])
  }
  for (const resource of Object.values(accessJson.Resources) as any[]) {
    if (resource.Type === 'AWS::IAM::Policy' && JSON.stringify(resource.Properties.Roles ?? []).includes('Publisher'))
      assert.ok(!JSON.stringify(resource).includes('ssm:'))
  }
  for (const env of ['beta', 'production']) {
    const policies = Object.entries(accessJson.Resources).filter(([id, resource]: [string, any]) =>
      id.startsWith(`${env}MetaWorkerRuntime`) && resource.Type === 'AWS::IAM::Policy')
      .flatMap(([, resource]: [string, any]) => resource.Properties.PolicyDocument.Statement)
    const writes = policies.filter((statement: any) => JSON.stringify(statement.Action).includes('dynamodb:'))
    assert.equal(writes.length, 1)
    assert.deepEqual(writes[0].Action, ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'])
    assert.equal(writes[0].Resource, `arn:aws:dynamodb:us-east-1:111111111111:table/flat-girl-${env}-events`)
  }
  for (const [id, resource] of Object.entries(accessJson.Resources) as [string, any][]) {
    if (/Publisher|SignupRuntime|MetaEdgeRuntime/.test(id) && resource.Type === 'AWS::IAM::Policy')
      assert.ok(!JSON.stringify(resource).includes('dynamodb:'))
    if (/Publisher|SignupRuntime|MetaEdgeRuntime/.test(id) && resource.Type === 'AWS::IAM::Policy')
      assert.ok(!JSON.stringify(resource).includes('ses:'))
    if (/NotificationRuntime/.test(id) && resource.Type === 'AWS::IAM::Policy') {
      const statements = resource.Properties.PolicyDocument.Statement
      const send = statements.find((s: any) => [s.Action].flat().includes('ses:SendRawEmail'))
      assert.deepEqual(send.Condition, { StringEquals: { 'ses:FromAddress': 'high@flatgirl.net' },
        'ForAllValues:StringEquals': { 'ses:Recipients': ['high@flatgirl.net'] } })
      assert.ok(!JSON.stringify(resource).includes('brevo-api-key'))
      assert.ok(!JSON.stringify(resource).includes('ssm:PutParameter'))
    }
  }
  app.synth() // Also exercises the 51,200-byte inline-template limit.
  assert.throws(() => signupConfig({ ...cfg, beta: { ...cfg.beta, listId: 4 } }))
  assert.throws(() => signupConfig({ ...cfg, production: { ...cfg.production, listId: 6 } }))
  assert.throws(() => signupConfig({ ...cfg, turnstileSiteKey: '1x00000000000000000000AA' }))
})
