"""Interactive, local Shopify product/cart smoke test. Never submits an order."""
import argparse
import getpass
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import warnings
import webbrowser

SHOP = 'tepwtx-zw.myshopify.com'
CHECKOUT_HOSTS = {SHOP, 'flatgirl.myshopify.com', 'shopify.flatgirl.net', 'checkout.shopify.com', 'shopify.com'}
PRODUCT_ID = 'gid://shopify/Product/15491665297684'
API_VERSION = '2026-10'

PRODUCT_QUERY = '''query ProductProof($id: ID!, $country: CountryCode!) @inContext(country: $country) {
  product(id: $id) {
    id title handle
    variants(first: 100) {
      pageInfo { hasNextPage }
      nodes { id title availableForSale price { amount currencyCode } }
    }
  }
}'''

CART_MUTATION = '''mutation CartProof($input: CartInput!, $country: CountryCode!) @inContext(country: $country) {
  cartCreate(input: $input) {
    cart {
      checkoutUrl totalQuantity
      lines(first: 2) { nodes { quantity merchandise { ... on ProductVariant { id } } } }
      cost { totalAmount { amount currencyCode } }
    }
    userErrors { code }
    warnings { code }
  }
}'''


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(token, query, variables):
    req = urllib.request.Request(
        f'https://{SHOP}/api/{API_VERSION}/graphql.json',
        data=json.dumps({'query': query, 'variables': variables}).encode(),
        headers={'Shopify-Storefront-Private-Token': token,
                 'Content-Type': 'application/json', 'Accept': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=20) as response:
            body = json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError(f'Shopify HTTP {error.code}; check the private Storefront token and permissions.') from None
    except Exception:
        raise ValueError('Shopify request failed; check connectivity. No automatic retry was attempted.') from None
    if not isinstance(body, dict) or body.get('errors') or not isinstance(body.get('data'), dict):
        # Never echo remote error messages: they can contain request data.
        raise ValueError('Shopify GraphQL request failed; check Storefront permissions and API version.')
    return body['data']


def read_product(call, country):
    product = call(PRODUCT_QUERY, {'id': PRODUCT_ID, 'country': country}).get('product')
    if not product:
        raise ValueError('Product is not visible. Make it Active and publish it to Headless; check the selected market.')
    if product['id'] != PRODUCT_ID:
        raise ValueError('Shopify returned an unexpected product.')
    if product['variants']['pageInfo']['hasNextPage']:
        raise ValueError('Product has more than 100 variants; this one-product proof needs pagination before proceeding.')
    if not product['variants']['nodes']:
        raise ValueError('Product has no visible variants.')
    return product


def select_variant(product, selected=None):
    variants = product['variants']['nodes']
    if selected:
        matches = [item for item in variants if item['id'] == selected]
        if not matches:
            raise ValueError('Selected variant does not belong to this product.')
        variant = matches[0]
    elif len(variants) == 1:
        variant = variants[0]
    else:
        raise ValueError('Choose a variant from the printed list and rerun with --variant ID (or make VARIANT=ID).')
    if variant['availableForSale'] is not True:
        raise ValueError('Selected variant is unavailable; no cart was created.')
    return variant


def create_checkout(call, variant, country):
    data = call(CART_MUTATION, {'country': country, 'input': {
        'lines': [{'merchandiseId': variant['id'], 'quantity': 1}],
        'buyerIdentity': {'countryCode': country},
        'attributes': [{'key': 'flatgirl_source', 'value': 'local-integration-proof'}],
    }})
    result = data.get('cartCreate')
    if not isinstance(result, dict) or result.get('userErrors') or result.get('warnings'):
        raise ValueError('Cart creation returned errors or warnings; check stock, market, and permissions. Checkout was not opened.')
    cart = result.get('cart')
    expected = [{'quantity': 1, 'merchandise': {'id': variant['id']}}]
    if not cart or cart.get('totalQuantity') != 1 or cart.get('lines', {}).get('nodes') != expected:
        raise ValueError('Cart does not contain exactly one unit of the selected variant. Checkout was not opened.')
    url = cart.get('checkoutUrl', '')
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname not in CHECKOUT_HOSTS
            or parsed.username or parsed.password or parsed.port not in (None, 443)):
        raise ValueError('Unexpected checkout host. Review Shopify domain configuration before opening checkout.')
    return cart


def run(args):
    if not sys.stdin.isatty():
        raise ValueError('Run in your own interactive terminal; the private token is entered with echo disabled.')
    print(f'Store: {SHOP}; product: {PRODUCT_ID}; market: {args.country}; API: {API_VERSION}')
    print('Use the PRIVATE Storefront API token from Headless. It is not saved.')
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        token = getpass.getpass('Private Storefront API token (hidden): ').strip()
    if not token or len(token) > 4096 or any(c.isspace() for c in token) or not token.isascii():
        raise ValueError('Token must be nonempty ASCII without whitespace.')
    call = lambda query, variables: request(token, query, variables)
    product = read_product(call, args.country)
    # JSON encoding keeps product titles from injecting terminal control sequences.
    print(f'Product: {json.dumps(product["title"])}; handle: {json.dumps(product["handle"])}')
    for variant in product['variants']['nodes']:
        print(json.dumps({key: variant[key] for key in ('id', 'title', 'availableForSale', 'price')}))
    print('PASS: product is readable through the Storefront API.')
    if args.read_only:
        return
    variant = select_variant(product, args.variant)
    cart = create_checkout(call, variant, args.country)
    print('PASS: Shopify created a cart with exactly one unit of the selected variant.')
    print('Estimated cart total (final shipping/tax shown at checkout): ' + json.dumps(cart['cost']['totalAmount']))
    print('No order has been submitted. Test-payment mode cannot be verified through this API.')
    print('Complete checkout using your test gateway, then check the order, email, and order-status link.')
    if not webbrowser.open(cart['checkoutUrl'], new=2):
        print('Browser did not open. Open this private checkout link manually (do not share it):')
        print(cart['checkoutUrl'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--read-only', action='store_true', help='Read product only; do not create a cart or open a browser')
    parser.add_argument('--variant', help='Exact gid://shopify/ProductVariant/... ID; required if multiple variants exist')
    parser.add_argument('--country', default='US', help='Two-letter Shopify market country code (default US)')
    args = parser.parse_args()
    if not re.fullmatch('[A-Z]{2}', args.country):
        parser.error('--country must be a two-letter uppercase country code')
    try:
        run(args)
    except (ValueError, getpass.GetPassWarning) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print('\nCancelled.', file=sys.stderr)
        return 1
    except Exception:
        print('Error: unexpected response or local failure; no raw response or credentials were logged.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
