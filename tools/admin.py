"""Independent admin build/publication and private credential setup. No public-site writes."""
import argparse
import base64
from datetime import datetime, timezone
import getpass
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler
from aws_common import AWS, bucket, project
from prepare_images import ROOT, write_json
from deploy_site import file_manifest, digest, publish_files, lock

PARAMETER = '/flat-girl/admin/authorization-sha256'


def credentials(confirm=False):
    username = input('Admin username: ').strip()
    password = getpass.getpass('Admin password: ')
    if not username or not password or ':' in username or any(c in username + password for c in '\r\n'):
        raise ValueError('Invalid username or password')
    if confirm and password != getpass.getpass('Repeat admin password: '):
        raise ValueError('Passwords do not match')
    return 'Basic ' + base64.b64encode((username + ':' + password).encode()).decode()


def auth(aws):
    authorization = credentials(confirm=True)
    aws.writer()
    aws.call('ssm', 'put-parameter', Name=PARAMETER, Type='SecureString', Overwrite=True,
             Value=hashlib.sha256(authorization.encode()).hexdigest())
    print('Admin credential updated; beta is unchanged. Allow 60 seconds for verifier caches.')


def preflight(aws):
    report = {}
    for env in ('beta', 'production'):
        table = aws.call('dynamodb', 'describe-table', TableName=f'flat-girl-{env}-events')['Table']
        url = aws.call('sqs', 'get-queue-url', QueueName=f'flat-girl-{env}-meta-dlq')['QueueUrl']
        attrs = aws.call('sqs', 'get-queue-attributes', QueueUrl=url,
                         AttributeNames=['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed'])['Attributes']
        report[env] = dict(table=table['TableName'], status=table['TableStatus'], approximateItems=table['ItemCount'],
                           approximateBytes=table['TableSizeBytes'], keys=table['KeySchema'], dlq=attrs)
    write_json(ROOT / '.deploy/admin/preflight.json', report)
    print(json.dumps(report, indent=2))


def destination(aws):
    out = aws.outputs('admin')
    if out.get('SiteUrl') != 'https://admin.flatgirl.net' or out.get('BucketName') != bucket(aws.p, 'admin') or not re.fullmatch(r'[A-Z0-9]+', out.get('DistributionId', '')):
        raise ValueError('Admin stack destination mismatch')
    return out


def release_dir(release=None):
    if not release:
        release = json.loads((ROOT / '.deploy/admin/current.json').read_text())['release']
    if not re.fullmatch(r'[A-Za-z0-9_-]+', release):
        raise ValueError('Invalid release ID')
    return ROOT / '.deploy/releases/admin' / release


def validate(directory, p):
    manifest = json.loads((directory / 'manifest.json').read_text())
    files = file_manifest(directory / 'public')
    if manifest.get('environment') != 'admin' or manifest.get('account') != p['account'] or manifest.get('siteUrl') != 'https://admin.flatgirl.net':
        raise ValueError('Admin artifact destination mismatch')
    if files != manifest.get('files') or digest(files) != manifest.get('artifactDigest'):
        raise ValueError('Admin artifact contents changed')
    return manifest


def build(p):
    subprocess.run(['npm', 'run', 'generate', '--prefix', 'admin'], cwd=ROOT, check=True)
    public = ROOT / 'admin/.output/public'
    if public.is_symlink():
        raise ValueError('Refusing symlinked output')
    (public / 'robots.txt').write_text('User-agent: *\nDisallow: /\n')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip())
    release = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + digest(file_manifest(public))[:12]
    write_json(public / 'build.json', dict(release=release, revision=revision, dirty=dirty, environment='admin'))
    files = file_manifest(public)
    directory = release_dir(release)
    directory.mkdir(parents=True, exist_ok=False)
    shutil.copytree(public, directory / 'public')
    manifest = dict(version=1, release=release, environment='admin', account=p['account'], siteUrl='https://admin.flatgirl.net',
                    revision=revision, dirty=dirty, files=files, artifactDigest=digest(files))
    write_json(directory / 'manifest.json', manifest)
    validate(directory, p)
    write_json(ROOT / '.deploy/admin/current.json', dict(release=release))
    print(f'Built admin release {release}; no AWS writes.')


