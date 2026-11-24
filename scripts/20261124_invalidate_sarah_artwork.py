#!/usr/bin/env -S uv run --locked --project tools python
"""Invalidate the six historical Sarah images and verify anonymous access is denied."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError
from urllib.request import Request, build_opener
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))

from aws_common import AWS, project
from deploy_site import NoRedirect
from prepare_images import ROOT

RELEASE = '20261107T045352Z-b8d1c6096ce4'
MANIFEST = ROOT / '.deploy/releases/production' / RELEASE / 'manifest.json'


def artwork_paths(outputs):
    receipt = json.loads(MANIFEST.read_text())['images']
    if receipt['origin'] != outputs['ImageBaseUrl'] or receipt['distribution'] != outputs['DistributionId']:
        raise ValueError('The historical release and FlatGirlImages identify different distributions.')
    names = {f'sarah-{side}-{width}.webp' for side in ('front', 'back') for width in (480, 960, 1696)}
    keys = sorted(key for key in receipt['objects'] if Path(key).name in names)
    if len(keys) != 6 or {Path(key).name for key in keys} != names:
        raise ValueError('Expected six distinct historical Sarah variants in the release manifest.')
    if any(not re.fullmatch(r'variants/[0-9a-f]{64}/[^/]+', key) for key in keys):
        raise ValueError('Unexpected variant key in the release manifest.')
    return ['/' + key for key in keys]


def verify_denied(origin, paths):
    http = build_opener(NoRedirect())
    failures = []
    for path in paths:
        try:
            with http.open(Request(origin + path, method='HEAD'), timeout=10) as response:
                status = response.status
        except HTTPError as error:
            status = error.code
            error.close()
        print(f'{Path(path).name}: HTTP {status}')
        if status not in (403, 404):
            failures.append(path)
    if failures:
        raise ValueError('Access denial was not verified for every image. Check the bucket policy and invalidation.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cdn-profile', default='flat-girl', help='AWS profile for invalidation (default: flat-girl)')
    args = parser.parse_args()
    config = project()
    outputs = AWS('flat-girl', config, read_only=True).outputs('images')
    paths = artwork_paths(outputs)
    distribution = outputs['DistributionId']
    profile = args.cdn_profile
    cdn = AWS(profile, config)
    result = cdn.call('cloudfront', 'create-invalidation', DistributionId=distribution, InvalidationBatch={
        'Paths': {'Quantity': len(paths), 'Items': paths}, 'CallerReference': 'drop2-' + uuid4().hex,
    })
    invalidation = result['Invalidation']['Id']
    print(f'Waiting for invalidation {invalidation} on {distribution}…', flush=True)
    subprocess.run(['aws', '--profile', profile, '--region', config['region'], 'cloudfront', 'wait',
                    'invalidation-completed', '--distribution-id', distribution, '--id', invalidation],
                   check=True, env=cdn.env)
    verify_denied(outputs['ImageBaseUrl'], paths)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, EOFError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
