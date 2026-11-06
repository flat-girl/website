import { readFileSync } from 'node:fs'
import { Duration, RemovalPolicy, Tags } from 'aws-cdk-lib'
import * as api from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager'
import { Role } from 'aws-cdk-lib/aws-iam'
import { Architecture, Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda'
import { FilterPattern, LogGroup, MetricFilter, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Alarm, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53'
import { ApiGatewayv2DomainProperties } from 'aws-cdk-lib/aws-route53-targets'
import type { Construct } from 'constructs'
import { Base } from './stacks.js'
import { stacks, type Config } from './config.js'
import { signupConfig, signupHost, signupNames, signupOrigin, signupParameters, type SignupConfig, type SignupEnvironment } from './signup-config.js'

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
    const fn = new Function(this, 'Subscribe', {
      functionName: names.function, runtime: Runtime.NODEJS_24_X, architecture: Architecture.ARM_64,
      handler: 'index.handler', code: Code.fromInline(readFileSync(new URL('../lambda/signup.cjs', import.meta.url), 'utf8')),
      memorySize: 256, timeout: Duration.seconds(15), logGroup: logs,
      role: Role.fromRoleArn(this, 'RuntimeRole', `arn:aws:iam::${p.account}:role/${names.role}`, { mutable: false }),
      environment: {
        SIGNUP_ENABLED: String(cfg.enabled), ALLOWED_ORIGIN: signupOrigin(env), BREVO_LIST_ID: String(cfg.listId),
        TURNSTILE_PARAMETER: signupParameters.turnstile, BREVO_PARAMETER: signupParameters.brevo,
      },
    })
    const gateway = new api.HttpApi(this, 'Api', {
      apiName: names.function, disableExecuteApiEndpoint: true, createDefaultStage: false,
      corsPreflight: { allowOrigins: [signupOrigin(env)], allowHeaders: ['content-type'],
        allowMethods: [api.CorsHttpMethod.POST, api.CorsHttpMethod.OPTIONS], maxAge: Duration.minutes(5) },
    })
    gateway.addRoutes({ path: '/subscribe', methods: [api.HttpMethod.POST], integration: new HttpLambdaIntegration('Subscribe', fn) })
    const stage = new api.HttpStage(this, 'Stage', { httpApi: gateway, stageName: '$default', autoDeploy: true,
      throttle: { rateLimit: cfg.rateLimit, burstLimit: cfg.burstLimit } })
    new api.ApiMapping(this, 'Mapping', { api: gateway, domainName: domain, stage })
    new ARecord(this, 'Dns', { zone, recordName: host,
      target: RecordTarget.fromAlias(new ApiGatewayv2DomainProperties(domain.regionalDomainName, domain.regionalHostedZoneId)) })
    const failures = new MetricFilter(this, 'ProviderFailures', {
      logGroup: logs, filterPattern: FilterPattern.anyTerm('secrets_failed', 'turnstile_failed', 'brevo_failed'),
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