def publish(aws, directory, dry_run=False):
    manifest = validate(directory, aws.p)
    out = destination(aws)
    if dry_run:
        print(f"Would archive and publish {manifest['release']} to {out['BucketName']}; invalidate only {out['DistributionId']}.")
        return
    aws.writer('admin')
    with lock('admin'):
        archive = directory / 'artifact.tar.gz'
        if not archive.exists():
            with tarfile.open(archive, 'w:gz') as tar:
                tar.add(directory / 'manifest.json', arcname='manifest.json')
                tar.add(directory / 'public', arcname='public')
        archive_key = f"releases/{manifest['release']}/artifact.tar.gz"
        if not aws.head(out['BucketName'], archive_key):
            aws.upload(out['BucketName'], archive_key, archive, ContentType='application/gzip', CacheControl='private, no-store', IfNoneMatch='*')
        journal = dict(release=manifest['release'], state='publishing', uploaded=[])
        publish_files(aws, out, manifest, directory, journal)
        inv = aws.call('cloudfront', 'create-invalidation', DistributionId=out['DistributionId'],
                       InvalidationBatch=dict(Paths=dict(Quantity=1, Items=['/*']), CallerReference='admin-' + datetime.now(timezone.utc).isoformat()))['Invalidation']['Id']
        subprocess.run(['aws', '--profile', aws.profile, '--region', aws.p['region'], 'cloudfront', 'wait', 'invalidation-completed',
                        '--distribution-id', out['DistributionId'], '--id', inv], env=aws.env, check=True)
        journal['state'] = 'published'; write_json(directory / 'journal.json', journal)
        write_json(ROOT / '.deploy/admin/current.json', dict(release=manifest['release']))
        print(f"Published https://admin.flatgirl.net — {manifest['release']}. Run admin-verify for authenticated checks.")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch(url, authorization=None, body=None):
    # No redirect can carry an operator's credentials to another host.
    headers = {'Authorization': authorization} if authorization else {}
    if body is not None:
        headers.update({'Content-Type': 'application/json', 'Origin': 'https://admin.flatgirl.net'})
    request = Request(url, headers=headers, data=json.dumps(body).encode() if body is not None else None)
    try:
        with build_opener(NoRedirect).open(request, timeout=20) as response:
            return response.status, response.read()
    except HTTPError as error:
        return error.code, error.read()


def verify_rollup(origin, authorization, environment):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        status, body = fetch(origin + '/api/rollups/ensure', authorization, {'environment': environment})
        if status not in (200, 202):
            raise ValueError(f'{environment} live rollup failed (HTTP {status})')
        result = json.loads(body)
        if result.get('state') == 'ready':
            data = result.get('data') or {}
            hours = data.get('hours', [])
            if (sum(h[1] for h in hours) != data.get('totalViews') or
                    sum(h[2] for h in hours) != data.get('totalLeads')):
                raise ValueError('Live aggregate totals do not match hourly buckets')
            unique = data.get('totalUniqueViews')
            unknown = data.get('unidentifiedViews')
            if (data.get('schema') != 3 or not isinstance(unique, int) or not isinstance(unknown, int)
                    or not 0 <= unique <= data['totalViews'] - unknown or unknown < 0
                    or any(len(h) != 5 or not 0 <= h[3] <= h[1] - h[4] or h[4] < 0 for h in hours)
                    or sum(h[4] for h in hours) != unknown
                    or any(d[1] > d[2] or d[2] > unique for d in data.get('uniqueDays', []))
                    or any(w[1] > unique for w in data.get('uniqueWeeks', []))
                    or (data.get('uniqueDays') or [[None, 0, 0]])[-1][2] != unique):
                raise ValueError('Live unique-view aggregates are inconsistent')
            launch = 1794085200  # November 7, 2026, 3 PM America/Chicago.
            if environment == 'production' and (data.get('coverageStart') != launch
                    or any(h[0] < launch for h in hours)):
                raise ValueError('Production metrics include history before launch')
            dlq = result.get('dlq') or {}
            if dlq.get('error') or any(k not in dlq for k in ('visible', 'inFlight', 'delayed')):
                raise ValueError(f'{environment} DLQ attributes are unavailable')
            return dict(views=data['totalViews'], estimatedUniqueViews=unique, unidentifiedViews=unknown,
                        coverageStart=data.get('coverageStart'), leads=data['totalLeads'], hours=len(hours),
                        calculatedAt=data['calculatedAt'], dlq={k: dlq[k] for k in ('visible', 'inFlight', 'delayed')})
        if result.get('state') not in ('updating', 'waiting', 'stale', 'missing'):
            raise ValueError('Unexpected rollup state')
        time.sleep(min(2, max(.1, result.get('retryAfterMs', 100) / 1000)))
    raise ValueError('Rollup verification timed out; cached progress remains resumable')


