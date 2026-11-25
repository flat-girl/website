import contextlib
import copy
import io
import json
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import shopify


def product():
    return {'id': shopify.PRODUCT_ID, 'title': 'Blanket', 'handle': 'blanket', 'variants': {
        'pageInfo': {'hasNextPage': False}, 'nodes': [{
            'id': 'gid://shopify/ProductVariant/123', 'title': 'Default', 'availableForSale': True,
            'price': {'amount': '60.0', 'currencyCode': 'USD'},
        }],
    }}


def cart():
    return {'cartCreate': {'userErrors': [], 'warnings': [], 'cart': {
        'checkoutUrl': f'https://{shopify.SHOP}/checkouts/cn/private-checkout',
        'totalQuantity': 1,
        'lines': {'nodes': [{'quantity': 1, 'merchandise': {'id': 'gid://shopify/ProductVariant/123'}}]},
        'cost': {'totalAmount': {'amount': '60.0', 'currencyCode': 'USD'}},
    }}}


class ShopifyTests(unittest.TestCase):
    def test_product_visibility_and_variant_selection(self):
        with self.assertRaisesRegex(ValueError, 'publish it to Headless'):
            shopify.read_product(lambda *args: {'product': None}, 'US')
        item = product()
        item['variants']['nodes'][0]['availableForSale'] = False
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            shopify.select_variant(item)
        item = product()
        with self.assertRaisesRegex(ValueError, 'does not belong'):
            shopify.select_variant(item, 'gid://shopify/ProductVariant/999')
        second = copy.deepcopy(item['variants']['nodes'][0])
        second['id'] = 'gid://shopify/ProductVariant/456'
        item['variants']['nodes'].append(second)
        with self.assertRaisesRegex(ValueError, 'Choose a variant'):
            shopify.select_variant(item)
        self.assertEqual(shopify.select_variant(item, second['id']), second)

    def test_cart_uses_variant_and_market_and_checks_result(self):
        call = Mock(return_value=cart())
        variant = product()['variants']['nodes'][0]
        result = shopify.create_checkout(call, variant, 'CA')
        variables = call.call_args.args[1]
        self.assertEqual(variables['input']['lines'], [{'merchandiseId': variant['id'], 'quantity': 1}])
        self.assertEqual(variables['country'], 'CA')
        self.assertEqual(variables['input']['buyerIdentity']['countryCode'], 'CA')
        self.assertEqual(result['totalQuantity'], 1)

    def test_accepts_renamed_store_checkout_without_changing_api_host(self):
        data = cart()
        data['cartCreate']['cart']['checkoutUrl'] = 'https://flatgirl.myshopify.com/checkouts/cn/private-checkout'
        result = shopify.create_checkout(lambda *args: data, product()['variants']['nodes'][0], 'US')
        self.assertEqual(result['checkoutUrl'], data['cartCreate']['cart']['checkoutUrl'])
        self.assertEqual(shopify.SHOP, 'tepwtx-zw.myshopify.com')

    def test_accepts_branded_checkout_without_rewriting_path_or_query(self):
        data = cart()
        url = 'https://shopify.flatgirl.net/checkouts/example?key=fixture-key'
        data['cartCreate']['cart']['checkoutUrl'] = url
        result = shopify.create_checkout(lambda *args: data, product()['variants']['nodes'][0], 'US')
        self.assertEqual(result['checkoutUrl'], url)

    def test_rejects_partial_cart_warnings_errors_and_untrusted_redirects(self):
        mutations = [
            lambda x: x['cartCreate'].update(userErrors=[{'code': 'INVALID'}]),
            lambda x: x['cartCreate'].update(warnings=[{'code': 'MERCHANDISE_NOT_ENOUGH_STOCK'}]),
            lambda x: x['cartCreate'].update(cart=None),
            lambda x: x['cartCreate']['cart'].update(totalQuantity=0),
            lambda x: x['cartCreate']['cart']['lines'].update(nodes=[]),
            lambda x: x['cartCreate']['cart']['lines']['nodes'][0]['merchandise'].update(id='wrong'),
        ]
        for url in ['http://' + shopify.SHOP, 'https://evil.invalid/checkout',
                    'http://shopify.flatgirl.net/checkouts/example',
                    'https://shopify.flatgirl.net.evil.invalid/checkouts/example',
                    'https://user@shopify.flatgirl.net/checkouts/example',
                    'https://shopify.flatgirl.net:8443/checkouts/example',
                    'https://untrusted.example/checkouts/example',
                    'https://flatgirl.myshopify.com.evil.invalid/checkout',
                    'https://' + shopify.SHOP + '.evil.invalid/', 'https://user@' + shopify.SHOP + '/',
                    'https://' + shopify.SHOP + ':8443/']:
            mutations.append(lambda x, url=url: x['cartCreate']['cart'].update(checkoutUrl=url))
        for mutate in mutations:
            data = cart()
            mutate(data)
            with self.subTest(data=data), self.assertRaises(ValueError):
                shopify.create_checkout(lambda *args: data, product()['variants']['nodes'][0], 'US')

    def test_transport_private_header_and_no_redirects(self):
        response = io.StringIO(json.dumps({'data': {'product': None}}))
        opener = Mock()
        opener.open.return_value = response
        with patch.object(shopify.urllib.request, 'build_opener', return_value=opener) as build:
            self.assertEqual(shopify.request('private-fixture', shopify.PRODUCT_QUERY, {'id': shopify.PRODUCT_ID}),
                             {'product': None})
        req = opener.open.call_args.args[0]
        self.assertEqual(req.get_header('Shopify-storefront-private-token'), 'private-fixture')
        self.assertNotIn('private-fixture', req.full_url)
        self.assertNotIn('private-fixture', req.data.decode())
        self.assertIsInstance(build.call_args.args[0], shopify.NoRedirect)
        self.assertIsNone(build.call_args.args[0].redirect_request(None))

    def test_provider_failures_do_not_expose_token_or_remote_body(self):
        for failure in [urllib.error.HTTPError('secret-url', 401, 'private-fixture', {}, None),
                        RuntimeError('private-fixture')]:
            with patch.object(shopify.urllib.request, 'build_opener') as build:
                build.return_value.open.side_effect = failure
                with self.assertRaises(ValueError) as caught:
                    shopify.request('private-fixture', 'query', {})
                self.assertNotIn('private-fixture', str(caught.exception))
                self.assertNotIn('secret-url', str(caught.exception))
                self.assertEqual(build.return_value.open.call_count, 1)
        with patch.object(shopify.urllib.request, 'build_opener') as build:
            build.return_value.open.return_value = io.StringIO(json.dumps({'errors': [{'message': 'private-fixture'}]}))
            with self.assertRaises(ValueError) as caught:
                shopify.request('private-fixture', 'query', {})
            self.assertNotIn('private-fixture', str(caught.exception))

    def test_interactive_read_only_never_creates_cart(self):
        output = io.StringIO()
        with patch.object(shopify.sys.stdin, 'isatty', return_value=True), \
                patch.object(shopify.getpass, 'getpass', return_value='private-fixture'), \
                patch.object(shopify, 'request', return_value={'product': product()}) as request, \
                patch.object(shopify.webbrowser, 'open') as browser, contextlib.redirect_stdout(output):
            shopify.run(SimpleNamespace(country='US', read_only=True, variant=None))
        self.assertEqual(request.call_count, 1)
        browser.assert_not_called()
        self.assertNotIn('private-fixture', output.getvalue())

    def test_cart_flow_opens_only_validated_checkout(self):
        for response, succeeds in [(cart(), True), ({'cartCreate': {'userErrors': [{'code': 'INVALID'}]}}, False)]:
            output = io.StringIO()
            with patch.object(shopify.sys.stdin, 'isatty', return_value=True), \
                    patch.object(shopify.getpass, 'getpass', return_value='private-fixture'), \
                    patch.object(shopify, 'request', side_effect=[{'product': product()}, response]), \
                    patch.object(shopify.webbrowser, 'open', return_value=True) as browser, \
                    contextlib.redirect_stdout(output):
                args = SimpleNamespace(country='US', read_only=False, variant=None)
                if succeeds:
                    shopify.run(args)
                    browser.assert_called_once_with(cart()['cartCreate']['cart']['checkoutUrl'], new=2)
                else:
                    with self.assertRaises(ValueError):
                        shopify.run(args)
                    browser.assert_not_called()
            self.assertNotIn('private-fixture', output.getvalue())
            self.assertNotIn('private-checkout', output.getvalue())

    def test_noninteractive_input_rejected_before_prompt(self):
        with patch.object(shopify.sys.stdin, 'isatty', return_value=False), \
                patch.object(shopify.getpass, 'getpass') as prompt:
            with self.assertRaisesRegex(ValueError, 'interactive terminal'):
                shopify.run(SimpleNamespace(country='US', read_only=False, variant=None))
            prompt.assert_not_called()


if __name__ == '__main__':
    unittest.main()
