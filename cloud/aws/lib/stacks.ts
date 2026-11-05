import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as cf from 'aws-cdk-lib/aws-cloudfront'
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as dns from 'aws-cdk-lib/aws-route53'
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'
import { bucketName, roleArn, stacks, type Config } from './config.js'
import { routeCode } from './routes.js'
import { StaticSynthesizer } from './static-synthesizer.js'

export class Base extends Stack {
  constructor(scope: Construct, id: string, public readonly project: Config, access = false) {
    super(scope, id, {env:{account:project.account,region:project.region}, terminationProtection:true,
      synthesizer:new StaticSynthesizer(access ? undefined : roleArn(project,'cloudformation'))})
    Tags.of(this).add('Project','FlatGirl')
  }
  bucket(kind: string) {
    return new s3.Bucket(this, kind, {bucketName:bucketName(this.project,kind),
      blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL, objectOwnership:s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption:s3.BucketEncryption.S3_MANAGED, enforceSSL:true, versioned:true, removalPolicy:RemovalPolicy.RETAIN})
  }
  zone() { return dns.HostedZone.fromHostedZoneAttributes(this,'Zone', {hostedZoneId:this.project.hostedZoneId,zoneName:this.project.domain}) }
  output(key: string, value: string) { new CfnOutput(this,key,{value}) }
}

export class Certificates extends Base {
  readonly certificate: acm.Certificate
  constructor(scope: Construct, p: Config) {
    super(scope,stacks.certificates,p)
    this.certificate = new acm.Certificate(this,'Certificate',{domainName:p.domain,
      subjectAlternativeNames:[`www.${p.domain}`,`beta.${p.domain}`], validation:acm.CertificateValidation.fromDns(this.zone())})
    this.certificate.applyRemovalPolicy(RemovalPolicy.RETAIN)
    this.output('CertificateArn',this.certificate.certificateArn)
  }
}
export class Images extends Base {
  constructor(scope: Construct, p: Config) {
    super(scope,stacks.images,p)
    const sources=this.bucket('sources'), variants=this.bucket('variants')
    variants.addToResourcePolicy(new iam.PolicyStatement({effect:iam.Effect.DENY,principals:[new iam.AnyPrincipal()],
      actions:['s3:PutObject'],resources:[variants.arnForObjects('variants/*')],conditions:{StringNotEquals:{'s3:if-none-match':'*'}}}))
    const distribution=new cf.Distribution(this,'Distribution',{comment:'Flat Girl shared processed images',
      defaultBehavior:{origin:S3BucketOrigin.withOriginAccessControl(variants),viewerProtocolPolicy:cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods:cf.AllowedMethods.ALLOW_GET_HEAD,cachePolicy:cf.CachePolicy.CACHING_OPTIMIZED},
      errorResponses:[403,404].map(httpStatus=>({httpStatus,ttl:Duration.seconds(0)}))})
    this.output('SourceBucketName',sources.bucketName); this.output('VariantsBucketName',variants.bucketName)
    this.output('ImageBaseUrl',`https://${distribution.distributionDomainName}`); this.output('DistributionId',distribution.distributionId)
  }
}
export class Site extends Base {
  constructor(scope: Construct, p: Config, env: 'beta'|'production', certificate: acm.ICertificate) {
    super(scope,stacks[env],p)
    const beta=env==='beta', host=beta?`beta.${p.domain}`:p.domain, bucket=this.bucket(env)
    Tags.of(this).add('Environment',env)
    const kvs=beta?new cf.KeyValueStore(this,'Auth',{keyValueStoreName:'flat-girl-beta-auth'}):undefined
    if(kvs) kvs.applyRemovalPolicy(RemovalPolicy.RETAIN)
    const routes=new cf.Function(this,'Routes',{functionName:`flat-girl-${env}-routes`,runtime:cf.FunctionRuntime.JS_2_0,
      code:cf.FunctionCode.fromInline(routeCode(host,beta)),keyValueStore:kvs})
    const custom: cf.ResponseHeadersPolicyProps['customHeadersBehavior']={customHeaders:[]}
    if(beta || p.productionNoindex) custom.customHeaders.push({header:'X-Robots-Tag',value:'noindex, nofollow, noarchive',override:true})
    if(beta) custom.customHeaders.push({header:'Cache-Control',value:'no-store',override:true})
    const headers=new cf.ResponseHeadersPolicy(this,'Headers',{customHeadersBehavior:custom.customHeaders.length?custom:undefined,
      securityHeadersBehavior:{contentTypeOptions:{override:true},frameOptions:{frameOption:cf.HeadersFrameOption.DENY,override:true},
        referrerPolicy:{referrerPolicy:cf.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,override:true},
        strictTransportSecurity:{accessControlMaxAge:Duration.days(365),override:true}}})
    const cache=beta?cf.CachePolicy.CACHING_DISABLED:new cf.CachePolicy(this,'Cache',{minTtl:Duration.seconds(0),defaultTtl:Duration.seconds(60),maxTtl:Duration.days(365),
      enableAcceptEncodingBrotli:true,enableAcceptEncodingGzip:true})
    const domains=beta?[host]:[host,`www.${host}`]
    const distribution=new cf.Distribution(this,'Distribution',{comment:`Flat Girl ${env}`,enabled:beta?p.betaEnabled:true,
      domainNames:domains,certificate,defaultRootObject:'index.html',minimumProtocolVersion:cf.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior:{origin:S3BucketOrigin.withOriginAccessControl(bucket),viewerProtocolPolicy:cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods:cf.AllowedMethods.ALLOW_GET_HEAD,compress:true,cachePolicy:cache,responseHeadersPolicy:headers,
        functionAssociations:[{eventType:cf.FunctionEventType.VIEWER_REQUEST,function:routes}]},
      errorResponses:[403,404].map(httpStatus=>({httpStatus,ttl:Duration.seconds(0)}))})
    const zone=this.zone()
    domains.forEach((name,i)=>{const props={zone,recordName:name,target:dns.RecordTarget.fromAlias(new CloudFrontTarget(distribution))};
      new dns.ARecord(this,`A${i}`,props);new dns.AaaaRecord(this,`AAAA${i}`,props)})
    this.output('SiteUrl',`https://${host}`);this.output('BucketName',bucket.bucketName)
    this.output('DistributionId',distribution.distributionId);this.output('DistributionDomainName',distribution.distributionDomainName)
    if(kvs) this.output('AuthStoreArn',kvs.keyValueStoreArn)
  }
}
