export interface TurnstileOptions {
  sitekey: string
  action: string
  appearance: 'interaction-only'
  size: 'flexible' | 'compact'
  theme: 'light'
  retry: 'never'
  'response-field': false
  'refresh-expired': 'manual'
  'refresh-timeout': 'manual'
  callback: (token: string) => void
  'error-callback': () => void
  'expired-callback': () => void
  'timeout-callback': () => void
  'before-interactive-callback': () => void
  'after-interactive-callback': () => void
}

export interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: TurnstileOptions,
  ) => string | undefined
  remove: (widgetId: string) => void
}

type TurnstileWindow = Window & {
  turnstile?: TurnstileApi
  flatGirlTurnstileLoaded?: () => void
}

let pending: Promise<TurnstileApi> | undefined

// Called after mount only. Route changes reuse one script and one loading attempt.
export function loadTurnstile(): Promise<TurnstileApi> {
  const browser = window as TurnstileWindow
  if (pending) return pending
  if (browser.turnstile) return Promise.resolve(browser.turnstile)
  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const timer = window.setTimeout(fail, 10000)
    function cleanup() {
      window.clearTimeout(timer)
      script.onerror = null
      delete browser.flatGirlTurnstileLoaded
    }
    function fail() {
      cleanup()
      script.remove()
      pending = undefined
      reject(new Error('Verification could not load.'))
    }
    browser.flatGirlTurnstileLoaded = () => {
      if (!browser.turnstile) return fail()
      cleanup()
      resolve(browser.turnstile)
    }
    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=flatGirlTurnstileLoaded'
    script.async = true
    script.defer = true
    script.onerror = fail
    document.head.append(script)
  })
  return pending
}
