import contextlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import meta

class FakeAWS:
    def __init__(self):
        self.writes = []
        self.values = {
            '/flat-girl/meta/beta/credentials': {'datasetId': '111', 'accessToken': 'beta-token'},
            '/flat-girl/meta/production/credentials': {'datasetId': '222', 'accessToken': 'production-token'},
            '/flat-girl/meta/beta/settings': dict(mode='live', version='v25.0', viewEnabled=True, leadEnabled=True),
        }
    def writer(self): pass
    def call(self, service, operation, **kwargs):
        if operation == 'get-parameter': return {'Parameter': {'Value': json.dumps(self.values[kwargs['Name']])}}
        self.writes.append((operation, kwargs))
        return {}

class MetaTests(unittest.TestCase):
    def test_expired_login_has_actionable_error_without_private_cli_output(self):
        error = meta.AwsError('sts', 'get-caller-identity', "aws: [ERROR]: Your session has expired. Please reauthenticate using 'aws login'. private-token")
        message = meta.failure_message(error)
        self.assertIn('aws login --profile flat-girl-human --region us-east-1', message)
        self.assertNotIn('private-token', message)
        denied = meta.AwsError('ssm', 'put-parameter', 'An error occurred (AccessDeniedException): private-token')
        self.assertIn('AccessDeniedException', meta.failure_message(denied))
        self.assertNotIn('private-token', meta.failure_message(denied))
        malformed = meta.AwsError('ssm', 'put-parameter', 'bad input (private-token@example.com)')
        self.assertNotIn('private-token', meta.failure_message(malformed))

    def test_runtime_settings_reject_test_mode(self):
        value = FakeAWS().values['/flat-girl/meta/beta/settings']
        self.assertEqual(meta.validate(value, 'beta'), value)
        for changed in [dict(value, mode='test'), dict(value, version='../../invalid')]:
            with self.assertRaises(ValueError): meta.validate(changed, 'beta')

    def test_normal_setup_defaults_to_environment_delivery_and_pinned_version(self):
        for env, mode in [('beta', 'live'), ('production', 'live')]:
            aws = FakeAWS()
            with contextlib.redirect_stdout(io.StringIO()): meta.configure(aws, env)
            value = json.loads(aws.writes[0][1]['Value'])
            self.assertEqual(value['mode'], mode)
            self.assertEqual(value['version'], 'v26.0')
            self.assertNotIn('testEventCode', value)
            for key in ['viewEnabled', 'leadEnabled']: self.assertTrue(value[key])

    def test_config_dry_run_never_writes_and_disable_preserves_version(self):
        aws = FakeAWS()
        with contextlib.redirect_stdout(io.StringIO()) as output:
            meta.configure(aws, 'beta', 'live', 'v25.0', True, True, True)
            self.assertEqual(aws.writes, [])
            meta.configure(aws, 'beta', 'off', None)
        settings = json.loads(aws.writes[0][1]['Value'])
        self.assertEqual(settings['mode'], 'off'); self.assertEqual(settings['version'], 'v25.0')
        self.assertNotIn('beta-token', output.getvalue())

    def test_private_credentials_are_environment_scoped_and_cannot_be_shared(self):
        aws = FakeAWS()
        with patch.object(meta, 'private', side_effect=['333', 'new-beta-token', 'new-beta-token']), contextlib.redirect_stdout(io.StringIO()) as output:
            meta.set_secrets(aws, 'beta')
        self.assertEqual(aws.writes[0][1]['Name'], '/flat-girl/meta/beta/credentials')
        self.assertEqual(aws.writes[0][1]['Type'], 'SecureString')
        self.assertNotIn('new-beta-token', output.getvalue())
        with patch.object(meta, 'private', side_effect=['222', 'production-token', 'production-token']):
            with self.assertRaises(ValueError): meta.set_secrets(aws, 'beta')
        self.assertEqual(len(aws.writes), 1)

    def test_manual_regression_keeps_test_code_outside_runtime_settings(self):
        aws = FakeAWS()
        def run(argv, **kwargs):
            self.assertNotIn('beta-token', ' '.join(argv))
            item = json.loads(kwargs['input'])
            self.assertEqual(item['config']['mode'], 'live')
            self.assertNotIn('testEventCode', item['config'])
            self.assertEqual(item['testEventCode'], 'TEST83329')
            self.assertEqual(item['credentials']['accessToken'], 'beta-token')
            self.assertEqual(item['customer']['email'], 'controlled@example.com')
            return type('Result', (), {'returncode': 0, 'stdout': '{"outcome":"delivered"}'})()
        with patch.object(meta, 'private', side_effect=['', 'Browser', 'controlled@example.com']), patch.object(meta.subprocess, 'run', side_effect=run), contextlib.redirect_stdout(io.StringIO()):
            meta.test_event(aws, 'beta', 'Lead')
        self.assertEqual(aws.writes, [])

    def test_website_test_requires_user_agent_and_view_matching_data(self):
        for values in [['', ''], ['', 'Browser']]:
            with patch.object(meta, 'private', side_effect=values), patch.object(meta.subprocess, 'run') as send:
                with self.assertRaises(ValueError): meta.test_event(FakeAWS(), 'beta', 'ViewContent')
                send.assert_not_called()

if __name__ == '__main__': unittest.main()
