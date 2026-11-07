"""Shared signup secrets, read-only diagnostics, and per-environment enable/disable."""
import argparse
import copy
import getpass
import json
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request
import warnings
from aws_common import AWS, AwsError, project
from prepare_images import ROOT, write_json

CONFIG_PATH = ROOT/'cloud/signup.json'
PARAMETERS = {'turnstile': '/flat-girl/signup/turnstile-secret', 'brevo': '/flat-girl/signup/brevo-api-key'}
LISTS = {'beta': 5, 'production': 4}

def validate_config(value):
    if not isinstance(value, dict) or set(value) != {'turnstileSiteKey', 'beta', 'production'}:
        raise ValueError('Invalid cloud/signup.json structure')
    key = value['turnstileSiteKey']
    if not isinstance(key, str) or key and not re.fullmatch(r'0x[A-Za-z0-9_-]{10,100}', key):
        raise ValueError('Enter the real shared Turnstile site key in cloud/signup.json')
    for env, list_id in LISTS.items():
        item = value[env]
        if not isinstance(item, dict) or set(item) != {'enabled', 'listId', 'rateLimit', 'burstLimit'}:
            raise ValueError('Invalid signup environment settings')
        if (type(item['enabled']) is not bool or type(item['listId']) is not int or item['listId'] != list_id or
            type(item['rateLimit']) not in (int, float) or not 0 < item['rateLimit'] <= 100 or
            type(item['burstLimit']) is not int or not 1 <= item['burstLimit'] <= 100 or
            item['enabled'] and not key):
            raise ValueError('Signup requires beta list 5, production list 4, bounded throttles and a real site key before enabling')
    return value

def config(path=CONFIG_PATH):
    return validate_config(json.loads(path.read_text()))

def endpoint(env):
    if env not in LISTS: raise ValueError('Select beta or production')
    return 'https://' + ('beta-api' if env == 'beta' else 'api') + '.flatgirl.net/subscribe'

def public_settings(cfg, env):
    validate_config(cfg)
    return dict(enabled=cfg[env]['enabled'], endpoint=endpoint(env), siteKey=cfg['turnstileSiteKey'], environment=env)

def validate_public(value, env):
    # Missing settings on milestone 2 manifests are intentionally allowed by the caller.
    if (not isinstance(value, dict) or set(value) != {'enabled','endpoint','siteKey','environment'} or
        type(value['enabled']) is not bool or value['environment'] != env or value['endpoint'] != endpoint(env) or
        not isinstance(value['siteKey'], str) or
        value['siteKey'] and not re.fullmatch(r'0x[A-Za-z0-9_-]{10,100}', value['siteKey']) or
        value['enabled'] and not value['siteKey']):
        raise ValueError('Archived signup settings do not match the destination')
    return value

def build_environment(environ, settings):
    # Nuxt's public overrides must not silently replace the checked build settings.
    cleaned = {k:v for k,v in environ.items() if not k.startswith(('FLAT_GIRL_SIGNUP_', 'FLAT_GIRL_TURNSTILE_', 'NUXT_PUBLIC_SIGNUP_', 'NUXT_PUBLIC_TURNSTILE_'))}
    cleaned.update(FLAT_GIRL_SIGNUP_ENDPOINT=settings['endpoint'], FLAT_GIRL_TURNSTILE_SITE_KEY=settings['siteKey'])
    return cleaned

def set_secrets(aws, selected):
    if not sys.stdin.isatty(): raise ValueError('Run signup-secrets in an interactive terminal; never pass keys in arguments')
    aws.writer()
    for key in ([selected] if selected else PARAMETERS):
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            value = getpass.getpass(f'Shared {key} key (hidden): ')
            confirm = getpass.getpass('Repeat key (hidden): ')
        if value != confirm or not value.strip() or any(c.isspace() for c in value) or len(value) > 4096:
            raise ValueError('Keys must match and contain no whitespace (maximum 4096 characters)')
        aws.writer()
        try:
            aws.call('ssm', 'put-parameter', Name=PARAMETERS[key], Value=value, Type='SecureString', Overwrite=True)
        except Exception:
            raise ValueError('Secret write failed; check the selected AWS session and shared-parameter permissions') from None
        finally:
            value = confirm = None
        print(f'Stored shared {key} key. Both environments use it; allow 60 seconds for runtime cache expiry.')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None

