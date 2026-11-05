"""Small AWS CLI adapter. No credentials or sensitive input in command arguments."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from prepare_images import ROOT, write_json

STACKS=dict(access='FlatGirlAccess',certificates='FlatGirlCertificates',images='FlatGirlImages',beta='FlatGirlBetaSite',production='FlatGirlProductionSite')

def project():
    path=ROOT/'cloud/aws/project.json'
    if not path.exists(): raise ValueError('Create cloud/aws/project.json from project.example.json; see cloud/ACCESS.md')
    p=json.loads(path.read_text())
    if not re.fullmatch(r'\d{12}',p.get('account','')) or p['account']=='111111111111' or p.get('region')!='us-east-1' or p.get('domain')!='flatgirl.net' or not re.fullmatch(r'Z[A-Z0-9]+',p.get('hostedZoneId','')) or p['hostedZoneId']=='ZEXAMPLE':
        raise ValueError('Unresolved or invalid project configuration')
    return p

def bucket(p,kind): return f"flat-girl-{kind}-{p['account']}-{p['region']}"

class AwsError(RuntimeError):
    def __init__(self,service,operation,error):
        match=re.search(r'\(([^)]+)\)',error)
        self.code=match.group(1) if match else 'CLIError'
        super().__init__(f'{service}.{operation} failed ({self.code}); check session, permissions and resource state')

class AWS:
    def __init__(self,profile,p,read_only=False):
        self.profile,self.p,self.read_only=profile,p,read_only
        self.env=dict(os.environ,AWS_STS_REGIONAL_ENDPOINTS='regional',AWS_PAGER='')
        self.identity=self.call('sts','get-caller-identity')
        if self.identity.get('Account')!=p['account']: raise ValueError('AWS account does not match project configuration')
    def call(self,service,operation,**kwargs):
        reads=('get-','list-','describe-','head-','lookup-')
        if self.read_only and not operation.startswith(reads): raise ValueError('AWS writes are disabled for this command')
        body=kwargs.pop('_body',None)
        args=['aws','--profile',self.profile,'--region',self.p['region'],'--no-cli-pager',service,operation,'--output','json']
        if body is not None:args+=['--body',body]
        # This installed CLI rejects /dev/stdin JSON. A private temporary file keeps
        # values out of argv; it is closed/unlinked even on errors. Never pass passwords here.
        with tempfile.NamedTemporaryFile(mode='w',suffix='.json') as payload:
            if kwargs:
                json.dump(kwargs,payload);payload.flush()
                args+=['--cli-input-json','file://'+payload.name]
            result=subprocess.run(args,text=True,capture_output=True,env=self.env)
        if result.returncode: raise AwsError(service,operation,result.stderr)
        return json.loads(result.stdout) if result.stdout.strip() else {}
    def writer(self,kind=None):
        # Recheck immediately before writes, including after long builds.
        who=self.call('sts','get-caller-identity')
        if who.get('Account')!=self.p['account'] or who.get('Arn','').endswith(':root'):
            raise ValueError('Use a non-root project session for publication and infrastructure changes')
        if kind and not re.search(rf':assumed-role/flat-girl-{kind}-publisher/',who['Arn']):
            raise ValueError(f'Use the flat-girl-{kind}-publisher role/profile for this destination')
    def outputs(self,kind):
        stack=self.call('cloudformation','describe-stacks',StackName=STACKS[kind])['Stacks'][0]
        if stack['StackStatus'] not in ('CREATE_COMPLETE','UPDATE_COMPLETE','UPDATE_ROLLBACK_COMPLETE'):
            raise ValueError(f'{STACKS[kind]} is not ready: {stack["StackStatus"]}')
        return {entry['OutputKey']:entry['OutputValue'] for entry in stack.get('Outputs',[])}
    def head(self,name,key):
        try: return self.call('s3api','head-object',Bucket=name,Key=key,ExpectedBucketOwner=self.p['account'],ChecksumMode='ENABLED')
        except AwsError as error:
            if error.code in ('404','NoSuchKey','NotFound'): return None
            raise
    def download(self,name,key,path):
        args=['aws','--profile',self.profile,'--region',self.p['region'],'--no-cli-pager','s3api','get-object','--bucket',name,'--key',key,'--expected-bucket-owner',self.p['account'],str(path)]
        result=subprocess.run(args,capture_output=True,text=True,env=self.env)
        if result.returncode: raise AwsError('s3api','get-object',result.stderr)
    def upload(self,name,key,path,**kwargs):
        self.writer()
        # --body invokes the CLI's streaming-file argument handler; JSON Body would be literal data.
        return self.call('s3api','put-object',Bucket=name,Key=key,_body=str(path),ExpectedBucketOwner=self.p['account'],**kwargs)
