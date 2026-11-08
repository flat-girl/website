import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'
import type { Config } from './config.js'
import { bucketName } from './config.js'
import { adminCache, adminEdge, adminFunction, adminParameter } from './admin-stack.js'
export function adminAccess(scope: Construct, p: Config, operator: iam.Role, execution: iam.Role, trust: iam.IPrincipal) {
  const grant = (role: iam.Role, actions: string[], resources: string[], conditions?: Record<string, any>) => role.addToPolicy(new iam.PolicyStatement({ actions, resources, conditions }))
  const arn = (service: string, resource: string) => `arn:aws:${service}:${p.region}:${p.account}:${resource}`
  const parameter = arn('ssm', `parameter${adminParameter}`), cache = arn('dynamodb', `table/${adminCache}`)
  const runtime = new iam.Role(scope, 'AdminRuntime', { roleName: adminFunction, assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') })
  const edge = new iam.Role(scope, 'AdminEdgeRuntime', { roleName: adminEdge, assumedBy: new iam.CompositePrincipal(new iam.ServicePrincipal('lambda.amazonaws.com'), new iam.ServicePrincipal('edgelambda.amazonaws.com')) })
  grant(runtime, ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:ConditionCheckItem'], [cache])
  grant(runtime, ['dynamodb:Scan'], ['beta', 'production'].map(env => arn('dynamodb', `table/flat-girl-${env}-events`)), {
    'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['event_id', 'event_name', 'event_time', 'environment', 'client_ip_address', 'client_user_agent'] },
    StringEquals: { 'dynamodb:Select': 'SPECIFIC_ATTRIBUTES' },
    Null: { 'dynamodb:Attributes': 'false' },
  })
  grant(runtime, ['sqs:GetQueueAttributes'], ['beta', 'production'].map(env => arn('sqs', `flat-girl-${env}-meta-dlq`)))
  for (const role of [runtime, edge]) grant(role, ['ssm:GetParameter'], [parameter])
  grant(runtime, ['logs:CreateLogStream', 'logs:PutLogEvents'], [arn('logs', `log-group:/aws/lambda/${adminFunction}:*`)])
  grant(edge, ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'], [
    `arn:aws:logs:*:${p.account}:log-group:/aws/lambda/us-east-1.${adminEdge}:*`, arn('logs', `log-group:/aws/lambda/${adminEdge}:*`),
  ])
  grant(operator, ['ssm:GetParameter', 'ssm:PutParameter'], [parameter])
  grant(execution, ['iam:PassRole'], [runtime.roleArn, edge.roleArn], { StringEquals: { 'iam:PassedToService': 'lambda.amazonaws.com' } })
  const functions = [adminFunction, adminEdge].flatMap(name => [arn('lambda', `function:${name}`), arn('lambda', `function:${name}:*`)])
  grant(execution, ['lambda:CreateFunction', 'lambda:DeleteFunction', 'lambda:GetFunction', 'lambda:GetFunctionConfiguration', 'lambda:UpdateFunctionCode', 'lambda:UpdateFunctionConfiguration',
    'lambda:AddPermission', 'lambda:RemovePermission', 'lambda:GetPolicy', 'lambda:PublishVersion', 'lambda:ListVersionsByFunction', 'lambda:TagResource', 'lambda:UntagResource', 'lambda:ListTags',
    'lambda:PutFunctionConcurrency', 'lambda:DeleteFunctionConcurrency', 'lambda:EnableReplication*', 'lambda:DisableReplication*'], functions)
  grant(execution, ['dynamodb:CreateTable', 'dynamodb:DeleteTable', 'dynamodb:DescribeTable', 'dynamodb:UpdateTable', 'dynamodb:DescribeContinuousBackups',
    'dynamodb:DescribeTimeToLive', 'dynamodb:UpdateTimeToLive', 'dynamodb:DescribeContributorInsights', 'dynamodb:DescribeKinesisStreamingDestination', 'dynamodb:TagResource', 'dynamodb:UntagResource', 'dynamodb:ListTagsOfResource'], [cache])
  const log = arn('logs', `log-group:/aws/lambda/${adminFunction}`)
  grant(execution, ['logs:CreateLogGroup', 'logs:DeleteLogGroup', 'logs:PutRetentionPolicy', 'logs:DeleteRetentionPolicy', 'logs:TagResource', 'logs:UntagResource', 'logs:ListTagsForResource', 'logs:TagLogGroup', 'logs:UntagLogGroup', 'logs:ListTagsLogGroup'], [log, `${log}:*`])
  grant(execution, ['route53:ChangeResourceRecordSets'], [`arn:aws:route53:::hostedzone/${p.hostedZoneId}`], {
    'ForAllValues:StringLike': { 'route53:ChangeResourceRecordSetsNormalizedRecordNames': ['admin.flatgirl.net', '_*.admin.flatgirl.net'] },
    'ForAllValues:StringEquals': { 'route53:ChangeResourceRecordSetsRecordTypes': ['A', 'AAAA', 'CNAME'] },
  })
  const site = `arn:aws:s3:::${bucketName(p, 'admin')}`
  grant(execution, ['s3:*'], [site, `${site}/*`])
  const publisher = new iam.Role(scope, 'AdminPublisher', { roleName: 'flat-girl-admin-publisher', assumedBy: new iam.CompositePrincipal(trust, new iam.ArnPrincipal(operator.roleArn)) })
  grant(publisher, ['cloudformation:DescribeStacks'], [arn('cloudformation', 'stack/FlatGirlAdmin/*')])
  grant(publisher, ['s3:GetBucketLocation', 's3:ListBucket'], [site])
  grant(publisher, ['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject'], [`${site}/*`])
  publisher.addToPolicy(new iam.PolicyStatement({ effect: iam.Effect.DENY, actions: ['s3:DeleteObject', 's3:DeleteObjectVersion'], resources: [`${site}/*`] }))
  grant(publisher, ['cloudfront:GetDistribution', 'cloudfront:GetDistributionConfig', 'cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'], [`arn:aws:cloudfront::${p.account}:distribution/*`],
    { StringEquals: { 'aws:ResourceTag/Project': 'FlatGirl', 'aws:ResourceTag/Environment': 'admin' } })
  grant(operator, ['sts:AssumeRole'], [publisher.roleArn])
  return publisher
}
