import base64
from email import policy
from email.parser import BytesParser
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import notifications as n

class Fake:
    def __init__(self):
        self.calls = []
        self.value = {'enabled': False}
    def writer(self): pass
    def call(self, service, operation, **kwargs):
        self.calls.append((service, operation, kwargs))
        if operation == 'get-parameter': return {'Parameter': {'Value': json.dumps(self.value)}}
        if operation == 'put-parameter': self.value = json.loads(kwargs['Value']); return {}
        if operation == 'get-account': return {'SendingEnabled': True, 'ProductionAccessEnabled': False}
        if operation == 'get-email-identity': return {'VerifiedForSendingStatus': True}
        if operation == 'send-raw-email': return {'MessageId': 'ses-message-id'}
        raise AssertionError(operation)

class NotificationTests(unittest.TestCase):
    def test_seed_is_disabled_and_cannot_accidentally_send_twice(self):
        aws = Fake()
        n.seed(aws, 'production')
        self.assertEqual(aws.value, {'enabled': False, 'threadMessageId': '<ses-message-id@email.amazonses.com>'})
        with self.assertRaisesRegex(ValueError, 'already exists'): n.seed(aws, 'production')
        sends = [args for _, op, args in aws.calls if op == 'send-raw-email']
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0]['Destinations'], ['high@flatgirl.net'])
        message = BytesParser(policy=policy.default).parsebytes(base64.b64decode(sends[0]['RawMessage']['Data']))
        self.assertEqual(message['Subject'], 'New Flat Girl Subscriber!')
        self.assertIsNone(message['In-Reply-To'])

    def test_enable_requires_real_anchor_and_disable_preserves_it(self):
        aws = Fake()
        with self.assertRaisesRegex(ValueError, 'Seed'): n.set_enabled(aws, 'production', True)
        for value in ['bad', '<x@y>\r\nBcc: someone@example.com']:
            with self.assertRaises(ValueError): n.set_enabled(aws, 'production', True, value)
        n.set_enabled(aws, 'production', True, '<delivered@example.com>')
        self.assertTrue(aws.value['enabled'])
        n.set_enabled(aws, 'production', False)
        self.assertEqual(aws.value, {'enabled': False, 'threadMessageId': '<delivered@example.com>'})

    def test_unverified_identity_cannot_seed(self):
        aws = Fake()
        original = aws.call
        def call(service, operation, **kwargs):
            if operation == 'get-email-identity': return {'VerifiedForSendingStatus': False}
            return original(service, operation, **kwargs)
        with patch.object(aws, 'call', side_effect=call):
            with self.assertRaisesRegex(ValueError, 'Verify'): n.seed(aws, 'production')
        self.assertFalse(any(op == 'send-raw-email' for _, op, _ in aws.calls))

if __name__ == '__main__': unittest.main()
