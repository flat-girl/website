"""Set up and verify the SES owner-notification thread; never touches Brevo contacts."""
import argparse
import base64
from email.message import EmailMessage
from email.policy import SMTP
import json
import re
import sys
from aws_common import AWS, AwsError, project

ADDRESS = 'high@flatgirl.net'

def parameter(env):
    return f'/flat-girl/signup/{env}/notification'

def settings(aws, env):
    try:
        value = json.loads(aws.call('ssm', 'get-parameter', Name=parameter(env))['Parameter']['Value'])
    except AwsError as error:
        if error.code == 'ParameterNotFound':
            return {'enabled': False}
        raise
    if type(value.get('enabled')) is not bool:
        raise ValueError('Invalid notification settings')
    return value

def save(aws, env, value):
    aws.writer()
    aws.call('ssm', 'put-parameter', Name=parameter(env), Type='String', Value=json.dumps(value), Overwrite=True)

def preflight(aws):
    account = aws.call('sesv2', 'get-account')
    if not account.get('SendingEnabled'):
        raise ValueError('SES sending is disabled in us-east-1')
    verified = False
    for identity in ['flatgirl.net', ADDRESS]:
        try:
            result = aws.call('sesv2', 'get-email-identity', EmailIdentity=identity)
            verified |= result.get('VerifiedForSendingStatus') is True
        except AwsError as error:
            if error.code != 'NotFoundException':
                raise
    if not verified:
        raise ValueError('Verify flatgirl.net or high@flatgirl.net in SES us-east-1 before sending')
    # Sender and recipient are the same verified identity, so sandbox is supported.

def valid_thread(value):
    return isinstance(value, str) and len(value) <= 254 and re.fullmatch(r'<[^<>\s@]+@[^<>\s@]+>', value)

def send(aws, env, body, root=None):
    message = EmailMessage(policy=SMTP)
    message['From'] = message['To'] = ADDRESS
    message['Subject'] = ('[Beta] ' if env == 'beta' else '') + 'New Flat Girl Subscriber!'
    if root:
        if not valid_thread(root):
            raise ValueError('Invalid thread Message-ID')
        message['In-Reply-To'] = message['References'] = root
    message.set_content(body)
    aws.writer()
    result = aws.call('ses', 'send-raw-email', Source=ADDRESS, Destinations=[ADDRESS],
                      RawMessage={'Data': base64.b64encode(message.as_bytes()).decode()})
    message_id = result.get('MessageId', '')
    if not re.fullmatch(r'[A-Za-z0-9-]+', message_id):
        raise ValueError('SES accepted the send but returned an unexpected ID; inspect the inbox before retrying')
    # This project is fixed to us-east-1. Verify the header in the setup email before enable.
    return f'<{message_id}@email.amazonses.com>'

def seed(aws, env):
    value = settings(aws, env)
    if value.get('threadMessageId'):
        raise ValueError('A thread already exists; use test instead of sending another seed')
    preflight(aws)
    root = send(aws, env, 'Flat Girl subscriber notification thread. Future subscriber alerts will appear as replies to this message.')
    try:
        save(aws, env, {'enabled': False, 'threadMessageId': root})
    except Exception:
        raise ValueError(f'Seed was sent but settings could not be saved. Do not resend; recover using Message-ID {root}') from None
    print(f'Thread seed sent to {ADDRESS}; notifications remain disabled. Message-ID: {root}')

def set_enabled(aws, env, enabled, thread=None):
    value = settings(aws, env)
    if thread:
        if not valid_thread(thread):
            raise ValueError('Use the complete Message-ID from the delivered seed, including < >')
        value['threadMessageId'] = thread
    if enabled:
        if not valid_thread(value.get('threadMessageId')):
            raise ValueError('Seed the thread first')
        preflight(aws)
    value['enabled'] = enabled
    save(aws, env, value)
    print(f'{env}: notifications {"enabled" if enabled else "disabled"}; workers refresh settings within 60 seconds.')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['status', 'seed', 'test', 'enable', 'disable'])
    parser.add_argument('--profile', required=True)
    parser.add_argument('--env', choices=['beta', 'production'], required=True)
    parser.add_argument('--thread-message-id', help='Exact Message-ID from delivered seed, if different from the saved value')
    args = parser.parse_args()
    aws = AWS(args.profile, project(), read_only=args.command == 'status')
    if args.command == 'seed':
        seed(aws, args.env)
    elif args.command in ['enable', 'disable']:
        set_enabled(aws, args.env, args.command == 'enable', args.thread_message_id)
    elif args.command == 'test':
        value = settings(aws, args.env)
        if not value.get('enabled'):
            raise ValueError('Enable notifications before testing the queue worker')
        # A reserved .invalid address clearly identifies the synthetic notification.
        queue = aws.outputs('signup-' + args.env)['NotificationQueueUrl']
        aws.writer()
        aws.call('sqs', 'send-message', QueueUrl=queue, MessageBody=json.dumps({
            'schema': 1, 'environment': args.env, 'email': 'threading-test@flatgirl.invalid'}))
        print(f'Queued one threading-test notification to {ADDRESS}; no subscriber or welcome email was created.')
    else:
        print(json.dumps(settings(aws, args.env), indent=2))

if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        sys.exit(str(error))
