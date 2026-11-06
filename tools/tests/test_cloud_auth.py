import contextlib
import io
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cloud

class FakeAWS:
    def __init__(self, digest='a' * 64):
        self.digest = digest
        self.calls = []
    def writer(self): pass
    def outputs(self, kind):
        assert kind == 'beta'
        return {'AuthStoreArn': 'test-store'}
    def call(self, service, operation, **kwargs):
        self.calls.append((service, operation, kwargs))
        if operation == 'get-key': return {'Value': self.digest}
        if operation == 'describe-key-value-store': return {'ETag': 'test-etag'}
        return {}

class AuthTests(unittest.TestCase):
    def test_migration_copies_digest_privately_without_rotating_legacy_store(self):
        aws = FakeAWS()
        with patch('builtins.input', side_effect=AssertionError('No password prompt')), contextlib.redirect_stdout(io.StringIO()) as output:
            cloud.auth(aws, migrate=True)
        self.assertEqual([call[1] for call in aws.calls], ['get-key', 'put-parameter'])
        self.assertEqual(aws.calls[1][2], dict(Name='/flat-girl/beta/authorization-sha256', Value='a' * 64, Type='SecureString', Overwrite=True))
        self.assertNotIn('a' * 64, output.getvalue())

    def test_migration_rejects_invalid_digest_before_writing(self):
        aws = FakeAWS('invalid')
        with self.assertRaises(ValueError): cloud.auth(aws, migrate=True)
        self.assertEqual(len(aws.calls), 1)

    def test_rotation_updates_ssm_and_retained_kvs_without_logging_credentials(self):
        aws = FakeAWS()
        with patch('builtins.input', return_value='reviewer'), patch.object(cloud.getpass, 'getpass', side_effect=['private-password', 'private-password']), contextlib.redirect_stdout(io.StringIO()) as output:
            cloud.auth(aws)
        parameter = next(call[2] for call in aws.calls if call[1] == 'put-parameter')
        legacy = next(call[2] for call in aws.calls if call[1] == 'put-key')
        self.assertEqual(parameter['Value'], legacy['Value'])
        self.assertEqual(len(parameter['Value']), 64)
        for value in ['private-password', parameter['Value']]: self.assertNotIn(value, output.getvalue())

if __name__ == '__main__': unittest.main()
