"""Isolated CDN-mode build/browser test: no originals or processed files in checkout."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from image_plan import plan,IMMUTABLE
from prepare_images import ROOT,prepare,sha256,write_json

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--browser',action='store_true');args=parser.parse_args()
    local=prepare();expected=plan()
    objects={}
    for entry in expected['entries']:
        data=(ROOT/'images/processed'/entry['key']).read_bytes()
        objects[entry['key']]=dict(sha256=sha256(data),bytes=len(data),**{k:entry[k] for k in ('fingerprint','width','height')})
    (ROOT/'.deploy').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='cdn-check-',dir=ROOT/'.deploy') as temporary:
        root=Path(temporary)
        ignore=shutil.ignore_patterns('node_modules','.nuxt','.output','.venv','__pycache__','test-results','playwright-report')
        for directory in ['web','tools']:shutil.copytree(ROOT/directory,root/directory,ignore=ignore)
        # Nuxt's server import maps resolve against real module paths. A directory
        # symlink would share generated caches and resolve imports in the original app.
        shutil.copytree(ROOT/'web/node_modules',root/'web/node_modules',symlinks=True,
                        ignore=shutil.ignore_patterns('.cache'))
        (root/'tools/.venv').symlink_to(ROOT/'tools/.venv',target_is_directory=True)
        (root/'images').mkdir()
        for name in ['manifest.json','recipes.json']:shutil.copyfile(ROOT/'images'/name,root/'images'/name)
        write_json(root/'.deploy/images.ready.json',dict(version=1,account='111111111111',origin='https://fixture.cloudfront.net',planDigest=expected['digest'],objects=objects))
        env=dict(os.environ,FLAT_GIRL_IMAGE_MODE='cdn',FLAT_GIRL_NOINDEX='true',FLAT_GIRL_TEST_CDN='true',FLAT_GIRL_TEST_IMAGE_ROOT=str(ROOT/'images/processed'))
        for command in [['npm','run','typecheck','--prefix','web'],['npm','run','generate','--prefix','web']]:
            result=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True)
            if result.returncode:raise RuntimeError(result.stdout[-3000:]+result.stderr[:4000]+result.stderr[-1000:])
        public=root/'web/.output/public'
        if (root/'images/raw').exists() or (root/'images/processed').exists() or (public/'variants').exists():raise ValueError('CDN checkout contains local image copies')
        html=(public/'index.html').read_text()
        if 'https://fixture.cloudfront.net/variants/' not in html or 'noindex' not in html:raise ValueError('CDN origin/noindex missing from HTML')
        # This scaffold has no application payload data; timestamps alone vary between builds.
        payload=json.loads((public/'_payload.json').read_text())
        if {} not in payload:raise ValueError('Review changed Nuxt payload semantics before ordered publication')
        if args.browser:subprocess.run(['npm','run','test:e2e','--prefix','web'],cwd=root,env=env,check=True)
        print('CDN fixture passed: no originals/processed files, external image URLs, no bundled variants, typecheck/generation'+('/browser' if args.browser else '')+'.')

if __name__=='__main__':main()
