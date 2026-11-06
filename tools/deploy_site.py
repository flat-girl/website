"""Build once, publish the checked bytes, verify, or restore an archived release."""
import argparse
import base64
from contextlib import contextmanager
from datetime import datetime,timezone
import fcntl
import getpass
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from aws_common import AWS,AwsError,bucket,project
from image_plan import IMMUTABLE,digest
from prepare_images import ROOT,sha256,write_json
from remote_images import ensure,destinations,remote_variant,immutable_upload,checksum64
from signup import config as signup_config, public_settings, validate_public, build_environment

MUTABLE='public, max-age=0, s-maxage=60, must-revalidate'
ROOT_FILES={'index.html','200.html','404.html','_payload.json','robots.txt','build.json','favicon.ico','favicon.svg','sitemap.xml'}
TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
       '.json':'application/json','.txt':'text/plain; charset=utf-8','.xml':'application/xml','.svg':'image/svg+xml',
       '.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2'}

def classify(key):
    parts=Path(key).parts
    if not parts or key.startswith('/') or '\\' in key or any(p.startswith('.') for p in parts):raise ValueError(f'Unsafe output path: {key}')
    if key not in ROOT_FILES and not key.startswith('_nuxt/'):
        raise ValueError(f'Unrecognized public file: {key}')
    suffix=Path(key).suffix
    if suffix not in TYPES:raise ValueError(f'Unrecognized content type: {key}')
    immutable=key.startswith('_nuxt/') and key!='_nuxt/builds/latest.json'
    phase=0 if immutable else 3 if key in ('_nuxt/builds/latest.json','build.json') else 2 if key=='index.html' else 1
    return dict(contentType=TYPES[suffix],cacheControl=IMMUTABLE if immutable else MUTABLE,phase=phase)

def file_manifest(directory):
    files=[]
    for path in sorted(directory.rglob('*')):
        if path.is_symlink():raise ValueError('Symlinks are not publishable')
        if path.is_dir():continue
        key=path.relative_to(directory).as_posix()
        data=path.read_bytes()
        files.append(dict(key=key,sha256=sha256(data),bytes=len(data),**classify(key)))
    if not any(f['key']=='index.html' and f['bytes']>0 for f in files):raise ValueError('Missing nonempty index.html')
    return sorted(files,key=lambda f:(f['phase'],f['key']))

def destination(aws,env):
    out=aws.outputs(env)
    host=('beta.' if env=='beta' else '')+aws.p['domain']
    if out.get('BucketName')!=bucket(aws.p,env) or out.get('SiteUrl')!='https://'+host or not re.fullmatch(r'[A-Z0-9]+',out.get('DistributionId','')):
        raise ValueError('Site outputs do not match selected environment')
    return out

def release_dir(env,release=None):
    if release is None:release=json.loads((ROOT/f'.deploy/{env}/current.json').read_text())['release']
    if not re.fullmatch(r'[A-Za-z0-9_-]+',release):raise ValueError('Invalid release ID')
    return ROOT/f'.deploy/releases/{env}'/release

def validate_artifact(directory,env,p):
    manifest=json.loads((directory/'manifest.json').read_text())
    if manifest.get('environment')!=env or manifest.get('account')!=p['account']:raise ValueError('Artifact destination mismatch')
    files=file_manifest(directory/'public')
    if files!=manifest.get('files') or digest(files)!=manifest.get('artifactDigest'):raise ValueError('Artifact files differ from manifest')
    if manifest.get('imageOrigin')!=manifest.get('images',{}).get('origin'):raise ValueError('Artifact image origin differs')
    if 'signup' in manifest:validate_public(manifest['signup'],env)
    return manifest

def verify_images(aws,receipt):
    out=destinations(aws)
    if receipt.get('account')!=aws.p['account'] or receipt.get('bucket')!=out['VariantsBucketName'] or receipt.get('origin')!=out['ImageBaseUrl']:
        raise ValueError('Archived image destination differs from live infrastructure')
    for key,obj in receipt['objects'].items():
        entry=dict(key=key,**{k:obj[k] for k in ('width','height','fingerprint')})
        if remote_variant(aws,out['VariantsBucketName'],entry)!=obj:raise ValueError(f'Archived image missing or changed: {key}')

