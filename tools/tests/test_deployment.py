import base64
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from prepare_images import prepare,source_info,sha256,write_json
from image_plan import plan,validate_receipt,install_receipt,IMMUTABLE
from remote_images import ensure,remote_variant,immutable_upload,checksum64,restore
from aws_common import AwsError,bucket
from deploy_site import classify,file_manifest,publish_files,validate_artifact,archive,restore_release,redirect_matches,check_redirect
from image_plan import digest
import remote_images

class FakeAWS:
    p={'account':'123456789012','region':'us-east-1'}
    def __init__(self):self.objects={};self.uploads=[];self.error=None
    def outputs(self,kind):return dict(SourceBucketName=bucket(self.p,'sources'),VariantsBucketName=bucket(self.p,'variants'),ImageBaseUrl='https://example.cloudfront.net',DistributionId='EXAMPLE')
    def head(self,name,key):
        if self.error:raise self.error
        return self.objects.get(key)
    def upload(self,name,key,path,**options):
        self.uploads.append(key)
        self.objects[key]=dict(ContentLength=path.stat().st_size,ChecksumSHA256=options['ChecksumSHA256'],ContentType=options['ContentType'],CacheControl=options['CacheControl'],Metadata=options.get('Metadata',{}))
    def download(self,*args):raise AssertionError('Unexpected download')

def fixture(root):
    raw=root/'images/raw';raw.mkdir(parents=True)
    source=raw/'test.png';Image.new('RGBA',(100,150),(255,0,0,128)).save(source)
    write_json(root/'images/manifest.json',{'images':[dict(id='test',file='test.png',alt='Test',**source_info(source))]})
    write_json(root/'images/recipes.json',dict(widths=[20,40],quality=85,fullQuality=90))

