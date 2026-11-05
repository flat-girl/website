export const publicFiles = ['index.html', '200.html', '404.html', '_payload.json', 'robots.txt', 'build.json',
  'favicon.ico', 'favicon.svg', 'sitemap.xml']

// Kept as source text so tests execute the same function that CloudFront runs.
export function routeCode(host: string, beta = false): string {
  return `${beta ? "import cf from 'cloudfront';\nvar crypto = require('crypto');\nconst store = cf.kvs();\n" : ''}
function response(status, headers) {
  headers['cache-control'] = {value:'no-store'};
  ${beta ? "headers['x-robots-tag'] = {value:'noindex, nofollow, noarchive'};" : ''}
  return {statusCode:status, headers:headers};
}
async function handler(event) {
  var request = event.request;
  ${beta ? `var header = request.headers.authorization;
  if (!header || header.value.length > 1024) return response(401, {'www-authenticate':{value:'Basic realm="Flat Girl Beta", charset="UTF-8"'}});
  try {
    var expected = await store.get('authorization-sha256');
    var actual = crypto.createHash('sha256').update(header.value).digest('hex');
    var difference = expected.length ^ actual.length;
    for (var n=0; n<64; n++) difference |= (expected.charCodeAt(n) || 0) ^ actual.charCodeAt(n);
    if (difference) return response(401, {'www-authenticate':{value:'Basic realm="Flat Girl Beta", charset="UTF-8"'}});
  } catch (_) { return response(503, {}); }
  delete request.headers.authorization;` : ''}
  var uri = request.uri;
  if (uri.indexOf('..') !== -1 || /%2e|%2f|%5c/i.test(uri) || uri.indexOf('/.') !== -1 || uri.indexOf('/variants/') === 0)
    return response(404, {});
  var file = ${JSON.stringify(publicFiles)}.indexOf(uri.slice(1)) !== -1 || uri.indexOf('/_nuxt/') === 0;
  var assetLike = file || uri.substring(uri.lastIndexOf('/')+1).indexOf('.') !== -1;
  var destination = uri === '/index.html' ? '/' : (uri === '/' || assetLike ? uri : '/');
  var incoming = request.headers.host ? request.headers.host.value.toLowerCase() : '';
  if (incoming !== ${JSON.stringify(host)} || destination !== uri) {
    var pairs = [];
    Object.keys(request.querystring || {}).forEach(function(key) {
      var entry = request.querystring[key];
      (entry.multiValue || [entry]).forEach(function(item) { pairs.push(key + '=' + item.value); });
    });
    return response(destination !== uri && uri !== '/index.html' ? 302 : 301,
      {location:{value:'https://${host}' + destination + (pairs.length ? '?' + pairs.join('&') : '')}});
  }
  return request;
}`
}
