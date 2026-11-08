import { Duration, RemovalPolicy, Tags } from 'aws-cdk-lib'
import { readFileSync } from 'node:fs'
import type { Construct } from 'constructs'
import * as cf from 'aws-cdk-lib/aws-cloudfront'
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as dns from 'aws-cdk-lib/aws-route53'
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as db from 'aws-cdk-lib/aws-dynamodb'
import * as api from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { Base } from './stacks.js'
import { stacks, type Config } from './config.js'
import { codeHash } from './meta.js'
export const adminParameter = '/flat-girl/admin/authorization-sha256'
export const adminCache = 'flat-girl-admin-cache'
export const adminFunction = 'flat-girl-admin-metrics'
export const adminEdge = 'flat-girl-admin-auth'
export function adminCode(edge = false) {
  const helper = readFileSync(new URL('../lambda/admin-auth.cjs', import.meta.url), 'utf8')
  return `const __adminAuth = (() => { const exports = {};\n${helper}\nreturn exports; })();\n` +
    (edge ? 'exports.handler = __adminAuth.createEdge();' :
      `const __adminUnique = (() => { const exports = {};\n${readFileSync(new URL('../lambda/admin-unique.cjs', import.meta.url), 'utf8')}\nreturn exports; })();\n` +
      readFileSync(new URL('../lambda/admin.cjs', import.meta.url), 'utf8'))
}
export class Admin extends Base {
  constructor(scope: Construct, p: Config) {
    super(scope, stacks.admin, p)
    Tags.of(this).add('Environment', 'admin')
    const zone = this.zone(), host = 'admin.flatgirl.net', bucket = this.bucket('admin')
    const certificate = new acm.Certificate(this, 'Certificate', { domainName: host, validation: acm.CertificateValidation.fromDns(zone) })
    const cache = new db.Table(this, 'Cache', { tableName: adminCache, partitionKey: { name: 'pk', type: db.AttributeType.STRING },
      sortKey: { name: 'sk', type: db.AttributeType.STRING }, billingMode: db.BillingMode.PAY_PER_REQUEST,
      encryption: db.TableEncryption.AWS_MANAGED, timeToLiveAttribute: 'ttl', removalPolicy: RemovalPolicy.RETAIN })
    const group = new logs.LogGroup(this, 'Logs', { logGroupName: `/aws/lambda/${adminFunction}`, retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE })
    const fn = new lambda.Function(this, 'Metrics', { functionName: adminFunction, runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64, handler: 'index.handler', code: lambda.Code.fromInline(adminCode()),
      memorySize: 512, timeout: Duration.seconds(28), reservedConcurrentExecutions: 2, logGroup: group,
      role: iam.Role.fromRoleArn(this, 'Runtime', `arn:aws:iam::${p.account}:role/${adminFunction}`, { mutable: false }),
      environment: { CACHE_TABLE: cache.tableName, ACCOUNT_ID: p.account } })
    const gateway = new api.HttpApi(this, 'Api', { apiName: adminFunction, createDefaultStage: false })
    gateway.addRoutes({ path: '/api/metrics', methods: [api.HttpMethod.GET], integration: new HttpLambdaIntegration('Read', fn) })
    gateway.addRoutes({ path: '/api/rollups/ensure', methods: [api.HttpMethod.POST], integration: new HttpLambdaIntegration('Ensure', fn) })
    new api.HttpStage(this, 'Stage', { httpApi: gateway, stageName: '$default', autoDeploy: true, throttle: { rateLimit: 5, burstLimit: 10 } })
    const source = adminCode(true)
    const edge = new lambda.CfnFunction(this, 'Auth', { functionName: adminEdge, runtime: 'nodejs24.x', architectures: ['x86_64'],
      handler: 'index.handler', code: { zipFile: source }, memorySize: 256, timeout: 5, role: `arn:aws:iam::${p.account}:role/${adminEdge}` })
    edge.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE)
    const version = new lambda.CfnVersion(this, `AuthVersion${codeHash(source)}`, { functionName: edge.ref })
    version.applyRemovalPolicy(RemovalPolicy.RETAIN)
    const edgeLambdas = [{ eventType: cf.LambdaEdgeEventType.VIEWER_REQUEST, functionVersion: lambda.Version.fromVersionArn(this, 'AuthPublished', `${edge.attrArn}:${version.attrVersion}`) }]
    const headers = new cf.ResponseHeadersPolicy(this, 'Headers', {
      customHeadersBehavior: { customHeaders: [{ header: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive', override: true }] },
      securityHeadersBehavior: { contentTypeOptions: { override: true }, frameOptions: { frameOption: cf.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cf.HeadersReferrerPolicy.NO_REFERRER, override: true }, strictTransportSecurity: { accessControlMaxAge: Duration.days(365), override: true } } })
    const distribution = new cf.Distribution(this, 'Distribution', { comment: 'Flat Girl admin', domainNames: [host], certificate,
      minimumProtocolVersion: cf.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: { origin: S3BucketOrigin.withOriginAccessControl(bucket), viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED, responseHeadersPolicy: headers, edgeLambdas, compress: true },
      additionalBehaviors: { '/api/*': { origin: new HttpOrigin(`${gateway.apiId}.execute-api.${p.region}.amazonaws.com`),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.HTTPS_ONLY, allowedMethods: cf.AllowedMethods.ALLOW_ALL,
        cachePolicy: cf.CachePolicy.CACHING_DISABLED, originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy: headers, edgeLambdas } },
      errorResponses: [403, 404].map(httpStatus => ({ httpStatus, ttl: Duration.seconds(0) })) })
    for (const [id, Record] of [['A', dns.ARecord], ['AAAA', dns.AaaaRecord]] as const) new Record(this, id, { zone, recordName: host, target: dns.RecordTarget.fromAlias(new CloudFrontTarget(distribution)) })
    this.output('SiteUrl', `https://${host}`); this.output('BucketName', bucket.bucketName)
    this.output('DistributionId', distribution.distributionId); this.output('DistributionDomainName', distribution.distributionDomainName)
    this.output('ApiOrigin', gateway.apiEndpoint); this.output('CacheTableName', cache.tableName); this.output('AuthParameterName', adminParameter)
  }
}
