"""Private Meta configuration and one-off manual regression checks, isolated by environment."""
import argparse
import getpass
import ipaddress
import json
import re
import subprocess
import sys
import warnings
from aws_common import AWS, AwsError, project
from prepare_images import ROOT

# Pinned to Meta's maintained Business SDK API version; no SDK dependency is used.
GRAPH_VERSION = 'v26.0'
TEST_CODES = {'beta': 'TEST83329', 'production': 'TEST72924'}

def names(env):
    if env not in TEST_CODES: raise ValueError('Select beta or production')
    return {key: f'/flat-girl/meta/{env}/{key}' for key in ['settings', 'credentials']}

def validate(value, env):
    if (not isinstance(value, dict) or value.get('mode') not in ['off', 'live'] or
        not re.fullmatch(r'v\d{1,3}\.0', value.get('version', '')) or
        any(type(value.get(key)) is not bool for key in ['viewEnabled', 'leadEnabled'])):
        raise ValueError('Invalid Meta settings')
    return value

def read(aws, env, key):
    return json.loads(aws.call('ssm', 'get-parameter', Name=names(env)[key], WithDecryption=True)['Parameter']['Value'])

def private(prompt):
    if not sys.stdin.isatty(): raise ValueError('Run in an interactive terminal; do not pass credentials or customer data in arguments')
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        return getpass.getpass(prompt)

def set_secrets(aws, env):
    dataset = private(f'{env} dataset ID (hidden): ').strip()
    token = private(f'{env} CAPI token (hidden): ')
    confirm = private('Repeat token (hidden): ')
    if not re.fullmatch(r'\d{1,30}', dataset) or token != confirm or not token or len(token) > 3500 or any(c.isspace() for c in token):
        raise ValueError('Invalid dataset ID or nonmatching token')
    other_env = 'production' if env == 'beta' else 'beta'
    try:
        other = read(aws, other_env, 'credentials')
    except AwsError as error:
        if error.code != 'ParameterNotFound': raise
        other = {}
    if other.get('datasetId') == dataset or other.get('accessToken') == token:
        raise ValueError('Beta and production must use separate datasets and tokens')
    aws.writer()
    aws.call('ssm', 'put-parameter', Name=names(env)['credentials'], Type='SecureString', Overwrite=True,
             Value=json.dumps(dict(datasetId=dataset, accessToken=token)))
    print(f'{env}: private credentials stored. Other environment unchanged.')

def configure(aws, env, mode=None, version=None, view=True, lead=True, dry_run=False):
    mode = mode or 'live'
    if mode == 'off' and not version:
        value = read(aws, env, 'settings')
        value['mode'] = 'off'
    else:
        value = dict(mode=mode, version=version or GRAPH_VERSION,
                     viewEnabled=view, leadEnabled=lead)
    validate(value, env)
    if mode != 'off':
        creds = read(aws, env, 'credentials')
        if not re.fullmatch(r'\d{1,30}', creds.get('datasetId', '')) or not creds.get('accessToken'):
            raise ValueError('Enter this environment\'s credentials before enabling tracking')
    print(f'{env}: ' + json.dumps(value, sort_keys=True))
    if not dry_run:
        aws.writer()
        aws.call('ssm', 'put-parameter', Name=names(env)['settings'], Value=json.dumps(value), Type='String', Overwrite=True)
        print('Settings saved; allow up to 60 seconds for runtime caches to refresh.')

def test_event(aws, env, event):
    config = validate(read(aws, env, 'settings'), env)
    # Only the manual regression harness receives a test code; runtime settings stay unchanged.
    customer = {}
    ip = private('Your actual client IP (hidden; leave blank to omit): ').strip()
    if ip:
        ipaddress.ip_address(ip); customer['ip'] = ip
    agent = private('Your browser User-Agent (hidden; required): ')
    if not agent.strip() or len(agent) > 2048 or re.search(r'[\x00-\x1f\x7f]', agent):
        raise ValueError('A valid browser User-Agent is required for website events')
    customer['agent'] = agent
    if event == 'Lead':
        email = private('Your controlled test email (hidden): ').strip()
        if '@' not in email or len(email) > 254: raise ValueError('Enter a controlled test email')
        customer['email'] = email
    if event == 'ViewContent' and not ip:
        raise ValueError('Supply your actual client IP for this ViewContent test; User-Agent alone is insufficient')
    item = dict(environment=env, event=event, config=config, customer=customer, testEventCode=TEST_CODES[env],
                credentials=read(aws, env, 'credentials'), send=True)
    result = subprocess.run(['node', str(ROOT/'tools/meta_test.cjs')], input=json.dumps(item), capture_output=True, text=True, timeout=15)
    if result.returncode: raise ValueError('Meta regression check failed; check credentials, Graph version and Test Events')
    print(result.stdout.strip())

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['secrets', 'configure', 'status', 'test'])
    parser.add_argument('--profile', required=True)
    parser.add_argument('--env', required=True, choices=TEST_CODES)
    parser.add_argument('--mode', choices=['off', 'live'])
    parser.add_argument('--version')
    parser.add_argument('--view', action=argparse.BooleanOptionalAction)
    parser.add_argument('--lead', action=argparse.BooleanOptionalAction)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--event', choices=['ViewContent', 'Lead'], default='ViewContent')
    args = parser.parse_args()
    if args.command != 'configure' and (args.mode or args.version or args.view is not None or args.lead is not None or args.dry_run):
        parser.error('Mode/version/feature flags apply only to configure')
    aws = AWS(args.profile, project(), read_only=args.command in ['status', 'test'] or args.dry_run)
    if args.command == 'secrets': return set_secrets(aws, args.env)
    if args.command == 'configure': return configure(aws, args.env, args.mode, args.version,
        True if args.view is None else args.view, True if args.lead is None else args.lead,
        args.dry_run)
    if args.command == 'test': return test_event(aws, args.env, args.event)
    print(json.dumps(validate(read(aws, args.env, 'settings'), args.env), sort_keys=True))
    out = aws.outputs('signup-'+args.env)
    attrs = aws.call('sqs', 'get-queue-attributes', QueueUrl=out['MetaQueueUrl'], AttributeNames=['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'])
    print(json.dumps(attrs['Attributes'], sort_keys=True))
    alarms = aws.call('cloudwatch', 'describe-alarms', AlarmNamePrefix=f'flat-girl-{args.env}-signup-meta')
    for alarm in alarms.get('MetricAlarms', []): print(f"{alarm['AlarmName']}: {alarm['StateValue']}")

def failure_message(error):
    if isinstance(error, AwsError):
        if error.code == 'LoginSessionExpired':
            return 'AWS session expired. Run: aws login --profile flat-girl-human --region us-east-1, then retry this command.'
        # CLI text can contain private inputs. Expose only a validated AWS error code.
        code = error.code if re.fullmatch(r'[A-Za-z0-9]{1,64}', error.code) else 'CLIError'
        return f'Meta operation failed: AWS request failed ({code}). Check the AWS session, profile and permissions. No credentials were printed.'
    return 'Meta operation failed. Check private inputs and environment settings. No credentials were printed.'

if __name__ == '__main__':
    try: main()
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError, getpass.GetPassWarning) as error:
        sys.exit(failure_message(error))
