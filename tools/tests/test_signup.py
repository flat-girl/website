import contextlib
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import signup
from aws_common import AWS

def fixture():
    return dict(turnstileSiteKey='0xTestSiteKeyForOfflineTests',
                beta=dict(enabled=True,listId=5,rateLimit=1,burstLimit=2),
                production=dict(enabled=True,listId=4,rateLimit=3,burstLimit=5))

class SignupTests(unittest.TestCase):
    def test_config_and_artifact_environment_validation(self):
        cfg=fixture()
        for env in ['beta','production']:
            settings=signup.public_settings(cfg,env)
            self.assertEqual(signup.validate_public(settings,env),settings)
            with self.assertRaises(ValueError):signup.validate_public(settings,'beta' if env=='production' else 'production')
        for mutate in [lambda x:x['beta'].update(listId=4),lambda x:x['production'].update(listId=6),lambda x:x.update(turnstileSiteKey=''),
                       lambda x:x.update(turnstileSiteKey='1x00000000000000000000AA'),
                       lambda x:x['production'].update(rateLimit=float('nan')),
                       lambda x:x['production'].update(enabled='true')]:
            invalid=copy.deepcopy(cfg);mutate(invalid)
            with self.assertRaises(ValueError):signup.validate_config(invalid)

    def test_build_discards_inherited_signup_overrides(self):
        settings=signup.public_settings(fixture(),'production')
        env=signup.build_environment({'PATH':'/bin','NUXT_PUBLIC_SIGNUP_ENDPOINT':'https://evil.invalid',
                                     'FLAT_GIRL_SIGNUP_ENDPOINT':'https://beta-api.flatgirl.net/subscribe',
                                     'NUXT_PUBLIC_TURNSTILE_SITE_KEY':'test'},settings)
        self.assertEqual(env['PATH'],'/bin')
        self.assertEqual(env['FLAT_GIRL_SIGNUP_ENDPOINT'],'https://api.flatgirl.net/subscribe')
        self.assertNotIn('NUXT_PUBLIC_SIGNUP_ENDPOINT',env)
        self.assertNotIn('NUXT_PUBLIC_TURNSTILE_SITE_KEY',env)

    def test_enable_dry_run_restores_config_even_on_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'signup.json';path.write_text(json.dumps(fixture()))
            original=path.read_bytes()
            for error in [None,RuntimeError('diff failed')]:
                def run(command,**kwargs):
                    self.assertIn('diff',command);self.assertIn('signup-beta',command)
                    self.assertFalse(json.loads(path.read_text())['beta']['enabled'])
                    if error:raise error
                with patch.object(signup.subprocess,'run',side_effect=run):
                    if error:
                        with self.assertRaises(RuntimeError):signup.set_enabled('operator','beta',False,True,path)
                    else:signup.set_enabled('operator','beta',False,True,path)
                self.assertEqual(path.read_bytes(),original)

    def test_shared_secret_prompt_and_safe_failure(self):
        class Fake:
            def writer(self):pass
            def call(self,*args,**kwargs):
                self.args=args;self.kwargs=kwargs
                if getattr(self,'fail',False):raise ValueError('error includes private-key')
        aws=Fake();out=io.StringIO()
        with patch.object(signup.sys.stdin,'isatty',return_value=True),patch.object(signup.getpass,'getpass',return_value='private-key'),contextlib.redirect_stdout(out):
            signup.set_secrets(aws,'brevo')
            self.assertEqual(aws.kwargs['Name'],'/flat-girl/signup/brevo-api-key')
            self.assertEqual(aws.kwargs['Type'],'SecureString')
            aws.fail=True
            with self.assertRaisesRegex(ValueError,'Secret write failed') as caught:signup.set_secrets(aws,'turnstile')
        self.assertNotIn('private-key',out.getvalue()+str(caught.exception))

    def test_aws_cli_secrets_use_private_temporary_payload_not_argv(self):
        aws=object.__new__(AWS);aws.profile='test';aws.p={'region':'us-east-1'};aws.read_only=False;aws.env={}
        paths=[]
        def run(args,**kwargs):
            self.assertNotIn('private-key',' '.join(args))
            path=Path(args[args.index('--cli-input-json')+1].removeprefix('file://'));paths.append(path)
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            self.assertEqual(json.loads(path.read_text())['Value'],'private-key')
            return type('Result',(),dict(returncode=0,stdout='{}'))()
        with patch('aws_common.subprocess.run',side_effect=run):
            aws.call('ssm','put-parameter',Name=signup.PARAMETERS['brevo'],Value='private-key',Type='SecureString')
        self.assertFalse(paths[0].exists())

    def test_preflight_reads_only_selected_list_and_redacts_keys(self):
        class Fake:
            def call(self,*args,**kwargs):
                self.last=args
                return {'Parameter':{'Type':'SecureString','Value':'private-key'}}
        out=io.StringIO();aws=Fake()
        with patch.object(signup,'get_list') as get_list,contextlib.redirect_stdout(out):
            signup.preflight(aws,'beta',fixture())
            get_list.assert_called_once_with('private-key',5)
        self.assertEqual(aws.last,('ssm','get-parameter'));self.assertNotIn('private-key',out.getvalue())

if __name__=='__main__':unittest.main()
