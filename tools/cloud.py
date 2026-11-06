"""User-run infrastructure commands; diff/preflight never write AWS."""
import argparse
import base64
from datetime import datetime,timezone
import difflib
import getpass
import hashlib
import json
import shutil
import subprocess
import sys
from aws_common import AWS,AwsError,STACKS,project
from prepare_images import ROOT,write_json

def synth():
    subprocess.run(['npm','run','synth','--prefix','cloud/aws'],cwd=ROOT,check=True)

def preflight(aws):
    p=aws.p
    zone=aws.call('route53','get-hosted-zone',Id=p['hostedZoneId'])
    if zone['HostedZone']['Name']!=p['domain']+'.' or zone['HostedZone']['Config']['PrivateZone']:
        raise ValueError('Hosted zone is not the public Flat Girl zone')
    records=aws.call('route53','list-resource-record-sets',HostedZoneId=p['hostedZoneId'])
    delegation=None
    if shutil.which('dig'):
        lookup=subprocess.run(['dig','+short','NS',p['domain']],capture_output=True,text=True,check=True)
        delegation=sorted(line.rstrip('.').lower() for line in lookup.stdout.splitlines() if line.strip())
        expected=sorted(name.lower() for name in zone['DelegationSet']['NameServers'])
        if delegation!=expected:raise ValueError('Public domain delegation differs from the selected Route 53 hosted zone')
    distributions=aws.call('cloudfront','list-distributions').get('DistributionList',{}).get('Items',[])
    matches=[dict(id=d['Id'],aliases=d.get('Aliases',{}).get('Items',[])) for d in distributions
             if any(host in d.get('Aliases',{}).get('Items',[]) for host in (p['domain'],'www.'+p['domain'],'beta.'+p['domain']))]
    report=dict(time=datetime.now(timezone.utc).isoformat(),identity=aws.identity,zone=zone,dns=records,delegation=delegation,existingDistributions=matches)
    write_json(ROOT/'.deploy/preflight.json',report)
    print(f"Account {p['account']}; zone {p['hostedZoneId']}; {len(matches)} matching distributions. Snapshot: .deploy/preflight.json")
    if aws.identity['Arn'].endswith(':root'): print('Discovery identity is root; configure a project operator before normal deployment.')

def auth(aws):
    aws.writer()
    store=aws.outputs('beta')['AuthStoreArn']
    username=input('Beta username: ').strip()
    password=getpass.getpass('Beta password: ')
    confirm=getpass.getpass('Repeat beta password: ')
    if not username or ':' in username or any(c in username for c in '\r\n'):
        raise ValueError('Enter a username without colons or line breaks')
    if not password or any(c in password for c in '\r\n'):
        raise ValueError('Enter a nonempty password without line breaks')
    if password!=confirm:
        raise ValueError('Passwords do not match')
    value='Basic '+base64.b64encode((username+':'+password).encode()).decode()
    digest=hashlib.sha256(value.encode()).hexdigest()
    description=aws.call('cloudfront-keyvaluestore','describe-key-value-store',KvsARN=store)
    aws.call('cloudfront-keyvaluestore','put-key',KvsARN=store,Key='authorization-sha256',Value=digest,IfMatch=description['ETag'])
    print('Beta credential updated. Verify new access and old-credential rejection after propagation.')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['preflight','diff','deploy','beta-enabled','auth'])
    parser.add_argument('action',nargs='?',choices=['set'])
    parser.add_argument('--profile',required=True)
    parser.add_argument('--stack',choices=list(STACKS))
    parser.add_argument('--read-only',action='store_true')
    parser.add_argument('--value',choices=['true','false'])
    parser.add_argument('--bootstrap',action='store_true',help='Explicit administrator access-stack bootstrap (root allowed only here)')
    args=parser.parse_args()
    p=project();aws=AWS(args.profile,p,read_only=args.command in ('preflight','diff') or args.read_only)
    if args.command=='preflight': return preflight(aws)
    if args.command=='auth': return auth(aws)
    if args.command=='beta-enabled':
        if args.value is None: parser.error('--value is required')
        args.stack='beta';p['betaEnabled']=args.value=='true'
        write_json(ROOT/'cloud/aws/project.json',p)
    if not args.stack: parser.error('--stack is required')
    if args.command=='deploy' and args.stack=='access' and not args.bootstrap:
        parser.error('Use --bootstrap for administrator-managed access setup')
    synth()
    template=ROOT/'cloud/aws/cdk.out'/f'{STACKS[args.stack]}.template.json'
    proposed=json.loads(template.read_text())
    if args.command=='diff':
        try:
            old=aws.call('cloudformation','get-template',StackName=STACKS[args.stack])['TemplateBody']
            if isinstance(old,str): old=json.loads(old)
        except AwsError as error:
            if error.code!='ValidationError': raise
            old={}
        print('\n'.join(difflib.unified_diff(json.dumps(old,indent=2,sort_keys=True).splitlines(),json.dumps(proposed,indent=2,sort_keys=True).splitlines(),fromfile='deployed',tofile='proposed')))
        return
    if not (args.stack=='access' and args.bootstrap): aws.writer()
    # Run through CloudFormation with the reviewed dedicated execution role; no implicit stack dependencies.
    command=['aws','--profile',args.profile,'--region',p['region'],'--no-cli-pager','cloudformation','deploy',
             '--stack-name',STACKS[args.stack],'--template-file',str(template),'--no-fail-on-empty-changeset']
    if args.stack=='access':command+=['--capabilities','CAPABILITY_NAMED_IAM']
    else:command+=['--role-arn',f"arn:aws:iam::{p['account']}:role/flat-girl-cloudformation"]
    if args.read_only: raise ValueError('--read-only forbids deployment')
    subprocess.run(command,check=True,env=aws.env)
    aws.call('cloudformation','update-termination-protection',StackName=STACKS[args.stack],EnableTerminationProtection=True)
    print(f'{STACKS[args.stack]} deployed; publication and live verification are separate.')

if __name__=='__main__':
    try:main()
    except (ValueError,RuntimeError,OSError,subprocess.CalledProcessError) as error:sys.exit(str(error))
