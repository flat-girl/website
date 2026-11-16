import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import commerce_build as commerce
from deploy_site import classify, file_manifest, validate_artifact, MUTABLE
from image_plan import digest

TOKEN = 'a' * 32


class CommerceBuildTests(unittest.TestCase):
    def settings(self, **overrides):
        return commerce.public_settings(dict(FLAT_GIRL_STOREFRONT_MODE='commerce', NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN=TOKEN, **overrides), 'beta')

    def artifact(self, root, settings=None):
        settings = settings or self.settings()
        public = root / 'public'
        public.mkdir()
        signup = dict(enabled=False, endpoint='https://beta-api.flatgirl.net/subscribe', siteKey='', environment='beta')
        runtime = {k: settings[k] for k in commerce.FIELDS}
        runtime.update(signupEndpoint=signup['endpoint'], turnstileSiteKey=signup['siteKey'])
        self.html = '<script>window.__NUXT__.config={public:{' + ','.join(k + ':' + json.dumps(v) for k, v in runtime.items()) + '},app:{}}</script>'
        for key in ['index.html', '200.html', '404.html', *commerce.POLICY_FILES]:
            path = public / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(self.html if key.endswith('.html') else '[]')
        files = file_manifest(public)
        manifest = dict(environment='beta', account='123456789012', siteUrl='https://beta.flatgirl.net', noindex=True,
                        commerce=settings, signup=signup, imageOrigin='https://images.example', images={'origin': 'https://images.example'},
                        files=files, artifactDigest=digest(files))
        (root / 'manifest.json').write_text(json.dumps(manifest))
        return public, manifest

    def test_public_token_needs_no_backend_and_waitlist_is_default(self):
        self.assertEqual(self.settings()['commerceEndpoint'], '')
        self.assertEqual(commerce.public_settings({}, 'production')['storefrontMode'], 'waitlist')
        with self.assertRaises(ValueError):
            commerce.public_settings({'FLAT_GIRL_STOREFRONT_MODE': 'commerce'}, 'beta')

    def test_unsafe_overrides_and_private_credentials_are_rejected(self):
        for overrides in [dict(NUXT_PUBLIC_COMMERCE_SOURCE='local'), dict(NUXT_PUBLIC_COMMERCE_ENDPOINT='/api/commerce'),
                          dict(FLAT_GIRL_COMMERCE_ENDPOINT='https://localhost'), dict(NUXT_PUBLIC_CHECKOUT_HOSTS='evil.example'),
                          dict(NUXT_PUBLIC_CHECKOUT_HOSTS='https://flatgirl.myshopify.com'), dict(NUXT_PUBLIC_STOREFRONT_MODE='mock'),
                          dict(NUXT_SHOPIFY_STOREFRONT_TOKEN=TOKEN)]:
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                self.settings(**overrides)
        for token in ['shpat_' + TOKEN, 'shpss_' + TOKEN, 'http://localhost', 'test-public-token', '']:
            with self.assertRaises(ValueError):
                commerce.public_settings({'FLAT_GIRL_STOREFRONT_MODE': 'commerce', 'NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN': token}, 'beta')

    def test_build_environment_removes_unchecked_public_overrides_and_private_token(self):
        result = commerce.build_environment({'NUXT_PUBLIC_UNKNOWN_SECRET': 'secret', 'NUXT_SHOPIFY_STOREFRONT_TOKEN': 'private',
                                            'FLAT_GIRL_COMMERCE_SOURCE': 'local', 'FLAT_GIRL_SIGNUP_ENDPOINT': 'checked'}, self.settings())
        self.assertNotIn('NUXT_PUBLIC_UNKNOWN_SECRET', result)
        self.assertNotIn('NUXT_SHOPIFY_STOREFRONT_TOKEN', result)
        self.assertNotIn('FLAT_GIRL_COMMERCE_SOURCE', result)
        self.assertEqual(result['FLAT_GIRL_SIGNUP_ENDPOINT'], 'checked')
        self.assertEqual(result['NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN'], TOKEN)

    def test_only_known_policy_files_have_mutable_cache_and_publish_before_home(self):
        for key in commerce.POLICY_FILES:
            self.assertEqual(classify(key)['cacheControl'], MUTABLE)
            self.assertLess(classify(key)['phase'], classify('index.html')['phase'])
        for key in ['policies/unknown/index.html', 'policies/privacy-policy/other.json', 'policies/privacy-policy/app.js', 'policies/privacy-policy/../index.html']:
            with self.assertRaises(ValueError):
                classify(key)

    def test_generated_runtime_matches_manifest_and_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public, manifest = self.artifact(root)
            project = dict(account='123456789012', domain='flatgirl.net')
            self.assertEqual(validate_artifact(root, 'beta', project), manifest)
            missing_signup = {k: v for k, v in manifest.items() if k != 'signup'}
            (root / 'manifest.json').write_text(json.dumps(missing_signup))
            with self.assertRaisesRegex(ValueError, 'requires checked signup'):
                validate_artifact(root, 'beta', project)
            for key, value in [('environment', 'production'), ('siteUrl', 'https://flatgirl.net'), ('noindex', False)]:
                changed = dict(manifest, **{key: value})
                (root / 'manifest.json').write_text(json.dumps(changed))
                with self.assertRaises(ValueError):
                    validate_artifact(root, 'beta', project)
            for old, new in [('commerceSource:"shopify"', 'commerceSource:"local"'), (TOKEN, 'b' * 32),
                             ('beta-api.flatgirl.net', 'api.flatgirl.net'), ('checkoutHosts:', 'secret:"private",checkoutHosts:')]:
                (public / 'index.html').write_text(self.html.replace(old, new))
                with self.assertRaises(ValueError):
                    commerce.validate_output(public, manifest['commerce'], 'beta', manifest['signup'])

    def test_missing_manifest_policies_fixtures_and_private_values_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public, manifest = self.artifact(root)
            with self.assertRaisesRegex(ValueError, 'missing its settings'):
                commerce.validate_output(public, None, 'beta')
            for marker in ['/api/commerce/mock-checkout', 'Local policy draft', 'quantityAvailable:327', '"quantityAvailable": 327', 'https://localhost:3000/checkout/demo', 'shpat_' + TOKEN, 'secret-canary']:
                asset = public / '_nuxt/app.js'
                asset.parent.mkdir(exist_ok=True)
                asset.write_text(marker)
                with self.assertRaises(ValueError):
                    commerce.validate_output(public, manifest['commerce'], 'beta', private_values=['secret-canary'])
            asset.unlink()
            (public / next(iter(commerce.POLICY_FILES))).unlink()
            with self.assertRaisesRegex(ValueError, 'Missing generated policy'):
                commerce.validate_output(public, manifest['commerce'], 'beta')

    def test_previous_waitlist_runtime_remains_valid_without_commerce_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            public = Path(directory)
            (public / 'index.html').write_text('<script>window.__NUXT__.config={public:{signupEndpoint:"",turnstileSiteKey:""},app:{}}</script>')
            commerce.validate_output(public, None, 'production')

    def test_archived_host_list_remains_publishable_but_new_builds_require_branded_host(self):
        for hosts in (commerce.LEGACY_CHECKOUT_HOSTS, commerce.CHECKOUT_HOSTS):
            with self.subTest(hosts=hosts), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                settings = dict(self.settings(), checkoutHosts=hosts)
                _, manifest = self.artifact(root, settings)
                self.assertEqual(validate_artifact(root, 'beta', dict(account='123456789012', domain='flatgirl.net')), manifest)
        with self.assertRaisesRegex(ValueError, 'New builds must include'):
            self.settings(NUXT_PUBLIC_CHECKOUT_HOSTS=commerce.LEGACY_CHECKOUT_HOSTS)


if __name__ == '__main__':
    unittest.main()
