import type { BrowserContext } from '@playwright/test'

export const signupEndpoint = 'https://signup.invalid/subscribe'
export const widgetScript = `
window.__signupWidgets = [];
window.turnstile = {
  render: function (element, options) {
    var id = String(window.__signupWidgets.length);
    window.__signupWidgets.push(options);
    queueMicrotask(function () { options.callback('fixture-token-' + id); });
    return id;
  },
  remove: function () {}
};
var callback = new URL(document.currentScript.src).searchParams.get('onload');
if (callback) window[callback]();
`
export async function installSignupFixture(context: BrowserContext) {
  if (process.env.FLAT_GIRL_TEST_SIGNUP !== 'true') return
  await context.route('https://challenges.cloudflare.com/**', route => route.fulfill({ contentType: 'application/javascript', body: widgetScript }))
  await context.route(signupEndpoint, route => route.fulfill({ json: { accepted: true } }))
}
