import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { config } from '../lib/config.js'
import { createRequire } from 'node:module'
const router = createRequire(import.meta.url)('../lambda/edge-router.cjs')
import { Certificates, Images, Site } from '../lib/stacks.js'
import { Access } from '../lib/access.js'
const p=config({account:'111111111111',region:'us-east-1',hostedZoneId:'ZEXAMPLE',domain:'flatgirl.net',operatorPrincipalArn:null,betaEnabled:true,productionNoindex:true})

function runner(beta=false, fail=false) {
  const authorization='Basic '+Buffer.from('reviewer:a-long-random-test-password').toString('base64')
  const handler=router.createHandler(beta?'beta':'production',{readCredential:async()=>{
    if(fail)throw Error('unavailable')
    return crypto.createHash('sha256').update(authorization).digest('hex')
  }})
  return {run:(uri:string,host=beta?'beta.flatgirl.net':'flatgirl.net',auth?:string,query='')=>handler({Records:[{cf:{request:{uri,
    headers:{host:[{value:host}],...(auth?{authorization:[{value:auth}]}:{})},querystring:query}}}]}),authorization}
}
test('routing preserves assets and repeated encoded campaign values',async()=>{
  const {run}=runner()
  assert.equal((await run('/_nuxt/app.js')).uri,'/_nuxt/app.js')
  assert.equal((await run('/missing.js')).uri,'/missing.js')
  assert.equal((await run('/offer','flatgirl.net',undefined,'utm_source=a%2Bb&x=1&x=')).headers.location[0].value,'https://flatgirl.net/?utm_source=a%2Bb&x=1&x=')
  assert.equal((await run('/_nuxt/app.js','www.flatgirl.net')).headers.location[0].value,'https://flatgirl.net/_nuxt/app.js')
  for(const path of ['/variants/a.webp','/.env','/%2e%2e/secret']) assert.equal((await run(path)).status,'404')
  assert.equal((await run('/index.html')).headers.location[0].value,'https://flatgirl.net/')
})
test('beta authenticates every path and raw hostname, strips credentials, and fails closed',async()=>{
  const {run,authorization}=runner(true)
  for(const path of ['/','/_nuxt/app.js','/robots.txt']) {
    assert.equal((await run(path)).status,'401')
    assert.equal((await run(path,'beta.flatgirl.net','Basic invalid')).status,'401')
    const valid=await run(path,'beta.flatgirl.net',authorization)
    assert.equal(valid.headers.authorization,undefined)
    assert.equal((await run(path)).status,'401')
  }
  assert.equal((await run('/','distribution.cloudfront.net')).status,'401')
  assert.equal((await run('/','distribution.cloudfront.net',authorization)).headers.location[0].value,'https://beta.flatgirl.net/')
  assert.equal((await runner(true,true).run('/','beta.flatgirl.net',authorization)).status,'503')
})
test('private retained origins; independent sites; no embedded credential',()=>{
  const app=new App();new Access(app,p);const cert=new Certificates(app,p);const images=new Images(app,p)
  const beta=new Site(app,p,'beta',cert.certificate),prod=new Site(app,p,'production',cert.certificate)
  for(const stack of [images,beta,prod]) {
    const template=Template.fromStack(stack)
    template.hasResourceProperties('AWS::S3::Bucket',{VersioningConfiguration:{Status:'Enabled'},PublicAccessBlockConfiguration:{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true}})
    for(const resource of Object.values(template.toJSON().Resources) as any[]) if(resource.Type==='AWS::S3::Bucket')assert.equal(resource.DeletionPolicy,'Retain')
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl',{OriginAccessControlConfig:{SigningBehavior:'always',OriginAccessControlOriginType:'s3'}})
  }
  Template.fromStack(images).resourceCountIs('AWS::S3::Bucket',2)
  Template.fromStack(beta).resourceCountIs('AWS::CloudFront::KeyValueStore',1)
  Template.fromStack(prod).resourceCountIs('AWS::CloudFront::KeyValueStore',0)
  assert.ok(!JSON.stringify(Template.fromStack(prod).toJSON()).includes('FlatGirlBeta'))
  assert.ok(!JSON.stringify(Template.fromStack(beta).toJSON()).includes('BasicAuthPassword'))
  Template.fromStack(beta).resourceCountIs('AWS::CloudFront::Function',0)
  Template.fromStack(prod).resourceCountIs('AWS::CloudFront::Function',0)
  const access=Template.fromStack(app.node.findChild('FlatGirlAccess') as Access).toJSON()
  assert.ok(!JSON.stringify(access).includes('token.actions.githubusercontent.com'))
  const assembly=app.synth()
  assert.equal(assembly.stacks.length,5)
})

test('beta auth cache expires and fails closed, while production never requests credentials',async()=>{
  let now=0, reads=0
  const digest=crypto.createHash('sha256').update('Basic valid').digest('hex')
  const reader=router.credentialReader({now:()=>now,read:async()=>{if(++reads>1)throw Error('unavailable');return digest}})
  assert.equal(await reader(new AbortController().signal),digest)
  assert.equal(await reader(new AbortController().signal),digest)
  assert.equal(reads,1)
  now=60001
  await assert.rejects(reader(new AbortController().signal))
  const production=router.createHandler('production',{readCredential:async()=>{throw Error('must not read')}})
  const request={uri:'/',querystring:'',headers:{host:[{value:'flatgirl.net'}]}}
  assert.equal(await production({Records:[{cf:{request}}]}),request)
})
