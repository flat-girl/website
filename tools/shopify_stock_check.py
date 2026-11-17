"""Compare theme inventory and Storefront product inventory over ten paired reads."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
import os
from pathlib import Path
import re
import shlex
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo


URL = 'https://shopify.flatgirl.net/products/boring-flat-girl-plush-blanket?view=flatgirl-data'
PRODUCT_ID = 'gid://shopify/Product/15491665297684'
READS = 10
STOREFRONT_URL = 'https://tepwtx-zw.myshopify.com/api/2026-10/graphql.json'
TOKEN_ENV = 'NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN'
ENV_FILE = Path(__file__).resolve().parents[1] / 'web' / '.env'
# Same product fields and default country context as the website's readProduct().
PRODUCT_QUERY = '''query Blanket($id: ID!) {
      product(id: $id) {
        id title availableForSale totalInventory
        priceRange {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
      }
    }'''


def public_token():
    token = os.environ.get(TOKEN_ENV, '')
    if not token and ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            match = re.fullmatch(r'\s*(?:export\s+)?' + TOKEN_ENV + r'\s*=\s*(.*)', line)
            if match:
                try:
                    values = shlex.split(match.group(1), comments=True)
                except ValueError:
                    raise ValueError(f'Invalid {TOKEN_ENV} entry in web/.env') from None
                token = values[0] if len(values) == 1 else ''
    if not re.fullmatch(r'[a-zA-Z0-9_-]{16,256}', token) or token.lower().startswith('shp'):
        raise ValueError(f'Set the public Storefront token in {TOKEN_ENV} or web/.env')
    return token


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request_json(request):
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=10) as response:
        if response.status != 200:
            raise ValueError(f'Unexpected HTTP status {response.status}')
        return json.load(response)


def read_quantity():
    # JSON negotiation can return Shopify's generic product JSON instead of Liquid.
    body = request_json(urllib.request.Request(URL, headers={
        'Accept': 'text/html', 'Cache-Control': 'no-cache',
    }))
    if (not isinstance(body, dict) or body.get('schemaVersion') != 2
            or body.get('source') != 'shopify-theme' or body.get('productId') != PRODUCT_ID
            or body.get('error')):
        raise ValueError('Unexpected response; check the installed theme template')
    inventory = body.get('inventory')
    quantity = inventory.get('quantity') if isinstance(inventory, dict) else None
    if type(quantity) is not int:
        raise ValueError('Inventory quantity is missing, null, or not an integer')
    return quantity


def read_storefront_quantity(token):
    body = request_json(urllib.request.Request(STOREFRONT_URL,
        data=json.dumps({'query': PRODUCT_QUERY, 'variables': {'id': PRODUCT_ID}}).encode(),
        headers={'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': token},
        method='POST'))
    if not isinstance(body, dict) or body.get('errors') or not isinstance(body.get('data'), dict):
        raise ValueError('Storefront GraphQL failed or returned invalid data')
    product = body['data'].get('product')
    if not isinstance(product, dict) or product.get('id') != PRODUCT_ID:
        raise ValueError('Storefront product missing or unexpected')
    quantity = product.get('totalInventory')
    if type(quantity) is not int:
        raise ValueError('Storefront quantity is missing, null, or not an integer')
    return quantity


def sample(read, *args):
    try:
        return read(*args), None
    except (urllib.error.URLError, OSError, ValueError) as error:
        if isinstance(error, urllib.error.HTTPError):
            reason = f'HTTP {error.code}'
        elif isinstance(error, (json.JSONDecodeError, UnicodeError)):
            reason = 'Response is not valid JSON'
        elif isinstance(error, ValueError):
            reason = str(error)
        else:
            reason = 'Network request failed or timed out'
        return None, reason


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected', type=int, help='Current Admin count to compare against')
    args = parser.parse_args(argv)
    try:
        token = public_token()
    except (OSError, ValueError):
        parser.error(f'Configure a public Storefront token in {TOKEN_ENV} or web/.env')
    print(f'Theme: {URL}')
    print(f'Storefront: {STOREFRONT_URL} (product totalInventory, website default context)')
    print('10 rounds, both sources requested concurrently per round; no deliberate delay.')
    print('Times: America/Chicago. Token is never printed.')
    if args.expected is not None:
        print(f'Expected quantity: {args.expected}')
    quantities = {'theme': [], 'storefront': []}
    failures = {'theme': 0, 'storefront': 0}
    disagreements = 0
    compared = 0
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=2) as pool:
        for number in range(1, READS + 1):
            observed = datetime.now(ZoneInfo('America/Chicago')).isoformat(timespec='milliseconds')
            pending = {'theme': pool.submit(sample, read_quantity),
                       'storefront': pool.submit(sample, read_storefront_quantity, token)}
            results = {source: future.result() for source, future in pending.items()}
            columns = []
            for source, (quantity, error) in results.items():
                if error:
                    failures[source] += 1
                    columns.append(f'{source}=ERROR ({error})')
                else:
                    quantities[source].append(quantity)
                    match = '' if args.expected is None else (' MATCH' if quantity == args.expected else ' MISMATCH')
                    columns.append(f'{source}={quantity}{match}')
            if all(error is None for _, error in results.values()):
                compared += 1
                agree = results['theme'][0] == results['storefront'][0]
                disagreements += not agree
                columns.append('AGREE' if agree else 'DIFFER')
            print(f'{number:2}/{READS}  {observed}  ' + ' | '.join(columns), flush=True)

    print(f'\nFinished in {time.monotonic() - started:.2f}s.')
    for source, values in quantities.items():
        counts = ', '.join(f'{q} ({count}/{READS})' for q, count in sorted(Counter(values).items())) or 'none'
        print(f'{source}: {counts}; errors={failures[source]}')
        if args.expected is not None:
            print(f'  Matched expected {args.expected}: {values.count(args.expected)}/{READS}')
    print(f'Sources disagreed: {disagreements}/{compared} valid pairs')
    inconsistent = any(len(set(values)) > 1 for values in quantities.values())
    mismatch = args.expected is not None and any(q != args.expected for values in quantities.values() for q in values)
    if any(failures.values()) or disagreements or inconsistent or mismatch:
        print('FAIL: errors, differing sources, changing counts, or an expected-count mismatch occurred.')
        return 1
    print('PASS: both sources agree across all ten rounds' + (' with the expected count.' if args.expected is not None
                                      else '; accuracy against Admin was not checked.'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