def build(aws,env):
    out=destination(aws,env)
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip())
    if env=='production' and dirty:raise ValueError('Production build requires a clean committed source tree')
    receipt=ensure(aws,check=True)
    noindex=env=='beta' or aws.p['productionNoindex']
    output=ROOT/'web/.output'
    if output.is_symlink():raise ValueError('Refusing symlinked generated output')
    if output.exists():shutil.rmtree(output)
    signup=public_settings(signup_config(),env)
    if signup['enabled']:
        service=aws.outputs('signup-'+env)
        if service.get('SignupEndpoint')!=signup['endpoint'] or service.get('SignupEnabled')!='true' or service.get('BrevoListId')!=str(5 if env=='beta' else 4):
            raise ValueError('Enable and verify the matching signup backend before building the enabled form')
    settings=build_environment(dict(os.environ,FLAT_GIRL_IMAGE_MODE='cdn',FLAT_GIRL_NOINDEX=str(noindex).lower()),signup)
    subprocess.run(['npm','run','generate','--prefix','web'],cwd=ROOT,env=settings,check=True)
    public=output/'public'
    (public/'robots.txt').write_text('User-agent: *\nDisallow: /\n' if noindex else 'User-agent: *\nAllow: /\n')
    files=file_manifest(public)
    release=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+digest(files)[:12]
    write_json(public/'build.json',dict(release=release,environment=env,revision=revision,dirty=dirty))
    files=file_manifest(public)
    manifest=dict(version=1,release=release,environment=env,account=aws.p['account'],siteUrl=out['SiteUrl'],revision=revision,dirty=dirty,
                  noindex=noindex,imageOrigin=receipt['origin'],images=receipt,signup=signup,files=files,artifactDigest=digest(files))
    target=release_dir(env,release)
    if target.exists():raise ValueError('Release directory already exists')
    target.mkdir(parents=True)
    shutil.copytree(public,target/'public')
    write_json(target/'manifest.json',manifest)
    validate_artifact(target,env,aws.p)
    write_json(ROOT/f'.deploy/{env}/current.json',dict(release=release))
    print(f'Built {env} {release}: {len(files)} files; no local image copies.')
    return target

@contextmanager
def lock(env):
    path=ROOT/f'.deploy/{env}/publish.lock';path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('a') as handle:
        try:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError(f'Another {env} publication is running') from None
        try:yield
        finally:fcntl.flock(handle,fcntl.LOCK_UN)

def archive(aws,directory,manifest):
    key=f"releases/{manifest['environment']}/{manifest['release']}/artifact.tar.gz"
    # Reuse a stable archive across retries; the release ID owns these exact bytes.
    stable=directory/'artifact.tar.gz'
    if not stable.exists():
        temporary=directory/'artifact.tmp'
        with tarfile.open(temporary,'w:gz') as tar:
            tar.add(directory/'manifest.json',arcname='manifest.json')
            tar.add(directory/'public',arcname='public')
        temporary.replace(stable)
    immutable_upload(aws,bucket(aws.p,'sources'),key,stable,'application/gzip',{'artifact-digest':manifest['artifactDigest']},'private, no-store')

def publish_files(aws,out,manifest,directory,journal):
    for entry in manifest['files']:
        path=directory/'public'/entry['key']
        existing=aws.head(out['BucketName'],entry['key'])
        immutable=entry['cacheControl']==IMMUTABLE
        if immutable and existing:
            if (existing.get('ChecksumSHA256')!=checksum64(entry['sha256']) or existing['ContentLength']!=entry['bytes'] or
                existing.get('ContentType')!=entry['contentType'] or existing.get('CacheControl')!=entry['cacheControl']):
                raise ValueError(f'Immutable site asset conflict: {entry["key"]}')
            continue
        extra={'IfNoneMatch':'*'} if immutable else {}
        aws.upload(out['BucketName'],entry['key'],path,ContentType=entry['contentType'],CacheControl=entry['cacheControl'],
                   ChecksumAlgorithm='SHA256',ChecksumSHA256=checksum64(entry['sha256']),**extra)
        journal['uploaded'].append(entry['key']);write_json(directory/'journal.json',journal)

