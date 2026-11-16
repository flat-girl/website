"""Public static commerce settings and fail-closed artifact checks (no Shopify calls)."""
import json
import re

POLICY_HANDLES = ('refund-policy', 'privacy-policy', 'shipping-policy', 'terms-of-service', 'contact-information')
POLICY_FILES = {f'policies/{handle}/{name}' for handle in POLICY_HANDLES for name in ('index.html', '_payload.json')}
CHECKOUT_HOSTS = 'tepwtx-zw.myshopify.com,flatgirl.myshopify.com'
FIELDS = ('storefrontMode', 'commerceSource', 'commerceEndpoint', 'shopifyStorefrontPublicToken', 'checkoutHosts')
ENV_FIELDS = ('STOREFRONT_MODE', 'COMMERCE_SOURCE', 'COMMERCE_ENDPOINT', 'SHOPIFY_STOREFRONT_PUBLIC_TOKEN', 'CHECKOUT_HOSTS')
DEFAULTS = ('waitlist', 'shopify', '', '', CHECKOUT_HOSTS)


def validate_public(value, environment):
    if not isinstance(value, dict) or set(value) != {'environment', *FIELDS} or value['environment'] != environment:
        raise ValueError('Commerce settings do not match the destination')
    if value['storefrontMode'] not in ('waitlist', 'commerce') or value['commerceSource'] != 'shopify' or value['commerceEndpoint'] != '' or value['checkoutHosts'] != CHECKOUT_HOSTS:
        raise ValueError('Static commerce requires Shopify public access and the configured checkout hosts')
    token = value['shopifyStorefrontPublicToken']
    if not isinstance(token, str) or (token and (not re.fullmatch(r'[A-Za-z0-9_-]{16,256}', token) or token.lower().startswith(('shp', 'test-', 'fixture-', 'your-')))) or (value['storefrontMode'] == 'commerce' and not token):
        raise ValueError('Commerce requires a public Storefront token, never a private/Admin token')
    return value


def public_settings(environ, environment):
    value = dict(environment=environment)
    for field, suffix, default in zip(FIELDS, ENV_FIELDS, DEFAULTS):
        # Source defaults to Shopify for static output, regardless of the dev switch.
        fallback = environ.get('FLAT_GIRL_' + suffix, default) if field != 'commerceSource' else default
        value[field] = environ.get('NUXT_PUBLIC_' + suffix, fallback)
    validate_public(value, environment)
    private = environ.get('NUXT_SHOPIFY_STOREFRONT_TOKEN')
    if private and value['shopifyStorefrontPublicToken'] == private:
        raise ValueError('Private Storefront token supplied as public token')
    return value


def build_environment(environ, settings):
    cleaned = {k: v for k, v in environ.items() if not k.startswith(('NUXT_PUBLIC_', 'FLAT_GIRL_COMMERCE_', 'FLAT_GIRL_STOREFRONT_', 'NUXT_SHOPIFY_'))}
    for field, suffix in zip(FIELDS, ENV_FIELDS):
        cleaned['NUXT_PUBLIC_' + suffix] = settings[field]
    cleaned['FLAT_GIRL_STOREFRONT_MODE'] = settings['storefrontMode']
    # The Nuxt CLI otherwise loads developer credentials and overrides from web/.env.
    return cleaned


def runtime_public(source):
    """Parse Nuxt's flat public runtime object without evaluating archived JavaScript."""
    matches = re.findall(r'window\.__NUXT__\.config\s*=\s*\{public:\{', source)
    if len(matches) != 1:
        raise ValueError('Expected one Nuxt public runtime configuration')
    remaining = source.split(matches[0], 1)[1]
    result = {}
    decoder = json.JSONDecoder()
    while not remaining.startswith('}'):
        key = re.match(r'([A-Za-z][A-Za-z0-9]*):', remaining)
        if not key or key[1] in result:
            raise ValueError('Unrecognized public runtime configuration')
        remaining = remaining[key.end():]
        try:
            value, end = decoder.raw_decode(remaining)
        except ValueError:
            raise ValueError('Unrecognized public runtime value') from None
        result[key[1]] = value
        remaining = remaining[end:]
        if remaining.startswith(','):
            remaining = remaining[1:]
        elif not remaining.startswith('}'):
            raise ValueError('Unrecognized public runtime delimiter')
    return result


def validate_output(public, commerce, environment, signup=None, private_values=()):
    if commerce is not None:
        validate_public(commerce, environment)
        if not POLICY_FILES.issubset({p.relative_to(public).as_posix() for p in public.rglob('*') if p.is_file()}):
            raise ValueError('Missing generated policy documents or payloads')
    for path in public.rglob('*'):
        if path.suffix not in ('.html', '.js', '.json') or not path.is_file():
            continue
        source = path.read_text()
        if (any(value and value in source for value in private_values)
            or re.search(r'shp(?:at|ca|pa|ss)_[A-Za-z0-9]+', source)
            or re.search(r'quantityAvailable["\']?\s*:\s*327\b', source)
            or re.search(r'https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/(?:api/commerce|checkout)', source)
            or any(marker in source for marker in ('/api/commerce/mock-checkout', 'Local policy draft', 'quantity-changed'))):
            raise ValueError('Private credential or local commerce fixture in artifact')
        if path.suffix != '.html':
            continue
        # Pre-commerce waitlist archives have no commerce manifest/runtime fields.
        if commerce is None and 'window.__NUXT__.config' not in source:
            continue
        actual = runtime_public(source)
        if commerce is None:
            if actual.get('storefrontMode', 'waitlist') != 'waitlist':
                raise ValueError('Commerce artifact is missing its settings manifest')
            if not any(field in actual for field in FIELDS):
                continue
            expected = dict(zip(FIELDS, DEFAULTS), environment=environment)
            expected.update({field: actual[field] for field in FIELDS if field in actual})
            validate_public(expected, environment)
        else:
            expected = commerce
        if any(actual.get(field) != expected[field] for field in FIELDS):
            raise ValueError('Generated commerce runtime differs from manifest')
        if set(actual) != {*FIELDS, 'signupEndpoint', 'turnstileSiteKey'}:
            raise ValueError('Unexpected public runtime fields')
        if signup is not None and (actual.get('signupEndpoint') != signup['endpoint'] or actual.get('turnstileSiteKey') != signup['siteKey']):
            raise ValueError('Generated signup runtime differs from destination')
