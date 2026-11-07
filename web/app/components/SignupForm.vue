<script setup lang="ts">
import { loadTurnstile, type TurnstileApi } from '~/utils/turnstile'

const config = useRuntimeConfig().public
const email = ref('')
const website = ref('')
const token = ref('')
const mounted = ref(false)
const busy = ref(false)
const accepted = ref(false)
const message = ref('')
const verificationMessage = ref('')
const verificationFailed = ref(false)
const challenge = ref<HTMLElement>()
const success = ref<HTMLElement>()
let turnstile: TurnstileApi | undefined
let widgetId: string | undefined
let attempt = 0
let controller: AbortController | undefined

watch(email, () => { message.value = '' })

function verificationError(text = 'Verification could not finish. Please try again.') {
  token.value = ''
  verificationFailed.value = true
  verificationMessage.value = text
}

async function verify() {
  const current = ++attempt
  token.value = ''
  verificationFailed.value = false
  verificationMessage.value = current === 1 ? 'Checking for bots...' : ''
  if (widgetId !== undefined) turnstile?.remove(widgetId)
  widgetId = undefined
  try {
    turnstile = await loadTurnstile()
    if (!mounted.value || current !== attempt || !challenge.value) return
    const active = () => mounted.value && current === attempt && !accepted.value
    widgetId = turnstile.render(challenge.value, {
      sitekey: config.turnstileSiteKey, action: 'subscribe', theme: 'light',
      size: 'compact', appearance: 'interaction-only', retry: 'never',
      'response-field': false, 'refresh-expired': 'manual', 'refresh-timeout': 'manual',
      callback: value => {
        if (!active()) return
        token.value = value
        verificationFailed.value = false
        verificationMessage.value = ''
      },
      'error-callback': () => { if (active()) verificationError() },
      'expired-callback': () => { if (active()) verificationError('Verification expired, if you could do it again.') },
      'timeout-callback': () => { if (active()) verificationError() },
      'before-interactive-callback': () => { if (active()) verificationMessage.value = 'Verify you\'re not a bot.' },
      'after-interactive-callback': () => {},
    })
    if (widgetId === undefined) throw new Error('Verification unavailable')
  } catch {
    if (mounted.value && current === attempt) verificationError('Verification could not load. Check your connection and try again.')
  }
}

async function submit() {
  if (!mounted.value || busy.value || accepted.value || !token.value) return
  if (website.value) { message.value = 'Unable to process signup. Please refresh and try again.'; return }
  busy.value = true
  message.value = ''
  const submittedToken = token.value
  token.value = ''
  const request = new AbortController()
  controller = request
  const timer = window.setTimeout(() => request.abort(), 18000)
  let retry = false
  try {
    const result = await fetch(config.signupEndpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      credentials: 'include', redirect: 'error', signal: request.signal,
      body: JSON.stringify({ email: email.value.trim(), website: website.value, turnstileToken: submittedToken }),
    })
    if (!result.ok) {
      if (result.status === 429) message.value = 'Rate limited. Chill for a sec and try again.'
      else if (result.status === 403) message.value = 'Gotta make sure you\'re not a bot.'
      else if (result.status === 400) message.value = 'You sure that\'s your email?.'
      throw new Error('Signup failed')
    }
    const body = await result.json()
    if (body?.accepted !== true) throw new Error('Unexpected response')
    if (!mounted.value) return
    accepted.value = true
    email.value = ''
    ++attempt
    if (widgetId !== undefined) turnstile?.remove(widgetId)
    widgetId = undefined
    await nextTick()
    success.value?.focus()
  } catch {
    if (!mounted.value) return
    if (!message.value) message.value = 'Not sure what\'s up. Try again? Reach out on instagram?'
    retry = true
  } finally {
    window.clearTimeout(timer)
    token.value = ''
    busy.value = false
    if (controller === request) controller = undefined
  }
  // Start the new widget after finally clears the consumed token, avoiding a callback race.
  if (retry && mounted.value) void verify()
}