def publish(aws,env,directory,dry_run=False):
    manifest=validate_artifact(directory,env,aws.p);out=destination(aws,env)
    if out['SiteUrl']!=manifest['siteUrl']:raise ValueError('Artifact site URL differs')
    verify_images(aws,manifest['images'])
    if dry_run:
        print(f"Would archive/publish {manifest['release']} to {out['BucketName']}, immutable assets before HTML; invalidate /* and verify.")
        return
    aws.writer(env)
    with lock(env):
        journal=dict(release=manifest['release'],state='archiving',uploaded=[])
        write_json(directory/'journal.json',journal)
        try:
            archive(aws,directory,manifest)
            journal['state']='publishing';write_json(directory/'journal.json',journal)
            publish_files(aws,out,manifest,directory,journal)
            # This tiny site uses one wildcard so previously cached missing paths are refreshed too.
            invalidation=aws.call('cloudfront','create-invalidation',DistributionId=out['DistributionId'],InvalidationBatch={
                'Paths':{'Quantity':1,'Items':['/*']},'CallerReference':manifest['release']+'-'+datetime.now(timezone.utc).isoformat()})['Invalidation']['Id']
            journal.update(state='invalidating',invalidation=invalidation);write_json(directory/'journal.json',journal)
            subprocess.run(['aws','--profile',aws.profile,'--region',aws.p['region'],'cloudfront','wait','invalidation-completed',
                            '--distribution-id',out['DistributionId'],'--id',invalidation],check=True,env=aws.env)
            journal['state']='awaiting-verification';write_json(directory/'journal.json',journal)
        except Exception:
            journal['state']='failed';write_json(directory/'journal.json',journal)
            raise
        # Keep the destination lock through verification and recording the result.
        verify(aws,env,directory)
        proof=directory/'verified.json'
        aws.upload(bucket(aws.p,'sources'),f"releases/{env}/{manifest['release']}/verified.json",proof,
                   ContentType='application/json',CacheControl='private, no-store',ChecksumAlgorithm='SHA256',ChecksumSHA256=checksum64(sha256(proof.read_bytes())))
        journal['state']='verified';write_json(directory/'journal.json',journal)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def request(url,authorization=None):
    headers={'Accept-Encoding':'identity'}
    if authorization:headers['Authorization']=authorization
    req=urllib.request.Request(url,headers=headers)
    try: response=urllib.request.build_opener(NoRedirect).open(req,timeout=20)
    except urllib.error.HTTPError as error:response=error
    with response:return response.status,response.headers,response.read()

def beta_login():
    username=input('Beta username for verification: ').strip();password=getpass.getpass('Beta password: ')
    return 'Basic '+base64.b64encode((username+':'+password).encode()).decode()

def redirect_matches(actual,expected):
    """Compare destinations without depending on ordering between query keys.

    Repeated values retain their order, and blank values must not disappear.
    The scheme, authority, path and fragment still have to match exactly.
    """
    if not actual:return False
    try:
        actual_url=urllib.parse.urlsplit(actual)
        expected_url=urllib.parse.urlsplit(expected)
        if any(getattr(actual_url,key)!=getattr(expected_url,key) for key in ('scheme','netloc','path','fragment')):
            return False
        def query_values(query):
            values={}
            for key,value in urllib.parse.parse_qsl(query,keep_blank_values=True,strict_parsing=True,errors='strict'):
                values.setdefault(key,[]).append(value)
            return values
        return query_values(actual_url.query)==query_values(expected_url.query)
    except (ValueError,UnicodeError):
        return False

def check_redirect(url,status,actual_location,expected_status,expected_location):
    if status!=expected_status or not redirect_matches(actual_location,expected_location):
        raise ValueError(f'Redirect failed: {url}; expected HTTP {expected_status} Location {expected_location!r}; '
                         f'received HTTP {status} Location {actual_location!r}')

