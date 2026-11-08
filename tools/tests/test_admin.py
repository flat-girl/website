import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import admin
from aws_common import bucket

P = dict(account='123456789012', region='us-east-1')

class FakeAWS:
    p = P
    def outputs(self, name):
        assert name == 'admin'
        return dict(SiteUrl='https://admin.flatgirl.net', BucketName=bucket(P, 'admin'), DistributionId='EXAMPLE')

class AdminTests(unittest.TestCase):
    def test_destination_is_admin_only(self):
        self.assertEqual(admin.destination(FakeAWS())['BucketName'], bucket(P, 'admin'))
        bad = FakeAWS()
        bad.outputs = lambda _: dict(SiteUrl='https://flatgirl.net', BucketName=bucket(P, 'production'), DistributionId='EXAMPLE')
        with self.assertRaises(ValueError): admin.destination(bad)

    def test_artifact_mutation_and_wrong_destination_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'public').mkdir(); (root / 'public/index.html').write_text('dashboard')
            files = admin.file_manifest(root / 'public')
            manifest = dict(environment='admin', account=P['account'], siteUrl='https://admin.flatgirl.net', files=files, artifactDigest=admin.digest(files))
            (root / 'manifest.json').write_text(json.dumps(manifest))
            self.assertEqual(admin.validate(root, P)['environment'], 'admin')
            with self.assertRaises(ValueError): admin.validate(root, {**P, 'account': '999999999999'})
            (root / 'public/index.html').write_text('changed')
            with self.assertRaises(ValueError): admin.validate(root, P)

    def test_rollback_rejects_archive_path_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            aws = FakeAWS()
            def download(_bucket, _key, target):
                with tarfile.open(target, 'w:gz') as tar:
                    member = tarfile.TarInfo('../escaped'); member.size = 1
                    tar.addfile(member, io.BytesIO(b'x'))
            aws.download = download
            with patch.object(admin, 'ROOT', Path(directory)):
                with self.assertRaisesRegex(ValueError, 'Unsafe archive'): admin.restore(aws, 'release1')

    def test_auth_accepts_short_password_and_still_rejects_empty_or_mismatch(self):
        with patch('builtins.input', return_value='admin'), patch.object(admin.getpass, 'getpass', side_effect=['abc', 'abc']):
            self.assertTrue(admin.credentials(confirm=True).startswith('Basic '))
        for values in ([''], ['abc', 'different']):
            with patch('builtins.input', return_value='admin'), patch.object(admin.getpass, 'getpass', side_effect=values):
                with self.assertRaises(ValueError): admin.credentials(confirm=True)

    def test_auth_writes_only_admin_digest(self):
        calls = []
        aws = FakeAWS(); aws.writer = lambda: None; aws.call = lambda *args, **kwargs: calls.append((args, kwargs))
        with patch.object(admin, 'credentials', return_value='Basic fixture-secret'):
            admin.auth(aws)
        self.assertEqual(calls[0][0], ('ssm', 'put-parameter'))
        self.assertEqual(calls[0][1]['Name'], '/flat-girl/admin/authorization-sha256')
        self.assertNotIn('fixture', calls[0][1]['Value'])
        self.assertEqual(len(calls[0][1]['Value']), 64)

    def test_live_rollup_verifier_handles_progress_and_checks_aggregate_integrity(self):
        ready = dict(state='ready', data=dict(schema=2, coverageStart=1794085200, hours=[[1794085200, 3, 1, 2, 0]],
                     totalViews=3, totalLeads=1, calculatedAt=42, totalUniqueViews=2, unidentifiedViews=0,
                     uniqueDays=[['2026-11-07', 2, 2]], uniqueWeeks=[['2026-11-02', 2]]),
                     dlq=dict(error=False, visible=0, inFlight=0, delayed=0))
        responses = [(202, json.dumps(dict(state='updating', retryAfterMs=100)).encode()),
                     (200, json.dumps(ready).encode())]
        with patch.object(admin, 'fetch', side_effect=responses) as request, patch.object(admin.time, 'sleep'):
            result = admin.verify_rollup('https://admin.flatgirl.net', 'Basic test-only', 'production')
            self.assertEqual(result['leads'], 1)
            self.assertEqual(request.call_args.args[2], {'environment': 'production'})
        for field, value, message in [('totalUniqueViews', 4, 'unique-view'), ('coverageStart', 0, 'before launch')]:
            original = ready['data'][field]
            ready['data'][field] = value
            with patch.object(admin, 'fetch', return_value=(200, json.dumps(ready).encode())):
                with self.assertRaisesRegex(ValueError, message):
                    admin.verify_rollup('https://admin.flatgirl.net', 'Basic test-only', 'production')
            ready['data'][field] = original
        ready['data']['totalLeads'] = 2
        with patch.object(admin, 'fetch', return_value=(200, json.dumps(ready).encode())):
            with self.assertRaisesRegex(ValueError, 'totals'):
                admin.verify_rollup('https://admin.flatgirl.net', 'Basic test-only', 'production')

    def test_publication_dry_run_never_writes(self):
        aws = FakeAWS(); aws.writer = lambda *_: self.fail('write')
        with patch.object(admin, 'validate', return_value={'release': 'release1'}):
            admin.publish(aws, Path('/unused'), dry_run=True)

if __name__ == '__main__': unittest.main()