def verify(aws, directory, rollups=False):
    manifest = validate(directory, aws.p); out = destination(aws)
    authorization = credentials()
    for path in ('/', '/api/metrics?environment=production'):
        if fetch(out['SiteUrl'] + path)[0] != 401 or fetch(out['SiteUrl'] + path, 'Basic invalid')[0] != 401:
            raise ValueError('Missing/incorrect credentials were not rejected')
    for entry in manifest['files']:
        status, body = fetch(out['SiteUrl'] + '/' + entry['key'], authorization)
        if status != 200:
            raise ValueError(f"Published admin asset {entry['key']} returned HTTP {status}")
        if hashlib.sha256(body).hexdigest() != entry['sha256']:
            raise ValueError(f"Published admin asset {entry['key']} has a checksum mismatch")
    status, body = fetch(out['SiteUrl'] + '/api/metrics?environment=production', authorization)
    if status != 200 or json.loads(body).get('state') not in ('ready', 'stale', 'missing'):
        raise ValueError('Authenticated metrics read failed')
    origin = out.get('ApiOrigin', '')
    if not re.fullmatch(r'https://[a-z0-9]+\.execute-api\.us-east-1\.amazonaws\.com', origin):
        raise ValueError('Unexpected API origin')
    if fetch(origin + '/api/metrics?environment=production')[0] != 401:
        raise ValueError('Direct origin permits unauthenticated access')
    if fetch(out['SiteUrl'] + '/releases/' + manifest['release'] + '/artifact.tar.gz', authorization)[0] != 404:
        raise ValueError('Release archive is exposed by the CDN')
    receipt = dict(release=manifest['release'], verifiedAt=datetime.now(timezone.utc).isoformat(),
                   assets=True, authentication=True, apiOriginProtection=True)
    if rollups:
        receipt['rollups'] = {env: verify_rollup(out['SiteUrl'], authorization, env) for env in ('production', 'beta')}
    write_json(ROOT / '.deploy/admin/verification.json', receipt)
    print(json.dumps(receipt, indent=2))
    print('Admin verification passed. No signup or source-data write was triggered.')


def restore(aws, release):
    directory = release_dir(release)
    if directory.exists():
        validate(directory, aws.p); return directory
    out = destination(aws)
    with tempfile.TemporaryDirectory() as temp:
        archive = Path(temp) / 'artifact.tar.gz'
        aws.download(out['BucketName'], f'releases/{release}/artifact.tar.gz', archive)
        with tarfile.open(archive, 'r:gz') as tar:
            for member in tar.getmembers():
                path = Path(member.name)
                if member.issym() or member.islnk() or path.is_absolute() or '..' in path.parts or not (member.name == 'manifest.json' or path.parts[0] == 'public'):
                    raise ValueError('Unsafe archive member')
            staging = Path(temp) / 'release'; tar.extractall(staging, filter='data')
        validate(staging, aws.p)
        directory.parent.mkdir(parents=True, exist_ok=True); shutil.copytree(staging, directory)
    return directory


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['build', 'auth', 'preflight', 'publish', 'verify', 'rollback'])
    parser.add_argument('--profile'); parser.add_argument('--release'); parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--rollups', action='store_true', help='Verify on-demand rollups through the authenticated API')
    args = parser.parse_args(); p = project()
    if args.command == 'build': return build(p)
    if not args.profile: parser.error('--profile is required')
    if args.dry_run and args.command not in ('publish', 'rollback'): parser.error('--dry-run is only supported for publication')
    aws = AWS(args.profile, p, read_only=args.command in ('preflight', 'verify') or args.dry_run)
    if args.command == 'auth': return auth(aws)
    if args.command == 'preflight': return preflight(aws)
    if args.command == 'rollback':
        if not args.release: parser.error('--release is required for rollback')
        directory = restore(aws, args.release)
    else: directory = release_dir(args.release)
    if args.command == 'verify': return verify(aws, directory, args.rollups)
    return publish(aws, directory, args.dry_run)


if __name__ == '__main__':
    try: main()
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error: sys.exit(str(error))