class DeploymentTests(unittest.TestCase):
    def test_discovered_sources_upload_with_their_actual_image_content_type(self):
        with tempfile.TemporaryDirectory() as d, contextlib.redirect_stdout(io.StringIO()):
            root = Path(d)
            fixture(root)
            for name in ['photo.jpg', 'photo.webp']:
                Image.new('RGB', (10, 15)).save(root / 'images/raw' / name)
            prepare(root, refresh=True)
            aws = FakeAWS()
            with patch.object(remote_images, 'ROOT', root), patch.object(remote_images, 'project', return_value=aws.p), \
                 patch.object(remote_images, 'AWS', return_value=aws), patch.object(remote_images, 'plan', side_effect=lambda: plan(root)), \
                 patch.object(sys, 'argv', ['remote_images.py', 'import', '--profile', 'fixture']):
                remote_images.main('sources')
            self.assertEqual({obj['ContentType'] for obj in aws.objects.values()}, {'image/png', 'image/jpeg', 'image/webp'})
            self.assertEqual(len(aws.uploads), 3)

    def test_redirects_ignore_key_order_but_preserve_destination_and_values(self):
        expected='https://beta.flatgirl.net/?utm_source=check&x=1&x=2&empty='
        actual='https://beta.flatgirl.net/?x=1&x=2&empty=&utm_source=check'
        self.assertTrue(redirect_matches(actual,expected))
        check_redirect('https://beta.flatgirl.net/offer',302,actual,302,expected)
        self.assertTrue(redirect_matches('https://beta.flatgirl.net/?q=a%20b&plus=%2b',
                                         'https://beta.flatgirl.net/?plus=%2B&q=a+b'))
        for invalid in [None,expected.replace('https:','http:'),expected.replace('beta.flatgirl.net','other.example'),
                        expected.replace('/?','/offer?'),expected+'#fragment',expected.replace('&x=2',''),
                        expected.replace('x=1&x=2','x=2&x=1'),expected.replace('&empty=',''),
                        expected+'&extra=1',expected.replace('check','changed')]:
            with self.subTest(location=invalid):self.assertFalse(redirect_matches(invalid,expected))

    def test_redirect_failure_reports_actual_status_and_location(self):
        with self.assertRaisesRegex(ValueError,"received HTTP 401 Location None"):
            check_redirect('https://beta.flatgirl.net/offer',401,None,302,'https://beta.flatgirl.net/')
        with self.assertRaisesRegex(ValueError,"received HTTP 302 Location 'https://other.example/'"):
            check_redirect('https://beta.flatgirl.net/offer',302,'https://other.example/',302,'https://beta.flatgirl.net/')

    def test_remote_reuse_receipt_and_build_without_originals(self):
        with tempfile.TemporaryDirectory() as d,contextlib.redirect_stdout(io.StringIO()):
            root=Path(d);fixture(root);local=prepare(root);expected=plan(root)
            self.assertEqual([v['key'] for v in local['images'][0]['variants']],[e['key'] for e in expected['entries']])
            aws=FakeAWS();receipt=ensure(aws,root=root)
            self.assertEqual(len(aws.uploads),3)
            self.assertEqual(ensure(aws,root=root)['objects'],receipt['objects'])
            self.assertEqual(len(aws.uploads),3)
            import shutil
            shutil.rmtree(root/'images/raw');shutil.rmtree(root/'images/processed')
            self.assertEqual(ensure(aws,check=True,root=root)['objects'],receipt['objects'])
            self.assertEqual(install_receipt(receipt,root)['origin'],receipt['origin'])
            receipt['planDigest']='wrong'
            with self.assertRaisesRegex(ValueError,'stale'):validate_receipt(receipt,expected)
    def test_missing_dry_run_denied_access_and_corruption(self):
        with tempfile.TemporaryDirectory() as d,contextlib.redirect_stdout(io.StringIO()):
            root=Path(d);fixture(root);aws=FakeAWS()
            self.assertIsNone(ensure(aws,dry_run=True,root=root));self.assertFalse(aws.uploads)
            with self.assertRaisesRegex(ValueError,'Missing'):ensure(aws,check=True,root=root)
            ensure(aws,root=root)
            entry=plan(root)['entries'][0];aws.objects[entry['key']]['Metadata']['width']='9'
            with self.assertRaisesRegex(ValueError,'conflict'):remote_variant(aws,'bucket',entry)
            aws.error=AwsError('s3api','head-object','(403)')
            with self.assertRaises(AwsError):ensure(aws,root=root)
    def test_conditional_race_is_verified(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'image';path.write_bytes(b'bytes');aws=FakeAWS()
            def race(*args,**kwargs):
                aws.objects['key']=dict(ContentLength=5,ChecksumSHA256=checksum64(sha256(b'bytes')))
                raise AwsError('s3api','put-object','(PreconditionFailed)')
            aws.upload=race
            immutable_upload(aws,'bucket','key',path,'image/webp',{})
            path.write_bytes(b'other')
            with self.assertRaisesRegex(ValueError,'conflict'):immutable_upload(aws,'bucket','key',path,'image/webp',{})
    def test_publication_order_and_failed_asset_stops_html(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);public=root/'public';(public/'_nuxt/builds').mkdir(parents=True)
            for key in ['index.html','_payload.json','_nuxt/app.js','_nuxt/builds/latest.json','build.json']:(public/key).write_text(key)
            files=file_manifest(public)
            self.assertLess([x['key'] for x in files].index('_nuxt/app.js'),[x['key'] for x in files].index('index.html'))
            self.assertGreater([x['key'] for x in files].index('build.json'),[x['key'] for x in files].index('index.html'))
            aws=FakeAWS()
            def fail(name,key,*args,**kwargs):
                aws.uploads.append(key)
                raise ValueError('injected asset failure')
            aws.upload=fail
            with self.assertRaisesRegex(ValueError,'injected'):publish_files(aws,{'BucketName':'bucket'},{'files':files},root,{'uploaded':[]})
            self.assertEqual(aws.uploads,['_nuxt/app.js'])
            for key in ['images/raw/source.png','variants/x/image.webp','.env','_nuxt/source.map','../secret']:
                with self.assertRaises(ValueError):classify(key)

    def test_changed_original_is_preserved_and_receipt_rejects_wrong_origin(self):
        with tempfile.TemporaryDirectory() as d,contextlib.redirect_stdout(io.StringIO()):
            root=Path(d);fixture(root);aws=FakeAWS();receipt=ensure(aws,root=root)
            with self.assertRaisesRegex(ValueError,'destination'):validate_receipt(receipt,plan(root),origin='https://different.cloudfront.net')
            source=plan(root)['entries'][0]['source'];path=root/'images/raw'/source['file']
            Image.new('RGBA',(100,150),(0,255,0,255)).save(path);changed=path.read_bytes()
            with self.assertRaisesRegex(ValueError,'changed local'):restore(aws,source,'bucket',root)
            self.assertEqual(path.read_bytes(),changed)

    def test_archived_rollback_restores_exact_bytes_and_rejects_wrong_destination(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);release=root/'.deploy/releases/beta/release-one';public=release/'public';public.mkdir(parents=True)
            (public/'index.html').write_text('old exact page');files=file_manifest(public)
            manifest=dict(release='release-one',environment='beta',account=FakeAWS.p['account'],files=files,artifactDigest=digest(files),imageOrigin='https://example.cloudfront.net',images={'origin':'https://example.cloudfront.net'})
            write_json(release/'manifest.json',manifest)
            self.assertEqual(validate_artifact(release,'beta',FakeAWS.p),manifest)
            with self.assertRaisesRegex(ValueError,'destination'):validate_artifact(release,'production',FakeAWS.p)
            aws=FakeAWS();stored={}
            original_upload=aws.upload
            def save(name,key,path,**options):
                stored[key]=path.read_bytes();original_upload(name,key,path,**options)
            aws.upload=save
            with patch('deploy_site.ROOT',root):
                archive(aws,release,manifest)
                stored['releases/beta/release-one/verified.json']=json.dumps(dict(release='release-one',artifactDigest=manifest['artifactDigest'])).encode()
                import shutil
                shutil.rmtree(release)
                aws.download=lambda name,key,path:Path(path).write_bytes(stored[key])
                restored=restore_release(aws,'beta','release-one')
                self.assertEqual((restored/'public/index.html').read_text(),'old exact page')
                (restored/'public/index.html').write_text('tampered')
                with self.assertRaisesRegex(ValueError,'differ'):validate_artifact(restored,'beta',aws.p)

if __name__=='__main__':unittest.main()
