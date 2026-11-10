import { lambdaCode, metaQueueName, metaWorkerName, eventTableName } from './meta.js'
import { readFileSync } from 'node:fs'
import { Duration, RemovalPolicy, Tags } from 'aws-cdk-lib'
import * as api from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager'
import { Role } from 'aws-cdk-lib/aws-iam'
import { Architecture, Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda'
import { FilterPattern, LogGroup, MetricFilter, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Alarm, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs'
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'
import { Table, AttributeType, BillingMode, TableEncryption, ProjectionType } from 'aws-cdk-lib/aws-dynamodb'
import { ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53'
import { ApiGatewayv2DomainProperties } from 'aws-cdk-lib/aws-route53-targets'
import type { Construct } from 'constructs'
import { Base } from './stacks.js'
import { stacks, type Config } from './config.js'
import { signupConfig, signupHost, signupNames, signupOrigin, signupParameters, notificationParameter, notificationName, type SignupConfig, type SignupEnvironment } from './signup-config.js'

export class Signup extends Base {
  constructor(scope: Construct, p: Config, env: SignupEnvironment, raw: SignupConfig) {
    super(scope, stacks[`signup-${env}`], p)
    const cfg = signupConfig(raw)[env], names = signupNames(env), host = signupHost(env)
    Tags.of(this).add('Environment', env)
    const zone = this.zone()
    const certificate = new Certificate(this, 'Certificate', { domainName: host, validation: CertificateValidation.fromDns(zone) })
    const domain = new api.DomainName(this, 'Domain', { domainName: host, certificate })
    // Retain established logs, but avoid orphaning this fixed name on initial rollback.
    const logs = new LogGroup(this, 'Logs', { logGroupName: names.logs, retention: RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE })
    const dlq = new Queue(this, 'MetaDeadLetters', { queueName: `${metaQueueName(env)}-dlq`,
      encryption: QueueEncryption.SQS_MANAGED, enforceSSL: true, retentionPeriod: Duration.days(7),
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE })
    const queue = new Queue(this, 'MetaQueue', { queueName: metaQueueName(env),
      encryption: QueueEncryption.SQS_MANAGED, enforceSSL: true, retentionPeriod: Duration.days(4),
      visibilityTimeout: Duration.seconds(180), deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE })
    const workerLogs = new LogGroup(this, 'MetaWorkerLogs', { logGroupName: `/aws/lambda/${metaWorkerName(env)}`,
      retention: RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE })
    const events = new Table(this, 'Events', {
      tableName: eventTableName(env), partitionKey: { name: 'event_id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST, encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true, removalPolicy: RemovalPolicy.RETAIN,
    })
    events.addGlobalSecondaryIndex({ indexName: 'environment-time',
      partitionKey: { name: 'environment', type: AttributeType.STRING }, sortKey: { name: 'event_time', type: AttributeType.NUMBER },
      projectionType: ProjectionType.INCLUDE, nonKeyAttributes: ['event_name', 'client_ip_address', 'client_user_agent'],
    })
    const worker = new Function(this, 'MetaWorker', {
      functionName: metaWorkerName(env), runtime: Runtime.NODEJS_24_X, architecture: Architecture.ARM_64,
      handler: 'index.handler', code: Code.fromInline(lambdaCode('worker', env)),
      memorySize: 256, timeout: Duration.seconds(15), logGroup: workerLogs,
      environment: { EVENTS_TABLE: events.tableName },
      role: Role.fromRoleArn(this, 'MetaWorkerRole', `arn:aws:iam::${p.account}:role/${metaWorkerName(env)}`, { mutable: false }),
    })
    worker.addEventSource(new SqsEventSource(queue, { batchSize: 1, reportBatchItemFailures: true }))
    new Alarm(this, 'MetaDeadLettersAlarm', { alarmName: `flat-girl-${env}-signup-meta-dead-letters`,
      metric: dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
      threshold: 1, evaluationPeriods: 1, treatMissingData: TreatMissingData.NOT_BREACHING })
    this.output('MetaQueueUrl', queue.queueUrl)
    this.output('MetaWorkerName', worker.functionName)
    this.output('EventsTableName', events.tableName)
    const notificationDlq = new Queue(this, 'NotificationDeadLetters', {
      queueName: `${notificationName(env)}-dlq`, encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true, retentionPeriod: Duration.days(14), removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    })
    const notificationQueue = new Queue(this, 'NotificationQueue', {
      queueName: notificationName(env), encryption: QueueEncryption.SQS_MANAGED, enforceSSL: true,
      retentionPeriod: Duration.days(4), visibilityTimeout: Duration.seconds(180),
      deadLetterQueue: { queue: notificationDlq, maxReceiveCount: 5 }, removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    })
    const notificationLogs = new LogGroup(this, 'NotificationLogs', {
      logGroupName: `/aws/lambda/${notificationName(env)}`, retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    })
    const notificationWorker = new Function(this, 'NotificationWorker', {
      functionName: notificationName(env), runtime: Runtime.NODEJS_24_X, architecture: Architecture.ARM_64,
      handler: 'index.handler', code: Code.fromInline(readFileSync(new URL('../lambda/notification.cjs', import.meta.url), 'utf8')),
      memorySize: 128, timeout: Duration.seconds(15), logGroup: notificationLogs,
      environment: { ENVIRONMENT: env, NOTIFICATION_PARAMETER: notificationParameter(env) },
      role: Role.fromRoleArn(this, 'NotificationRole', `arn:aws:iam::${p.account}:role/${notificationName(env)}`, { mutable: false }),
    })
    notificationWorker.addEventSource(new SqsEventSource(notificationQueue, { batchSize: 1, reportBatchItemFailures: true }))
    new Alarm(this, 'NotificationDeadLettersAlarm', {
      alarmName: `flat-girl-${env}-signup-notification-dead-letters`,
      metric: notificationDlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
      threshold: 1, evaluationPeriods: 1, treatMissingData: TreatMissingData.NOT_BREACHING,
    })
    this.output('NotificationQueueUrl', notificationQueue.queueUrl)
    const fn = new Function(this, 'Subscribe', {
      functionName: names.function, runtime: Runtime.NODEJS_24_X, architecture: Architecture.ARM_64,
      handler: 'index.handler', code: Code.fromInline(lambdaCode('signup', env)),
      memorySize: 256, timeout: Duration.seconds(15), logGroup: logs,
      role: Role.fromRoleArn(this, 'RuntimeRole', `arn:aws:iam::${p.account}:role/${names.role}`, { mutable: false }),
      environment: {
        META_ENVIRONMENT: env, META_QUEUE_URL: queue.queueUrl, SIGNUP_ENABLED: String(cfg.enabled), ALLOWED_ORIGIN: signupOrigin(env), BREVO_LIST_ID: String(cfg.listId),
        TURNSTILE_PARAMETER: signupParameters.turnstile, BREVO_PARAMETER: signupParameters.brevo,
        NOTIFICATION_QUEUE_URL: notificationQueue.queueUrl,
      },
    })
    const gateway = new api.HttpApi(this, 'Api', {
      apiName: names.function, disableExecuteApiEndpoint: true, createDefaultStage: false,
      corsPreflight: { allowCredentials: true, allowOrigins: [signupOrigin(env)], allowHeaders: ['content-type'],
        allowMethods: [api.CorsHttpMethod.POST, api.CorsHttpMethod.OPTIONS], maxAge: Duration.minutes(5) },
    })
    gateway.addRoutes({ path: '/subscribe', methods: [api.HttpMethod.POST], integration: new HttpLambdaIntegration('Subscribe', fn) })
    const stage = new api.HttpStage(this, 'Stage', { httpApi: gateway, stageName: '$default', autoDeploy: true,
      throttle: { rateLimit: cfg.rateLimit, burstLimit: cfg.burstLimit } })
    new api.ApiMapping(this, 'Mapping', { api: gateway, domainName: domain, stage })
    new ARecord(this, 'Dns', { zone, recordName: host,
      target: RecordTarget.fromAlias(new ApiGatewayv2DomainProperties(domain.regionalDomainName, domain.regionalHostedZoneId)) })
    const failures = new MetricFilter(this, 'ProviderFailures', {
      logGroup: logs, filterPattern: FilterPattern.anyTerm('secrets_failed', 'turnstile_failed', 'brevo_failed', 'notification_enqueue_failed'),
      metricNamespace: 'FlatGirl/Signup', metricName: `${env}-provider-failures`, metricValue: '1', defaultValue: 0,
    })
    new Alarm(this, 'ProviderFailureAlarm', { alarmName: `flat-girl-${env}-signup-provider-failures`,
      metric: failures.metric({ statistic: 'Sum', period: Duration.minutes(5) }), threshold: 3, evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING })
    new Alarm(this, 'LambdaErrorAlarm', { alarmName: `flat-girl-${env}-signup-errors`,
      metric: fn.metricErrors({ period: Duration.minutes(5) }), threshold: 1, evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING })
    new Alarm(this, 'LambdaThrottleAlarm', { alarmName: `flat-girl-${env}-signup-throttles`,
      metric: fn.metricThrottles({ period: Duration.minutes(5) }), threshold: 1, evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING })
    this.output('SignupEndpoint', `https://${host}/subscribe`)
    this.output('SignupFunctionName', names.function)
    this.output('SignupEnabled', String(cfg.enabled))
    this.output('BrevoListId', String(cfg.listId))
  }
}
