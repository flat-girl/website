import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'
import { RemovalPolicy } from 'aws-cdk-lib'
import { Base } from './stacks.js'
import { bucketName, roleArn, stacks, type Config } from './config.js'
import { signupNames, signupParameters } from './signup-config.js'

export class Access extends Base {
  constructor(scope: Construct,p: Config) {
    super(scope,stacks.access,p,true)
    let human: iam.User | undefined
    if (!p.operatorPrincipalArn) {
      human=new iam.User(this,'HumanOperator',{userName:'flat-girl-operator'})
      human.applyRemovalPolicy(RemovalPolicy.RETAIN)
      human.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SignInLocalDevelopmentAccess'))
      human.addToPolicy(new iam.PolicyStatement({actions:['iam:GetUser','iam:ChangePassword','iam:ListMFADevices'],resources:[human.userArn]}))
      human.addToPolicy(new iam.PolicyStatement({actions:['iam:GetAccountPasswordPolicy'],resources:['*']}))
      this.output('HumanOperatorArn',human.userArn)
    }
    const trust=new iam.ArnPrincipal(p.operatorPrincipalArn || human!.userArn)
    const execution=new iam.Role(this,'Execution',{roleName:'flat-girl-cloudformation',assumedBy:new iam.ServicePrincipal('cloudformation.amazonaws.com')})
    const operator=new iam.Role(this,'Operator',{roleName:'flat-girl-operator',assumedBy:trust,maxSessionDuration: undefined})
    if(human) human.addToPolicy(new iam.PolicyStatement({actions:['sts:AssumeRole'],resources:[operator.roleArn]}))
    const statement=(actions:string[],resources:string[],conditions?:Record<string,any>)=>new iam.PolicyStatement({actions,resources,conditions})
    const stackArns=Object.entries(stacks).filter(([key])=>key!=='access').map(([,name])=>`arn:aws:cloudformation:${p.region}:${p.account}:stack/${name}/*`)
    operator.addToPolicy(statement(['cloudformation:*'],stackArns))
    operator.addToPolicy(statement(['iam:PassRole'],[execution.roleArn],{StringEquals:{'iam:PassedToService':'cloudformation.amazonaws.com'}}))
    operator.addToPolicy(statement(['cloudfront:DescribeKeyValueStore'],[`arn:aws:cloudfront::${p.account}:key-value-store/*`]))
    operator.addToPolicy(statement(['cloudfront-keyvaluestore:DescribeKeyValueStore','cloudfront-keyvaluestore:PutKey'],[`arn:aws:cloudfront::${p.account}:key-value-store/*`]))
    const buckets=['sources','variants','beta','production'].map(kind=>`arn:aws:s3:::${bucketName(p,kind)}`)
    execution.addToPolicy(statement(['s3:*'],buckets.flatMap(arn=>[arn,`${arn}/*`])))
    execution.addToPolicy(statement(['route53:GetHostedZone','route53:ListResourceRecordSets'],[`arn:aws:route53:::hostedzone/${p.hostedZoneId}`]))
    execution.addToPolicy(statement(['route53:ChangeResourceRecordSets'],[`arn:aws:route53:::hostedzone/${p.hostedZoneId}`],{
      'ForAllValues:StringLike':{'route53:ChangeResourceRecordSetsNormalizedRecordNames':[p.domain,`www.${p.domain}`,`beta.${p.domain}`,`api.${p.domain}`,`beta-api.${p.domain}`,`_*.${p.domain}`,`_*.www.${p.domain}`,`_*.beta.${p.domain}`,`_*.api.${p.domain}`,`_*.beta-api.${p.domain}`]},
      'ForAllValues:StringEquals':{'route53:ChangeResourceRecordSetsRecordTypes':['A','AAAA','CNAME']}}))
    execution.addToPolicy(statement(['route53:GetChange'],['arn:aws:route53:::change/*']))
    execution.addToPolicy(statement(['acm:*'],[`arn:aws:acm:${p.region}:${p.account}:certificate/*`]))
    execution.addToPolicy(statement(['acm:RequestCertificate','acm:ListCertificates'],['*'],{StringEquals:{'aws:RequestedRegion':p.region}}))
    // CloudFront policy/OAC creation and lifecycle APIs cannot all be restricted by project tags.
    execution.addToPolicy(statement(['cloudfront:*'],[`arn:aws:cloudfront::${p.account}:*`]))
    execution.addToPolicy(statement(['cloudfront:Create*','cloudfront:List*'],['*']))
    const discovery=statement(['cloudformation:DescribeStacks','cloudformation:GetTemplate','cloudformation:DescribeStackEvents'],stackArns)
    operator.addToPolicy(statement(['route53:GetHostedZone','route53:ListResourceRecordSets'],[`arn:aws:route53:::hostedzone/${p.hostedZoneId}`]))
    operator.addToPolicy(statement(['route53:ListHostedZonesByName','cloudfront:ListDistributions','acm:ListCertificates'],['*']))
    operator.addToPolicy(statement(['cloudfront:GetDistribution','cloudfront:GetDistributionConfig'],[`arn:aws:cloudfront::${p.account}:distribution/*`]))
    for(const env of ['beta','production']) {
      const role=new iam.Role(this,`${env}Publisher`,{roleName:`flat-girl-${env}-publisher`,assumedBy:new iam.CompositePrincipal(trust,new iam.ArnPrincipal(operator.roleArn))})
      const site=`arn:aws:s3:::${bucketName(p,env)}`, sources=buckets[0],variants=buckets[1]
      role.addToPolicy(discovery)
      role.addToPolicy(statement(['s3:GetBucketLocation','s3:ListBucket'],[site,sources,variants]))
      role.addToPolicy(statement(['s3:GetObject','s3:GetObjectVersion'],[`${sources}/sources/*`,`${sources}/releases/${env}/*`,`${variants}/variants/*`,`${site}/*`]))
      role.addToPolicy(statement(['s3:PutObject'],[`${sources}/releases/${env}/*`,`${variants}/variants/*`,`${site}/*`]))
      role.addToPolicy(new iam.PolicyStatement({effect:iam.Effect.DENY,actions:['s3:DeleteObject','s3:DeleteObjectVersion'],resources:[`${sources}/*`,`${variants}/*`,`${site}/*`]}))
      role.addToPolicy(statement(['cloudfront:GetDistribution','cloudfront:GetDistributionConfig','cloudfront:CreateInvalidation','cloudfront:GetInvalidation'],[`arn:aws:cloudfront::${p.account}:distribution/*`],{
        StringEquals:{'aws:ResourceTag/Project':'FlatGirl','aws:ResourceTag/Environment':env}}))
      operator.addToPolicy(statement(['sts:AssumeRole'],[role.roleArn]))
      this.output(`${env}PublisherRoleArn`,role.roleArn)
    }
    operator.addToPolicy(statement(['s3:ListBucket','s3:GetBucketLocation'],[buckets[0],buckets[1]]))
    operator.addToPolicy(statement(['s3:GetObject','s3:PutObject'],[`${buckets[0]}/sources/*`,`${buckets[1]}/variants/*`]))
    const parameters=Object.values(signupParameters).map(name=>`arn:aws:ssm:${p.region}:${p.account}:parameter${name}`)
    operator.addToPolicy(statement(['ssm:GetParameter','ssm:PutParameter'],parameters))
    // Both environments intentionally use the same provider keys; publishers cannot read them.
    for(const env of ['beta','production'] as const) {
      const names=signupNames(env)
      const logs=`arn:aws:logs:${p.region}:${p.account}:log-group:${names.logs}`
      const functionArn=`arn:aws:lambda:${p.region}:${p.account}:function:${names.function}`
      const runtime=new iam.Role(this,`${env}SignupRuntime`,{roleName:names.role,assumedBy:new iam.ServicePrincipal('lambda.amazonaws.com')})
      runtime.addToPolicy(statement(['ssm:GetParameter'],parameters))
      runtime.addToPolicy(statement(['logs:CreateLogStream','logs:PutLogEvents'],[`${logs}:*`]))
      execution.addToPolicy(statement(['iam:PassRole'],[runtime.roleArn],{StringEquals:{'iam:PassedToService':'lambda.amazonaws.com'}}))
      execution.addToPolicy(statement(['lambda:CreateFunction','lambda:DeleteFunction','lambda:GetFunction','lambda:GetFunctionConfiguration',
        'lambda:UpdateFunctionCode','lambda:UpdateFunctionConfiguration','lambda:AddPermission','lambda:RemovePermission','lambda:GetPolicy',
        'lambda:TagResource','lambda:UntagResource','lambda:ListTags','lambda:PutFunctionConcurrency','lambda:DeleteFunctionConcurrency'],[functionArn,`${functionArn}:*`]))
      execution.addToPolicy(statement(['logs:CreateLogGroup','logs:DeleteLogGroup','logs:PutRetentionPolicy','logs:DeleteRetentionPolicy',
        'logs:PutMetricFilter','logs:DeleteMetricFilter','logs:DescribeMetricFilters','logs:TagResource','logs:UntagResource','logs:ListTagsForResource',
        'logs:TagLogGroup','logs:UntagLogGroup','logs:ListTagsLogGroup'],[logs,`${logs}:*`]))
      execution.addToPolicy(statement(['cloudwatch:PutMetricAlarm','cloudwatch:DeleteAlarms','cloudwatch:DescribeAlarms',
        'cloudwatch:TagResource','cloudwatch:UntagResource','cloudwatch:ListTagsForResource'],[`arn:aws:cloudwatch:${p.region}:${p.account}:alarm:flat-girl-${env}-signup-*`]))
      operator.addToPolicy(statement(['lambda:GetFunctionConfiguration'],[functionArn]))
      operator.addToPolicy(statement(['logs:FilterLogEvents'],[`${logs}:*`]))
    }
    execution.addToPolicy(statement(['logs:DescribeLogGroups'],['*']))
    // API IDs are generated; API Gateway control-plane ARNs have no account component.
    // Stage resource handlers require named tagging actions in addition to HTTP verbs.
    execution.addToPolicy(statement(['apigateway:GET','apigateway:POST','apigateway:PUT','apigateway:PATCH','apigateway:DELETE',
      'apigateway:TagResource','apigateway:UntagResource'],[
      `arn:aws:apigateway:${p.region}::/apis`, `arn:aws:apigateway:${p.region}::/apis/*`,
      `arn:aws:apigateway:${p.region}::/domainnames`,
      `arn:aws:apigateway:${p.region}::/domainnames/api.${p.domain}`,`arn:aws:apigateway:${p.region}::/domainnames/api.${p.domain}/*`,
      `arn:aws:apigateway:${p.region}::/domainnames/beta-api.${p.domain}`,`arn:aws:apigateway:${p.region}::/domainnames/beta-api.${p.domain}/*`,
      `arn:aws:apigateway:${p.region}::/tags/*`,
    ]))
    // DomainName handlers also authorize certificate attachment/removal explicitly.
    execution.addToPolicy(statement(['apigateway:AddCertificateToDomain','apigateway:RemoveCertificateFromDomain'],[
      `arn:aws:apigateway:${p.region}::/domainnames/api.${p.domain}`,
      `arn:aws:apigateway:${p.region}::/domainnames/beta-api.${p.domain}`,
    ]))
    // API Gateway may create its AWS-managed service-linked role on first use.
    execution.addToPolicy(statement(['iam:CreateServiceLinkedRole'],[
      `arn:aws:iam::${p.account}:role/aws-service-role/ops.apigateway.amazonaws.com/AWSServiceRoleForAPIGateway`
    ],{StringEquals:{'iam:AWSServiceName':'ops.apigateway.amazonaws.com'}}))
    operator.addToPolicy(statement(['cloudwatch:DescribeAlarms'],['*']))
    this.output('OperatorRoleArn',operator.roleArn);this.output('ExecutionRoleArn',execution.roleArn)
  }
}