onMounted(() => {
  mounted.value = true
  void verify()
})
onBeforeUnmount(() => {
  mounted.value = false
  ++attempt
  controller?.abort()
  if (widgetId !== undefined) turnstile?.remove(widgetId)
})
</script>

<template>
  <section class="signup" aria-labelledby="signup-heading">
    <h2 id="signup-heading">Get notified when we drop</h2>
    <p class="signup-intro">We will let you know as soon as they are available; can't guarantee your spot, but you'll be the first to know.</p>
    <p v-if="accepted" ref="success" tabindex="-1" role="status" class="signup-success">
      Request received; we will be in touch.
    </p>
    <form v-else :aria-busy="busy" novalidate @submit.prevent="submit">
      <label for="signup-email" class="signup-label">Email address</label>
      <input id="signup-email" v-model="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="none"
        :spellcheck="false" maxlength="254" required :disabled="!mounted || busy" aria-describedby="signup-message"
        placeholder="you@example.com" class="signup-email">
      <div class="signup-decoy" aria-hidden="true" inert>
        <label for="signup-website">Website</label>
        <input id="signup-website" v-model="website" name="website" type="text" tabindex="-1" autocomplete="off">
      </div>
      <div class="signup-verification">
        <div ref="challenge" />
        <p role="status">{{ verificationMessage }}</p>
        <button v-if="verificationFailed" type="button" :disabled="busy" class="signup-retry" @click="verify">I am not a bot</button>
      </div>
      <p id="signup-message" role="alert" class="signup-error">{{ message }}</p>
      <button type="submit" :disabled="!mounted || busy || !token" class="signup-submit">
        {{ busy ? 'Submitting…' : 'Keep me posted' }}
      </button>
      <p v-if="!mounted" class="signup-help">Enable JavaScript to sign up; gotta ensure you're not a bot.</p>
    </form>
    <p id="signup-privacy" class="signup-privacy">You can unsubscribe if you feel like it, but we recommend against it.</p>
  </section>
</template>

<style scoped>
.signup {
  margin-top: 2rem;
  margin-inline: auto;
  max-width: 28rem;
}

h2 {
  font-size: 1.5rem;
  line-height: 1.333333;
  font-weight: 700;
}

.signup-intro,
.signup-help {
  margin-top: 0.75rem;
}

.signup-verification,
.signup-submit {
  margin-top: 0.5rem;
}

.signup-disclaimer,
.signup-retry,
.signup-email {
  margin-top: 0.5rem;
}

form,
.signup-success,
.signup-privacy {
  margin-top: 1rem;
}

.signup-help,
.signup-disclaimer,
.signup-verification p,
.signup-privacy {
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.signup-label,
.signup-submit {
  font-weight: 600;
}

.signup-label {
  display: block;
}

.signup-email {
  width: 100%;
  border: 1px solid #6b7280;
  border-radius: 0.25rem;
  padding: 0.75rem;
  font-size: 1rem;
}

.signup-email::placeholder {
  color: color-mix(in oklab, currentcolor 50%, transparent);
  opacity: 1;
}

.signup-success {
  border: 1px solid #15803d;
  border-radius: 0.25rem;
  padding: 1rem;
}

.signup-retry {
  text-decoration: underline;
}

.signup-error {
  color: #b91c1c;
  font-size: 0.875rem;
  line-height: 1.25rem;
  font-weight: 600;
}

.signup-error:not(:empty) {
  margin-top: 0.5rem;
}

.signup-submit {
  padding: 0.625rem 1rem;
  background: black;
  color: white;
}

.signup-submit:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.signup-email:focus {
  outline: none;
  border-color: #111;
}

.signup-retry:focus {
  outline: 2px solid #155dfc;
  outline-offset: 2px;
}

.signup-success:focus {
  outline: 2px solid #15803d;
  outline-offset: -2px;
}

.signup-submit:focus {
  outline: 2px solid #155dfc;
  outline-offset: 4px;
}

.signup-privacy {
  color: #374151;
}

.signup-decoy { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