def get_list(key, list_id):
    req = urllib.request.Request(f'https://api.brevo.com/v3/contacts/lists/{list_id}', headers={'api-key': key, 'accept': 'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=12) as result:
            body = json.load(result)
            if not isinstance(body, dict) or body.get('id') != list_id: raise ValueError('Invalid list')
    except Exception:
        raise ValueError(f'Brevo list {list_id} could not be verified; check key, account access and list ID') from None

def preflight(aws, env, cfg):
    validate_config(cfg)
    if not cfg['turnstileSiteKey']: raise ValueError('Set the shared public Turnstile site key in cloud/signup.json first')
    values = {}
    try:
        for label, name in PARAMETERS.items():
            result = aws.call('ssm', 'get-parameter', Name=name, WithDecryption=True)
            if result.get('Parameter', {}).get('Type') != 'SecureString' or not result['Parameter'].get('Value'):
                raise ValueError('Missing SecureString')
            values[label] = result['Parameter']['Value']
    except Exception:
        raise ValueError('Shared signup secrets are missing or unreadable; run signup-secrets with the operator profile') from None
    try: get_list(values['brevo'], LISTS[env])
    finally: values.clear()
    print(f'{env}: shared secrets readable; Brevo list {LISTS[env]} exists; endpoint {endpoint(env)}.')
    print('Confirm both site hostnames in the shared Turnstile widget and the intended Brevo welcome automation before live testing.')

def status(aws, env):
    out = aws.outputs('signup-'+env)
    expected = f'flat-girl-{env}-signup'
    if out.get('SignupFunctionName') != expected or out.get('SignupEndpoint') != endpoint(env) or out.get('BrevoListId') != str(LISTS[env]):
        raise ValueError('Signup stack outputs do not match selected environment')
    result = aws.call('lambda', 'get-function-configuration', FunctionName=expected)
    variables = result.get('Environment', {}).get('Variables', {})
    print(f"{env}: enabled={variables.get('SIGNUP_ENABLED', 'unknown')}; list={LISTS[env]}; state={result.get('State', 'unknown')}; endpoint={endpoint(env)}")
    alarms = aws.call('cloudwatch', 'describe-alarms', AlarmNamePrefix=expected+'-')
    for alarm in alarms.get('MetricAlarms', []):
        print(f"{alarm['AlarmName']}: {alarm['StateValue']}; notification actions={len(alarm.get('AlarmActions', []))}")

def set_enabled(profile, env, enabled, dry_run=False, path=CONFIG_PATH):
    original = path.read_bytes()
    cfg = config(path)
    changed = copy.deepcopy(cfg)
    changed[env]['enabled'] = enabled
    validate_config(changed)
    # cloud.py uses this same config when synthesizing. Dry-run restores exact original bytes.
    write_json(path, changed)
    try:
        subprocess.run([sys.executable, str(ROOT/'tools/cloud.py'), 'diff' if dry_run else 'deploy',
                        '--profile', profile, '--stack', 'signup-'+env], cwd=ROOT, check=True)
    finally:
        if dry_run: path.write_bytes(original)
    if not dry_run:
        print(f'{env} backend enabled={str(enabled).lower()}. cloud/signup.json updated; rebuild/publish the site to change its form.')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['secrets','preflight','status','enabled'])
    parser.add_argument('--profile', required=True)
    parser.add_argument('--env', choices=list(LISTS))
    parser.add_argument('--key', choices=list(PARAMETERS))
    parser.add_argument('--value', choices=['true','false'])
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if args.command != 'secrets' and args.env is None: parser.error('--env is required')
    if args.command == 'secrets' and args.env: parser.error('Keys are shared; omit --env')
    if args.command != 'secrets' and args.key: parser.error('--key applies only to secrets')
    if args.command != 'enabled' and (args.dry_run or args.value): parser.error('--dry-run/--value apply only to enabled')
    if args.command == 'enabled':
        if args.value is None: parser.error('--value is required')
        return set_enabled(args.profile, args.env, args.value == 'true', args.dry_run)
    aws = AWS(args.profile, project(), read_only=args.command != 'secrets')
    if args.command == 'secrets': return set_secrets(aws, args.key)
    if args.command == 'preflight': return preflight(aws, args.env, config())
    return status(aws, args.env)

if __name__ == '__main__':
    try: main()
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError, getpass.GetPassWarning) as error:
        sys.exit(str(error))
