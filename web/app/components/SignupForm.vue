<script setup lang="ts">
import { loadTurnstile, type TurnstileApi } from '~/utils/turnstile'

const config = useRuntimeConfig().public
const enabled = config.signupEnabled === true
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

function verificationError(text = 'Verification could not finish. Please try again.') {
  token.value = ''
  verificationFailed.value = true
  verificationMessage.value = text
}

async function verify() {
  const current = ++attempt
  token.value = ''
  verificationFailed.value = false
  verificationMessage.value = 'Loading verification…'
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
      'expired-callback': () => { if (active()) verificationError('Verification expired. Please verify again.') },
      'timeout-callback': () => { if (active()) verificationError() },
      'before-interactive-callback': () => { if (active()) verificationMessage.value = 'Complete the verification below.' },
      'after-interactive-callback': () => {},
    })
    if (widgetId === undefined) throw new Error('Verification unavailable')
  } catch {
    if (mounted.value && current === attempt) verificationError('Verification could not load. Check your connection and try again.')
  }
}

async function submit() {
  if (!enabled || !mounted.value || busy.value || accepted.value || !token.value) return
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
      if (result.status === 429) message.value = 'Too many requests right now. Please wait a minute and try again.'
      else if (result.status === 403) message.value = 'Please complete a new verification and try again.'
      else if (result.status === 400) message.value = 'Please check your email address and try again.'
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
    if (!message.value) message.value = 'We couldn’t confirm your signup. Your email is still here—please try again.'
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
  if (enabled) void verify()
})
onBeforeUnmount(() => {
  mounted.value = false
  ++attempt
  controller?.abort()
  if (widgetId !== undefined) turnstile?.remove(widgetId)
})
</script>

<template>
  <section class="mt-8 max-w-md" aria-labelledby="signup-heading">
    <h2 id="signup-heading" class="text-2xl font-bold">Notify me when it drops</h2>
    <p v-if="!enabled" class="mt-3">Notifications aren't available yet. Check back soon.</p>
    <template v-else>
      <p v-if="config.signupEnvironment === 'beta'" class="mt-2 text-sm font-semibold">Test signup — this form uses our test list.</p>
      <p v-if="accepted" ref="success" tabindex="-1" role="status" class="mt-4 rounded border border-green-700 p-4 focus:outline-2 focus:outline-offset-4">
        Thanks—your notification request has been received.
      </p>
      <form v-else class="mt-4" :aria-busy="busy" @submit.prevent="submit">
        <label for="signup-email" class="block font-semibold">Email address</label>
        <input id="signup-email" v-model="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="none"
          :spellcheck="false" maxlength="254" required :disabled="!mounted || busy" aria-describedby="signup-blurb signup-message"
          placeholder="you@example.com" class="mt-2 w-full rounded border border-gray-500 px-3 py-3 text-base focus:outline-2 focus:outline-offset-2">
        <div class="signup-decoy" aria-hidden="true" inert>
          <label for="signup-website">Website</label>
          <input id="signup-website" v-model="website" name="website" type="text" tabindex="-1" autocomplete="off">
        </div>
        <p id="signup-blurb" class="mt-3 text-sm">Submit your email to get the Boring Flat Girl launch notification. You can unsubscribe anytime.</p>
        <p class="mt-2 text-sm">Signing up does not reserve one of the 500 units.</p>
        <div class="mt-3">
          <div ref="challenge" />
          <p role="status" class="text-sm">{{ verificationMessage }}</p>
          <button v-if="verificationFailed" type="button" :disabled="busy" class="mt-2 rounded py-2 underline focus:outline-2 focus:outline-offset-2" @click="verify">Retry verification</button>
        </div>
        <button type="submit" :disabled="!mounted || busy || !token" class="mt-3 w-full rounded bg-black px-4 py-3 font-semibold text-white focus:outline-2 focus:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-50">
          {{ busy ? 'Submitting…' : 'Notify me when it drops' }}
        </button>
        <p id="signup-message" role="alert" class="mt-3 text-sm">{{ message }}</p>
        <p v-if="!mounted" class="mt-3 text-sm">Please enable JavaScript to sign up for the notification.</p>
      </form>
      <p id="signup-privacy" class="mt-4 text-sm text-gray-700">We use Brevo to manage the notification list and send our welcome email, and Cloudflare Turnstile to prevent spam.</p>
    </template>
  </section>
</template>

<style scoped>
.signup-decoy { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