def verify(aws,env,directory):
    manifest=validate_artifact(directory,env,aws.p);out=destination(aws,env);origin=out['SiteUrl']
    verify_images(aws,manifest['images'])
    auth=beta_login() if env=='beta' else None
    if env=='beta':
        paths=['/','/'+next(f['key'] for f in manifest['files'] if f['key'].startswith('_nuxt/'))]
        for base in [origin,'https://'+out['DistributionDomainName']]:
            for path in paths:
                status,headers,_=request(base+path)
                if status!=401 or 'noindex' not in headers.get('X-Robots-Tag',''):raise ValueError('Beta authentication/noindex failed')
    for entry in manifest['files']:
        path='/' if entry['key']=='index.html' else '/'+entry['key']
        status,headers,data=request(origin+path,auth)
        if status!=200 or sha256(data)!=entry['sha256'] or headers.get_content_type()!=entry['contentType'].split(';')[0]:
            raise ValueError(f'Public bytes/type differ: {path}')
        cache=headers.get('Cache-Control','')
        if cache!=entry['cacheControl']:raise ValueError(f'Cache policy differs: {path}')
        if manifest['noindex'] and 'noindex' not in headers.get('X-Robots-Tag',''):raise ValueError(f'Missing noindex header: {path}')
    for key,obj in manifest['images']['objects'].items():
        status,headers,data=request(manifest['imageOrigin']+'/'+key)
        content_type = 'image/png' if key.endswith('.png') else 'image/webp'
        if status!=200 or sha256(data)!=obj['sha256'] or headers.get_content_type()!=content_type or headers.get('Cache-Control')!=IMMUTABLE:
            raise ValueError(f'Image CDN verification failed: {key}')
    probes=[(origin+'/offer?utm_source=check&x=1&x=2',302,origin+'/?utm_source=check&x=1&x=2'),
            ('https://'+out['DistributionDomainName']+'/',301,origin+'/'),(origin+'/index.html',301,origin+'/')]
    if env=='production':probes.append(('https://www.'+aws.p['domain']+'/',301,origin+'/'))
    for url,expected,location in probes:
        status,headers,_=request(url,auth if url.startswith(origin+'/') or env=='beta' and url.startswith('https://'+out['DistributionDomainName']+'/') else None)
        check_redirect(url,status,headers.get('Location'),expected,location)
    status,headers,_=request(origin.replace('https:','http:')+'/')
    if status not in (301,302,307,308) or headers.get('Location')!=origin+'/':raise ValueError('HTTP-to-HTTPS redirect failed')
    for path in ['/missing.js','/variants/missing.webp','/.env']:
        status,_,_=request(origin+path,auth)
        if status not in (403,404):raise ValueError(f'Missing/private path did not fail: {path}')
    source=json.loads((ROOT/'images/manifest.json').read_text())['images'][0]
    from remote_images import source_key
    for name,key in [(bucket(aws.p,'sources'),source_key(source)),(out['BucketName'],'index.html')]:
        status,_,_=request(f'https://{name}.s3.{aws.p["region"]}.amazonaws.com/{key}')
        if status not in (403,404):raise ValueError('Private S3 origin is accessible anonymously')
    if env=='beta' and request(origin+'/')[0]!=401:raise ValueError('Beta cache bypasses authentication')
    proof=dict(release=manifest['release'],verifiedAt=datetime.now(timezone.utc).isoformat(),artifactDigest=manifest['artifactDigest'])
    write_json(directory/'verified.json',proof)
    write_json(ROOT/f'.deploy/{env}/verified.json',proof)
    print(f"Verified HTTPS {env} release {manifest['release']}: site bytes, images, auth, redirects, cache and private origins.")

def restore_release(aws,env,release):
    target=release_dir(env,release)
    # Only an observed successful release is a normal rollback target.
    proof_path=ROOT/f'.deploy/{env}/rollback-proof.json'
    proof_path.parent.mkdir(parents=True,exist_ok=True)
    aws.download(bucket(aws.p,'sources'),f'releases/{env}/{release}/verified.json',proof_path)
    proof=json.loads(proof_path.read_text())
    if proof.get('release')!=release:raise ValueError('Rollback verification record differs')
    if target.exists():
        manifest=validate_artifact(target,env,aws.p)
        if manifest['artifactDigest']!=proof.get('artifactDigest'):raise ValueError('Rollback proof does not match artifact')
        return target
    target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target.parent) as temporary:
        temporary=Path(temporary);archive_path=temporary/'artifact.tar.gz'
        aws.download(bucket(aws.p,'sources'),f'releases/{env}/{release}/artifact.tar.gz',archive_path)
        extracted=temporary/'unpacked';extracted.mkdir()
        with tarfile.open(archive_path) as tar:
            for member in tar.getmembers():
                if not (member.name=='manifest.json' or member.name=='public' or member.name.startswith('public/')) or member.issym() or member.islnk() or member.name.startswith('/') or '..' in Path(member.name).parts:
                    raise ValueError('Unsafe archive member')
            tar.extractall(extracted,filter='data')
        manifest=validate_artifact(extracted,env,aws.p)
        if manifest['artifactDigest']!=proof.get('artifactDigest'):raise ValueError('Rollback proof does not match artifact')
        shutil.copyfile(archive_path,extracted/'artifact.tar.gz')
        extracted.rename(target)
    return target

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['build','publish','verify','rollback'])
    parser.add_argument('--env',required=True,choices=['beta','production']);parser.add_argument('--profile',required=True)
    parser.add_argument('--release');parser.add_argument('--dry-run',action='store_true')
    args=parser.parse_args()
    aws=AWS(args.profile,project(),read_only=args.command in ('build','verify') or args.dry_run)
    if args.command=='build':
        with lock('build'):return build(aws,args.env)
    if args.command=='rollback' and not args.release:parser.error('--release is required for rollback')
    directory=restore_release(aws,args.env,args.release) if args.command=='rollback' else release_dir(args.env,args.release)
    if args.command=='verify':return verify(aws,args.env,directory)
    publish(aws,args.env,directory,args.dry_run)

if __name__=='__main__':
    try:main()
    except (ValueError,RuntimeError,OSError,subprocess.CalledProcessError) as error:sys.exit(str(error))
