import type { BrowserContext } from '@playwright/test'

export const signupEndpoint = 'https://signup.invalid/subscribe'
export function createWidgetScript(token?: string) {
  return `
window.__signupWidgets = [];
window.turnstile = {
  render: function (element, options) {
    var id = String(window.__signupWidgets.length);
    window.__signupWidgets.push(options);
    queueMicrotask(function () { options.callback(${token === undefined ? "'fixture-token-' + id" : JSON.stringify(token)}); });
    return id;
  },
  remove: function () {}
};
var callback = new URL(document.currentScript.src).searchParams.get('onload');
if (callback) window[callback]();
`
}
export const widgetScript = createWidgetScript()
export async function installSignupFixture(context: BrowserContext) {
  await context.route('https://challenges.cloudflare.com/**', route => route.fulfill({ contentType: 'application/javascript', body: widgetScript }))
  if (process.env.FLAT_GIRL_TEST_SIGNUP !== 'true') return
  await context.route(signupEndpoint, route => route.fulfill({ json: { accepted: true } }))
}
